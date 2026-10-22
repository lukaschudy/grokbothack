import { asUser } from "@/lib/db";
import { formatWindow } from "@/lib/time";
import { body, CANT_POST, fail, isRls, ok, requireMember } from "@/lib/api";

/** POST /api/requests {venue_id, start, end, headcount, message}. Saved as a draft: this demo doesn't send email. */
export async function POST(req: Request) {
  const me = await requireMember(req);
  if (me instanceof Response) return me;
  if (!me.can_post) return fail(403, CANT_POST);
  const b = await body<{ venue_id: string; start: string; end: string; headcount: number; message: string }>(req);
  const start = new Date(String(b.start ?? ""));
  const end = new Date(String(b.end ?? ""));
  if (!b.venue_id || !String(b.message ?? "").trim() || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return fail(400, "Send venue_id, start, end, headcount and message.");
  }
  const subject = `Venue request: ${Number(b.headcount) || "?"} people, ${formatWindow(start, end)}`;
  try {
    const [row] = await asUser(me.id, (tx) => tx<{ id: string }[]>`
      insert into requests (venue_id, subject, body) values (${String(b.venue_id)}, ${subject}, ${String(b.message)}) returning id`);
    return ok({ id: row!.id, status: "draft", subject, message: "Saved as a draft on the website (Find a room → Draft request), where it opens in your email. This demo doesn't send email itself." }, 201);
  } catch (e) {
    if (isRls(e)) return fail(403, CANT_POST);
    if (/foreign key/.test((e as Error).message)) return fail(404, "No such venue.");
    throw e;
  }
}
