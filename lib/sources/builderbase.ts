// BuilderBase: public discovery feed (worldwide hackathons, city-level location only).
import { cachedJson, isInLondon, type SourceEvent } from "./types";

export async function fetchBuilderBase(): Promise<any[]> {
  const json: any = await cachedJson("https://edge.builderbase.com/super-events/public/discovery?status=active&limit=100", {
    cacheKey: "builderbase/discovery.json"
  });
  return json.data?.events ?? [];
}

/** Pure: discovery event → SourceEvent if it's in London (by coordinates + GB), else null. */
export function builderBaseToSourceEvent(e: any): SourceEvent | null {
  const loc = e.location ?? {};
  if (!/^(GB|UK|United Kingdom)$/i.test(loc.country ?? "") || !isInLondon(loc.lat, loc.lng)) return null;
  if (!e.start_at || e.format === "online") return null;
  const url = e.external_url
    ? String(e.external_url).replace(/[?&]utm_[^&]*/g, "").replace(/\?$/, "")
    : `https://builderbase.com/event/${e.slug}`;
  return {
    source: "builderbase",
    externalId: String(e.id),
    title: String(e.name).trim(),
    url,
    startsAt: new Date(e.start_at).toISOString(),
    endsAt: e.end_at ? new Date(e.end_at).toISOString() : null,
    venueName: null,
    address: null,
    // City-level coordinates (even "precise" ones are the London centroid) are not a venue.
    lat: null,
    lng: null,
    community: e.organization?.name ?? null,
    attendees: e.participant_count || null,
    isFree: null,
    tags: [e.event_type, ...(e.theme_tags ?? []).map((t: string) => t.toLowerCase())].filter(Boolean)
  };
}
