// Load evidence-seeded venues and ranked events (data/seed/*.json) into the DB.
// Idempotent: matches venues by Google place ID, else by name within 100 m.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "../lib/db";
import type { RankedEvent, SeedVenue } from "../lib/sources/types";

const dir = path.join(import.meta.dirname, "..", "data", "seed");
const venues = JSON.parse(await readFile(path.join(dir, "venues.json"), "utf8")) as SeedVenue[];
const events = JSON.parse(await readFile(path.join(dir, "events.json"), "utf8")) as RankedEvent[];

let created = 0;
let hosts = 0;
for (const v of venues) {
  const sources = [...new Set(v.hosts.map((h) => h.source))].join("+") || "evidence";
  const capacity = v.maxAttendeesSeen && v.maxAttendeesSeen >= 15 ? v.maxAttendeesSeen : null;
  const venueId = await sql.begin(async (tx) => {
    await tx`select set_config('roomline.source', ${sources}, true)`;
    const point = tx`st_setsrid(st_makepoint(${v.lng}, ${v.lat}), 4326)::geography`;
    const [existing] = v.googlePlaceId
      ? await tx<{ id: string }[]>`select id from venues where google_place_id = ${v.googlePlaceId}`
      : await tx<{ id: string }[]>`select id from venues where lower(name) = lower(${v.name}) and st_dwithin(location, ${point}, 100)`;
    if (existing) return existing.id;
    created++;
    const [row] = await tx<{ id: string }[]>`
      insert into venues (name, address, area, location, kind, capacity, google_place_id, created_by)
      values (${v.name}, ${v.address}, ${v.area}, ${point}, ${v.kindGuess}, ${capacity}, ${v.googlePlaceId}, null)
      returning id`;
    return row!.id;
  });
  for (const h of v.hosts) {
    const r = await sql`
      insert into venue_hosts (venue_id, community, event_title, event_url, event_date, attendees, source)
      values (${venueId}, ${h.community}, ${h.eventTitle}, ${h.eventUrl}, ${h.eventDate}, ${h.attendees}, ${h.source})
      on conflict (venue_id, event_url) do nothing`;
    hosts += r.count;
  }
}

for (const e of events) {
  const point = e.lat != null && e.lng != null ? sql`st_setsrid(st_makepoint(${e.lng}, ${e.lat}), 4326)::geography` : sql`null`;
  await sql`
    insert into events (source, external_id, title, url, starts_at, ends_at, venue_name, address, location, community, attendees, is_free, tags, score, reasons, updated_at)
    values (${e.source}, ${e.externalId}, ${e.title}, ${e.url}, ${e.startsAt}, ${e.endsAt}, ${e.venueName}, ${e.address}, ${point},
            ${e.community}, ${e.attendees}, ${e.isFree}, ${e.tags}, ${e.score}, ${e.reasons}, now())
    on conflict (source, external_id) do update set
      title = excluded.title, url = excluded.url, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
      venue_name = excluded.venue_name, address = excluded.address, location = excluded.location, community = excluded.community,
      attendees = excluded.attendees, is_free = excluded.is_free, tags = excluded.tags, score = excluded.score,
      reasons = excluded.reasons, updated_at = now()`;
}
await sql`update events e set venue_id = v.id from venues v
          where e.venue_id is null and e.location is not null and st_dwithin(e.location, v.location, 60)`;
console.log(`venues: ${created} new of ${venues.length}; hosts: ${hosts} new; events: ${events.length} upserted`);
await sql.end();
