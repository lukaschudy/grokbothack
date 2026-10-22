// Mates Rates HTTP API. One node:http server: /api/*, /events.ics, static public/.
// /twilio/* is left to lib/calls (attachCallStreams) and never answered here.
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { z } from "zod";
import { createAccount, readSession, signIn, signSession } from "../lib/auth";
import { asUser, sql } from "../lib/db";
import { buildIcs } from "../lib/ics";
import { rankEvents } from "../lib/rank";
import { parseLumaLink, resolveLumaEvent, LumaVenueHiddenError, type ResolvedLumaEvent } from "../lib/sources/luma";
import { AREAS, areaFor, isInLondon, londonDate, type SourceEvent } from "../lib/sources/types";
import { guessKind } from "../scripts/fetch-sources";
import { parseLondonTime, shortDate, whenRange } from "./time";

export type Place = { lat: number; lng: number; label: string };
export type Email = { from: string; to: string[]; cc: string[]; reply_to: string; subject: string; text: string };

export type Deps = {
  geocode: (near: string) => Promise<Place | null>;
  resolveLuma: (url: string) => Promise<ResolvedLumaEvent>;
  sendEmail: ((mail: Email) => Promise<void>) | null;
  placeCall: (callId: string) => Promise<void>;
  publicDir: string;
};

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

const NOMINATIM_UA = "MatesRates/0.1 (+github.com/lukaschudy/grokbothack)";
const LONDON_VIEWBOX = "-0.52,51.7,0.34,51.28";
const geoCache = new Map<string, Place | null>();
let lastNominatim = 0;

const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

/** Known London neighbourhoods first (instant), then Nominatim bounded to London. Cached. */
export async function geocodeLondon(near: string): Promise<Place | null> {
  const key = norm(near).replace(/\b(london|uk|station|tube|underground|roundabout|area)\b/g, "").replace(/\s+/g, " ").trim();
  const area = AREAS.find(([name]) => norm(name) === key);
  if (area) return { label: area[0], lat: area[1], lng: area[2] };
  if (geoCache.has(key)) return geoCache.get(key)!;
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=gb&bounded=1` +
    `&viewbox=${LONDON_VIEWBOX}&q=${encodeURIComponent(near)}`;
  const res = await fetch(url, { headers: { "user-agent": NOMINATIM_UA, accept: "application/json" }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new HttpError(502, "geocoder_unavailable", `Geocoder returned ${res.status}; pass lat and lng instead`);
  const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const place = hit && isInLondon(+hit.lat, +hit.lon) ? { lat: +hit.lat, lng: +hit.lon, label: near.trim() } : null;
  geoCache.set(key, place);
  return place;
}

export async function resendEmail(mail: Email): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(mail),
    signal: AbortSignal.timeout(10_000)
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ---------- validation ----------

const time = z.string().transform((s, ctx) => {
  const d = parseLondonTime(s);
  if (!d) ctx.addIssue({ code: "custom", message: `Not a date/time: ${s}. Use e.g. 2026-10-29T18:30 (London)` });
  return d ?? new Date(NaN);
});
const headcount = z.coerce.number().int().min(1).max(5000);
const KINDS = ["bookable", "company_office", "community_space", "university", "coworking", "pub_or_bar", "other"] as const;
const TERMS = ["free", "free_for_community", "paid", "unknown"] as const;
const uuid = z.uuid();

/** UK-friendly phone → E.164. "07700 900123" → "+447700900123". */
export function toE164(raw: string): string | null {
  let s = raw.replace(/\(0\)/g, "").replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  else if (/^0\d{9,10}$/.test(s)) s = `+44${s.slice(1)}`;
  else if (/^44\d{9,10}$/.test(s)) s = `+${s}`;
  return /^\+[1-9][0-9]{6,14}$/.test(s) ? s : null;
}

const schemas = {
  join: z.object({
    email: z.email().transform((s) => s.trim().toLowerCase()),
    password: z.string().min(8, "Password needs at least 8 characters").max(200),
    display_name: z.string().trim().min(1).max(80),
    community: z.string().trim().max(80).optional().nullable(),
    luma_url: z.string().trim().max(500).optional().nullable()
  }),
  login: z.object({ email: z.string().trim().min(3), password: z.string().min(1) }),
  vouch: z
    .object({ display_name: z.string().trim().min(1).optional(), profile_id: uuid.optional() })
    .refine((v) => v.display_name || v.profile_id, "Give display_name or profile_id"),
  search: z.object({
    near: z.string().trim().min(2).max(200).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    headcount: headcount.optional(),
    capacity: headcount.optional(),
    start: time,
    end: time.optional(),
    free_only: z.enum(["true", "false", "1", "0", "yes", "no"]).optional().transform((v) => v === "true" || v === "1" || v === "yes"),
    radius_m: z.coerce.number().int().min(200).max(20_000).optional()
  }),
  fromLuma: z.object({ url: z.string().trim().min(3).max(500) }),
  patch: z.object({
    capacity: z.coerce.number().int().min(1).max(5000).nullable().optional(),
    av: z.union([z.array(z.string().trim().min(1).max(40)).max(20), z.string().max(400)]).optional()
      .transform((v) => (typeof v === "string" ? v.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : v)),
    evening_ok: z.boolean().nullable().optional(),
    weekend_ok: z.boolean().nullable().optional(),
    terms: z.enum(TERMS).optional(),
    price_note: z.string().trim().max(300).nullable().optional(),
    kind: z.enum(KINDS).optional(),
    ok_to_call: z.boolean().optional(),
    intro_via_poster: z.boolean().optional(),
    contact: z
      .object({
        contact_name: z.string().trim().max(120).nullable().optional(),
        contact_role: z.string().trim().max(120).nullable().optional(),
        email: z.email().nullable().optional(),
        phone: z.string().trim().max(40).nullable().optional().transform((p, ctx) => {
          if (!p) return p;
          const e = toE164(p);
          if (!e) ctx.addIssue({ code: "custom", message: `Phone must be E.164, e.g. +442079460000 (got ${p})` });
          return e;
        })
      })
      .optional()
  }),
  report: z.object({ reason: z.string().trim().max(500).optional().nullable() }),
  request: z.object({
    venue_id: uuid, start: time, end: time.optional(), headcount,
    message: z.string().trim().min(1).max(5000), subject: z.string().trim().max(200).optional()
  }),
  call: z.object({
    venue_id: uuid, start: time, end: time.optional(), headcount,
    event_title: z.string().trim().max(200).optional().nullable()
  })
};

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input ?? {});
  if (r.success) return r.data;
  const msg = r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
  throw new HttpError(400, "invalid_input", msg);
}

const endOr = (start: Date, end: Date | undefined) => {
  const e = end ?? new Date(start.getTime() + 3 * 3600_000);
  if (e <= start) throw new HttpError(400, "invalid_input", "end must be after start");
  return e;
};

// ---------- helpers ----------

type Ctx = { req: http.IncomingMessage; url: URL; body: unknown; deps: Deps };

function bearer(req: http.IncomingMessage): string | null {
  const m = (req.headers.authorization ?? "").match(/^Bearer\s+(\S+)$/i);
  return readSession(m?.[1]);
}

async function requireUser(ctx: Ctx): Promise<string> {
  const uid = bearer(ctx.req);
  if (uid) {
    const [p] = await sql`select 1 from profiles where id = ${uid}`;
    if (p) return uid;
  }
  throw new HttpError(401, "unauthorized", "Missing or invalid token. Join (POST /api/join) or log in (POST /api/login).");
}

const canPost = async (uid: string) => (await sql<{ ok: boolean }[]>`select can_post(${uid}) as ok`)[0]!.ok;

async function requirePoster(uid: string) {
  if (!(await canPost(uid)))
    throw new HttpError(403, "not_trusted", "You can't post yet: a member needs to vouch for you (they say: vouch for <your name>). Vouchers are accountable for what you post.");
}

function publicUrl(req: http.IncomingMessage): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? "http";
  return `${proto}://${req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost"}`;
}

