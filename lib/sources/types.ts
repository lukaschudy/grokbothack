// Shared types and helpers for the event/venue source fetchers.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type Source = "luma" | "meetup" | "devpost" | "builderbase";

export type SourceEvent = {
  source: Source;
  externalId: string;
  title: string;
  url: string;
  startsAt: string; // ISO UTC
  endsAt: string | null;
  venueName: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  community: string | null;
  attendees: number | null;
  isFree: boolean | null;
  tags: string[];
};

export type RankedEvent = SourceEvent & { score: number; reasons: string[] };

/** One event that actually happened at a place: the raw material for venues.json. */
export type VenueEvidence = {
  venueName: string;
  address: string | null;
  lat: number;
  lng: number;
  googlePlaceId: string | null;
  community: string;
  eventTitle: string;
  eventUrl: string;
  eventDate: string; // YYYY-MM-DD (Europe/London)
  attendees: number | null;
  source: Source;
};

export type VenueKind = "company_office" | "coworking" | "university" | "community_space" | "bookable" | "pub_or_bar" | "other";

export type SeedVenue = {
  name: string;
  address: string | null;
  area: string | null;
  lat: number;
  lng: number;
  googlePlaceId: string | null;
  kindGuess: VenueKind;
  maxAttendeesSeen: number | null;
  hosts: { community: string; eventTitle: string; eventUrl: string; eventDate: string; attendees: number | null; source: Source }[];
};

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// ---------- HTTP with raw cache + polite per-host spacing ----------

export const RAW_DIR = join(process.cwd(), "data", "raw");
const lastCall = new Map<string, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type FetchOpts = { cacheKey: string; maxAgeMs?: number; init?: RequestInit; minGapMs?: number; timeoutMs?: number };

/** GET (or POST) text, cached under data/raw/<cacheKey>. Spaces calls to one host by minGapMs. */
export async function cachedText(url: string, o: FetchOpts): Promise<string> {
  const file = join(RAW_DIR, o.cacheKey.replace(/[^\w.\-/]/g, "_"));
  const maxAge = o.maxAgeMs ?? 12 * 3600_000;
  try {
    if (Date.now() - (await stat(file)).mtimeMs < maxAge) return await readFile(file, "utf8");
  } catch {}
  const host = new URL(url).host;
  const wait = (lastCall.get(host) ?? 0) + (o.minGapMs ?? 2000) - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall.set(host, Date.now());
  const res = await fetch(url, {
    ...o.init,
    headers: { "user-agent": BROWSER_UA, accept: "*/*", ...(o.init?.headers ?? {}) },
    signal: AbortSignal.timeout(o.timeoutMs ?? 20_000)
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const body = await res.text();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body);
  return body;
}

export async function cachedJson<T = any>(url: string, o: FetchOpts): Promise<T> {
  return JSON.parse(await cachedText(url, o)) as T;
}

// ---------- Geo ----------

/** Greater London bounding box. Use this, never the city name ("London, Ontario"). */
export function isInLondon(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return lat != null && lng != null && lat > 51.28 && lat < 51.7 && lng > -0.52 && lng < 0.34;
}

export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371e3, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const POSTCODE_RE = /\b([A-Z]{1,2}[0-9][A-Z0-9]?)\s*([0-9][A-Z]{2})\b/i;

/** Full UK postcode in a string, normalised to "EC2A 4HT", or null. */
export function extractPostcode(s: string | null | undefined): string | null {
  const m = s?.match(POSTCODE_RE);
  return m ? `${m[1]!.toUpperCase()} ${m[2]!.toUpperCase()}` : null;
}

/** Bulk geocode UK postcodes via postcodes.io (free, keyless, 100 per call). */
export async function geocodePostcodes(postcodes: string[]): Promise<Map<string, { lat: number; lng: number }>> {
  const out = new Map<string, { lat: number; lng: number }>();
  const uniq = [...new Set(postcodes)].sort();
  for (let i = 0; i < uniq.length; i += 100) {
    const batch = uniq.slice(i, i + 100);
    const json = await cachedJson<{ result: { query: string; result: { latitude: number; longitude: number } | null }[] }>(
      "https://api.postcodes.io/postcodes",
      {
        cacheKey: `postcodes/${hash(batch.join("|"))}.json`,
        maxAgeMs: 30 * 86400_000,
        minGapMs: 500,
        init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ postcodes: batch }) }
      }
    );
    for (const r of json.result) if (r.result) out.set(r.query, { lat: r.result.latitude, lng: r.result.longitude });
  }
  return out;
}

