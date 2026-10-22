import { createAccount, signSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { parseLumaLink } from "@/lib/sources/luma";
import { email, HttpError, json, preflight, readJson, route, str } from "../_lib/http";

export const OPTIONS = preflight;

export const POST = route(async (req) => {
  const b = await readJson(req);
  const mail = email(b.email, "email")!;
  const password = typeof b.password === "string" ? b.password : "";
  if (password.length < 8) throw new HttpError(400, "invalid_input", "password needs at least 8 characters");
  const name = str(b.display_name, "display_name", { max: 80 })!;
  const community = str(b.community, "community", { max: 80, optional: true });
  const luma = str(b.luma_url, "luma_url", { optional: true });
  if (luma) {
    try { parseLumaLink(luma); } catch (e) { throw new HttpError(400, "invalid_input", (e as Error).message); }
  }
  const [taken] = await sql`select 1 from profiles where lower(display_name) = lower(${name})`;
  if (taken)
    throw new HttpError(409, "name_taken", `Someone is already called "${name}". Add your community, e.g. "${name} (${community || "London.js"})".`);
  let uid: string;
  try {
    uid = await createAccount({ email: mail, password, displayName: name, community });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, "email_taken", "That email already has an account. Use POST /api/login.");
    throw e;
  }
  return json({
    token: signSession(uid), profile_id: uid, display_name: name, status: "pending", can_post: false, luma_url: luma,
    next: `You're in. To add venues, ask a member to vouch for you (they type: vouch for ${name}).`
  }, 201);
});
