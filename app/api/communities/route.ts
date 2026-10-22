import { sql } from "@/lib/db";
import { json, preflight, requireUser, route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/**
 * Communities from past hosts (venue_hosts) and upcoming events: size, cadence, venues used, public link.
 * ?q= matches whole words (or word prefixes for 4+ letters) in name, event titles, venues and areas.
 */
export const GET = route(async (req) => {
  await requireUser(req);
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = q.length <= 3 ? `\\m${esc}\\M` : `\\m${esc}`;
  const rows = await sql`
    with items as (
      select distinct on (community, coalesce(url, id)) * from (
        select h.community, h.event_title as title, h.event_url as url, h.event_date::timestamptz as at, h.attendees,
               v.name as venue, v.area, false as upcoming, h.id::text as id
        from venue_hosts h join venues v on v.id = h.venue_id where v.junk_at is null
        union all
        select e.community, e.title, e.url, e.starts_at, e.attendees, coalesce(v.name, e.venue_name), v.area, e.starts_at > now(), e.id::text
        from events e left join venues v on v.id = e.venue_id where e.community is not null
      ) u order by community, coalesce(url, id), upcoming desc
    )
    select community as name,
      count(*) filter (where not upcoming)::int as past_events,
      count(*) filter (where upcoming)::int as upcoming_events,
      round(percentile_cont(0.5) within group (order by attendees))::int as typical_attendees,
      max(at) filter (where not upcoming) as last_event,
      min(at) filter (where upcoming) as next_event,
      (array_agg(title order by at desc) filter (where title is not null))[1:5] as recent_titles,
      (array_agg(distinct case when area is not null then venue || ' (' || area || ')' else venue end) filter (where venue is not null))[1:6] as venues,
      (array_agg(url order by at desc) filter (where url is not null))[1] as link
    from items
    group by community
    having ${q} = '' or community ~* ${re} or bool_or(title ~* ${re}) or bool_or(venue ~* ${re}) or bool_or(area ~* ${re})
    order by count(*) desc, max(at) desc nulls last
    limit 15`;
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
  return json({
    communities: rows.map((r) => ({
      ...r, last_event: r.last_event ? day(new Date(r.last_event)) : null, next_event: r.next_event ? new Date(r.next_event).toISOString() : null
    }))
  });
});
