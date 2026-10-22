// Shared plumbing for the JSON API the Grok Bot skills call (bot/skills/*.md).
// Auth is `Authorization: Bearer <lib/auth signSession token>`; writes run through asUser so RLS decides.
import { readSession } from "./auth";
import { placeCall } from "./dialer";
import { geocode } from "./places";
import { resolveLumaEvent } from "./sources/luma";
import type { CallResult } from "./bus";
import { asUser, sql } from "./db";
import { formatWindow, londonToUtc } from "./time";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export type Email = { from: string; to: string[]; cc: string[]; reply_to: string; subject: string; text: string };

async function resendEmail(mail: Email): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(mail),
    signal: AbortSignal.timeout(10_000)
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Outside effects, swappable in tests. */
export const deps = {
  geocode,
  resolveLuma: resolveLumaEvent,
  placeCall,
  sendEmail: (mail: Email) => resendEmail(mail),
  emailConfigured: () => Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM)
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PATCH, OPTIONS"
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS } });

export const preflight = () => new Response(null, { status: 204, headers: CORS });

/** Map Postgres errors raised by our SQL functions and RLS to HTTP. */
function pgToHttp(e: unknown): HttpError | null {
  const err = e as { message?: string; code?: string; detail?: string };
  const msg = err?.message ?? "";
  if (msg.includes("not_trusted") || /row-level security/.test(msg))
    return new HttpError(403, "not_trusted", "You can't do that yet: a member needs to vouch for you.");
  if (msg.includes("venue_not_found")) return new HttpError(404, "venue_not_found", "No such venue (or it was removed as junk).");
  if (msg.includes("not_ok_to_call"))
    return new HttpError(409, "not_ok_to_call", "Only bookable venues whose poster said OK can be called. Send a request or ask a past host for an intro.");
  if (msg.includes("no_phone")) return new HttpError(409, "no_phone", "No phone number on file for this venue. Send a request instead.");
  if (err?.code === "23505") return new HttpError(409, "conflict", err.detail ?? "Already exists");
  if (err?.code === "23514" || err?.code === "22P02") return new HttpError(400, "invalid_input", err.detail ?? msg);
  return null;
}

/** Wrap a handler: JSON errors as `{error, message}`, never a stack trace. */
export function route<A extends unknown[]>(fn: (req: Request, ...args: A) => Promise<Response>) {
  return async (req: Request, ...args: A): Promise<Response> => {
    try {
      return await fn(req, ...args);
    } catch (e) {
      const h = e instanceof HttpError ? e : pgToHttp(e);
      if (!h) console.error(`[api] ${req.method} ${new URL(req.url).pathname}`, e);
      const out = h ?? new HttpError(500, "server_error", "Something went wrong on our side.");
      return json({ error: out.code, message: out.message, ...out.extra }, out.status);
    }
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  if (text.length > 100_000) throw new HttpError(413, "too_large", "Body too large");
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {}
  throw new HttpError(400, "invalid_json", "Body must be a JSON object");
}

export async function requireUser(req: Request): Promise<string> {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(\S+)$/i);
  const uid = readSession(m?.[1]);
  if (uid) {
    const [p] = await sql`select 1 from profiles where id = ${uid}`;
    if (p) return uid;
  }
  throw new HttpError(401, "unauthorized", "Missing or invalid token. Join (POST /api/join) or log in (POST /api/login).");
}

export const canPost = async (uid: string) => (await sql<{ ok: boolean }[]>`select can_post(${uid}) as ok`)[0]!.ok;

export async function requirePoster(uid: string) {
  if (!(await canPost(uid)))
    throw new HttpError(403, "not_trusted", "You can't post yet: a member needs to vouch for you (they say: vouch for <your name>). Vouchers are accountable for what you post.");
}

export function publicBase(req: Request): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0] ?? u.protocol.replace(":", "");
  return `${proto}://${req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host}`;
}

// ---------- input checks (no zod in this repo) ----------