export function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

// Neighbourhood centroids, used to label a venue's area.
export const AREAS: [string, number, number][] = [
  ["Shoreditch", 51.5262, -0.0794], ["Old Street", 51.5257, -0.0875], ["Hoxton", 51.5317, -0.0817],
  ["Clerkenwell", 51.5235, -0.1055], ["Farringdon", 51.5203, -0.1053], ["King's Cross", 51.5308, -0.1238],
  ["Euston", 51.5282, -0.1337], ["Bloomsbury", 51.5219, -0.1270], ["Fitzrovia", 51.5194, -0.1384],
  ["Marylebone", 51.5203, -0.1540], ["Soho", 51.5136, -0.1340], ["Covent Garden", 51.5117, -0.1240],
  ["Holborn", 51.5174, -0.1200], ["Strand", 51.5105, -0.1180], ["Mayfair", 51.5100, -0.1470],
  ["Westminster", 51.4995, -0.1300], ["Victoria", 51.4965, -0.1440], ["St James's", 51.5060, -0.1370],
  ["City of London", 51.5145, -0.0925], ["St Paul's", 51.5138, -0.0984], ["Liverpool Street", 51.5178, -0.0817],
  ["Aldgate", 51.5142, -0.0755], ["Whitechapel", 51.5195, -0.0610], ["Spitalfields", 51.5196, -0.0750],
  ["Bank", 51.5133, -0.0890], ["Moorgate", 51.5186, -0.0886], ["Barbican", 51.5204, -0.0979],
  ["London Bridge", 51.5050, -0.0865], ["Borough", 51.5011, -0.0943], ["Southwark", 51.5039, -0.1050],
  ["Waterloo", 51.5031, -0.1132], ["South Bank", 51.5065, -0.1160], ["Bermondsey", 51.4980, -0.0710],
  ["Elephant & Castle", 51.4943, -0.1003], ["Vauxhall", 51.4861, -0.1253], ["Battersea", 51.4790, -0.1450],
  ["Canary Wharf", 51.5054, -0.0235], ["Stratford", 51.5416, -0.0033], ["Hackney Wick", 51.5435, -0.0250],
  ["Hackney", 51.5450, -0.0553], ["Dalston", 51.5465, -0.0750], ["Bethnal Green", 51.5270, -0.0550],
  ["Islington", 51.5362, -0.1033], ["Angel", 51.5322, -0.1058], ["Camden", 51.5390, -0.1426],
  ["Paddington", 51.5154, -0.1755], ["Notting Hill", 51.5090, -0.1960], ["Kensington", 51.5000, -0.1920],
  ["South Kensington", 51.4941, -0.1738], ["Chelsea", 51.4875, -0.1687], ["Hammersmith", 51.4927, -0.2240],
  ["White City", 51.5120, -0.2240], ["Brixton", 51.4613, -0.1156], ["Greenwich", 51.4826, -0.0077],
  ["Mile End", 51.5249, -0.0332], ["Kentish Town", 51.5503, -0.1403], ["Peckham", 51.4740, -0.0690]
];

/** Nearest named neighbourhood within 1.5 km, else null. */
export function areaFor(lat: number, lng: number): string | null {
  let best: string | null = null, bestD = 1500;
  for (const [name, aLat, aLng] of AREAS) {
    const d = distanceM(lat, lng, aLat, aLng);
    if (d < bestD) [best, bestD] = [name, d];
  }
  return best;
}

/** YYYY-MM-DD of an instant in Europe/London. */
export function londonDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

const TECH_RE =
  /\b(ai|a\.i\.|agents?|agentic|llms?|gpt|genai|gen ai|ml|machine learning|deep learning|data|hack(athon|ers?|s)?|buildathon|build(ers?|ing)?|developers?|devs?|devops|engineer(s|ing)?|code|coding|software|tech|technology|startups?|founders?|product|saas|cloud|security|cyber|pentest|crypto|web3|blockchain|solana|ethereum|fintech|robotics?|python|javascript|typescript|react|rust|golang|open[- ]source|api|vcs?|venture|investors?|innovation|digital|computing|quantum|automation|no-code|ux|design systems?)\b/i;

/** Keyword tech filter (Luma discover returns every category). */
export function isTech(...texts: (string | null | undefined)[]): boolean {
  return TECH_RE.test(texts.filter(Boolean).join(" \n "));
}
