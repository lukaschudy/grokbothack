// Pure helpers for the ingest: normalising, deduping, scoring, SQL. No network here.
import { createHash } from 'node:crypto';

export type Source = 'luma' | 'meetup' | 'devpost' | 'builderbase';
export type EventKind = 'hackathon' | 'talk' | 'networking' | 'other';
export type VenueKind = 'company_office' | 'bookable' | 'pub' | 'university' | 'community_space' | 'other';

export interface RawVenue {
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  postcode?: string;
}

export interface Community {
  key: string; // e.g. 'luma:cal-xxx', 'meetup:openuk'
  name: string;
  url?: string;
  lumaCalendarId?: string;
  description?: string;
}

export interface RawEvent {
  id: string; // '<source>:<source id>'
  source: Source;
  title: string;
  url?: string;
  startsAt: string; // ISO
  endsAt?: string;
  venue?: RawVenue;
  community?: Community;
  hostNames: string[];
  online: boolean;
  paid?: boolean;
  guestCount?: number;
  kindHint?: EventKind; // e.g. Devpost and BuilderBase are always hackathons
}

export interface Venue {
  id: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  placeId?: string;
  kind: VenueKind;
}

export interface ScoredEvent extends RawEvent {
  venueId?: string;
  kind: EventKind;
  score: number;
  reasons: string[];
}