const bad = (msg: string) => new HttpError(400, "invalid_input", msg);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function str(v: unknown, name: string, o: { min?: number; max?: number; optional?: boolean } = {}): string | null {
  if (v == null || (typeof v === "string" && !v.trim() && o.optional)) {
    if (o.optional) return null;
    throw bad(`${name} is required`);
  }
  if (typeof v !== "string") throw bad(`${name} must be text`);
  const s = v.trim();
  if (s.length < (o.min ?? 1)) throw bad(`${name} is required`);
  if (s.length > (o.max ?? 500)) throw bad(`${name} is too long (max ${o.max ?? 500})`);
  return s;
}

export function int(v: unknown, name: string, o: { min?: number; max?: number; optional?: boolean } = {}): number | null {
  if (v == null || v === "") {
    if (o.optional) return null;
    throw bad(`${name} is required`);
  }
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < (o.min ?? 1) || n > (o.max ?? 5000)) throw bad(`${name} must be a whole number from ${o.min ?? 1} to ${o.max ?? 5000}`);
  return n;
}

export function bool(v: unknown, name: string): boolean | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || typeof v === "boolean") return v;
  if (v === "true" || v === "yes") return true;
  if (v === "false" || v === "no") return false;
  throw bad(`${name} must be true or false`);
}

export function uuid(v: unknown, name: string): string {
  if (typeof v !== "string" || !UUID.test(v)) throw bad(`${name} must be an id`);
  return v;
}

export function oneOf<T extends string>(v: unknown, name: string, values: readonly T[]): T | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "string" && (values as readonly string[]).includes(v)) return v as T;
  throw bad(`${name} must be one of ${values.join(", ")}`);
}

export function email(v: unknown, name: string, optional = false): string | null {
  const s = str(v, name, { max: 200, optional });
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad(`${name} must be an email address`);
  return s?.toLowerCase() ?? null;
}

/**
 * A time from the bot. With an offset or Z it is taken as given; without one
 * ("2026-10-29T18:30") it is London wall-clock time.
 */
export function parseLondonTime(input: string): Date | null {
  const s = input.trim().replace(" ", "T");
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?)?$/);
  return m ? londonToUtc(m[1]!, m[2] ?? "18:30") : null;
}

/** start (required) and end (default start + 3 h). */
export function timeWindow(start: unknown, end: unknown): { start: Date; end: Date } {
  const s = typeof start === "string" ? parseLondonTime(start) : null;
  if (!s) throw bad("start must be a date-time, e.g. 2026-10-29T18:30 (London time)");
  const e = end == null || end === "" ? new Date(s.getTime() + 3 * 3600_000) : typeof end === "string" ? parseLondonTime(end) : null;
  if (!e) throw bad("end must be a date-time, e.g. 2026-10-29T21:30 (London time)");
  if (e <= s) throw bad("end must be after start");
  return { start: s, end: e };
}

/** UK-friendly phone → E.164. "07700 900123" → "+447700900123". */
export function toE164(raw: string): string | null {
  let s = raw.replace(/\(0\)/g, "").replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  else if (/^0\d{9,10}$/.test(s)) s = `+44${s.slice(1)}`;
  else if (/^44\d{9,10}$/.test(s)) s = `+${s}`;
  return /^\+[1-9][0-9]{6,14}$/.test(s) ? s : null;
}

// ---------- shared views ----------

/** Public venue view: never includes venue_contacts, only whether the assistant can use them. */
export async function venueView(id: string) {
  const [v] = await sql`
    select v.id, v.name, v.address, v.area, v.kind, v.capacity, v.av, v.evening_ok, v.weekend_ok,
      v.terms, v.price_note, v.ok_to_call, v.intro_via_poster, v.website,
      st_y(v.location::geometry) as lat, st_x(v.location::geometry) as lng, v.updated_at,
      (v.ok_to_call and v.kind = 'bookable' and exists (select 1 from venue_contacts c where c.venue_id = v.id and c.phone is not null)) as can_call,
      coalesce((select json_agg(json_build_object('community', h.community, 'event_title', h.event_title, 'event_url', h.event_url,
                 'event_date', h.event_date, 'attendees', h.attendees) order by h.event_date desc nulls last)
                from venue_hosts h where h.venue_id = v.id), '[]') as past_hosts
    from venues v where v.id = ${id} and v.junk_at is null`;
  if (!v) throw new HttpError(404, "venue_not_found", "No such venue (or it was removed as junk).");
  return v;
}

