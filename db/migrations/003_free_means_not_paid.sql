-- "Free" drops venues known to be paid. Most seeded venues have unconfirmed
-- terms; keep them (confirmed-free venues still rank higher).
set search_path = public, extensions;

create or replace function public.search_venues(
  p_lat double precision, p_lng double precision, p_headcount int,
  p_starts timestamptz, p_ends timestamptz,
  p_radius_m int default 4000, p_free_only boolean default false, p_limit int default 3)
returns table (
  id uuid, name text, address text, area text, kind text, capacity int, terms text, price_note text,
  av text[], evening_ok boolean, weekend_ok boolean, ok_to_call boolean, intro_via_poster boolean,
  lat double precision, lng double precision, distance_m double precision,
  host_count bigint, hosts text[], last_hosted date,
  availability_status text, availability_conditions text, availability_at timestamptz,
  score double precision)
language sql stable set search_path = public, extensions as $$
  with q as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g,
           extract(hour from p_starts at time zone 'Europe/London') >= 17 as evening,
           extract(isodow from p_starts at time zone 'Europe/London') >= 6 as weekend
  ), c as (
    select v.*, st_distance(v.location, q.g) as d, q.evening, q.weekend,
           h.cnt, h.hosts, h.last_hosted,
           a.status as a_status, a.conditions as a_conditions, a.created_at as a_at
    from venues v cross join q
    left join lateral (
      select count(*) as cnt, (array_agg(distinct vh.community))[1:4] as hosts, max(vh.event_date) as last_hosted
      from venue_hosts vh where vh.venue_id = v.id
    ) h on true
    left join lateral (
      select av.status, av.conditions, av.created_at from availability av
      where av.venue_id = v.id and tstzrange(av.starts_at, av.ends_at) && tstzrange(p_starts, p_ends)
      order by av.created_at desc limit 1
    ) a on true
    where v.junk_at is null and v.location is not null
      and st_dwithin(v.location, q.g, p_radius_m)
      and (v.capacity >= p_headcount or v.capacity is null)
      and (not q.evening or v.evening_ok is not false)
      and (not q.weekend or v.weekend_ok is not false)
      and (not p_free_only or v.terms <> 'paid')
      and a.status is distinct from 'unavailable'
  )
  select c.id, c.name, c.address, c.area, c.kind, c.capacity, c.terms, c.price_note,
         c.av, c.evening_ok, c.weekend_ok, c.ok_to_call, c.intro_via_poster,
         st_y(c.location::geometry), st_x(c.location::geometry), c.d,
         c.cnt, c.hosts, c.last_hosted, c.a_status, c.a_conditions, c.a_at,
         3 * (1 - c.d / p_radius_m)
         + least(c.cnt, 5) / 2.5
         + case when c.terms in ('free', 'free_for_community') then 1.5 else 0 end
         + case c.a_status when 'available' then 2 when 'partial' then 1 else 0 end
         + case when c.ok_to_call then 0.5 else 0 end
         - case when c.capacity is null then 2.5 else greatest(c.capacity::float / p_headcount - 3, 0) / 2 end as score
  from c
  order by score desc
  limit p_limit
$$;
