// Load data/seed/venues.json + data/seed/events.json into Supabase over the REST API.
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the sb_secret_ key; it bypasses RLS).
//   npm run db:seed            (run scripts/fetch-sources.ts first)
//   npm run db:seed -- --dry   (print counts, write nothing)
// Re-runnable: venue ids are deterministic. Existing venues and hosts are never overwritten,
// so organiser edits survive; events are refreshed (score, reasons, attendees).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { areaFor, distanceM, extractPostcode, type RankedEvent, type SeedVenue } from "../lib/sources/types";
import { guessKind } from "./fetch-sources";

type Row = Record<string, unknown>;

/** Deterministic uuid, so re-seeding upserts the same venue rows. */
export function uuidFrom(key: string): string {
  const h = createHash("md5").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const point = (lat: number, lng: number) => `SRID=4326;POINT(${lng} ${lat})`;
const GENERIC = /^(london|london,? uk|tba|tbc|tbd|online|secret location|to be announced)$/i;

export function venueId(v: { googlePlaceId: string | null; name: string; lat: number; lng: number }): string {
  return uuidFrom(v.googlePlaceId ? `place:${v.googlePlaceId}` : `venue:${compact(v.name)}|${v.lat.toFixed(4)},${v.lng.toFixed(4)}`);
}

type Placed = { id: string; name: string; lat: number; lng: number };

/** Nearest seeded venue within 60 m, or same name within 300 m. */
function matchVenue(venues: Placed[], name: string, lat: number, lng: number): Placed | undefined {
  let best: Placed | undefined, bestD = Infinity;
  for (const v of venues) {
    const d = distanceM(v.lat, v.lng, lat, lng);
    if ((d <= 60 || (d <= 300 && compact(v.name) === compact(name))) && d < bestD) [best, bestD] = [v, d];
  }
  return best;
}

/**
 * Turn the seed files into table rows. Venues come from past-event evidence (venues.json);
 * an upcoming event at a place we haven't seen yet also creates a venue (it is about to host).
 */
export function buildSeed(seedVenues: SeedVenue[], events: RankedEvent[]) {
  const venues: Row[] = [];
  const hosts: Row[] = [];
  const placed: Placed[] = [];

  const addVenue = (v: { name: string; address: string | null; area: string | null; lat: number; lng: number; googlePlaceId: string | null; kind: string }) => {
    const id = venueId(v);
    if (placed.some((p) => p.id === id)) return id;
    placed.push({ id, name: v.name, lat: v.lat, lng: v.lng });
    venues.push({
      id, name: v.name.slice(0, 120), address: v.address, area: v.area, location: point(v.lat, v.lng),
      kind: v.kind, google_place_id: v.googlePlaceId
    });
    return id;
  };

  for (const v of seedVenues) {
    const id = addVenue({ ...v, kind: v.kindGuess });
    for (const h of v.hosts) {
      if (!h.community) continue;
      hosts.push({
        venue_id: id, community: h.community, event_title: h.eventTitle, event_url: h.eventUrl,
        event_date: h.eventDate, attendees: h.attendees, source: h.source
      });
    }
  }

  const eventRows: Row[] = events.map((e) => {
    let venue_id: string | null = null;
    if (e.lat != null && e.lng != null && e.venueName) {
      venue_id = matchVenue(placed, e.venueName, e.lat, e.lng)?.id ?? null;
      const usable = e.venueName.trim().length >= 2 && !GENERIC.test(e.venueName.trim()) && !!extractPostcode(e.address ?? e.venueName);
      if (!venue_id && usable) {
        venue_id = addVenue({
          name: e.venueName.trim(), address: e.address, area: areaFor(e.lat, e.lng), lat: e.lat, lng: e.lng,
          googlePlaceId: null, kind: guessKind(e.venueName, e.address)
        });
      }
    }
    return {
      source: e.source, external_id: e.externalId, title: e.title, url: e.url, starts_at: e.startsAt, ends_at: e.endsAt,
      venue_name: e.venueName, address: e.address, location: e.lat != null && e.lng != null ? point(e.lat, e.lng) : null,
      community: e.community, attendees: e.attendees, is_free: e.isFree, tags: e.tags, venue_id,
      score: e.score, reasons: e.reasons
    };
  });

  return { venues, hosts, events: eventRows };
}

async function upsert(table: string, rows: Row[], onConflict: string, resolution: "ignore" | "merge") {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  for (let i = 0; i < rows.length; i += 500) {
    const res = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: "POST",
      headers: {
        apikey: key, "content-type": "application/json",
        prefer: `resolution=${resolution}-duplicates,return=minimal`
      },
      body: JSON.stringify(rows.slice(i, i + 500))
    });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  }
  console.log(`${table}: ${rows.length} rows`);
}

async function main() {
  const seedVenues = JSON.parse(await readFile("data/seed/venues.json", "utf8")) as SeedVenue[];
  const events = existsSync("data/seed/events.json") ? (JSON.parse(await readFile("data/seed/events.json", "utf8")) as RankedEvent[]) : [];
  const rows = buildSeed(seedVenues, events);
  if (process.argv.includes("--dry")) {
    console.log({ venues: rows.venues.length, hosts: rows.hosts.length, events: rows.events.length, linked: rows.events.filter((e) => e.venue_id).length });
    return;
  }
  await upsert("venues", rows.venues, "id", "ignore");
  await upsert("venue_hosts", rows.hosts, "venue_id,event_url", "ignore");
  await upsert("events", rows.events, "source,external_id", "merge");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
