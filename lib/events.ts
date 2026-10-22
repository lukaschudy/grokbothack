import { sql } from "./db";
import type { RankedEvent } from "./sources/types";

/** Upcoming events from the DB, as the ranked shape lib/ics.ts expects. */
export async function upcomingEvents(limit = 80): Promise<RankedEvent[]> {
  const rows = await sql<{ source: RankedEvent["source"]; external_id: string; title: string; url: string; starts_at: Date; ends_at: Date | null;
    venue_name: string | null; address: string | null; lat: number | null; lng: number | null; community: string | null; attendees: number | null;
    is_free: boolean | null; tags: string[]; score: number; reasons: string[] }[]>`
    select source, external_id, title, url, starts_at, ends_at, venue_name, address,
           st_y(location::geometry) as lat, st_x(location::geometry) as lng, community, attendees, is_free, tags, score, reasons
    from events where coalesce(ends_at, starts_at + interval '3 hours') > now()
    order by score desc, starts_at limit ${limit}`;
  return rows.map((r) => ({
    source: r.source, externalId: r.external_id, title: r.title, url: r.url, startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at?.toISOString() ?? null, venueName: r.venue_name, address: r.address, lat: r.lat, lng: r.lng,
    community: r.community, attendees: r.attendees, isFree: r.is_free, tags: r.tags, score: r.score, reasons: r.reasons
  }));
}