const metres = (m: number) => (m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`);
const TERMS_LABEL: Record<string, string> = {
  free: "Free", free_for_community: "Free for community events", paid: "Paid", unknown: "Terms unconfirmed"
};

const PUBLIC_VENUE_COLS = sql`v.id, v.name, v.address, v.area, v.kind, v.capacity, v.av, v.evening_ok, v.weekend_ok,
  v.terms, v.price_note, v.ok_to_call, v.intro_via_poster, v.website,
  st_y(v.location::geometry) as lat, st_x(v.location::geometry) as lng, v.updated_at`;

async function venueView(id: string) {
  const [v] = await sql`
    select ${PUBLIC_VENUE_COLS},
      (v.ok_to_call and v.kind = 'bookable' and exists (select 1 from venue_contacts c where c.venue_id = v.id and c.phone is not null)) as can_call,
      exists (select 1 from venue_contacts c where c.venue_id = v.id and c.email is not null) as has_email,
      coalesce((select json_agg(json_build_object('community', h.community, 'event_title', h.event_title, 'event_url', h.event_url,
                 'event_date', h.event_date, 'attendees', h.attendees) order by h.event_date desc nulls last)
                from venue_hosts h where h.venue_id = v.id), '[]') as past_hosts
    from venues v where v.id = ${id} and v.junk_at is null`;
  if (!v) throw new HttpError(404, "venue_not_found", "No such venue (or it was removed as junk)");
  return v;
}

/** Map Postgres errors raised by our functions and RLS to HTTP. */
function pgToHttp(e: any): HttpError | null {
  const msg: string = e?.message ?? "";
  if (msg === "not_trusted" || /row-level security/.test(msg))
    return new HttpError(403, "not_trusted", "You can't do that yet: a member needs to vouch for you.");
  if (msg === "venue_not_found") return new HttpError(404, "venue_not_found", "No such venue (or it was removed as junk)");
  if (msg === "not_ok_to_call")
    return new HttpError(409, "not_ok_to_call", "Only bookable venues whose poster said OK can be called. Send a request or ask a past host for an intro.");
  if (msg === "no_phone") return new HttpError(409, "no_phone", "No phone number on file for this venue. Send a request instead.");
  if (e?.code === "23505") return new HttpError(409, "conflict", e.detail ?? "Already exists");
  if (e?.code === "23514" || e?.code === "22P02") return new HttpError(400, "invalid_input", e.detail ?? msg);
  return null;
}

// ---------- handlers ----------

async function join(ctx: Ctx) {
  const b = parse(schemas.join, ctx.body);
  if (b.luma_url) {
    try { parseLumaLink(b.luma_url); } catch (e: any) { throw new HttpError(400, "invalid_input", e.message); }
  }
  const [taken] = await sql`select 1 from profiles where lower(display_name) = lower(${b.display_name})`;
  if (taken)
    throw new HttpError(409, "name_taken", `Someone is already called "${b.display_name}". Add your community, e.g. "${b.display_name} (${b.community || "London.js"})".`);
  let uid: string;
  try {
    uid = await createAccount({ email: b.email, password: b.password, displayName: b.display_name, community: b.community ?? null });
  } catch (e: any) {
    if (e?.code === "23505") throw new HttpError(409, "email_taken", "That email already has an account. Use POST /api/login.");
    throw e;
  }
  return {
    status: 201,
    body: {
      token: signSession(uid), profile_id: uid, display_name: b.display_name, status: "pending", can_post: false,
      luma_url: b.luma_url ?? null,
      next: `You're in. To add venues, ask a member to vouch for you (they type: vouch for ${b.display_name}).`
    }
  };
}

