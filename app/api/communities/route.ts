import { sql } from "@/lib/db";
import { ok } from "@/lib/api";

/** Communities seen hosting events, from venue evidence. ?q= matches community, event or venue. */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  const like = `%${q}%`;
  const rows = await sql<{ community: string; events: number; last: string | null; turnout: number | null; recent: string[]; venues: string[]; links: string[] }[]>`
    select h.community, count(*)::int as events, max(h.event_date)::text as last,
           round(avg(h.attendees))::int as turnout,
           (array_agg(h.event_title order by h.event_date desc nulls last))[1:3] as recent,
           (array_agg(distinct v.name))[1:4] as venues,
           (array_agg(h.event_url order by h.event_date desc nulls last))[1:1] as links
    from venue_hosts h join venues v on v.id = h.venue_id and v.junk_at is null
    where ${q} = '' or h.community ilike ${like} or h.event_title ilike ${like} or v.name ilike ${like}
    group by h.community
    order by count(*) desc
    limit 10`;
  return ok({ communities: rows.map((r) => ({ name: r.community, events_seen: r.events, last_event: r.last, typical_turnout: r.turnout, recent_events: r.recent, venues: r.venues, link: r.links[0] ?? null })) });
}
