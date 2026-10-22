import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeed, venueId } from "../scripts/seed";
import type { RankedEvent, SeedVenue } from "../lib/sources/types";

const venue = (over: Partial<SeedVenue> = {}): SeedVenue => ({
  name: "Tessl", address: "210 Pentonville Rd, London N1 9JY", area: "King's Cross", lat: 51.5309, lng: -0.1186,
  googlePlaceId: null, kindGuess: "company_office", maxAttendeesSeen: 50,
  hosts: [{ community: "Elastic London", eventTitle: "Agents talk", eventUrl: "https://meetup.com/e/1", eventDate: "2026-09-10", attendees: 50, source: "meetup" }],
  ...over
});

const event = (over: Partial<RankedEvent> = {}): RankedEvent => ({
  source: "luma", externalId: "evt-1", title: "Talk", url: "https://lu.ma/x", startsAt: "2026-10-29T18:30:00Z", endsAt: null,
  venueName: "Tessl", address: "210 Pentonville Rd, London N1 9JY", lat: 51.5309, lng: -0.1186,
  community: "Elastic London", attendees: 40, isFree: true, tags: [], score: 3, reasons: ["talk"], ...over
});

test("venue ids are deterministic and prefer the Google place id", () => {
  const a = venueId({ googlePlaceId: null, name: "Tessl", lat: 51.5309, lng: -0.1186 });
  assert.equal(a, venueId({ googlePlaceId: null, name: "TESSL", lat: 51.53091, lng: -0.11861 }));
  assert.notEqual(venueId({ googlePlaceId: "P1", name: "Tessl", lat: 51.5309, lng: -0.1186 }), a);
});

test("buildSeed maps venues and hosts, and links events to the nearby venue", () => {
  const rows = buildSeed([venue()], [event({ lat: 51.5312, lng: -0.1187 })]);
  assert.equal(rows.venues.length, 1);
  assert.equal(rows.venues[0]!.location, "SRID=4326;POINT(-0.1186 51.5309)");
  assert.equal(rows.hosts.length, 1);
  assert.equal(rows.hosts[0]!.venue_id, rows.venues[0]!.id);
  assert.equal(rows.events[0]!.venue_id, rows.venues[0]!.id);
});

test("an upcoming event at an unseen place creates a venue; junk places don't", () => {
  const rows = buildSeed([venue()], [
    event({ externalId: "evt-2", venueName: "Granola", address: "1 Example St, London EC2A 4HT", lat: 51.523, lng: -0.08 }),
    event({ externalId: "evt-3", venueName: "London", address: "London, UK", lat: 51.507, lng: -0.127 }),
    event({ externalId: "evt-4", venueName: null, lat: null, lng: null })
  ]);
  assert.deepEqual(rows.venues.map((v) => v.name), ["Tessl", "Granola"]);
  assert.equal(rows.events[0]!.venue_id, rows.venues[1]!.id);
  assert.equal(rows.events[1]!.venue_id, null);
  assert.equal(rows.events[2]!.location, null);
});

test("rows in a batch share the same keys (PostgREST bulk insert needs that)", () => {
  const rows = buildSeed([venue(), venue({ name: "Other", lat: 51.5, lng: -0.1, googlePlaceId: "P9", hosts: [] })], [event(), event({ externalId: "e2", venueName: null, lat: null, lng: null })]);
  for (const table of [rows.venues, rows.events]) {
    const keys = JSON.stringify(Object.keys(table[0]!).sort());
    for (const r of table) assert.equal(JSON.stringify(Object.keys(r).sort()), keys);
  }
});
