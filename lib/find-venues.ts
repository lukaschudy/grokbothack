// Venue search for the Grok Bot API: structured filters or a sentence, top 3 with reasons, never contacts.
// "Free" keeps venues whose terms are unknown (most seeded venues): only paid ones are dropped, confirmed
// free ones rank first. Done here, not in search_venues, so no migration is needed.
import { asUser, sql } from "./db";
import { parseAskLocally } from "./ask";
import { parseAskWithGrok } from "./grok";
import { geocode, type Place } from "./places";
import { reasonsFor, type Clash, type VenueHit } from "./search";
import { formatWindow, londonDate, londonToUtc, resolveDay } from "./time";

export type FindInput = { place: Place; headcount: number; start: Date; end: Date; freeOnly: boolean; radiusM?: number | null };
type Row = Omit<VenueHit, "reasons" | "callable"> & { av: string[]; evening_ok: boolean | null; weekend_ok: boolean | null; score: number };

const FREE = new Set(["free", "free_for_community"]);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const shortDate = (d: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${d}T12:00:00Z`));

/** Free-only: drop paid, confirmed free first, then unknown terms; search_venues' score order within each. */
export function freeFirst<T extends { terms: string }>(rows: T[]): T[] {
  return [...rows.filter((r) => FREE.has(r.terms)), ...rows.filter((r) => r.terms !== "paid" && !FREE.has(r.terms))];
}

/** "free space for 80 next Thursday near Old Street" → filters. Grok when configured, else the local parser. */
export async function parseAsk(text: string, now = new Date(), find = geocode): Promise<Omit<FindInput, "place"> & { place: Place | null; near: string | null }> {
  let ask = parseAskLocally(text);
  try {
    const grok = await parseAskWithGrok(text, now);
    if (grok) ask = { ...ask, ...Object.fromEntries(Object.entries(grok).filter(([, v]) => v !== null)) };
  } catch (e) {
    console.warn("[find-venues] grok parse failed, using local parser:", (e as Error).message);
  }
  const date = (ask.day_phrase && resolveDay(ask.day_phrase, now)) || (ask.date && /^\d{4}-\d{2}-\d{2}$/.test(ask.date) ? ask.date : null) || londonDate(now);
  const start = londonToUtc(date, ask.start_time && HHMM.test(ask.start_time) ? ask.start_time : "18:30");
  const endAt = ask.end_time && HHMM.test(ask.end_time) ? londonToUtc(date, ask.end_time) : null;
  return {
    near: ask.near, place: ask.near ? await find(ask.near) : null,
    headcount: ask.headcount && ask.headcount > 0 ? ask.headcount : 50,
    start, end: endAt && endAt > start ? endAt : new Date(start.getTime() + 3 * 3600_000), freeOnly: ask.free_only
  };
}

export async function findVenues(uid: string | null, q: FindInput) {
  const { place, headcount, start, end, freeOnly } = q;
  let rows: Row[] = [];
  let radius = q.radiusM ?? 3000;
  for (const r of q.radiusM ? [q.radiusM] : [3000, 6000]) {
    radius = r;
    const all = await asUser(uid, (tx) => tx<Row[]>`
      select id, name, address, area, kind, capacity, terms, price_note, ok_to_call, intro_via_poster, av, evening_ok, weekend_ok,
             lat, lng, distance_m, coalesce(hosts, '{}') as hosts, host_count::int as host_count,
             last_hosted::text as last_hosted, availability_status, availability_conditions, availability_at, score
      from search_venues(${place.lat}, ${place.lng}, ${headcount}, ${start}, ${end}, ${r}, false, 40)`);
    rows = (freeOnly ? freeFirst(all) : all).slice(0, 3);
    if (rows.length >= 3) break;
  }
  const ids = rows.map((r) => r.id);
  const [extras, clashes] = await Promise.all([
    ids.length
      ? sql<{ id: string; biggest_turnout: number | null; can_call: boolean; confirmed: Record<string, { by: string; at: string }>; busy: { title: string; url: string } | null }[]>`
          select v.id,
            (select max(h.attendees) from venue_hosts h where h.venue_id = v.id) as biggest_turnout,
            (v.ok_to_call and v.kind = 'bookable' and exists (select 1 from venue_contacts c where c.venue_id = v.id and c.phone is not null)) as can_call,
            coalesce((select json_object_agg(s.field, json_build_object('by', s.confirmed_by, 'at', s.confirmed_at))
                      from venue_field_status s where s.venue_id = v.id and s.by_profile is not null
                        and s.field in ('capacity', 'terms', 'evening_ok', 'weekend_ok')), '{}') as confirmed,
            (select json_build_object('title', e.title, 'url', e.url) from events e
              where e.venue_id = v.id and e.starts_at < ${end} and coalesce(e.ends_at, e.starts_at + interval '3 hours') > ${start}
              order by e.starts_at limit 1) as busy
          from venues v where v.id = any(${ids}::uuid[])`
      : Promise.resolve([]),
    asUser(uid, (tx) => tx<Clash[]>`
      select title, url, community, attendees, venue_name, distance_m, starts_at from event_clashes(${place.lat}, ${place.lng}, ${start}, ${end})`)
  ]);
  const byId = new Map(extras.map((x) => [x.id, x]));
  const top = clashes[0];
  const clash = top
    ? `Same evening: ${top.title}${top.attendees ? ` (${top.attendees} going)` : ""}${top.venue_name ? ` at ${top.venue_name}` : ""}${top.distance_m != null ? `, ${Math.round(top.distance_m)} m away` : ""}`
    : null;
  const evening = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(start)) >= 17;

  const venues = rows.map((v) => {
    const x = byId.get(v.id);
    const confirmed = x?.confirmed ?? {};
    const reasons = reasonsFor(v, headcount, place.name).map((r) => (r === "Terms not confirmed yet" ? "Terms unconfirmed: ask" : r));
    if (confirmed.capacity) reasons.push(`Capacity confirmed by ${confirmed.capacity.by}`);
    if (x?.biggest_turnout) reasons.push(`Biggest turnout seen: ${x.biggest_turnout}`);
    if (v.last_hosted) reasons.push(`Last hosted ${shortDate(v.last_hosted)}`);
    if (evening && v.evening_ok == null) reasons.push("Evening use not confirmed");
    if (x?.busy) reasons.push(`Heads-up: ${x.busy.title} is listed here that evening`);
    if (x?.can_call) reasons.push("We can phone them to check availability");
    const unconfirmed = [
      ...(v.capacity == null || !confirmed.capacity ? ["capacity"] : []),
      ...(v.terms === "unknown" || !confirmed.terms ? ["terms"] : []),
      ...(evening && (v.evening_ok == null || !confirmed.evening_ok) ? ["evening_ok"] : [])
    ];
    return {
      id: v.id, name: v.name, area: v.area, address: v.address, kind: v.kind, capacity: v.capacity, terms: v.terms, price_note: v.price_note,
      terms_label: FREE.has(v.terms) || v.terms === "paid" ? null : "terms unconfirmed: ask",
      av: v.av, evening_ok: v.evening_ok, weekend_ok: v.weekend_ok, ok_to_call: Boolean(x?.can_call), intro_via_poster: v.intro_via_poster,
      lat: v.lat, lng: v.lng, distance_m: Math.round(v.distance_m), host_count: v.host_count, past_hosts: v.hosts, last_hosted: v.last_hosted,
      biggest_turnout: x?.biggest_turnout ?? null,
      availability: v.availability_status ? { status: v.availability_status, conditions: v.availability_conditions, checked_at: v.availability_at } : null,
      busy: x?.busy ?? null, clash, unconfirmed, reasons
    };
  });

  return {
    query: {
      place: place.name, lat: place.lat, lng: place.lng, headcount, start: start.toISOString(), end: end.toISOString(),
      when: formatWindow(start, end), free_only: freeOnly, radius_m: radius
    },
    venues,
    clashes: clashes.map((c) => ({ ...c, starts_at: new Date(c.starts_at).toISOString(), distance_m: c.distance_m == null ? null : Math.round(c.distance_m) })),
    clash_warning: clash,
    note: venues.length
      ? freeOnly && venues.some((v) => v.terms_label) ? "Some of these haven't confirmed their terms yet: ask before you book." : null
      : `No venues for ${headcount} within ${radius / 1000} km of ${place.name}. Try a bigger radius_m, a smaller headcount, or another area.`
  };
}
