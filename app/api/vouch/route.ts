import { asUser, sql } from "@/lib/db";
import { body, CANT_POST, fail, isRls, ok, requireMember } from "@/lib/api";
import { memberById } from "@/lib/session";

export async function POST(req: Request) {
  const me = await requireMember(req);
  if (me instanceof Response) return me;
  const name = String((await body<{ display_name: string }>(req)).display_name ?? "").trim();
  if (!name) return fail(400, "Send display_name of the person to vouch for.");
  const matches = await sql<{ id: string; display_name: string; community: string | null }[]>`
    select id, display_name, community from profiles where lower(display_name) = lower(${name})`;
  if (matches.length === 0) return fail(404, `Nobody called "${name}" has joined yet. They need to run the join skill first.`);
  if (matches.length > 1) return fail(409, "More than one person has that name.", { matches: matches.map((m) => ({ display_name: m.display_name, community: m.community })) });
  const target = matches[0]!;
  if (target.id === me.id) return fail(400, "You can't vouch for yourself.");
  try {
    await asUser(me.id, (tx) => tx`insert into vouches (voucher_id, vouchee_id) values (${me.id}, ${target.id}) on conflict do nothing`);
  } catch (e) {
    if (isRls(e)) return fail(403, me.can_post ? "You've lost the right to vouch: someone you vouched for posted junk." : CANT_POST);
    throw e;
  }
  const after = await memberById(target.id);
  return ok({ vouched_for: target.display_name, they_can_post: after!.can_post });
}
