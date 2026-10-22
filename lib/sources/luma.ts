// Luma: resolve a pasted link, London discover feed, and calendar .ics history.
import { cachedJson, cachedText, isInLondon, isTech, londonDate, type SourceEvent, type VenueEvidence } from "./types";

const API = "https://api.lu.ma";
export const LONDON_DISCOVER_PLACE = "discplace-QCcNk3HXowOR97j";

export type LumaHost = { name: string; linkedin?: string; x?: string; website?: string };

export type ResolvedLumaEvent = {
  title: string;
  url: string;
  startsAt: string;
  endsAt: string | null;
  venueName: string | null;
  address: string | null;
  lat: number;
  lng: number;
  googlePlaceId: string | null;
  community: string | null;
  hosts: LumaHost[];
  guestCount: number | null;
  isFree: boolean | null;
};

export class LumaVenueHiddenError extends Error {
  constructor(url: string) {
    super(`Luma hides this event's venue until you register (${url}). Register, then paste the address instead.`);
    this.name = "LumaVenueHiddenError";
  }
}

/** Pull the slug or evt- id out of any Luma link (lu.ma, luma.com, /event/evt-..., query strings). */
export function parseLumaLink(input: string): { eventId: string } | { slug: string } {
  const raw = input.trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw.includes("/") ? raw : `lu.ma/${raw}`}`);
  if (!/(^|\.)(lu\.ma|luma\.com)$/i.test(url.hostname)) throw new Error(`Not a Luma link: ${input}`);
  const parts = url.pathname.split("/").filter(Boolean);
  const evt = parts.find((p) => /^evt-[A-Za-z0-9]+$/.test(p));
  if (evt) return { eventId: evt };
  const slug = parts[0];
  if (!slug) throw new Error(`No event in Luma link: ${input}`);
  return { slug };
}

/** Resolve a Luma link to venue + hosts in one keyless call (~0.2 s). */
export async function resolveLumaEvent(url: string): Promise<ResolvedLumaEvent> {
  const ref = parseLumaLink(url);
  const endpoint =
    "eventId" in ref
      ? `${API}/event/get?event_api_id=${encodeURIComponent(ref.eventId)}`
      : `${API}/url?url=${encodeURIComponent(ref.slug)}`;
  const res = await fetch(endpoint, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(2500) });
  if (res.status === 404) throw new Error(`Luma event not found: ${url}`);
  if (!res.ok) throw new Error(`Luma returned ${res.status} for ${url}`);
  const body = (await res.json()) as any;
  const data = "eventId" in ref ? body : body.kind === "event" ? body.data : null;
  if (!data?.event) throw new Error(`Luma link is not an event (got ${body.kind ?? "nothing"}): ${url}`);
  return lumaPayloadToResolved(data, url);
}

/** Pure: event/get payload (also `data` of /url) → ResolvedLumaEvent. */
export function lumaPayloadToResolved(data: any, originalUrl = ""): ResolvedLumaEvent {
  const ev = data.event;
  const geo = ev.geo_address_info;
  const coord = ev.coordinate ?? geo?.place_coordinate;
  if (ev.location_type === "online" || (!geo && !coord)) throw new Error(`Luma event is online, no venue: ${originalUrl || ev.url}`);
  if (!geo || geo.mode !== "shown" || !geo.full_address) throw new LumaVenueHiddenError(originalUrl || `https://luma.com/${ev.url}`);
  return {
    title: ev.name,
    url: `https://luma.com/${ev.url}`,
    startsAt: new Date(ev.start_at).toISOString(),
    endsAt: ev.end_at ? new Date(ev.end_at).toISOString() : null,
    venueName: geo.address ?? null,
    address: geo.full_address ?? null,
    lat: coord.latitude,
    lng: coord.longitude,
    googlePlaceId: geo.type === "google" ? (geo.place_id ?? null) : null,
    community: communityOf(data),
    hosts: (data.hosts ?? []).map(toHost),
    guestCount: ev.hide_rsvp ? null : (data.guest_count ?? null),
    isFree: data.ticket_info?.is_free ?? null
  };
}

function communityOf(entry: any): string | null {
  const cal = entry.calendar;
  if (cal && !cal.is_personal && cal.name) return cal.name;
  return entry.hosts?.[0]?.name ?? null;
}

function toHost(h: any): LumaHost {
  const out: LumaHost = { name: h.name };
  if (h.linkedin_handle) out.linkedin = `https://www.linkedin.com${h.linkedin_handle.startsWith("/") ? "" : "/"}${h.linkedin_handle}`;
  if (h.twitter_handle) out.x = `https://x.com/${h.twitter_handle}`;
  if (h.website) out.website = h.website;
  return out;
}

// ---------- Discover (London, upcoming) ----------

export type LumaDiscoverEntry = any;