async function login(ctx: Ctx) {
  const b = parse(schemas.login, ctx.body);
  const uid = await signIn(b.email, b.password);
  if (!uid) throw new HttpError(401, "bad_credentials", "Wrong email or password");
  return { body: { token: signSession(uid), profile_id: uid } };
}

async function me(ctx: Ctx) {
  const uid = await requireUser(ctx);
  const [p] = await sql`
    select p.id, p.display_name, p.community, p.is_root, p.banned_at, p.vouch_revoked_at, p.created_at, a.email,
      can_post(p.id) as can_post, can_vouch(p.id) as can_vouch,
      coalesce((select array_agg(v.display_name) from vouches x join profiles v on v.id = x.voucher_id where x.vouchee_id = p.id), '{}') as vouched_by,
      coalesce((select array_agg(v.display_name) from vouches x join profiles v on v.id = x.vouchee_id where x.voucher_id = p.id), '{}') as vouched_for
    from profiles p join accounts a on a.id = p.id where p.id = ${uid}`;
  const status = p!.banned_at ? "banned" : p!.can_post ? "member" : "pending";
  return {
    body: {
      profile: { id: p!.id, display_name: p!.display_name, community: p!.community, is_root: p!.is_root, created_at: p!.created_at },
      email: p!.email, status, can_post: p!.can_post, can_vouch: p!.can_vouch,
      vouched_by: p!.vouched_by, vouched_for: p!.vouched_for
    }
  };
}

async function vouch(ctx: Ctx) {
  const uid = await requireUser(ctx);
  const b = parse(schemas.vouch, ctx.body);
  const [ok] = await sql<{ ok: boolean }[]>`select can_vouch(${uid}) as ok`;
  if (!ok!.ok) throw new HttpError(403, "cannot_vouch", "You can't vouch: you need to be vouched for yourself, and vouching rights are lost if someone you vouched for posted junk.");
  const matches = b.profile_id
    ? await sql`select id, display_name, community from profiles where id = ${b.profile_id}`
    : await sql`select id, display_name, community from profiles where lower(display_name) = lower(${b.display_name!})
                union all
                select id, display_name, community from profiles
                where not exists (select 1 from profiles where lower(display_name) = lower(${b.display_name!}))
                  and display_name ilike ${"%" + b.display_name! + "%"}
                limit 5`;
  if (matches.length === 0) throw new HttpError(404, "not_found", `No organiser called "${b.display_name ?? b.profile_id}". They need to join first.`);
  if (matches.length > 1)
    throw new HttpError(409, "ambiguous", "More than one organiser matches; pass profile_id", {
      candidates: matches.map((m) => ({ profile_id: m.id, display_name: m.display_name, community: m.community }))
    });
  const who = matches[0]!;
  if (who.id === uid) throw new HttpError(400, "self_vouch", "You can't vouch for yourself");
  await asUser(uid, (tx) => tx`insert into vouches (voucher_id, vouchee_id) values (${uid}, ${who.id}) on conflict do nothing`);
  const nowCan = await canPost(who.id);
  return {
    body: {
      vouched: { profile_id: who.id, display_name: who.display_name, community: who.community }, can_post: nowCan,
      message: nowCan ? `${who.display_name} can now post venues.` : `Vouch recorded, but ${who.display_name} still can't post (banned).`
    }
  };
}

type SearchRow = {
  id: string; name: string; address: string | null; area: string | null; kind: string; capacity: number | null; terms: string;
  price_note: string | null; av: string[]; evening_ok: boolean | null; weekend_ok: boolean | null; ok_to_call: boolean;
  intro_via_poster: boolean; lat: number; lng: number; distance_m: number; host_count: string | number; hosts: string[] | null;
  last_hosted: Date | null; availability_status: string | null; availability_conditions: string | null; availability_at: Date | null;
  score: number;
};

