-- Roomline schema: venues, trust, provenance, availability, calls, events.
-- Runs on Supabase Postgres and on plain Postgres + PostGIS (local dev, tests).
-- The app sets `role` and `request.jwt.claim.sub` per transaction, the same way
-- PostgREST does, so the RLS policies below are the real gate in both places.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;
set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant anon, authenticated to current_user;
grant usage on schema public, extensions to anon, authenticated;

create or replace function public.current_uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- People -------------------------------------------------------------------

-- Credentials stay in a table no client role can read.
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references public.accounts (id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 80),
  community text,
  is_root boolean not null default false,
  banned_at timestamptz,
  vouch_revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.vouches (
  voucher_id uuid not null references public.profiles (id) on delete cascade,
  vouchee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (voucher_id, vouchee_id),
  check (voucher_id <> vouchee_id)
);

-- Posting needs one vouch from a member in good standing (or root status).
-- Vouches can only be created by members who may vouch (see policy below),
-- so a single level of checking is enough.
create or replace function public.can_post(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = uid and p.banned_at is null
      and (p.is_root or exists (
        select 1 from vouches v join profiles voucher on voucher.id = v.voucher_id
        where v.vouchee_id = uid and voucher.banned_at is null))
  )
$$;

create or replace function public.can_vouch(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_post(uid)
     and exists (select 1 from profiles where id = uid and vouch_revoked_at is null)
$$;

-- Venues -------------------------------------------------------------------

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  address text,
  area text,
  location geography (Point, 4326),
  kind text not null default 'other'
    check (kind in ('bookable', 'company_office', 'community_space', 'university', 'coworking', 'pub_or_bar', 'other')),
  capacity int check (capacity between 1 and 5000),
  av text[] not null default '{}',
  evening_ok boolean,
  weekend_ok boolean,
  terms text not null default 'unknown' check (terms in ('free', 'free_for_community', 'paid', 'unknown')),
  price_note text,
  ok_to_call boolean not null default false,
  intro_via_poster boolean not null default false,
  website text,
  google_place_id text,
  notes text,
  created_by uuid references public.profiles (id) default public.current_uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  junk_at timestamptz
);
create index venues_location_idx on public.venues using gist (location);

-- Members-only contact details. Kept apart so RLS can hide them.
create table public.venue_contacts (
  venue_id uuid primary key references public.venues (id) on delete cascade,
  contact_name text,
  contact_role text,
  email text,
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  updated_at timestamptz not null default now()
);

-- Evidence: events that actually happened at a venue.
create table public.venue_hosts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  community text not null,
  event_title text,
  event_url text,
  event_date date,
  attendees int,
  source text not null default 'organiser',
  created_at timestamptz not null default now(),
  unique (venue_id, event_url)
);
create index venue_hosts_venue_idx on public.venue_hosts (venue_id);

-- Provenance: who set or confirmed each field, and when.
create table public.field_log (
  id bigint generated always as identity primary key,
  venue_id uuid not null references public.venues (id) on delete cascade,
  field text not null,
  value jsonb,
  by_profile uuid references public.profiles (id) on delete set null,
  source text not null,
  at timestamptz not null default now()
);
create index field_log_venue_idx on public.field_log (venue_id, field, at desc);

create or replace view public.venue_field_status with (security_invoker = true) as
  select distinct on (f.venue_id, f.field)
    f.venue_id, f.field, f.value, f.source, f.at as confirmed_at, f.by_profile, p.display_name as confirmed_by
  from public.field_log f left join public.profiles p on p.id = f.by_profile
  order by f.venue_id, f.field, f.at desc;

create or replace function public.log_venue_fields() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text;
  newj jsonb := to_jsonb(new);
  oldj jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  src text := coalesce(nullif(current_setting('roomline.source', true), ''), 'organiser');
  who uuid := coalesce(public.current_uid(), new.created_by);
begin
  for k in select jsonb_object_keys(newj) loop
    continue when k in ('id', 'created_at', 'updated_at', 'created_by', 'junk_at', 'location');
    continue when tg_op = 'INSERT' and newj -> k = 'null'::jsonb;
    continue when tg_op = 'UPDATE' and (newj -> k) is not distinct from (oldj -> k);
    insert into field_log (venue_id, field, value, by_profile, source) values (new.id, k, newj -> k, who, src);
  end loop;
  return new;
end $$;

create trigger venues_log_fields after insert or update on public.venues
  for each row execute function public.log_venue_fields();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger venues_touch before update on public.venues
  for each row execute function public.touch_updated_at();

-- Re-confirm current values without changing them ("still correct").
create or replace function public.confirm_venue_fields(p_venue uuid, p_fields text[], p_source text default 'organiser')
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := public.current_uid(); j jsonb; k text;
begin
  if uid is not null and not public.can_post(uid) then raise exception 'not_trusted' using errcode = '42501'; end if;
  select to_jsonb(v) into j from venues v where v.id = p_venue;
  if j is null then raise exception 'venue_not_found'; end if;
  foreach k in array p_fields loop
    continue when not j ? k;
    insert into field_log (venue_id, field, value, by_profile, source) values (p_venue, k, j -> k, uid, p_source);
  end loop;