// ---------- calls: what Grok Bot polls ----------

const DONE = new Set(["completed", "failed", "no_answer", "busy", "canceled"]);

export type CallState = {
  status: string;
  venue_name: string;
  when: string;
  headcount: number;
  result: CallResult | null;
  error: string | null;
  last_said: { who: "agent" | "venue"; text: string } | null;
};

/** One or two plain sentences for the organiser: where the call is, or what the venue said. */
export function callSummary(c: CallState): string {
  const v = c.venue_name;
  const r = c.result;
  if (r) {
    const said = [
      r.max_people ? `up to ${r.max_people} people` : null,
      r.price,
      r.conditions ? `Conditions: ${r.conditions}` : null
    ].filter(Boolean).join(". ");
    const who = r.contact_name ? ` Confirmed by ${[r.contact_name, r.contact_role].filter(Boolean).join(", ")}.` : "";
    const next = r.next_step ? ` Next step: ${r.next_step}.` : "";
    const alt = r.alternative ? ` They offered: ${r.alternative}.` : "";
    const head =
      r.status === "available" ? `${v} is free ${c.when}` :
      r.status === "partial" ? `${v} is partly free ${c.when}` :
      `${v} isn't free ${c.when}`;
    return `${head}${said ? `: ${said}` : ""}.${who}${alt}${next}`.replace(/\.\./g, ".");
  }
  switch (c.status) {
    case "queued":
    case "dialing": return `Dialling ${v} about ${c.when} for ${c.headcount} people…`;
    case "ringing": return `Ringing ${v}…`;
    case "in_progress": return `On the phone with ${v} now.${c.last_said ? ` Last said (${c.last_said.who}): "${c.last_said.text.slice(0, 160)}"` : ""}`;
    case "no_answer": return `No answer from ${v}. Want me to email them a request instead?`;
    case "busy": return `${v}'s line was busy. Try again later, or email them a request?`;
    case "canceled": return `The call to ${v} was cancelled${c.error ? ` (${c.error})` : ""}.`;
    case "failed": return `The call to ${v} didn't go through${c.error ? ` (${c.error})` : ""}. Email them a request instead?`;
    case "completed": return `The call to ${v} ended without a clear answer. Email them a request instead?`;
    default: return `Call status: ${c.status}.`;
  }
}

/** A call as the bot sees it: status, summary, the venue's answer and the dated availability record. Members only (RLS). */
export async function callView(uid: string, id: string) {
  const [c] = await asUser(uid, (tx) => tx`
    select c.id, c.venue_id, v.name as venue_name, c.status, c.starts_at, c.ends_at, c.headcount, c.event_title,
      c.answered_at, c.ended_at, c.result, c.error, c.created_at, c.transcript -> -1 as last_line,
      (select json_build_object('status', a.status, 'conditions', a.conditions, 'price_note', a.price_note,
              'confirmed_by_name', a.confirmed_by_name, 'created_at', a.created_at)
       from availability a where a.call_id = c.id order by a.created_at desc limit 1) as availability
    from calls c join venues v on v.id = c.venue_id where c.id = ${id}`);
  if (!c) throw new HttpError(404, "call_not_found", "No such call (only vouched members can see calls).");
  const { last_line, ...rest } = c;
  const last_said = last_line?.who && last_line?.text ? { who: last_line.who, text: last_line.text } : null;
  const when = formatWindow(c.starts_at, c.ends_at);
  const summary = callSummary({ status: c.status, venue_name: c.venue_name, when, headcount: c.headcount, result: c.result, error: c.error, last_said });
  return { ...rest, when, done: DONE.has(c.status), summary, last_said };
}
