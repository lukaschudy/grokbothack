// Meetup: parse the Apollo state embedded in public pages (no API key).
import { cachedText, extractPostcode, isInLondon, londonDate, type SourceEvent, type VenueEvidence } from "./types";

export type MeetupEvent = {
  id: string;
  title: string;
  url: string;
  startsAt: string;
  physical: boolean;
  attendees: number | null;
  venueName: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  postcode: string | null;
  groupName: string | null;
  groupUrlname: string | null;
  isFree: boolean | null;
};

/** Pure: page HTML → events (works for /find/ and /<group>/events/?type=past). */
export function parseMeetupHtml(html: string): MeetupEvent[] {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/) ?? html.match(/__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  const apollo: Record<string, any> = JSON.parse(m[1]!).props?.pageProps?.__APOLLO_STATE__ ?? {};
  const deref = (v: any) => (v && v.__ref ? apollo[v.__ref] : v);
  const out: MeetupEvent[] = [];
  for (const [k, e] of Object.entries(apollo)) {
    if (!k.startsWith("Event:") || !e?.dateTime) continue;
    const venue = deref(e.venue);
    const group = deref(e.group);
    const physical = e.eventType === "PHYSICAL" && !!venue?.address && venue.name !== "Online event";
    out.push({
      id: String(e.id),
      title: String(e.title).trim(),
      url: e.eventUrl ?? `https://www.meetup.com/events/${e.id}/`,
      startsAt: new Date(e.dateTime).toISOString(),
      physical,
      attendees: e.rsvps?.totalCount ?? e.going?.totalCount ?? null,
      venueName: physical ? String(venue.name).trim() : null,
      address: physical ? String(venue.address).trim() : null,
      city: venue?.city || null,
      country: venue?.country ? String(venue.country).toUpperCase() : null,
      postcode: physical ? extractPostcode(`${venue.address} ${venue.name}`) : null,
      groupName: group?.name ?? null,
      groupUrlname: group?.urlname ?? e.eventUrl?.match(/meetup\.com\/([^/]+)\//)?.[1] ?? null,
      isFree: e.feeSettings ? false : null
    });
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
}

export async function fetchMeetupFind(keyword: string): Promise<MeetupEvent[]> {
  const url = `https://www.meetup.com/find/?location=gb--17--London&source=EVENTS&keywords=${encodeURIComponent(keyword)}`;
  return parseMeetupHtml(await cachedText(url, { cacheKey: `meetup/find-${keyword}.html`, minGapMs: 4000 }));
}

export async function fetchMeetupGroupPast(urlname: string): Promise<MeetupEvent[]> {
  const url = `https://www.meetup.com/${encodeURIComponent(urlname)}/events/?type=past`;
  return parseMeetupHtml(await cachedText(url, { cacheKey: `meetup/past-${urlname}.html`, minGapMs: 4000 }));
}

type Coords = Map<string, { lat: number; lng: number }>;

/** London = country GB and, when geocodable, inside the London box. Never by city name alone. */
function londonCoords(e: MeetupEvent, coords: Coords): { lat: number; lng: number } | null | "unknown" {
  if (e.country !== "GB") return null;
  const c = e.postcode ? coords.get(e.postcode) : undefined;
  if (c) return isInLondon(c.lat, c.lng) ? c : null;
  return "unknown";
}

export function meetupToSourceEvent(e: MeetupEvent, coords: Coords): SourceEvent | null {
  if (!e.physical) return null;
  const c = londonCoords(e, coords);
  if (c === null || (c === "unknown" && !/london/i.test(e.city ?? ""))) return null;
  return {
    source: "meetup",
    externalId: e.id,
    title: e.title,
    url: e.url,
    startsAt: e.startsAt,
    endsAt: null,
    venueName: e.venueName,
    address: e.address,
    lat: c === "unknown" ? null : c.lat,
    lng: c === "unknown" ? null : c.lng,
    community: e.groupName,
    attendees: e.attendees,
    isFree: e.isFree,
    tags: /hack/i.test(e.title) ? ["hackathon"] : []
  };
}

/** Evidence needs real coordinates: only events whose postcode geocodes inside London. */
export function meetupToEvidence(e: MeetupEvent, coords: Coords, now: Date): VenueEvidence | null {
  if (!e.physical || !e.venueName || new Date(e.startsAt) > now) return null;
  const c = londonCoords(e, coords);
  if (!c || c === "unknown") return null;
  return {
    venueName: e.venueName, address: e.address, lat: c.lat, lng: c.lng, googlePlaceId: null,
    community: e.groupName ?? "Unknown", eventTitle: e.title, eventUrl: e.url,
    eventDate: londonDate(e.startsAt), attendees: e.attendees, source: "meetup"
  };
}