async function search(ctx: Ctx) {
  await requireUser(ctx);
  const q = parse(schemas.search, Object.fromEntries(ctx.url.searchParams));
  const people = q.headcount ?? q.capacity;
  if (!people) throw new HttpError(400, "invalid_input", "headcount is required");
  const end = endOr(q.start, q.end);
  let place: Place | null;
  if (q.lat != null && q.lng != null) place = { lat: q.lat, lng: q.lng, label: q.near ?? `${q.lat.toFixed(4)}, ${q.lng.toFixed(4)}` };
  else if (q.near) place = await ctx.deps.geocode(q.near);
  else throw new HttpError(400, "invalid_input", "Give near (e.g. Old Street) or lat and lng");
  if (!place) throw new HttpError(422, "place_not_found", `Couldn't find "${q.near}" in London. Try a station, area or postcode.`);

  const run = (radius: number) => sql<SearchRow[]>`
    select * from search_venues(p_lat => ${place!.lat}, p_lng => ${place!.lng}, p_headcount => ${people},
      p_starts => ${q.start}, p_ends => ${end}, p_radius_m => ${radius}, p_free_only => ${q.free_only}, p_limit => 3)`;
  let radius = q.radius_m ?? 2000;
  let rows = await run(radius);
  let widened = false;
  if (rows.length < 3 && q.radius_m == null) {
    radius = 4000;
    rows = await run(radius);
    widened = true;
  }

  const ids = rows.map((r) => r.id);
  const [extras, clashes] = await Promise.all([
    ids.length
      ? sql`
        select v.id,
          (select max(h.attendees) from venue_hosts h where h.venue_id = v.id) as biggest_turnout,
          (v.ok_to_call and v.kind = 'bookable' and exists (select 1 from venue_contacts c where c.venue_id = v.id and c.phone is not null)) as can_call,
          coalesce((select json_object_agg(s.field, json_build_object('by', s.confirmed_by, 'at', s.confirmed_at))
                    from venue_field_status s where s.venue_id = v.id and s.by_profile is not null
                      and s.field in ('capacity', 'terms', 'evening_ok', 'weekend_ok', 'av')), '{}') as confirmed,
          (select json_build_object('title', e.title, 'url', e.url, 'starts_at', e.starts_at) from events e
            where e.venue_id = v.id and e.starts_at < ${end} and coalesce(e.ends_at, e.starts_at + interval '3 hours') > ${q.start}
            order by e.starts_at limit 1) as busy
        from venues v where v.id = any(${ids}::uuid[])`
      : Promise.resolve([] as any[]),
    sql<{ title: string; url: string; starts_at: Date; venue_name: string | null; community: string | null; attendees: number | null; distance_m: number | null }[]>`
      select * from event_clashes(${place.lat}, ${place.lng}, ${q.start}, ${end}, 3000)`
  ]);
  const byId = new Map(extras.map((x: any) => [x.id, x]));
  const clashList = clashes.map((c) => ({
    title: c.title, url: c.url, starts_at: c.starts_at, venue_name: c.venue_name, community: c.community, attendees: c.attendees,
    distance_m: c.distance_m == null ? null : Math.round(c.distance_m)
  }));
  const top = clashList[0];
  const clashWarning = top
    ? `Same evening: ${top.title}${top.attendees ? ` (${top.attendees} going)` : ""}${top.venue_name ? ` at ${top.venue_name}` : ""}${top.distance_m != null ? `, ${metres(top.distance_m)} away` : ""}`
    : null;
  const evening = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(q.start)) >= 17;

  const venues = rows.map((r) => {
    const x: any = byId.get(r.id) ?? {};
    const confirmed: Record<string, { by: string; at: string }> = x.confirmed ?? {};
    const hostCount = Number(r.host_count);
    const reasons: string[] = [];
    reasons.push(`${metres(r.distance_m)} from ${place!.label} (~${Math.max(1, Math.round(r.distance_m / 80))} min walk)`);
    if (r.capacity != null) reasons.push(`Fits ${r.capacity}${confirmed.capacity ? ` (confirmed by ${confirmed.capacity.by}, ${shortDate(confirmed.capacity.at)})` : " (unconfirmed)"}`);
    else reasons.push("Capacity unconfirmed");
    if (x.biggest_turnout) reasons.push(`Biggest turnout seen: ${x.biggest_turnout}`);
    if (hostCount > 0 && r.hosts?.length)
      reasons.push(`Hosted ${hostCount} event${hostCount === 1 ? "" : "s"}: ${r.hosts.join(", ")}${r.hosts.length >= 4 ? ", …" : ""}`);
    if (r.last_hosted) reasons.push(`Last hosted ${shortDate(r.last_hosted)}`);
    reasons.push(r.terms === "paid" && r.price_note ? `Paid: ${r.price_note}` : TERMS_LABEL[r.terms] ?? r.terms);
    if (r.availability_status)
      reasons.push(`Phone check ${r.availability_at ? shortDate(r.availability_at) : ""}: ${r.availability_status}${r.availability_conditions ? ` (${r.availability_conditions})` : ""}`);
    if (evening && r.evening_ok == null) reasons.push("Evening use unconfirmed");
    if (x.busy) reasons.push(`Heads-up: ${x.busy.title} is listed here that evening`);
    if (x.can_call) reasons.push("Can phone to check availability");
    else if (r.intro_via_poster) reasons.push("Intro via the member who posted it");
    else if (r.kind === "company_office") reasons.push("Company office: ask a past host for an intro");
    const unconfirmed = [
      ...(r.capacity == null || !confirmed.capacity ? ["capacity"] : []),
      ...(r.terms === "unknown" || !confirmed.terms ? ["terms"] : []),
      ...(evening && (r.evening_ok == null || !confirmed.evening_ok) ? ["evening_ok"] : [])
    ];
    return {
      id: r.id, name: r.name, area: r.area, address: r.address, kind: r.kind, capacity: r.capacity, terms: r.terms,
      price_note: r.price_note, av: r.av, evening_ok: r.evening_ok, weekend_ok: r.weekend_ok,
      ok_to_call: !!x.can_call, intro_via_poster: r.intro_via_poster,
      lat: r.lat, lng: r.lng, distance_m: Math.round(r.distance_m),
      host_count: hostCount, past_hosts: r.hosts ?? [], last_hosted: r.last_hosted ? londonDate(new Date(r.last_hosted).toISOString()) : null,
      biggest_turnout: x.biggest_turnout ?? null,
      availability: r.availability_status
        ? { status: r.availability_status, conditions: r.availability_conditions, checked_at: r.availability_at }
        : null,
      busy: x.busy ?? null, clash: clashWarning, unconfirmed, reasons, score: Math.round(r.score * 100) / 100
    };
  });

  return {
    body: {
      query: {
        near: q.near ?? null, place: place.label, lat: place.lat, lng: place.lng, headcount: people,
        start: q.start.toISOString(), end: end.toISOString(), when: whenRange(q.start, end), free_only: q.free_only,
        radius_m: radius, widened
      },
      venues, clashes: clashList, clash_warning: clashWarning,
      note: venues.length ? null : `No venues for ${people} within ${metres(radius)} of ${place.label}. Try a wider radius_m, a smaller headcount, or another area.`
    }
  };
}

