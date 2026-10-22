// Load data/seed/*.json straight into a Postgres (DATABASE_URL) with the same rows as scripts/seed.ts.
// For running without Supabase REST access, e.g. a local fallback database.
//   DATABASE_URL=postgres://... npx tsx scripts/seed-local.ts
// Re-runnable: same conflict rules as the REST loader (venues/hosts kept, events refreshed).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { sql } from "../lib/db";
import type { RankedEvent, SeedVenue } from "../lib/sources/types";
import { buildSeed } from "./seed";

const seedVenues = JSON.parse(await readFile("data/seed/venues.json", "utf8")) as SeedVenue[];
const events = existsSync("data/seed/events.json") ? (JSON.parse(await readFile("data/seed/events.json", "utf8")) as RankedEvent[]) : [];
const rows = buildSeed(seedVenues, events);

await sql.begin(async (tx) => {
  for (let i = 0; i < rows.venues.length; i += 500)
    await tx`insert into venues ${tx(rows.venues.slice(i, i + 500) as never)} on conflict (id) do nothing`;
  for (let i = 0; i < rows.hosts.length; i += 500)
    await tx`insert into venue_hosts ${tx(rows.hosts.slice(i, i + 500) as never)} on conflict (venue_id, event_url) do nothing`;
  for (let i = 0; i < rows.events.length; i += 500)
    await tx`insert into events ${tx(rows.events.slice(i, i + 500) as never)}
             on conflict (source, external_id) do update set
               title = excluded.title, url = excluded.url, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
               venue_name = excluded.venue_name, address = excluded.address, location = excluded.location,
               community = excluded.community, attendees = excluded.attendees, is_free = excluded.is_free,
               tags = excluded.tags, venue_id = excluded.venue_id, score = excluded.score, reasons = excluded.reasons`;
});
console.log({ venues: rows.venues.length, hosts: rows.hosts.length, events: rows.events.length });
await sql.end();
