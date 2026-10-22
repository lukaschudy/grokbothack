// Devpost: hackathon list API + JSON-LD on each hackathon page (needs a browser User-Agent).
import { cachedJson, cachedText, extractPostcode, isInLondon, londonDate, type SourceEvent, type VenueEvidence } from "./types";

export type DevpostHackathon = {
  id: number;
  title: string;
  url: string;
  displayedLocation: string;
  registrations: number | null;
  organization: string | null;
  openState: string;
  themes: string[];
};

export type DevpostPlace = { startsAt: string | null; endsAt: string | null; streetAddress: string | null; postcode: string | null };

/** Pure: /api/hackathons JSON → hackathons (skips online ones). */
export function parseDevpostList(json: any): DevpostHackathon[] {
  return (json.hackathons ?? [])
    .filter((h: any) => h.displayed_location?.icon !== "globe" && !/^online$/i.test(h.displayed_location?.location ?? ""))
    .map((h: any) => ({
      id: h.id,
      title: String(h.title).trim(),
      url: h.url,
      displayedLocation: h.displayed_location?.location ?? "",
      registrations: h.registrations_count ?? null,
      organization: h.organization_name || null,
      openState: h.open_state,
      themes: (h.themes ?? []).map((t: any) => t.name)
    }));
}

/** Pure: hackathon page HTML → dates and address from its schema.org Event JSON-LD. */
export function parseDevpostPage(html: string): DevpostPlace | null {
  const m = html.match(/<script type="application\/ld\+json" id="challenge-json-ld">([\s\S]*?)<\/script>/);
  if (!m) return null;
  let ld: any;
  try {
    ld = JSON.parse(m[1]!);
  } catch {
    return null;
  }
  const addr = ld.location?.address ?? {};
  const street = addr.streetAddress ? String(addr.streetAddress).trim() : null;
  return {
    startsAt: ld.startDate ? new Date(ld.startDate).toISOString() : null,
    endsAt: ld.endDate ? new Date(ld.endDate).toISOString() : null,
    streetAddress: street,
    postcode: extractPostcode(addr.postalCode) ?? extractPostcode(street)
  };
}

export async function fetchDevpostList(status: "ended" | "upcoming", maxPages: number): Promise<DevpostHackathon[]> {
  const out: DevpostHackathon[] = [];
  const statusQ = status === "ended" ? "status[]=ended" : "status[]=upcoming&status[]=open";
  for (let page = 1; page <= maxPages; page++) {
    const json: any = await cachedJson(`https://devpost.com/api/hackathons?${statusQ}&search=london&page=${page}`, {
      cacheKey: `devpost/${status}-${page}.json`
    });
    out.push(...parseDevpostList(json));
    if ((json.hackathons ?? []).length < (json.meta?.per_page ?? 40)) break;
  }
  return out;
}

export async function fetchDevpostPlace(h: DevpostHackathon): Promise<DevpostPlace | null> {
  const html = await cachedText(h.url, { cacheKey: `devpost/page-${h.id}.html`, maxAgeMs: 30 * 86400_000, minGapMs: 1500 });
  return parseDevpostPage(html);
}

type Coords = Map<string, { lat: number; lng: number }>;

function venueNameOf(h: DevpostHackathon, p: DevpostPlace): string | null {
  const first = h.displayedLocation.split(",")[0]!.trim();
  if (first && !/^(london|greater london|uk|united kingdom|england)$/i.test(first)) return first;
  return p.streetAddress?.split(",")[0]?.trim() || null;
}

/** London only if the page's postcode geocodes inside the London box ("London, Ontario" exists). */
function placeCoords(p: DevpostPlace | null, coords: Coords) {
  const c = p?.postcode ? coords.get(p.postcode) : undefined;
  return c && isInLondon(c.lat, c.lng) ? c : null;
}

export function devpostToSourceEvent(h: DevpostHackathon, p: DevpostPlace | null, coords: Coords): SourceEvent | null {
  const c = placeCoords(p, coords);
  if (!c || !p?.startsAt) return null;
  return {
    source: "devpost",
    externalId: String(h.id),
    title: h.title,
    url: h.url,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    venueName: venueNameOf(h, p),
    address: p.streetAddress,
    lat: c.lat,
    lng: c.lng,
    community: h.organization,
    attendees: h.registrations || null,
    isFree: null,
    tags: ["hackathon", ...h.themes.map((t) => t.toLowerCase())]
  };
}

export function devpostToEvidence(h: DevpostHackathon, p: DevpostPlace | null, coords: Coords, now: Date): VenueEvidence | null {
  const e = devpostToSourceEvent(h, p, coords);
  if (!e || !e.venueName || new Date(e.startsAt) > now) return null;
  return {
    venueName: e.venueName, address: e.address, lat: e.lat!, lng: e.lng!, googlePlaceId: null,
    community: e.community ?? h.title, eventTitle: e.title, eventUrl: e.url,
    eventDate: londonDate(e.startsAt), attendees: e.attendees, source: "devpost"
  };
}
