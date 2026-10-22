// Helpers for the JSON API the Grok Bot calls (Authorization: Bearer <token>).
import { readSession } from "./auth";
import { memberById, type Member } from "./session";

export const ok = (data: unknown, status = 200) => Response.json(data, { status });
export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => Response.json({ error, ...extra }, { status });

export const bearerUid = (req: Request) => readSession(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim());

/** The signed-in member, or a 401 response telling the bot how to sign in. */
export async function requireMember(req: Request): Promise<Member | Response> {
  const member = await memberById(bearerUid(req));
  return member ?? fail(401, "Not signed in. Run the join skill: POST /api/join or POST /api/login, then send Authorization: Bearer <token>.");
}

export async function body<T>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>;
  } catch {
    return {};
  }
}

export const isRls = (e: unknown) => /row-level security|not_trusted/.test((e as Error)?.message ?? "");

export const CANT_POST =
  "You can't post yet. A member needs to vouch for you: ask an organiser who knows you to say \"vouch for <your name>\" to their bot. Anyone who vouches is accountable for what you post.";