async function fromLuma(ctx: Ctx) {
  const uid = await requireUser(ctx);
  const b = parse(schemas.fromLuma, ctx.body);
  await requirePoster(uid);
  let ev: ResolvedLumaEvent;
  try {
    ev = await ctx.deps.resolveLuma(b.url);
  } catch (e: any) {
    if (e instanceof LumaVenueHiddenError) throw new HttpError(422, "venue_hidden", e.message);
    throw new HttpError(422, "luma_failed", e?.message ?? "Couldn't read that Luma link");
  }
  if (!isInLondon(ev.lat, ev.lng)) throw new HttpError(422, "not_london", `That event isn't in London (${ev.address ?? "unknown address"}).`);
  const name = (ev.venueName?.trim() || ev.address?.split(",")[0]?.trim() || ev.title).slice(0, 120);
  const point = sql`st_setsrid(st_makepoint(${ev.lng}, ${ev.lat}), 4326)::geography`;

  const [existing] = await sql<{ id: string }[]>`
    select id from venues
    where junk_at is null and ((${ev.googlePlaceId}::text is not null and google_place_id = ${ev.googlePlaceId}) or st_dwithin(location, ${point}, 60))
    order by (google_place_id is not distinct from ${ev.googlePlaceId}) desc, st_distance(location, ${point}) limit 1`;
  const [poster] = await sql<{ community: string | null }[]>`select community from profiles where id = ${uid}`;
  const id = await asUser(uid, async (tx) => {
    let vid = existing?.id;
    if (!vid) {
      const [v] = await tx<{ id: string }[]>`
        insert into venues (name, address, area, location, kind, google_place_id, created_by)
        values (${name}, ${ev.address}, ${areaFor(ev.lat, ev.lng)}, ${point}, ${guessKind(name, ev.address)}, ${ev.googlePlaceId}, ${uid})
        returning id`;
      vid = v!.id;
    }
    await tx`
      insert into venue_hosts (venue_id, community, event_title, event_url, event_date, attendees, source)
      values (${vid}, ${ev.community ?? poster?.community ?? "Unknown community"}, ${ev.title}, ${ev.url},
              ${londonDate(ev.startsAt)}, ${ev.guestCount}, 'luma')
      on conflict (venue_id, event_url) do nothing`;
    return vid;
  });
  const venue = await venueView(id);
  return {
    status: existing ? 200 : 201,
    body: {
      created: !existing, venue,
      event: { title: ev.title, url: ev.url, starts_at: ev.startsAt, community: ev.community, attendees: ev.guestCount },
      questions: [
        { fields: ["capacity", "av"], ask: "Roughly how many people does it hold, and does it have AV (screen, mics)?" },
        { fields: ["terms", "price_note", "evening_ok", "weekend_ok"], ask: "Is it free, free for communities, or paid (and roughly what)? Evenings and weekends OK?" },
        { fields: ["contact", "ok_to_call", "intro_via_poster"], ask: "Who's the contact (name, role, email, phone), and is it OK for our assistant to phone them? Or should people go through you for an intro?" }
      ],
      next: `PATCH /api/venues/${id} with the answers`
    }
  };
}

const VENUE_FIELDS = ["capacity", "av", "evening_ok", "weekend_ok", "terms", "price_note", "kind", "ok_to_call", "intro_via_poster"] as const;

async function patchVenue(ctx: Ctx, id: string) {
  const uid = await requireUser(ctx);
  parse(uuid, id);
  const b = parse(schemas.patch, ctx.body);
  await requirePoster(uid);
  const known = new Set<string>([...VENUE_FIELDS, "contact"]);
  const ignored = Object.keys((ctx.body as object) ?? {}).filter((k) => !known.has(k));
  const given: Record<string, unknown> = {};
  for (const k of VENUE_FIELDS) if (b[k] !== undefined) given[k] = b[k];

  const result = await asUser(uid, async (tx) => {
    const [before] = await tx`select to_jsonb(v) as j from venues v where id = ${id}`;
    if (!before) throw new HttpError(404, "venue_not_found", "No such venue (or it was removed as junk)");
    const changed = Object.keys(given).filter((k) => JSON.stringify(before.j[k] ?? null) !== JSON.stringify(given[k] ?? null));
    const same = Object.keys(given).filter((k) => !changed.includes(k));
    if (changed.length) {
      const upd: Record<string, unknown> = Object.fromEntries(changed.map((k) => [k, given[k]]));
      const rows = await tx`update venues set ${tx(upd as any, ...changed)} where id = ${id} returning id`;
      if (!rows.length) throw new HttpError(403, "not_trusted", "You can't edit this venue");
    }
    if (same.length) await tx`select confirm_venue_fields(${id}, ${same}::text[])`;
    let contactSaved = false;
    const c = b.contact;
    if (c && Object.values(c).some((x) => x != null)) {
      await tx`
        insert into venue_contacts (venue_id, contact_name, contact_role, email, phone)
        values (${id}, ${c.contact_name ?? null}, ${c.contact_role ?? null}, ${c.email?.toLowerCase() ?? null}, ${c.phone ?? null})
        on conflict (venue_id) do update set
          contact_name = coalesce(excluded.contact_name, venue_contacts.contact_name),
          contact_role = coalesce(excluded.contact_role, venue_contacts.contact_role),
          email = coalesce(excluded.email, venue_contacts.email),
          phone = coalesce(excluded.phone, venue_contacts.phone),
          updated_at = now()`;
      contactSaved = true;
    }
    return { changed, confirmed: same, contactSaved };
  });
  const venue = await venueView(id);
  return {
    body: {
      venue, updated: result.changed, confirmed: result.confirmed, contact_saved: result.contactSaved, ignored,
      message: `${venue.name} is live.${result.contactSaved ? " The contact stays private: only the assistant uses it." : ""}`
    }
  };
}