end $$;

-- Junk handling ------------------------------------------------------------

create table public.venue_reports (
  venue_id uuid not null references public.venues (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (venue_id, reporter_id)
);

-- A root's report, or two reports from members in good standing, marks a
-- venue as junk. The poster is banned and everyone who vouched for them loses
-- the right to vouch.
create or replace function public.report_junk(p_venue uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.current_uid();
  poster uuid;
  reports int;
  reporter_is_root boolean;
begin
  if uid is null or not public.can_post(uid) then raise exception 'not_trusted' using errcode = '42501'; end if;
  select created_by into poster from venues where id = p_venue and junk_at is null;
  if not found then raise exception 'venue_not_found'; end if;
  insert into venue_reports (venue_id, reporter_id, reason) values (p_venue, uid, p_reason)
    on conflict (venue_id, reporter_id) do nothing;
  select is_root into reporter_is_root from profiles where id = uid;
  select count(*) into reports from venue_reports r where r.venue_id = p_venue and public.can_post(r.reporter_id);
  if not (reporter_is_root or reports >= 2) then
    return jsonb_build_object('junk', false, 'reports', reports);
  end if;
  update venues set junk_at = now() where id = p_venue;
  update profiles set banned_at = now() where id = poster and not is_root;
  update profiles set vouch_revoked_at = now()
    where id in (select voucher_id from vouches where vouchee_id = poster) and vouch_revoked_at is null;
  return jsonb_build_object('junk', true, 'reports', reports);
end $$;

-- Availability, calls, requests ---------------------------------------------

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  headcount int not null,
  event_title text,
  status text not null default 'queued'
    check (status in ('queued', 'dialing', 'ringing', 'in_progress', 'completed', 'failed', 'no_answer', 'busy', 'canceled')),
  twilio_sid text,
  answered_at timestamptz,
  ended_at timestamptz,
  transcript jsonb not null default '[]',
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index calls_venue_idx on public.calls (venue_id, created_at desc);

create table public.availability (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null check (status in ('available', 'unavailable', 'partial')),
  conditions text,
  price_note text,
  confirmed_by_name text,
  source text not null check (source in ('call', 'organiser', 'email')),
  call_id uuid references public.calls (id) on delete set null,
  recorded_by uuid references public.profiles (id) on delete set null default public.current_uid(),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index availability_venue_idx on public.availability (venue_id, created_at desc);

create table public.app_settings (
  key text primary key,
  value jsonb not null
);
insert into public.app_settings (key, value) values ('call_cooldown_days', '7');

-- One call answers every organiser: reuse a recent answer, else allow at most
-- one call per venue per cooldown window.
create or replace function public.request_call(
  p_venue uuid, p_starts timestamptz, p_ends timestamptz, p_headcount int, p_title text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.current_uid();
  v venues;
  recent availability;
  last_call calls;
  cooldown int := coalesce((select (value #>> '{}')::int from app_settings where key = 'call_cooldown_days'), 7);
  new_id uuid;
begin
  if uid is null or not public.can_post(uid) then raise exception 'not_trusted' using errcode = '42501'; end if;
  select * into v from venues where id = p_venue and junk_at is null;
  if not found then raise exception 'venue_not_found'; end if;
  if not v.ok_to_call or v.kind <> 'bookable' then raise exception 'not_ok_to_call'; end if;
  if not exists (select 1 from venue_contacts where venue_id = p_venue and phone is not null) then
    raise exception 'no_phone';
  end if;

  select a.* into recent from availability a
    where a.venue_id = p_venue and a.source = 'call'
      and a.created_at > now() - make_interval(days => cooldown)
      and tstzrange(a.starts_at, a.ends_at) && tstzrange(p_starts, p_ends)
    order by a.created_at desc limit 1;
  if found then
    return jsonb_build_object('outcome', 'reused', 'call_id', recent.call_id, 'availability_id', recent.id);
  end if;

  select c.* into last_call from calls c
    where c.venue_id = p_venue
      and c.status not in ('failed', 'canceled', 'no_answer', 'busy')
      and c.created_at > now() - make_interval(days => cooldown)
    order by c.created_at desc limit 1;
  if found then
    return jsonb_build_object(
      'outcome', case when last_call.status in ('queued', 'dialing', 'ringing', 'in_progress') then 'in_progress' else 'called_recently' end,
      'call_id', last_call.id);
  end if;

  insert into calls (venue_id, requested_by, starts_at, ends_at, headcount, event_title)
    values (p_venue, uid, p_starts, p_ends, p_headcount, p_title)
    returning id into new_id;
  return jsonb_build_object('outcome', 'new', 'call_id', new_id);
end $$;

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  from_profile uuid not null references public.profiles (id) on delete cascade default public.current_uid(),
  subject text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'sent')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- Events feed ----------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('luma', 'meetup', 'devpost', 'builderbase')),
  external_id text not null,
  title text not null,
  url text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  venue_name text,
  address text,
  location geography (Point, 4326),
  community text,
  attendees int,
  is_free boolean,
  tags text[] not null default '{}',
  venue_id uuid references public.venues (id) on delete set null,
  score double precision not null default 0,
  reasons text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index events_starts_idx on public.events (starts_at);
create index events_location_idx on public.events using gist (location);

-- Search ---------------------------------------------------------------------

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
      and v.capacity >= p_headcount
      and (not q.evening or v.evening_ok is not false)
      and (not q.weekend or v.weekend_ok is not false)
      and (not p_free_only or v.terms in ('free', 'free_for_community'))
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
         - greatest(c.capacity::float / p_headcount - 3, 0) / 2 as score
  from c
  order by score desc
  limit p_limit
$$;

create or replace function public.event_clashes(
  p_lat double precision, p_lng double precision, p_starts timestamptz, p_ends timestamptz, p_radius_m int default 5000)
returns table (title text, url text, starts_at timestamptz, venue_name text, community text, attendees int, distance_m double precision)
language sql stable set search_path = public, extensions as $$
  select e.title, e.url, e.starts_at, e.venue_name, e.community, e.attendees,
         st_distance(e.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)
  from events e
  where e.starts_at < p_ends
    and coalesce(e.ends_at, e.starts_at + interval '3 hours') > p_starts
    and (e.location is null or st_dwithin(e.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_radius_m))
  order by e.attendees desc nulls last
  limit 3
$$;

-- Row level security ----------------------------------------------------------

alter table public.accounts enable row level security;
alter table public.profiles enable row level security;
alter table public.vouches enable row level security;
alter table public.venues enable row level security;
alter table public.venue_contacts enable row level security;
alter table public.venue_hosts enable row level security;
alter table public.field_log enable row level security;
alter table public.venue_reports enable row level security;
alter table public.calls enable row level security;
alter table public.availability enable row level security;
alter table public.app_settings enable row level security;
alter table public.requests enable row level security;
alter table public.events enable row level security;

-- No grants on accounts or app_settings: server code only.
grant select on public.profiles, public.vouches, public.venues, public.venue_hosts, public.field_log,
  public.venue_field_status, public.availability, public.events to anon, authenticated;
grant select on public.venue_contacts, public.calls, public.requests, public.venue_reports to authenticated;
grant insert, update on public.venues, public.venue_contacts to authenticated;
grant insert on public.venue_hosts, public.vouches, public.availability, public.requests to authenticated;
grant update (display_name, community) on public.profiles to authenticated;
grant update (status, sent_at) on public.requests to authenticated;
grant execute on all functions in schema public to anon, authenticated;

create policy "profiles are public" on public.profiles for select using (true);
create policy "edit own profile" on public.profiles for update using (id = public.current_uid());

create policy "vouches are public" on public.vouches for select using (true);
create policy "vouch if allowed" on public.vouches for insert
  with check (voucher_id = public.current_uid() and public.can_vouch(public.current_uid()));

create policy "venues are public unless junk" on public.venues for select using (junk_at is null);
create policy "trusted members post venues" on public.venues for insert
  with check (public.can_post(public.current_uid()) and created_by = public.current_uid());
create policy "trusted members update venues" on public.venues for update
  using (public.can_post(public.current_uid()) and junk_at is null)
  with check (public.can_post(public.current_uid()));

create policy "contacts are members-only" on public.venue_contacts for select
  using (public.can_post(public.current_uid()));
create policy "trusted members add contacts" on public.venue_contacts for insert
  with check (public.can_post(public.current_uid()));
create policy "trusted members update contacts" on public.venue_contacts for update
  using (public.can_post(public.current_uid()));

create policy "hosts are public" on public.venue_hosts for select using (true);
create policy "trusted members add hosts" on public.venue_hosts for insert
  with check (public.can_post(public.current_uid()));

create policy "provenance is public" on public.field_log for select using (true);

create policy "members see reports" on public.venue_reports for select using (public.can_post(public.current_uid()));

create policy "members see calls" on public.calls for select using (public.can_post(public.current_uid()));

create policy "availability is public" on public.availability for select using (true);
create policy "trusted members record availability" on public.availability for insert
  with check (public.can_post(public.current_uid()) and source <> 'call');

create policy "own requests" on public.requests for select using (from_profile = public.current_uid());
create policy "trusted members draft requests" on public.requests for insert
  with check (from_profile = public.current_uid() and public.can_post(public.current_uid()));
create policy "send own requests" on public.requests for update using (from_profile = public.current_uid());

create policy "events are public" on public.events for select using (true);
