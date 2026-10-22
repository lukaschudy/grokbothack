import { asUser } from "@/lib/db";
import { json, preflight, readJson, requireUser, route, str, uuid } from "@/lib/api";

export const OPTIONS = preflight;

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const uid = await requireUser(req);
  const id = uuid((await ctx.params).id, "venue id");
  const b = await readJson(req);
  const reason = str(b.reason, "reason", { optional: true });
  const [row] = await asUser(uid, (tx) => tx<{ r: { junk: boolean; reports: number } }[]>`select report_junk(${id}, ${reason}) as r`);
  const r = row!.r;
  return json({
    ...r,
    message: r.junk
      ? "Marked as junk and hidden. The poster is banned and their vouchers lost vouching rights."
      : `Report recorded (${r.reports}). Two members' reports, or one root's, hide the venue.`
  });
});
