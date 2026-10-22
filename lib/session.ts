import { cookies } from "next/headers";
import { cache } from "react";
import { readSession } from "./auth";
import { sql } from "./db";

export const SESSION_COOKIE = "rl_session";

export type Member = {
  id: string;
  display_name: string;
  community: string | null;
  is_root: boolean;
  can_post: boolean;
  can_vouch: boolean;
  banned: boolean;
  vouched_by: string[];
};

export async function currentUid(): Promise<string | null> {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function memberById(uid: string | null): Promise<Member | null> {
  if (!uid) return null;
  const [m] = await sql<Member[]>`
    select p.id, p.display_name, p.community, p.is_root,
           can_post(p.id) as can_post, can_vouch(p.id) as can_vouch, p.banned_at is not null as banned,
           coalesce((select array_agg(v.display_name order by vo.created_at)
                     from vouches vo join profiles v on v.id = vo.voucher_id where vo.vouchee_id = p.id), '{}') as vouched_by
    from profiles p where p.id = ${uid}`;
  return m ?? null;
}

export const currentMember = cache(async (): Promise<Member | null> => memberById(await currentUid()));
