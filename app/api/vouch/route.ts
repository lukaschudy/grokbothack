import { asUser, sql } from "@/lib/db";
import { canPost, HttpError, json, preflight, readJson, requireUser, route, str, uuid } from "../_lib/http";

export const OPTIONS = preflight;

type Person = { id: string; display_name: string; community: string | null };
const view = (m: Person) => ({ profile_id: m.id, display_name: m.display_name, community: m.community });

export const POST = route(async (req) => {
  const uid = await requireUser(req);
  const b = await readJson(req);
  const byId = b.profile_id != null ? uuid(b.profile_id, "profile_id") : null;
  const name = byId ? null : str(b.display_name, "display_name", { max: 80 });
  const [ok] = await sql<{ ok: boolean }[]>`select can_vouch(${uid}) as ok`;
  if (!ok!.ok)
    throw new HttpError(403, "cannot_vouch", "You can't vouch: you need a vouch yourself, and vouching rights are lost if someone you vouched for posted junk.");
  const matches = byId
    ? await sql<Person[]>`select id, display_name, community from profiles where id = ${byId}`
    : await sql<Person[]>`select id, display_name, community from profiles where lower(display_name) = lower(${name!}) limit 5`;
  if (matches.length === 0) {
    // Never vouch on a fuzzy match: suggest names instead.
    const like = name ? await sql<Person[]>`select id, display_name, community from profiles where display_name ilike ${"%" + name + "%"} limit 5` : [];
    throw new HttpError(404, "not_found", `No organiser called "${name ?? byId}". They need to join first.`, { did_you_mean: like.map(view) });
  }
  if (matches.length > 1) throw new HttpError(409, "ambiguous", "More than one organiser has that name; pass profile_id.", { candidates: matches.map(view) });
  const who = matches[0]!;
  if (who.id === uid) throw new HttpError(400, "self_vouch", "You can't vouch for yourself.");
  await asUser(uid, (tx) => tx`insert into vouches (voucher_id, vouchee_id) values (${uid}, ${who.id}) on conflict do nothing`);
  const nowCan = await canPost(who.id);
  return json({
    vouched: view(who), can_post: nowCan,
    message: nowCan ? `${who.display_name} can now post venues.` : `Vouch recorded, but ${who.display_name} still can't post (banned).`
  });
});
