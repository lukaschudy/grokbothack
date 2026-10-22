import { signIn, signSession } from "@/lib/auth";
import { HttpError, json, preflight, readJson, route, str } from "@/lib/api";

export const OPTIONS = preflight;

export const POST = route(async (req) => {
  const b = await readJson(req);
  const uid = await signIn(str(b.email, "email", { max: 200 })!, typeof b.password === "string" ? b.password : "");
  if (!uid) throw new HttpError(401, "bad_credentials", "Wrong email or password.");
  return json({ token: signSession(uid), profile_id: uid });
});
