import { upcomingEvents } from "@/lib/events";
import { ok } from "@/lib/api";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 10) || 10));
  const events = await upcomingEvents(limit);
  return ok({
    events: events.map((e) => ({ title: e.title, starts_at: e.startsAt, ends_at: e.endsAt, venue: e.venueName, community: e.community, going: e.attendees, url: e.url, source: e.source, reasons: e.reasons })),
    calendar: { webcal: `webcal://${url.host}/events.ics`, ics: `${url.origin}/events.ics` }
  });
}
