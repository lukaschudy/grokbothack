import { asUser, sql } from "@/lib/db";
import { body, CANT_POST, fail, isRls, ok, requireMember } from "@/lib/api";
import { memberById } from "@/lib/session";

type Candidate = { id: string; display_name: string; community: string | null; email: string; created_at: Date };

const maskEmail = (e: string) => e.replace(/^(.)[^@]*(@.*)$/, "$1***$2");

/**
 * POST /api/vouch {email} vouches straight away (emails are unique).
 * POST /api/vouch {display_name} only returns the match to confirm, because anyone can
 * sign up under a name; resend with {display_name, confirm: true} once the voucher checks it.
 */
export async function POST(req: Request) {
  const me = await requireMember(req);
  if (me instanceof Response) return me;
  const b = await body<{ display_name: string; email: string; confirm: boolean }>(req);
  const email = String(b.email ?? "").trim().toLowerCase();
  const name = String(b.display_name ?? "").trim();
  if (!email && !name) return fail(400, "Send the person's email (best) or display_name.");

  const matches = email
    ? await sql<Candidate[]>`select p.id, p.display_name, p.community, a.email, p.created_at from profiles p join accounts a on a.id = p.id where a.email = ${email}`
    : await sql<Candidate[]>`select p.id, p.display_name, p.community, a.email, p.created_at from profiles p join accounts a on a.id = p.id where lower(p.display_name) = lower(${name})`;
  if (matches.length === 0) return fail(404, "Nobody with that name or email has joined yet. They need to run the join skill first.");
  const describe = (m: Candidate) => ({ display_name: m.display_name, community: m.community, email_hint: maskEmail(m.email), joined: m.created_at });
  if (matches.length > 1) return fail(409, "More than one person has that name. Ask for their email and vouch by email.", { matches: matches.map(describe) });
  const target = matches[0]!;
  if (target.id === me.id) return fail(400, "You can't vouch for yourself.");
  if (!email && b.confirm !== true) {
    return ok({
      needs_confirmation: true,
      candidate: describe(target),
      message: `Check this is the person you know: ${target.display_name}${target.community ? `, ${target.community}` : ""}, ${maskEmail(target.email)}. If yes, resend with confirm: true. Anyone can sign up under a name, so don't skip this.`
    });
  }
  try {
    await asUser(me.id, (tx) => tx`insert into vouches (voucher_id, vouchee_id) values (${me.id}, ${target.id}) on conflict do nothing`);
  } catch (e) {
    if (isRls(e)) return fail(403, me.can_post ? "You've lost the right to vouch: someone you vouched for posted junk." : CANT_POST);
    throw e;
  }
  const after = await memberById(target.id);
  return ok({ vouched_for: target.display_name, community: target.community, they_can_post: after!.can_post });
}
