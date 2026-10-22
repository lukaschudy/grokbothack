import { signIn, signSession } from "@/lib/auth";
import { body, fail, ok } from "@/lib/api";

export async function POST(req: Request) {
  const b = await body<{ email: string; password: string }>(req);
  const uid = await signIn(String(b.email ?? ""), String(b.password ?? ""));
  return uid ? ok({ token: signSession(uid) }) : fail(401, "Email and password don't match.");
}
