import { asUser } from "./db";
import { parseAskLocally } from "./ask";
import { parseAskWithGrok, type ParsedAsk } from "./grok";
import { geocode, type Place } from "./places";
import { ago, formatWindow, londonDate, londonToUtc, resolveDay } from "./time";

export type VenueHit = {
  id: string;
  name: string;
  address: string | null;
  area: string | null;
  kind: string;
  capacity: number | null;
  terms: string;
  price_note: string | null;
  ok_to_call: boolean;
  intro_via_poster: boolean;
  lat: number;
  lng: number;
  distance_m: number;
  hosts: string[];
  host_count: number;
  last_hosted: string | null;
  availability_status: string | null;
  availability_conditions: string | null;
  availability_at: string | null;
  reasons: string[];
  callable: boolean;
};

export type Clash = { title: string; url: string; community: string | null; attendees: number | null; venue_name: string | null; distance_m: number | null; starts_at: string };

export type SearchResult = {
  query: string;
  parsed: { headcount: number; starts_at: string; ends_at: string; window: string; place: Place; free_only: boolean; event_title: string | null; radius_m: number };
  venues: VenueHit[];
  clashes: Clash[];
  ms: number;
  parser: "grok" | "local";
};

async function parse(text: string, now: Date): Promise<{ ask: ParsedAsk; parser: "grok" | "local" }> {
  const local = parseAskLocally(text);
  try {
    const grok = await parseAskWithGrok(text, now);
    if (grok) return { ask: { ...local, ...Object.fromEntries(Object.entries(grok).filter(([, v]) => v !== null)) } as ParsedAsk, parser: "grok" };
  } catch (e) {
    console.warn("[search] grok parse failed, using local parser:", (e as Error).message);
  }
  return { ask: local, parser: "local" };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const distanceLabel = (m: number) => (m < 950 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`);

const TERMS_LABEL: Record<string, string> = {
  free: "Free to use",
  free_for_community: "Free for community events",
  paid: "Paid",
  unknown: "Terms not confirmed yet"
};

export function reasonsFor(v: Omit<VenueHit, "reasons" | "callable">, headcount: number, place: string): string[] {
  const r: string[] = [];
  r.push(v.capacity ? `Fits ${v.capacity} — you need ${headcount}` : "Capacity not confirmed yet");
  r.push(`${distanceLabel(v.distance_m)} from ${place}`);
  if (v.host_count > 0) {
    const names = v.hosts.slice(0, 2).join(", ");
    const more = v.host_count > 2 ? ` and ${v.host_count - 2} more` : "";
    r.push(`Hosted ${names}${more}`);
  }
  if (v.availability_status === "available" && v.availability_at) r.push(`Confirmed free that evening, ${ago(new Date(v.availability_at))}`);
  if (v.availability_status === "partial") r.push(`Partly free: ${v.availability_conditions ?? "with conditions"}`);
  r.push(v.terms === "paid" && v.price_note ? `Paid: ${v.price_note}` : TERMS_LABEL[v.terms] ?? "Terms unknown");
  if (v.kind === "company_office") r.push(v.intro_via_poster ? "Company office — intro via the member who posted it" : "Company office — ask a past host for an intro");
  return r;
}

export async function searchVenues(text: string, uid: string | null, now = new Date()): Promise<SearchResult> {
  const t0 = performance.now();
  const { ask, parser } = await parse(text, now);
  const place = (ask.near && (await geocode(ask.near))) || { name: "Old Street", lat: 51.5257, lng: -0.0875 };
  const date = (ask.day_phrase && resolveDay(ask.day_phrase, now)) || (ask.date && /^\d{4}-\d{2}-\d{2}$/.test(ask.date) ? ask.date : null) || londonDate(now);
  const start = ask.start_time && HHMM.test(ask.start_time) ? ask.start_time : "18:30";
  const startsAt = londonToUtc(date, start);
  const endsAt = ask.end_time && HHMM.test(ask.end_time) && londonToUtc(date, ask.end_time) > startsAt
    ? londonToUtc(date, ask.end_time)
    : new Date(startsAt.getTime() + 3 * 3600_000);
  const headcount = ask.headcount && ask.headcount > 0 ? ask.headcount : 50;

  let rows: Omit<VenueHit, "reasons" | "callable">[] = [];
  let radius = 3000;
  for (const r of [3000, 6000, 12000]) {
    radius = r;
    rows = await asUser(uid, (tx) => tx<Omit<VenueHit, "reasons" | "callable">[]>`
      select id, name, address, area, kind, capacity, terms, price_note, ok_to_call, intro_via_poster,
             lat, lng, distance_m, coalesce(hosts, '{}') as hosts, host_count::int as host_count,
             last_hosted::text as last_hosted, availability_status, availability_conditions, availability_at
      from search_venues(${place.lat}, ${place.lng}, ${headcount}, ${startsAt}, ${endsAt}, ${r}, ${ask.free_only}, 3)`);
    if (rows.length >= 3) break;
  }
  const clashes = await asUser(uid, (tx) => tx<Clash[]>`
    select title, url, community, attendees, venue_name, distance_m, starts_at
    from event_clashes(${place.lat}, ${place.lng}, ${startsAt}, ${endsAt})`);

  return {
    query: text,
    parsed: {
      headcount, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), window: formatWindow(startsAt, endsAt), place,
      free_only: ask.free_only, event_title: ask.event_title, radius_m: radius
    },
    venues: rows.map((v) => ({
      ...v,
      reasons: reasonsFor(v, headcount, place.name),
      callable: v.ok_to_call && v.kind === "bookable"
    })),
    clashes: clashes.map((c) => ({ ...c, starts_at: new Date(c.starts_at).toISOString() })),
    ms: Math.round(performance.now() - t0),
    parser
  };
}
