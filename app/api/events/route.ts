import { upcomingEvents } from "@/lib/events";
import { areaFor } from "@/lib/sources/types";
import { formatWindow } from "@/lib/time";
import { json, preflight, publicBase, route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** Public: ranked upcoming London events with their reasons, plus the calendar feed links. */
export const GET = route(async (req) => {
  const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 10));
  const base = publicBase(req);
  const events = (await upcomingEvents(limit)).map((e) => ({
    title: e.title, url: e.url, source: e.source, starts_at: e.startsAt, ends_at: e.endsAt,
    when: formatWindow(new Date(e.startsAt), new Date(e.endsAt ?? Date.parse(e.startsAt) + 2 * 3600_000)),
    venue_name: e.venueName, area: e.lat != null && e.lng != null ? areaFor(e.lat, e.lng) : null, address: e.address,
    community: e.community, attendees: e.attendees, is_free: e.isFree, tags: e.tags, score: e.score, reasons: e.reasons
  }));
  return json({ events, ics_url: `${base}/events.ics`, webcal_url: `${base.replace(/^https?:/, "webcal:")}/events.ics` });
});
