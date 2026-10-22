import { sql } from "@/lib/db";
import { json, preflight, requireUser, route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export const GET = route(async (req) => {
  const uid = await requireUser(req);
  const [p] = await sql`
    select p.id, p.display_name, p.community, p.is_root, p.banned_at, p.created_at, a.email,
      can_post(p.id) as can_post, can_vouch(p.id) as can_vouch,
      coalesce((select array_agg(v.display_name order by x.created_at) from vouches x join profiles v on v.id = x.voucher_id where x.vouchee_id = p.id), '{}') as vouched_by,
      coalesce((select array_agg(v.display_name order by x.created_at) from vouches x join profiles v on v.id = x.vouchee_id where x.voucher_id = p.id), '{}') as vouched_for
    from profiles p join accounts a on a.id = p.id where p.id = ${uid}`;
  return json({
    profile: { id: p!.id, display_name: p!.display_name, community: p!.community, is_root: p!.is_root, created_at: p!.created_at },
    email: p!.email, status: p!.banned_at ? "banned" : p!.can_post ? "member" : "pending",
    can_post: p!.can_post, can_vouch: p!.can_vouch, vouched_by: p!.vouched_by, vouched_for: p!.vouched_for
  });
});
