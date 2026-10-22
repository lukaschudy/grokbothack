import { ok, requireMember } from "@/lib/api";

export async function GET(req: Request) {
  const me = await requireMember(req);
  if (me instanceof Response) return me;
  return ok({
    display_name: me.display_name, community: me.community, founding_organiser: me.is_root,
    can_post: me.can_post, can_vouch: me.can_vouch, banned: me.banned, vouched_by: me.vouched_by
  });
}