/** Fetch London discover pages until `until` (ISO) or maxPages. Raw entries. */
export async function fetchLumaDiscover(opts: { until: string; maxPages?: number }): Promise<LumaDiscoverEntry[]> {
  const out: LumaDiscoverEntry[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < (opts.maxPages ?? 8); page++) {
    const url: string =
      `${API}/discover/get-paginated-events?discover_place_api_id=${LONDON_DISCOVER_PLACE}&pagination_limit=50` +
      (cursor ? `&pagination_cursor=${encodeURIComponent(cursor)}` : "");
    const json: any = await cachedJson(url, { cacheKey: `luma/discover-${page}.json` });
    out.push(...json.entries);
    const last = json.entries.at(-1)?.event?.start_at;
    if (!json.has_more || !json.next_cursor || (last && last > opts.until)) break;
    cursor = json.next_cursor;
  }
  return out;
}

/** Pure: discover entry → SourceEvent, or null when not an in-person London tech event. */
export function lumaEntryToSourceEvent(entry: LumaDiscoverEntry): SourceEvent | null {
  const ev = entry.event;
  if (!ev || ev.location_type === "online") return null;
  const cal = entry.calendar;
  if (!isTech(ev.name, cal && !cal.is_personal ? `${cal.name} ${cal.description_short ?? ""}` : null)) return null;
  const geo = ev.geo_address_info;
  const shown = geo?.mode === "shown";
  const lat = ev.coordinate?.latitude ?? null, lng = ev.coordinate?.longitude ?? null;
  if (!isInLondon(lat, lng)) return null;
  const tags: string[] = [];
  if (/hack|buildathon/i.test(ev.name)) tags.push("hackathon");
  return {
    source: "luma",
    externalId: ev.api_id,
    title: ev.name.trim(),
    url: `https://luma.com/${ev.url}`,
    startsAt: new Date(ev.start_at).toISOString(),
    endsAt: ev.end_at ? new Date(ev.end_at).toISOString() : null,
    venueName: shown ? (geo.address ?? null) : null,
    address: shown ? (geo.full_address ?? null) : null,
    // Hidden venues get fuzzed coordinates; don't pretend they're precise.
    lat: shown ? lat : null,
    lng: shown ? lng : null,
    community: communityOf(entry),
    attendees: ev.hide_rsvp || !entry.guest_count ? null : entry.guest_count,
    isFree: entry.ticket_info?.is_free ?? null,
    tags
  };
}

/** Pure: past/present discover entry with a shown venue → evidence. */
export function lumaEntryToEvidence(entry: LumaDiscoverEntry): VenueEvidence | null {
  const e = lumaEntryToSourceEvent(entry);
  if (!e || e.lat == null || e.lng == null || !e.venueName) return null;
  return {
    venueName: e.venueName, address: e.address, lat: e.lat, lng: e.lng,
    googlePlaceId: entry.event.geo_address_info?.place_id ?? null,
    community: e.community ?? "Unknown", eventTitle: e.title, eventUrl: e.url,
    eventDate: londonDate(e.startsAt), attendees: e.attendees, source: "luma"
  };
}

// ---------- Calendar .ics history ----------

export type IcsEvent = { uid: string; start: string; end: string | null; summary: string; location: string | null; lat: number | null; lng: number | null; url: string | null };

/** Minimal RFC 5545 reader for Luma's calendar feed (unfolds lines, unescapes text). */
export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: IcsEvent[] = [];
  let cur: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT" && cur) {
      const geo = cur.GEO?.split(";").map(Number);
      const url = cur.DESCRIPTION?.match(/https:\/\/luma\.com\/[\w-]+/)?.[0] ?? null;
      if (cur.DTSTART && cur.UID)
        out.push({
          uid: cur.UID, start: icsDate(cur.DTSTART), end: cur.DTEND ? icsDate(cur.DTEND) : null,
          summary: cur.SUMMARY ?? "", location: cur.LOCATION ?? null,
          lat: geo?.[0] ?? null, lng: geo?.[1] ?? null, url
        });
      cur = null;
    } else if (cur) {
      const i = line.indexOf(":");
      if (i > 0) cur[line.slice(0, i).split(";")[0]!] = unescapeIcs(line.slice(i + 1));
    }
  }
  return out;
}

const unescapeIcs = (s: string) => s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

function icsDate(v: string): string {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
  if (!m) return new Date(v).toISOString();
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))).toISOString();
}

export async function fetchLumaCalendarIcs(calendarId: string): Promise<IcsEvent[]> {
  const text = await cachedText(`${API}/ics/get?entity=calendar&id=${encodeURIComponent(calendarId)}`, {
    cacheKey: `luma/ics-${calendarId}.ics`
  });
  return parseIcs(text);
}

/** Pure: past .ics events with a real address in London → evidence. Hidden venues show a URL as LOCATION. */
export function icsToEvidence(events: IcsEvent[], community: string, now: Date): VenueEvidence[] {
  const out: VenueEvidence[] = [];
  for (const e of events) {
    if (!e.location || /^https?:/i.test(e.location) || !isInLondon(e.lat, e.lng)) continue;
    if (new Date(e.start) > now) continue;
    const parts = e.location.split(",").map((s) => s.trim());
    if (parts.length < 2) continue; // just "London" or a bare name: not a place
    out.push({
      venueName: parts[0]!, address: e.location, lat: e.lat!, lng: e.lng!, googlePlaceId: null,
      community, eventTitle: e.summary, eventUrl: e.url ?? `https://luma.com/event/${e.uid.split("@")[0]}`,
      eventDate: londonDate(e.start), attendees: null, source: "luma"
    });
  }
  return out;
}
