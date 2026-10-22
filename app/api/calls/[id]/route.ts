import { asUser } from "@/lib/db";
import { fail, ok, requireMember } from "@/lib/api";
import { callJson } from "../shape";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember(req);
  if (me instanceof Response) return me;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return fail(404, "No such call.");
  const [call] = await asUser(me.id, (tx) => callJson(tx, id));
  return call ? ok(call) : fail(404, "No such call (or you can't see calls until someone vouches for you).");
}