async function reportVenue(ctx: Ctx, id: string) {
  const uid = await requireUser(ctx);
  parse(uuid, id);
  const b = parse(schemas.report, ctx.body);
  const [row] = await asUser(uid, (tx) => tx`select report_junk(${id}, ${b.reason ?? null}) as r`);
  const r = row!.r as { junk: boolean; reports: number };
  return {
    body: {
      ...r,
      message: r.junk
        ? "Marked as junk and hidden. The poster is banned and their vouchers lost vouching rights."
        : `Report recorded (${r.reports}). Two members' reports, or one root's, hide the venue.`
    }
  };
}

async function createRequest(ctx: Ctx) {
  const uid = await requireUser(ctx);
  const b = parse(schemas.request, ctx.body);
  await requirePoster(uid);
  const end = endOr(b.start, b.end);
  const [v] = await sql`
    select v.name, v.intro_via_poster, c.email as contact_email, c.contact_name, poster.display_name as poster_name
    from venues v left join venue_contacts c on c.venue_id = v.id left join profiles poster on poster.id = v.created_by
    where v.id = ${b.venue_id} and v.junk_at is null`;
  if (!v) throw new HttpError(404, "venue_not_found", "No such venue (or it was removed as junk)");
  const [me] = await sql`select p.display_name, p.community, a.email from profiles p join accounts a on a.id = p.id where p.id = ${uid}`;
  const when = whenRange(b.start, end);
  const from = me!.community ? `${me!.display_name} (${me!.community})` : me!.display_name;
  const subject = b.subject ?? `Venue request: ${b.headcount} people, ${when}`;
  const text = [
    b.message, "", "—",
    `When: ${when} (London time)`, `Headcount: ${b.headcount}`, `From: ${from}, ${me!.email}`, "",
    `Sent via Mates Rates, the shared venue finder for London community organisers. Reply to this email to reach ${me!.display_name} directly.`
  ].join("\n");

  const [req] = await asUser(uid, (tx) => tx<{ id: string }[]>`
    insert into requests (venue_id, from_profile, subject, body) values (${b.venue_id}, ${uid}, ${subject}, ${text}) returning id`);
  const base = { request_id: req!.id, venue: { id: b.venue_id, name: v.name }, subject, when };

  if (!v.contact_email) {
    const intro = v.intro_via_poster && v.poster_name ? ` ${v.poster_name} offered intros: ask them.` : "";
    return { body: { ...base, status: "draft", reason: "no_contact_email", message: `No email on file for ${v.name}; kept as a draft.${intro}` } };
  }
  if (!ctx.deps.sendEmail || !process.env.MAIL_FROM)
    return { body: { ...base, status: "draft", reason: "email_not_configured", message: "Email sending isn't configured on the server; kept as a draft." } };
  try {
    await ctx.deps.sendEmail({ from: process.env.MAIL_FROM, to: [v.contact_email], cc: [me!.email], reply_to: me!.email, subject, text });
  } catch (e: any) {
    throw new HttpError(502, "send_failed", `Couldn't send the email (${e?.message ?? "unknown"}); kept as a draft.`, { ...base, status: "draft" });
  }
  await asUser(uid, (tx) => tx`update requests set status = 'sent', sent_at = now() where id = ${req!.id}`);
  return {
    status: 201,
    body: { ...base, status: "sent", message: `Sent to ${v.name}. Replies go to ${me!.email}, and you're CC'd.` }
  };
}

async function createCall(ctx: Ctx) {
  const uid = await requireUser(ctx);
  const b = parse(schemas.call, ctx.body);
  const end = endOr(b.start, b.end);
  const [row] = await asUser(uid, (tx) => tx`
    select request_call(${b.venue_id}, ${b.start}, ${end}, ${b.headcount}, ${b.event_title ?? null}) as r`);
  const r = row!.r as { outcome: "new" | "reused" | "in_progress" | "called_recently"; call_id: string | null; availability_id?: string };
  if (r.outcome === "new") {
    ctx.deps.placeCall(r.call_id!).catch(async (e) => {
      await sql`update calls set status = 'failed', error = ${String(e?.message ?? e).slice(0, 500)}, ended_at = now()
                where id = ${r.call_id} and status in ('queued', 'dialing')`.catch(() => {});
    });
    return {
      status: 202,
      body: { call_id: r.call_id, outcome: "new", status: "queued", poll: `/api/calls/${r.call_id}`, message: "Calling now, usually under 2 minutes." }
    };
  }
  if (r.outcome === "reused") {
    const [a] = await sql`select status, conditions, price_note, confirmed_by_name, starts_at, ends_at, created_at from availability where id = ${r.availability_id!}`;
    return {
      body: {
        call_id: r.call_id, outcome: "reused", availability: a ?? null,
        message: a ? `Checked by phone on ${shortDate(a.created_at)}: ${a.status}${a.conditions ? ` (${a.conditions})` : ""}. No new call needed.` : "Recently checked."
      }
    };
  }
  const call = await callView(uid, r.call_id!);
  return {
    body: {
      ...call, call_id: r.call_id, outcome: r.outcome, poll: `/api/calls/${r.call_id}`,
      message: r.outcome === "in_progress"
        ? "Someone is already calling this venue; poll that call for the answer."
        : "This venue was called recently (max one call a week); here's that answer."
    }
  };
}

