import { asUser } from "@/lib/db";
import { body, CANT_POST, fail, ok, requireMember } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember(req);
  if (me instanceof Response) return me;
  if (!me.can_post) return fail(403, CANT_POST);
  const { id } = await params;
  const reason = String((await body<{ reason: string }>(req)).reason ?? "").slice(0, 300) || null;
  try {
    const [row] = await asUser(me.id, (tx) => tx<{ r: { junk: boolean; reports: number } }[]>`select report_junk(${id}, ${reason}) as r`);
    return ok(row!.r.junk
      ? { recorded: true, removed: true, message: "Removed as junk. The poster can no longer post, and whoever vouched for them lost the right to vouch." }
      : { recorded: true, removed: false, reports: row!.r.reports, message: "Recorded. One more report from a member removes it." });
  } catch (e) {
    if (/venue_not_found/.test((e as Error).message)) return fail(404, "No such venue (or it's already removed).");
    throw e;
  }
}