// Deterministic UUID from a string key, so reruns upsert the same rows.
// The API must use venueIdFor() too, so organiser-added venues dedupe against seeded ones.
export function uuidFrom(key: string): string {
  const h = createHash('md5').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function venueIdFor(v: RawVenue): string {
  if (v.placeId) return uuidFrom(`place:${v.placeId}`);
  return uuidFrom(`venue:${normName(v.name)}|${v.postcode ?? `${v.lat?.toFixed(3)},${v.lng?.toFixed(3)}`}`);
}

export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(london|ltd|limited|the|hq|uk|office|offices)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
export function extractPostcode(s: string | undefined): string | undefined {
  const m = s?.match(POSTCODE);
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : undefined;
}

// Greater London bounding box.
export function inLondon(lat: number | undefined, lng: number | undefined): boolean {
  return lat !== undefined && lng !== undefined && lat > 51.28 && lat < 51.7 && lng > -0.52 && lng < 0.34;
}

const GENERIC_VENUE = /^(london|london,? uk|london,? united kingdom|tba|tbc|tbd|online|online event|virtual|hybrid|to be announced|secret location)$/i;
export function isUsableVenueName(name: string | undefined): name is string {
  return !!name && name.trim().length > 1 && !GENERIC_VENUE.test(name.trim());
}

export function venueKind(name: string): VenueKind {
  const n = name.toLowerCase();
  if (/\b(arms|tavern|taverne|inn|pub|bar|brewery|brewdog|tap ?room)\b/.test(n)) return 'pub';
  if (/\b(university|college|imperial|ucl|kcl|king's|qmul|queen mary|lse|school|campus|institute)\b/.test(n)) return 'university';
  if (/\b(library|church|centre|center|community|hall|house|chapel|guild)\b/.test(n)) return 'community_space';
  if (/\b(hotel|studio|studios|space|spaces|cowork|co-work|wework|huckletree|techspace|second home|loading bay|venue|rooms)\b/.test(n)) return 'bookable';
  return 'company_office';
}

const TECH = /\b(ai|a\.i\.|ml|llm|llms|agent|agents|agentic|gpt|genai|data|tech|technology|hack|hackathon|buildathon|startup|startups|founder|founders|vc|developer|developers|dev|devs|devrel|engineer|engineers|engineering|software|code|coding|python|javascript|react|rust|golang|cloud|security|cyber|crypto|web3|blockchain|solana|ethereum|product|design|ux|saas|fintech|robotics|quantum|open source|api|sdk|mcp|builder|builders|build|demo day)\b/i;
export function isTech(...texts: (string | undefined)[]): boolean {
  return texts.some((t) => !!t && TECH.test(t));
}

export function eventKind(title: string): EventKind {
  if (/\b(hack|hackathon|hackathons|buildathon|build day|hacker house|game jam|jam)\b/i.test(title)) return 'hackathon';
  if (/\b(network|networking|drinks|social|mixer|happy hour|breakfast|games night|poker|run club|5k|walk|party|supper|dinner)\b/i.test(title)) return 'networking';
  if (/\b(talk|talks|meetup|lecture|panel|fireside|workshop|conference|summit|debate|demo|session|course)\b/i.test(title)) return 'talk';
  return 'other';
}

const KIND_WEIGHT: Record<EventKind, number> = { hackathon: 3, talk: 2, networking: 1, other: 1.5 };

// Higher is better. Reasons are shown to users, so keep them short and factual.
export function scoreEvent(e: RawEvent, communityEventCount: number): { kind: EventKind; score: number; reasons: string[] } {
  const kind = e.kindHint ?? eventKind(e.title);
  let score = KIND_WEIGHT[kind];
  const reasons: string[] = [kind];
  if (e.guestCount && e.guestCount > 0) {
    score += Math.log10(1 + e.guestCount);
    reasons.push(`${e.guestCount} going`);
  }
  if (e.paid === true) {
    score -= 1;
    reasons.push('paid');
  } else if (e.paid === false) {
    reasons.push('free');
  }
  if (e.community && communityEventCount >= 3) {
    score += 0.5;
    reasons.push(`${e.community.name} runs ${communityEventCount} listed events`);
  }
  if (e.online) score -= 2;
  return { kind, score: Math.round(score * 100) / 100, reasons };
}

// Devpost dates look like 'Sep 12, 2026', 'Apr 09 - 10, 2016', 'Oct 31 - Nov 02, 2025'.
export function parseDevpostDates(s: string): { start: string; end?: string } | undefined {
  const m = s.match(/^([A-Z][a-z]{2}) (\d{1,2})(?: - (?:([A-Z][a-z]{2}) )?(\d{1,2}))?, (\d{4})$/);
  if (!m) return undefined;
  const [, mon1, d1, mon2, d2, y] = m;
  const start = new Date(`${mon1} ${d1}, ${y} 09:00 UTC`);
  if (Number.isNaN(start.getTime())) return undefined;
  const end = d2 ? new Date(`${mon2 ?? mon1} ${d2}, ${y} 18:00 UTC`) : undefined;
  return { start: start.toISOString(), end: end?.toISOString() };
}

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function sameName(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

// Group events' venues into unique venues. Same Google place, or within 75 m with a matching name.
// Returns the venues and a map from event id to venue id.
export function dedupeVenues(events: RawEvent[]): { venues: Venue[]; venueOf: Map<string, string> } {
  const venues: Venue[] = [];
  const byPlace = new Map<string, Venue>();
  const venueOf = new Map<string, string>();
  // Luma first: it has Google place ids, so its venues become the canonical ones.
  const ordered = [...events].sort((a, b) => Number(!!b.venue?.placeId) - Number(!!a.venue?.placeId));
  for (const e of ordered) {
    const v = e.venue;
    if (!v || !isUsableVenueName(v.name) || v.lat === undefined || v.lng === undefined || !inLondon(v.lat, v.lng)) continue;
    const point = { lat: v.lat, lng: v.lng };
    let match = v.placeId ? byPlace.get(v.placeId) : undefined;
    match ??= venues.find((u) => distanceM(u, point) < 75 && sameName(u.name, v.name));
    if (!match) {
      match = { id: venueIdFor(v), name: v.name.trim(), address: v.address, lat: v.lat, lng: v.lng, placeId: v.placeId, kind: venueKind(v.name) };
      venues.push(match);
    }
    if (v.placeId && !byPlace.has(v.placeId)) byPlace.set(v.placeId, match);
    venueOf.set(e.id, match.id);
  }
  return { venues, venueOf };
}

// SQL --------------------------------------------------------------------

type SqlValue = string | number | boolean | null | undefined | string[];

export function lit(v: SqlValue): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.length ? `array[${v.map(lit).join(',')}]::text[]` : `'{}'::text[]`;
  return `'${v.replace(/'/g, "''")}'`;
}

export function toSql(communities: Community[], venues: Venue[], events: ScoredEvent[]): string {
  const out: string[] = ['-- Generated by `npm run ingest`. Idempotent upserts.', 'begin;'];
  for (const c of communities) {
    out.push(
      `insert into communities (id, name, luma_calendar_id, url, description) values (${lit(uuidFrom(c.key))}, ${lit(c.name)}, ${lit(c.lumaCalendarId)}, ${lit(c.url)}, ${lit(c.description)})` +
        ` on conflict (id) do update set name = excluded.name, url = excluded.url, description = excluded.description;`,
    );
  }
  for (const v of venues) {
    out.push(
      `insert into venues (id, name, address, location, google_place_id, kind) values (${lit(v.id)}, ${lit(v.name)}, ${lit(v.address)}, st_setsrid(st_makepoint(${v.lng}, ${v.lat}), 4326)::geography, ${lit(v.placeId)}, ${lit(v.kind)})` +
        ` on conflict (id) do update set name = excluded.name, address = excluded.address, location = excluded.location, kind = excluded.kind where not venues.verified;`,
    );
  }
  for (const e of events) {
    out.push(
      `insert into events (id, source, title, url, starts_at, ends_at, venue_id, community_id, host_names, online, paid, guest_count, kind, score, reasons) values (` +
        [
          lit(e.id), lit(e.source), lit(e.title), lit(e.url), lit(e.startsAt), lit(e.endsAt), lit(e.venueId),
          lit(e.community ? uuidFrom(e.community.key) : null), lit(e.hostNames), lit(e.online), lit(e.paid),
          lit(e.guestCount), lit(e.kind), lit(e.score), lit(e.reasons),
        ].join(', ') +
        `) on conflict (id) do update set title = excluded.title, url = excluded.url, starts_at = excluded.starts_at, ends_at = excluded.ends_at, venue_id = excluded.venue_id, community_id = excluded.community_id, host_names = excluded.host_names, online = excluded.online, paid = excluded.paid, guest_count = excluded.guest_count, kind = excluded.kind, score = excluded.score, reasons = excluded.reasons, fetched_at = now();`,
    );
  }
  out.push('commit;', '');
  return out.join('\n');
}