const DONE = new Set(["completed", "failed", "no_answer", "busy", "canceled"]);

async function callView(uid: string, id: string) {
  const [c] = await asUser(uid, (tx) => tx`
    select c.id, c.venue_id, v.name as venue_name, c.status, c.starts_at, c.ends_at, c.headcount, c.event_title,
      c.answered_at, c.ended_at, c.result, c.error, c.created_at,
      (select json_build_object('status', a.status, 'conditions', a.conditions, 'price_note', a.price_note,
              'confirmed_by_name', a.confirmed_by_name, 'created_at', a.created_at)
       from availability a where a.call_id = c.id order by a.created_at desc limit 1) as availability
    from calls c join venues v on v.id = c.venue_id where c.id = ${id}`);
  if (!c) throw new HttpError(404, "call_not_found", "No such call (only members can see calls)");
  return { ...c, when: whenRange(c.starts_at, c.ends_at), done: DONE.has(c.status) };
}

async function getCall(ctx: Ctx, id: string) {
  const uid = await requireUser(ctx);
  parse(uuid, id);
  return { body: await callView(uid, id) };
}

async function rankedEvents(limit: number) {
  const rows = await sql`
    select source, external_id, title, url, starts_at, ends_at, venue_name, address,
      st_y(location::geometry) as lat, st_x(location::geometry) as lng, community, attendees, is_free, tags
    from events where coalesce(ends_at, starts_at + interval '2 hours') > now() and starts_at < now() + interval '60 days'`;
  const past = await sql<{ community: string; n: string }[]>`select community, count(*) as n from venue_hosts group by community`;
  const events: SourceEvent[] = rows.map((r) => ({
    source: r.source, externalId: r.external_id, title: r.title, url: r.url,
    startsAt: new Date(r.starts_at).toISOString(), endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
    venueName: r.venue_name, address: r.address, lat: r.lat, lng: r.lng, community: r.community,
    attendees: r.attendees, isFree: r.is_free, tags: r.tags ?? []
  }));
  return rankEvents(events, new Date(), { pastEventsByCommunity: Object.fromEntries(past.map((p) => [p.community, Number(p.n)])) })
    .filter((e) => e.score > -100)
    .slice(0, limit);
}

async function listEvents(ctx: Ctx) {
  const limit = Math.min(100, Math.max(1, Number(ctx.url.searchParams.get("limit")) || 10));
  const base = publicUrl(ctx.req);
  const events = (await rankedEvents(limit)).map((e) => ({
    title: e.title, url: e.url, source: e.source, starts_at: e.startsAt, ends_at: e.endsAt,
    when: whenRange(new Date(e.startsAt), new Date(e.endsAt ?? Date.parse(e.startsAt) + 2 * 3600_000)),
    venue_name: e.venueName, area: e.lat != null && e.lng != null ? areaFor(e.lat, e.lng) : null, address: e.address,
    community: e.community, attendees: e.attendees, is_free: e.isFree, tags: e.tags, score: e.score, reasons: e.reasons
  }));
  return { body: { events, ics_url: `${base}/events.ics`, webcal_url: `${base.replace(/^https?:/, "webcal:")}/events.ics` } };
}

async function communities(ctx: Ctx) {
  await requireUser(ctx);
  const q = (ctx.url.searchParams.get("q") ?? "").trim();
  const like = `%${q}%`;
  const rows = await sql`
    with items as (
      select distinct on (community, coalesce(url, id::text)) * from (
        select h.community, h.event_title as title, h.event_url as url, h.event_date::timestamptz as at, h.attendees,
               v.name as venue, v.area, false as upcoming, h.id::text as id
        from venue_hosts h join venues v on v.id = h.venue_id where v.junk_at is null
        union all
        select e.community, e.title, e.url, e.starts_at, e.attendees, coalesce(v.name, e.venue_name), v.area,
               e.starts_at > now(), e.id::text
        from events e left join venues v on v.id = e.venue_id where e.community is not null
      ) u order by community, coalesce(url, id::text), upcoming desc
    )
    select community as name,
      count(*) filter (where not upcoming)::int as past_events,
      count(*) filter (where upcoming)::int as upcoming_events,
      round(percentile_cont(0.5) within group (order by attendees))::int as typical_attendees,
      max(at) filter (where not upcoming) as last_event,
      min(at) filter (where upcoming) as next_event,
      (array_agg(title order by at desc) filter (where title is not null))[1:5] as recent_titles,
      (array_agg(distinct case when area is not null then venue || ' (' || area || ')' else venue end) filter (where venue is not null))[1:6] as venues,
      (array_agg(url order by at desc) filter (where url is not null))[1] as link
    from items
    group by community
    having ${q} = '' or community ilike ${like} or bool_or(title ilike ${like}) or bool_or(venue ilike ${like}) or bool_or(area ilike ${like})
    order by count(*) desc, max(at) desc nulls last
    limit 15`;
  return {
    body: {
      communities: rows.map((r) => ({
        ...r, last_event: r.last_event ? londonDate(new Date(r.last_event).toISOString()) : null,
        next_event: r.next_event ? new Date(r.next_event).toISOString() : null
      }))
    }
  };
}

async function stats() {
  const [s] = await sql`
    select (select count(*) from venues where junk_at is null)::int as venues,
      (select count(distinct c) from (select community as c from venue_hosts union select community from events where community is not null) x)::int as communities,
      (select count(*) from events where coalesce(ends_at, starts_at + interval '2 hours') > now())::int as events,
      (select count(*) from venue_hosts)::int as hosts`;
  return { body: s };
}

