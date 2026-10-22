// Aggregate London events and venues from Luma, Meetup, Devpost and BuilderBase into data/seed.sql.
// Usage: npm run ingest [-- --cached] [-- --apply]
//   --cached  reuse data/raw/ responses instead of refetching
//   --apply   load the result into SUPABASE_DB_URL with psql
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  dedupeVenues, extractPostcode, inLondon, isTech, isUsableVenueName, normName, parseDevpostDates, scoreEvent, toSql,
  type Community, type RawEvent, type RawVenue, type ScoredEvent,
} from './lib.ts';

const RAW = 'data/raw';
const CACHED = process.argv.includes('--cached');
const APPLY = process.argv.includes('--apply');
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const BOT_UA = 'MatesRates/0.1 (+https://github.com/lukaschudy/grokbothack)';
const HORIZON_DAYS = 60;
const DEVPOST_SINCE = 2024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lastCall = new Map<string, number>();

// Polite fetch: per-host minimum gap, raw response cached to data/raw/<name> (null = don't cache).
async function fetchText(url: string, name: string | null, opts: { gapMs: number; ua?: string; init?: RequestInit }): Promise<string> {
  const file = name && `${RAW}/${name}`;
  if (file && CACHED && existsSync(file)) return readFile(file, 'utf8');
  const host = new URL(url).host;
  const wait = (lastCall.get(host) ?? 0) + opts.gapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall.set(host, Date.now());
  const res = await fetch(url, { ...opts.init, headers: { 'User-Agent': opts.ua ?? BROWSER_UA, ...opts.init?.headers } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  if (file) await writeFile(file, text);
  return text;
}

// Luma ----------------------------------------------------------------------

interface LumaEntry {
  guest_count?: number;
  hosts?: { name?: string }[];
  ticket_info?: { is_free?: boolean } | null;
  calendar?: { api_id: string; name: string; slug?: string | null; description_short?: string | null; is_personal?: boolean };
  event: {
    api_id: string; name: string; url: string; start_at: string; end_at?: string; location_type: string;
    coordinate?: { latitude: number; longitude: number } | null;
    geo_address_info?: {
      mode?: string; address?: string; full_address?: string; place_id?: string;
      place_coordinate?: { latitude: number; longitude: number };
    } | null;
  };
}

async function fetchLuma(): Promise<RawEvent[]> {
  const out: RawEvent[] = [];
  const horizon = Date.now() + HORIZON_DAYS * 864e5;
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const url = 'https://api.lu.ma/discover/get-paginated-events?discover_place_api_id=discplace-QCcNk3HXowOR97j&pagination_limit=50' +
      (cursor ? `&pagination_cursor=${encodeURIComponent(cursor)}` : '');
    const j = JSON.parse(await fetchText(url, `luma-${page}.json`, { gapMs: 10_000 })) as { entries: LumaEntry[]; has_more: boolean; next_cursor?: string };
    for (const x of j.entries) {
      const e = x.event;
      const cal = x.calendar;
      if (!isTech(e.name, cal?.name, cal?.description_short ?? undefined)) continue;
      const geo = e.geo_address_info;
      const point = geo?.place_coordinate ?? e.coordinate ?? undefined;
      const venue: RawVenue | undefined = geo?.mode === 'shown' && geo.address && point
        ? { name: geo.address, address: geo.full_address, lat: point.latitude, lng: point.longitude, placeId: geo.place_id, postcode: extractPostcode(geo.full_address) }
        : undefined;
      out.push({
        id: `luma:${e.api_id}`, source: 'luma', title: e.name, url: `https://lu.ma/${e.url}`,
        startsAt: e.start_at, endsAt: e.end_at, venue,
        community: cal && !cal.is_personal
          ? { key: `luma:${cal.api_id}`, name: cal.name, lumaCalendarId: cal.api_id, url: cal.slug ? `https://lu.ma/${cal.slug}` : undefined, description: cal.description_short ?? undefined }
          : undefined,
        hostNames: (x.hosts ?? []).map((h) => h.name).filter((n): n is string => !!n),
        online: e.location_type !== 'offline',
        paid: x.ticket_info ? x.ticket_info.is_free === false : undefined,
        guestCount: x.guest_count || undefined, // 0 usually means the guest list is hidden
      });
    }
    const last = j.entries.at(-1)?.event.start_at;
    if (!j.has_more || !j.next_cursor || (last && Date.parse(last) > horizon)) break;
    cursor = j.next_cursor;
  }
  return out;
}

// Meetup --------------------------------------------------------------------

const MEETUP_KEYWORDS = ['tech', 'ai', 'hackathon', 'startup', 'data', 'python', 'javascript', 'developer', 'product'];

interface MeetupEvent {
  id: string; title: string; eventUrl: string; dateTime: string; eventType: string;
  venue?: { name?: string; address?: string; city?: string; country?: string } | null;
  group?: { __ref: string } | null;
  feeSettings?: unknown;
  rsvps?: { totalCount?: number; edges?: { node: { isHost?: boolean; member?: { __ref: string } } }[] } | null;
}

async function fetchMeetup(): Promise<RawEvent[]> {
  const out = new Map<string, RawEvent>();
  for (const kw of MEETUP_KEYWORDS) {
    const html = await fetchText(
      `https://www.meetup.com/find/?location=gb--17--London&source=EVENTS&keywords=${kw}`,
      `meetup-${kw}.html`,
      { gapMs: 3_000 },
    );
    const m = html.match(/__NEXT_DATA__[^>]*>(.*?)<\/script>/s);
    if (!m) continue;
    const state = JSON.parse(m[1]).props.pageProps.__APOLLO_STATE__ as Record<string, Record<string, unknown>>;
    for (const [key, raw] of Object.entries(state)) {
      if (!key.startsWith('Event:')) continue;
      const e = raw as unknown as MeetupEvent;
      const group = e.group ? (state[e.group.__ref] as { name?: string; urlname?: string } | undefined) : undefined;
      const hosts = (e.rsvps?.edges ?? [])
        .filter((x) => x.node.isHost && x.node.member)
        .map((x) => (state[x.node.member!.__ref] as { name?: string } | undefined)?.name)
        .filter((n): n is string => !!n);
      const v = e.venue;
      out.set(e.id, {
        id: `meetup:${e.id}`, source: 'meetup', title: e.title, url: e.eventUrl,
        startsAt: new Date(e.dateTime).toISOString(),
        venue: v?.name && v.country?.toLowerCase() === 'gb' ? { name: v.name, address: v.address || undefined, postcode: extractPostcode(v.address) } : undefined,
        community: group?.urlname ? { key: `meetup:${group.urlname}`, name: group.name ?? group.urlname, url: `https://www.meetup.com/${group.urlname}/` } : undefined,
        hostNames: hosts,
        online: e.eventType !== 'PHYSICAL',
        paid: e.feeSettings ? true : undefined,
        guestCount: e.rsvps?.totalCount || undefined,
      });
    }
  }
  return [...out.values()];
}

// Devpost -------------------------------------------------------------------

interface DevpostHackathon {
  id: number; title: string; url: string; submission_period_dates: string;
  displayed_location?: { icon?: string; location?: string };
  registrations_count?: number; organization_name?: string | null;
}

function devpostEvent(h: DevpostHackathon): RawEvent | undefined {
  const loc = h.displayed_location?.location?.trim() ?? '';
  if (/canada|ontario/i.test(loc)) return undefined;
  const dates = parseDevpostDates(h.submission_period_dates);
  if (!dates) return undefined;
  const online = h.displayed_location?.icon === 'globe' || /^online$/i.test(loc);
  // 'Cloudflare, London' → 'Cloudflare'. Bare 'London' stays unusable and gets dropped later.
  const name = loc.replace(/,?\s*london(,\s*(uk|united kingdom))?$/i, '').trim() || loc;
  return {
    id: `devpost:${h.id}`, source: 'devpost', title: h.title, url: h.url, startsAt: dates.start, endsAt: dates.end,
    venue: !online && isUsableVenueName(name) ? { name } : undefined,
    community: h.organization_name ? { key: `devpost:${normName(h.organization_name)}`, name: h.organization_name } : undefined,
    hostNames: [], online, guestCount: h.registrations_count || undefined, kindHint: 'hackathon',
  };
}

async function fetchDevpost(): Promise<RawEvent[]> {
  const out: RawEvent[] = [];
  const base = 'https://devpost.com/api/hackathons?search=london';
  const upcoming = JSON.parse(await fetchText(`${base}&status[]=upcoming&status[]=open`, 'devpost-upcoming.json', { gapMs: 2_000 })) as { hackathons: DevpostHackathon[] };
  for (const h of upcoming.hackathons) { const e = devpostEvent(h); if (e) out.push(e); }
  for (let page = 1; page <= 30; page++) {
    const j = JSON.parse(await fetchText(`${base}&status[]=ended&page=${page}`, `devpost-ended-${page}.json`, { gapMs: 2_000 })) as { hackathons: DevpostHackathon[] };
    if (!j.hackathons.length) break;
    for (const h of j.hackathons) {
      const e = devpostEvent(h);
      if (e && new Date(e.startsAt).getUTCFullYear() >= DEVPOST_SINCE) out.push(e);
    }
  }
  return out;
}

// BuilderBase -----------------------------------------------------------------

interface BuilderBaseEvent {
  id: string; name: string; slug?: string | null; start_at: string; end_at?: string; format?: string; event_type?: string;
  external_url?: string | null; participant_count?: number | null;
  location?: { lat?: number; lng?: number; country?: string } | null; organization?: { name?: string } | null;
}

async function fetchBuilderBase(): Promise<RawEvent[]> {
  const j = JSON.parse(await fetchText('https://edge.builderbase.com/super-events/public/discovery?status=active&limit=100', 'builderbase.json', { gapMs: 2_000 })) as { data: { events: BuilderBaseEvent[] } };
  return j.data.events
    .filter((e) => e.location?.country === 'GB' && inLondon(e.location.lat, e.location.lng))
    .map((e): RawEvent => ({
      id: `builderbase:${e.id}`, source: 'builderbase', title: e.name, url: e.external_url ?? undefined,
      startsAt: e.start_at, endsAt: e.end_at,
      community: e.organization?.name ? { key: `builderbase:${normName(e.organization.name)}`, name: e.organization.name } : undefined,
      hostNames: [], online: e.format === 'online', guestCount: e.participant_count || undefined,
      kindHint: e.event_type === 'hackathon' ? 'hackathon' : undefined,
    }));
}

// Geocoding -------------------------------------------------------------------

async function geocode(events: RawEvent[]): Promise<void> {
  const cacheFile = `${RAW}/geocode.json`;
  const cache: Record<string, [number, number] | null> = existsSync(cacheFile) ? JSON.parse(await readFile(cacheFile, 'utf8')) : {};
  const todo = events.map((e) => e.venue).filter((v): v is RawVenue => !!v && v.lat === undefined);

  // 1. Postcodes, in bulk.
  const postcodes = [...new Set(todo.map((v) => v.postcode).filter((p): p is string => !!p && !(`pc:${p}` in cache)))];
  for (let i = 0; i < postcodes.length; i += 100) {
    const res = await fetch('https://api.postcodes.io/postcodes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postcodes: postcodes.slice(i, i + 100) }),
    });
    const j = (await res.json()) as { result: { query: string; result: { latitude: number; longitude: number } | null }[] };
    for (const r of j.result) cache[`pc:${r.query}`] = r.result ? [r.result.latitude, r.result.longitude] : null;
  }

  // 2. Everything else via Nominatim, 1 request per second, bounded to London.
  for (const v of todo) {
    const pc = v.postcode ? cache[`pc:${v.postcode}`] : undefined;
    if (pc) { [v.lat, v.lng] = pc; continue; }
    const q = v.address ? `${v.address}, London` : `${v.name}, London`;
    if (!(`q:${q}` in cache)) {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=gb&viewbox=-0.52,51.70,0.34,51.28&bounded=1&q=${encodeURIComponent(q)}`;
      const hits = JSON.parse(await fetchText(url, null, { gapMs: 1_100, ua: BOT_UA })) as { lat: string; lon: string }[];
      cache[`q:${q}`] = hits[0] ? [Number(hits[0].lat), Number(hits[0].lon)] : null;
    }
    const hit = cache[`q:${q}`];
    if (hit) [v.lat, v.lng] = hit;
  }
  await writeFile(cacheFile, JSON.stringify(cache, null, 1));
}

// Main ------------------------------------------------------------------------

async function main(): Promise<void> {
  await mkdir(RAW, { recursive: true });
  const bySource = await Promise.all([fetchLuma(), fetchMeetup(), fetchDevpost(), fetchBuilderBase()]);
  const [luma, meetup, devpost, builderbase] = bySource;
  console.log(`fetched: luma ${luma.length} (tech), meetup ${meetup.length}, devpost ${devpost.length}, builderbase ${builderbase.length}`);

  const all = bySource.flat().filter((e) => !e.online);
  await geocode(all);
  // Keep in-person London events. Events without a usable venue stay if the source is London-specific.
  const london = all.filter((e) => (e.venue?.lat !== undefined ? inLondon(e.venue.lat, e.venue.lng) : e.source !== 'meetup'));

  const { venues, venueOf } = dedupeVenues(london);
  const perCommunity = new Map<string, number>();
  for (const e of london) if (e.community) perCommunity.set(e.community.key, (perCommunity.get(e.community.key) ?? 0) + 1);
  const scored: ScoredEvent[] = london.map((e) => ({
    ...e, venueId: venueOf.get(e.id), ...scoreEvent(e, e.community ? perCommunity.get(e.community.key) ?? 0 : 0),
  }));
  const communities = [...new Map(london.filter((e) => e.community).map((e) => [e.community!.key, e.community!] as [string, Community])).values()];

  await writeFile('data/seed.sql', toSql(communities, venues, scored));
  const kinds = Object.entries(Object.groupBy(venues, (v) => v.kind)).map(([k, v]) => `${k} ${v?.length}`).join(', ');
  console.log(`london in-person events: ${london.length}, venues: ${venues.length} (${kinds}), communities: ${communities.length}`);
  console.log('top upcoming:');
  for (const e of scored.filter((e) => Date.parse(e.startsAt) > Date.now()).sort((a, b) => b.score - a.score).slice(0, 10)) {
    console.log(`  ${e.score.toFixed(2)}  ${e.startsAt.slice(0, 10)}  ${e.title.slice(0, 60)}  [${e.reasons.join(' · ')}]`);
  }

  if (APPLY) {
    const db = process.env.SUPABASE_DB_URL;
    if (!db) throw new Error('SUPABASE_DB_URL not set');
    execFileSync('psql', [db, '-v', 'ON_ERROR_STOP=1', '-q', '-f', 'data/seed.sql'], { stdio: 'inherit' });
    console.log('applied data/seed.sql');
  }
}

await main();
