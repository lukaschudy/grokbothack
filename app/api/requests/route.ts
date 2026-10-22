import { asUser, sql } from "@/lib/db";
import { formatWindow } from "@/lib/time";
import { deps, HttpError, int, json, preflight, readJson, requirePoster, requireUser, route, str, timeWindow, uuid } from "@/lib/api";

export const OPTIONS = preflight;

/** Email the venue on the organiser's behalf: Reply-To and CC are the organiser. Without email config it stays a draft. */
export const POST = route(async (req) => {
  const uid = await requireUser(req);
  const b = await readJson(req);
  const venueId = uuid(b.venue_id, "venue_id");
  const { start, end } = timeWindow(b.start, b.end);
  const headcount = int(b.headcount, "headcount")!;
  const message = str(b.message, "message", { max: 5000 })!;
  await requirePoster(uid);
  const [v] = await sql<{ name: string; intro_via_poster: boolean; contact_email: string | null; poster_name: string | null }[]>`
    select v.name, v.intro_via_poster, c.email as contact_email, poster.display_name as poster_name
    from venues v left join venue_contacts c on c.venue_id = v.id left join profiles poster on poster.id = v.created_by
    where v.id = ${venueId} and v.junk_at is null`;
  if (!v) throw new HttpError(404, "venue_not_found", "No such venue (or it was removed as junk).");
  const [me] = await sql<{ display_name: string; community: string | null; email: string }[]>`
    select p.display_name, p.community, a.email from profiles p join accounts a on a.id = p.id where p.id = ${uid}`;
  const when = formatWindow(start, end);
  const from = me!.community ? `${me!.display_name} (${me!.community})` : me!.display_name;
  const subject = str(b.subject, "subject", { max: 200, optional: true }) ?? `Venue request: ${headcount} people, ${when}`;
  const text = [
    message, "", "—", `When: ${when} (London time)`, `Headcount: ${headcount}`, `From: ${from}, ${me!.email}`, "",
    `Sent via Mates Rates, the shared venue finder for London community organisers. Reply to this email to reach ${me!.display_name} directly.`
  ].join("\n");
  const [row] = await asUser(uid, (tx) => tx<{ id: string }[]>`
    insert into requests (venue_id, from_profile, subject, body) values (${venueId}, ${uid}, ${subject}, ${text}) returning id`);
  const base = { request_id: row!.id, venue: { id: venueId, name: v.name }, subject, body: text, when };

  if (!v.contact_email) {
    const intro = v.intro_via_poster && v.poster_name ? ` ${v.poster_name} offered intros: ask them.` : "";
    return json({ ...base, status: "draft", reason: "no_contact_email", message: `No email on file for ${v.name}; kept as a draft.${intro}` });
  }
  if (!deps.emailConfigured())
    return json({ ...base, status: "draft", reason: "email_not_configured", message: "Email sending isn't configured on the server yet; kept as a draft." });
  try {
    await deps.sendEmail({ from: process.env.MAIL_FROM ?? "", to: [v.contact_email], cc: [me!.email], reply_to: me!.email, subject, text });
  } catch (e) {
    throw new HttpError(502, "send_failed", `Couldn't send the email (${(e as Error).message}); kept as a draft.`, { ...base, status: "draft" });
  }
  await asUser(uid, (tx) => tx`update requests set status = 'sent', sent_at = now() where id = ${row!.id}`);
  return json({ ...base, status: "sent", message: `Sent to ${v.name}. Replies go to ${me!.email}, and you're CC'd.` }, 201);
});
