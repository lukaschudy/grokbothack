import { callView, json, preflight, requireUser, route, uuid } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export const GET = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const uid = await requireUser(req);
  return json(await callView(uid, uuid((await ctx.params).id, "call id")));
});
