import { createAccount, signSession } from "@/lib/auth";
import { memberById } from "@/lib/session";
import { body, fail, ok } from "@/lib/api";

export async function POST(req: Request) {
  const b = await body<{ email: string; password: string; display_name: string; community: string; luma_url: string }>(req);
  const email = String(b.email ?? "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail(400, "Send a valid email.");
  if (String(b.password ?? "").length < 8) return fail(400, "Password needs at least 8 characters.");
  if (!String(b.display_name ?? "").trim()) return fail(400, "Send display_name: the name other organisers know you by.");
  try {
    const uid = await createAccount({ email, password: String(b.password), displayName: String(b.display_name), community: b.community ? String(b.community) : null });
    const me = await memberById(uid);
    return ok({ token: signSession(uid), display_name: me!.display_name, can_post: me!.can_post }, 201);
  } catch (e) {
    if (/unique|duplicate/.test((e as Error).message)) return fail(409, "That email already has an account. Use POST /api/login.");
    throw e;
  }
}
