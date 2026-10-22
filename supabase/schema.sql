-- Mates Rates schema. Paste into the Supabase SQL editor.
-- Public (anon) can read venues, communities, events. Everything else is backend-only (service role).

create extension if not exists postgis;

-- Organisers and trust ---------------------------------------------------

create table organisers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  community text,
  email text,
  luma_url text,
  token_hash text unique not null,          -- sha256 of the API token kept in the organiser's Grok Bot secrets
  is_root boolean not null default false,
  can_vouch boolean not null default true,  -- set false for 30 days when a vouchee posts junk
  suspended boolean not null default false,
  created_at timestamptz not null default now()
);

create table vouches (
  voucher_id uuid not null references organisers(id),
  vouchee_id uuid not null references organisers(id),
  created_at timestamptz not null default now(),
  primary key (voucher_id, vouchee_id),
  check (voucher_id <> vouchee_id)
);

-- Root, or enough vouches from approved organisers who can vouch. Threshold: 1 tonight, 2 after.
create or replace function is_approved(org uuid, threshold int default 1)
returns boolean language sql stable as $$
  select exists (
    select 1 from organisers o
    where o.id = org and not o.suspended
      and (o.is_root or (
        select count(*) from vouches v
        join organisers w on w.id = v.voucher_id
        where v.vouchee_id = o.id and not w.suspended and w.can_vouch
      ) >= threshold)
  );
$$;

-- Venues -----------------------------------------------------------------

create type venue_terms as enum ('free', 'free_with_conditions', 'paid');
create type venue_kind as enum ('company_office', 'bookable', 'pub', 'university', 'community_space', 'other');

create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  location geography(point, 4326) not null,
  google_place_id text unique,              -- dedupe key from Luma
  kind venue_kind not null default 'other',
  capacity int,
  av text,
  evenings boolean,
  weekends boolean,
  terms venue_terms,
  terms_note text,
  callable boolean not null default false,  -- poster agreed the agent may phone the bookings line
  verified boolean not null default false,  -- false = seeded from events, not yet confirmed by an organiser
  added_by uuid references organisers(id),
  last_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index venues_location_idx on venues using gist (location);

-- Never public: only the backend reads this, to call and email.
create table venue_contacts (
  venue_id uuid primary key references venues(id) on delete cascade,
  name text,
  email text,
  phone text,                               -- E.164, e.g. +447700900123
  added_by uuid references organisers(id),
  updated_at timestamptz not null default now()
);

create table flags (
  venue_id uuid not null references venues(id) on delete cascade,
  organiser_id uuid not null references organisers(id),
  reason text,
  created_at timestamptz not null default now(),
  primary key (venue_id, organiser_id)
);

-- Communities and events -------------------------------------------------

create table communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  luma_calendar_id text unique,
  url text,
  description text
);

create table events (
  id text primary key,                      -- '<source>:<source id>'
  source text not null check (source in ('luma', 'meetup', 'devpost', 'builderbase')),
  title text not null,
  url text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  venue_id uuid references venues(id),
  community_id uuid references communities(id),
  host_names text[],
  online boolean not null default false,
  paid boolean,
  guest_count int,
  kind text check (kind in ('hackathon', 'talk', 'networking', 'other')),
  score real,
  reasons text[],
  fetched_at timestamptz not null default now()
);
create index events_venue_idx on events (venue_id, starts_at);
create index events_starts_idx on events (starts_at);

-- Calls and requests -----------------------------------------------------

create table calls (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id),
  organiser_id uuid not null references organisers(id),
  for_start timestamptz not null,
  headcount int,
  twilio_sid text,
  status text not null default 'queued' check (status in ('queued', 'ringing', 'in_progress', 'done', 'no_answer', 'failed')),
  available text check (available in ('yes', 'no', 'maybe')),
  price text,
  conditions text,
  summary text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table requests (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id),
  organiser_id uuid not null references organisers(id),
  for_start timestamptz not null,
  headcount int,
  body text not null,
  sent_at timestamptz
);

-- Search -----------------------------------------------------------------

-- Venues near a point, big enough, ranked free-first then by distance.
-- seen_capacity = largest turnout of a past event there; clash = an event already listed there that London day.
create or replace function search_venues(
  lat double precision,
  lng double precision,
  radius_m int default 2000,
  min_capacity int default 0,
  at timestamptz default null,
  max_results int default 5
)
returns table (
  id uuid, name text, address text, kind venue_kind, terms venue_terms, terms_note text,
  capacity int, seen_capacity int, distance_m double precision,
  hosted_count int, past_hosts text[], clash text, callable boolean, verified boolean
)
language sql stable as $$
  with p as (select st_setsrid(st_makepoint(lng, lat), 4326)::geography as g),
  hist as (
    select e.venue_id,
           max(e.guest_count) as seen_capacity,
           count(*) filter (where e.starts_at < now()) as hosted_count,
           (array_agg(distinct c.name) filter (where c.name is not null))[1:5] as past_hosts
    from events e left join communities c on c.id = e.community_id
    where e.venue_id is not null
    group by e.venue_id
  )
  select v.id, v.name, v.address, v.kind, v.terms, v.terms_note,
         v.capacity, h.seen_capacity::int, st_distance(v.location, p.g),
         coalesce(h.hosted_count, 0)::int, coalesce(h.past_hosts, '{}'),
         (select e.title from events e
           where at is not null and e.venue_id = v.id
             and (e.starts_at at time zone 'Europe/London')::date = (at at time zone 'Europe/London')::date
           limit 1),
         v.callable, v.verified
  from venues v
  cross join p
  left join hist h on h.venue_id = v.id
  where st_dwithin(v.location, p.g, radius_m)
    and greatest(coalesce(v.capacity, 0), coalesce(h.seen_capacity, 0)) >= min_capacity
    and (select count(*) from flags f where f.venue_id = v.id) < 2
  order by (v.terms = 'free') desc nulls last, v.verified desc, st_distance(v.location, p.g)
  limit max_results;
$$;

-- Row-level security -----------------------------------------------------

alter table organisers enable row level security;
alter table vouches enable row level security;
alter table venues enable row level security;
alter table venue_contacts enable row level security;
alter table flags enable row level security;
alter table communities enable row level security;
alter table events enable row level security;
alter table calls enable row level security;
alter table requests enable row level security;

-- Public read on the open data only. No policy = no access for anon/authenticated.
create policy "public read venues" on venues for select using (true);
create policy "public read communities" on communities for select using (true);
create policy "public read events" on events for select using (true);