async function ics(ctx: Ctx) {
  const events = await rankedEvents(200);
  const text = buildIcs(events, { calendarName: "Mates Rates: London builder events" });
  return { raw: text, type: "text/calendar; charset=utf-8", headers: { "content-disposition": 'inline; filename="events.ics"' } };
}

// ---------- static ----------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2", ".mp4": "video/mp4"
};

function serveStatic(dir: string, pathname: string, res: http.ServerResponse, head: boolean): boolean {
  let rel: string;
  try { rel = decodeURIComponent(pathname); } catch { return false; }
  let file = path.resolve(dir, "." + (rel.endsWith("/") ? `${rel}index.html` : rel));
  if (!file.startsWith(path.resolve(dir) + path.sep)) return false;
  if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
  if (!existsSync(file)) return false;
  let st = statSync(file);
  if (st.isDirectory()) {
    file = path.join(file, "index.html");
    if (!existsSync(file)) return false;
    st = statSync(file);
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": st.size, "cache-control": "public, max-age=60"
  });
  if (head) res.end();
  else createReadStream(file).pipe(res);
  return true;
}

const FALLBACK_HOME = `<!doctype html><meta charset="utf-8"><title>Mates Rates</title>
<body style="font:16px system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>Mates Rates</h1><p>Free venues for London communities, sorted by mates.</p>
<p><a href="/events.ics">events.ics</a> · <a href="/api/events">/api/events</a> · <a href="/api/stats">/api/stats</a></p></body>`;

// ---------- router ----------

type Result = { status?: number; body?: unknown; raw?: string; type?: string; headers?: Record<string, string> };
type Route = [method: string, pattern: RegExp, handler: (ctx: Ctx, ...params: string[]) => Promise<Result>];

const ROUTES: Route[] = [
  ["POST", /^\/api\/join$/, join],
  ["POST", /^\/api\/login$/, login],
  ["GET", /^\/api\/me$/, me],
  ["POST", /^\/api\/vouch$/, vouch],
  ["GET", /^\/api\/venues\/search$/, search],
  ["POST", /^\/api\/venues\/from-luma$/, fromLuma],
  ["PATCH", /^\/api\/venues\/([^/]+)$/, patchVenue],
  ["POST", /^\/api\/venues\/([^/]+)\/report$/, reportVenue],
  ["POST", /^\/api\/requests$/, createRequest],
  ["POST", /^\/api\/calls$/, createCall],
  ["GET", /^\/api\/calls\/([^/]+)$/, getCall],
  ["GET", /^\/api\/events$/, listEvents],
  ["GET", /^\/api\/communities$/, communities],
  ["GET", /^\/api\/stats$/, stats],
  ["GET", /^\/events\.ics$/, ics],
  ["GET", /^\/api\/health$/, async () => ({ body: { ok: true } })],
  // Landing page config (public/app.js reads it): the Grok Bot share link comes from env.
  ["GET", /^\/config\.json$/, async () => ({ body: { grokBotUrl: process.env.GROK_BOT_SHARE_URL || null, icsUrl: "/events.ics" } })]
];

function readBody(req: http.IncomingMessage, limit = 100_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, "too_large", "Body too large")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(new HttpError(400, "invalid_json", "Body must be JSON")); }
    });
    req.on("error", reject);
  });
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PATCH, OPTIONS"
};

function send(res: http.ServerResponse, status: number, body: unknown, head = false) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS });
  res.end(head ? undefined : text);
}

export function createApp(overrides: Partial<Deps> = {}): http.Server {
  const deps: Deps = {
    geocode: geocodeLondon,
    resolveLuma: resolveLumaEvent,
    sendEmail: process.env.RESEND_API_KEY ? resendEmail : null,
    placeCall: async () => { throw new Error("calling not configured"); },
    publicDir: path.join(import.meta.dirname, "..", "public"),
    ...overrides
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/twilio/")) return; // owned by lib/calls attachCallStreams
    const method = req.method === "HEAD" ? "GET" : (req.method ?? "GET");
    try {
      if (method === "OPTIONS") {
        res.writeHead(204, CORS);
        return res.end();
      }
      for (const [m, re, handler] of ROUTES) {
        const match = url.pathname.match(re);
        if (!match) continue;
        if (m !== method) continue;
        const body = method === "POST" || method === "PATCH" ? await readBody(req) : undefined;
        const out = await handler({ req, url, body, deps }, ...match.slice(1));
        if (out.raw != null) {
          res.writeHead(out.status ?? 200, { "content-type": out.type ?? "text/plain", ...CORS, ...out.headers });
          return res.end(req.method === "HEAD" ? undefined : out.raw);
        }
        return send(res, out.status ?? 200, out.body, req.method === "HEAD");
      }
      if (url.pathname.startsWith("/api/")) {
        const allowed = ROUTES.some(([, re]) => re.test(url.pathname));
        throw allowed ? new HttpError(405, "method_not_allowed", `${req.method} not allowed here`) : new HttpError(404, "not_found", `No route ${url.pathname}`);
      }
      if (method === "GET" && serveStatic(deps.publicDir, url.pathname, res, req.method === "HEAD")) return;
      if (method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(FALLBACK_HOME);
      }
      throw new HttpError(404, "not_found", "Not found");
    } catch (e: any) {
      const err = e instanceof HttpError ? e : pgToHttp(e);
      if (!err) console.error(`${req.method} ${url.pathname}`, e);
      const h = err ?? new HttpError(500, "server_error", "Something went wrong on our side");
      if (!res.headersSent) send(res, h.status, { error: h.code, message: h.message, ...h.extra });
      else res.end();
    }
  });
}
