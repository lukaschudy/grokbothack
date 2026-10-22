import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { builderBaseToSourceEvent } from "../lib/sources/builderbase";
import { devpostToEvidence, devpostToSourceEvent, parseDevpostList, parseDevpostPage } from "../lib/sources/devpost";
import {
  icsToEvidence, lumaEntryToEvidence, lumaEntryToSourceEvent, lumaPayloadToResolved, LumaVenueHiddenError, parseIcs, parseLumaLink
} from "../lib/sources/luma";
import { meetupToEvidence, meetupToSourceEvent, parseMeetupHtml } from "../lib/sources/meetup";
import { areaFor, extractPostcode, isInLondon, isTech, londonDate } from "../lib/sources/types";
import { aggregateVenues, dedupeEvents, guessKind } from "../scripts/fetch-sources";
import type { VenueEvidence } from "../lib/sources/types";

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const json = (name: string) => JSON.parse(fx(name));
const NOW = new Date("2026-10-22T12:00:00Z");

describe("helpers", () => {
  test("London is a box, not a name", () => {
    assert.equal(isInLondon(51.5257, -0.0875), true);
    assert.equal(isInLondon(42.9849, -81.2453), false); // London, Ontario
    assert.equal(isInLondon(51.75, -0.34), false); // St Albans
    assert.equal(isInLondon(null, null), false);
  });
  test("postcodes", () => {
    assert.equal(extractPostcode("The Loading Bay, Clifton St, London EC2A 4HT, UK"), "EC2A 4HT");
    assert.equal(extractPostcode("210 Pentonville Rd, London n19jy"), "N1 9JY");
    assert.equal(extractPostcode("Mortimer Street, London, W1T"), null);
  });
  test("area and London dates", () => {
    assert.equal(areaFor(51.5236, -0.0824), "Shoreditch");
    assert.equal(areaFor(51.4, 0.3), null);
    assert.equal(londonDate("2026-10-24T23:30:00Z"), "2026-10-25"); // BST
    assert.equal(londonDate("2026-10-25T23:30:00Z"), "2026-10-25"); // GMT after clocks go back
  });
  test("tech filter", () => {
    assert.equal(isTech("HACKATHON - Agent Eval Harness"), true);
    assert.equal(isTech("Chet Rock Jeans Collection Launch"), false);
    assert.equal(isTech("Chess night", "Startup Community London"), true);
  });
});

describe("luma", () => {
  test("parses every kind of link", () => {
    assert.deepEqual(parseLumaLink("https://lu.ma/gkmdzbk9"), { slug: "gkmdzbk9" });
    assert.deepEqual(parseLumaLink("https://luma.com/gkmdzbk9?tk=abc&utm_source=x"), { slug: "gkmdzbk9" });
    assert.deepEqual(parseLumaLink("lu.ma/gkmdzbk9"), { slug: "gkmdzbk9" });
    assert.deepEqual(parseLumaLink("https://lu.ma/event/evt-Yz7RR89Zlv56tya"), { eventId: "evt-Yz7RR89Zlv56tya" });
    assert.deepEqual(parseLumaLink("https://luma.com/event/manage/evt-Yz7RR89Zlv56tya?x=1#y"), { eventId: "evt-Yz7RR89Zlv56tya" });
    assert.throws(() => parseLumaLink("https://meetup.com/foo"), /Not a Luma link/);
  });

  test("resolves an event payload to venue + hosts", () => {
    const r = lumaPayloadToResolved(json("luma-event-get.json"));
    assert.equal(r.title, "Agentic AI in Financial Services and Insurance: Pilot to Production");
    assert.equal(r.url, "https://luma.com/gkmdzbk9");
    assert.equal(r.startsAt, "2026-10-22T16:00:00.000Z");
    assert.equal(r.venueName, "IFX Payments");
    assert.match(r.address!, /EC4V 6RN/);
    assert.equal(r.googlePlaceId, "ChIJibd0As0adkgRBnIVONIhlTU");
    assert.equal(r.community, "Future Forward");
    assert.equal(r.guestCount, 139);
    assert.equal(r.isFree, true);
    assert.deepEqual(r.hosts[1], { name: "Blott Labs", linkedin: "https://www.linkedin.com/in/blott-io", x: "https://x.com/BlottStudio", website: "https://www.blott.com/" });
  });

  test("hidden venue throws a clear error", () => {
    const d = json("luma-event-get.json");
    d.event.geo_address_info = { mode: "obfuscated", city: "London", country_code: "GB" };
    assert.throws(() => lumaPayloadToResolved(d, "https://lu.ma/x"), (e: Error) => e instanceof LumaVenueHiddenError && /until you register/.test(e.message));
  });

  test("discover: tech filter, hidden venues drop coordinates", () => {
    const entries = json("luma-discover.json").entries;
    const [shown, hidden, jeans] = entries.map(lumaEntryToSourceEvent);
    assert.equal(shown?.venueName, "IFX Payments");
    assert.equal(shown?.attendees, 139);
    assert.equal(hidden?.venueName, null);
    assert.equal(hidden?.lat, null);
    assert.equal(jeans, null);
    assert.equal(lumaEntryToEvidence(entries[1]), null);
    assert.equal(lumaEntryToEvidence(entries[0])?.googlePlaceId, "ChIJibd0As0adkgRBnIVONIhlTU");
  });

  test("calendar .ics → past London evidence only", () => {
    const ics = parseIcs(fx("luma-calendar.ics"));
    assert.equal(ics.length, 4);
    assert.equal(ics[0]!.location, "Digital Catapult, 101 Euston Rd., London NW1 2RA, UK");
    assert.equal(ics[0]!.url, "https://luma.com/1jmjzo29");
    assert.equal(ics[0]!.start, "2024-12-05T15:30:00.000Z");
    const ev = icsToEvidence(ics, "Future Forward", NOW);
    // Colchester is outside London; the 22 Oct event is still in the future at NOW.
    assert.deepEqual(ev.map((e) => e.venueName), ["Digital Catapult", "Dawn Capital"]);
    assert.equal(ev[1]!.address, "Dawn Capital, Level 7, Ilona Rose House, Manette St, London W1D 4AL, UK");
  });

  test("ics: hidden venue LOCATION is a URL and is skipped", () => {
    const text = "BEGIN:VEVENT\r\nUID:evt-1@events.lu.ma\r\nDTSTART:20260211T170000Z\r\nSUMMARY:x\r\nLOCATION:https://luma.com/event/evt-1\r\nGEO:51.51;-0.10\r\nEND:VEVENT\r\n";
    assert.equal(icsToEvidence(parseIcs(text), "c", NOW).length, 0);
  });
});

describe("meetup", () => {
  const events = parseMeetupHtml(fx("meetup-find.html"));
  const coords = new Map([["N1 9JY", { lat: 51.5313, lng: -0.1146 }], ["AL1 1RN", { lat: 51.748, lng: -0.338 }]]);

  test("parses Apollo state with venue refs", () => {
    assert.equal(events.length, 4);
    const tessl = events.find((e) => e.id === "101")!;
    assert.equal(tessl.venueName, "Tessl");
    assert.equal(tessl.postcode, "N1 9JY");
    assert.equal(tessl.groupName, "London.js");
    assert.equal(tessl.attendees, 143);
  });

  test("London by geocoded postcode; online and St Albans dropped", () => {
    const out = events.map((e) => meetupToSourceEvent(e, coords)?.externalId ?? null);
    assert.deepEqual(out.sort(), [null, null, "101", "104"].sort());
    assert.equal(events.find((e) => e.id === "104")!.isFree, false);
  });

  test("evidence only for past events", () => {
    const ev = events.map((e) => meetupToEvidence(e, coords, NOW)).filter(Boolean);
    assert.deepEqual(ev.map((e) => e!.eventTitle), ["Past London.js"]);
  });
});

describe("devpost", () => {
  const list = parseDevpostList(json("devpost-list.json"));
  const place = parseDevpostPage(fx("devpost-page.html"))!;

  test("parses list and JSON-LD", () => {
    assert.equal(list[0]!.title, "WORLDS London");
    assert.equal(place.postcode, "WC2N 6RH");
    assert.equal(place.startsAt, "2024-08-15T12:45:00.000Z");
  });

  test("needs a London postcode for coordinates", () => {
    const h = list.find((x) => x.title === "XR Hack - London")!;
    const coords = new Map([["WC2N 6RH", { lat: 51.5075, lng: -0.1229 }]]);
    const e = devpostToSourceEvent(h, place, coords)!;
    assert.equal(e.venueName, "PwC London");
    assert.ok(e.tags.includes("hackathon"));
    assert.equal(devpostToEvidence(h, place, coords, NOW)?.attendees, 164);
    assert.equal(devpostToSourceEvent(h, place, new Map()), null);
  });
});

describe("builderbase", () => {
  test("keeps London (GB + coordinates) only, no fake venue coordinates", () => {
    const out = json("builderbase.json").data.events.map(builderBaseToSourceEvent).filter(Boolean);
    assert.deepEqual(out.map((e: any) => e.title).sort(), ["AgentVerse", "Encode London Hackathon and Conference"]);
    assert.equal(out[0].lat, null);
    assert.equal(out.find((e: any) => e.title.startsWith("Encode")).url, "https://luma.com/encode-london-2026");
  });
});

describe("venues", () => {
  const ev = (o: Partial<VenueEvidence>): VenueEvidence => ({
    venueName: "Techspace", address: "The Loading Bay, Clifton St, London EC2A 4HT, UK", lat: 51.5236, lng: -0.0824,
    googlePlaceId: null, community: "London.js", eventTitle: "t", eventUrl: "u1", eventDate: "2026-01-01", attendees: null, source: "meetup", ...o
  });

  test("merges by place_id and ~50 m, drops evidence without a postcode", () => {
    const venues = aggregateVenues([
      ev({ googlePlaceId: "P1", eventUrl: "a", attendees: 80, source: "luma" }),
      ev({ lat: 51.5238, lng: -0.0826, eventUrl: "b", attendees: 120 }), // ~25 m away
      ev({ eventUrl: "b" }), // duplicate event
      ev({ venueName: "Far", lat: 51.53, lng: -0.1, eventUrl: "c" }),
      ev({ venueName: "No postcode", address: "Mortimer Street", lat: 51.6, lng: -0.2, eventUrl: "d" })
    ]);
    assert.equal(venues.length, 2);
    const t = venues.find((v) => v.name === "Techspace")!;
    assert.equal(t.googlePlaceId, "P1");
    assert.equal(t.hosts.length, 2);
    assert.equal(t.maxAttendeesSeen, 120);
    assert.equal(t.area, "Shoreditch");
    assert.equal(t.kindGuess, "coworking");
  });

  test("same postcode within 300 m merges; real name beats an address-as-name", () => {
    const venues = aggregateVenues([
      ev({ venueName: "210 Pentonville Rd", address: "210 Pentonville Rd, London N1 9JY, UK", lat: 51.5313, lng: -0.1146, eventUrl: "a" }),
      ev({ venueName: "Tessl", address: "210 Pentonville Rd, London N1 9JY", lat: 51.5320, lng: -0.1160, eventUrl: "b" }) // ~120 m
    ]);
    assert.equal(venues.length, 1);
    assert.equal(venues[0]!.name, "Tessl");
  });

  test("kind guesses", () => {
    assert.equal(guessKind("Newspeak House", null), "community_space");
    assert.equal(guessKind("Imperial College London", null), "university");
    assert.equal(guessKind("Craft Beer Co. Covent Garden", null), "pub_or_bar");
    assert.equal(guessKind("Adam Smith Institute", null), "other");
    assert.equal(guessKind("The Bricklayers Arms", "63 Charlotte Road"), "pub_or_bar");
    assert.equal(guessKind("Snyk London (Mainframe Building, Floor 3)", null), "company_office");
    assert.equal(guessKind("Somewhere", "Lincoln's Inn Fields, London WC2A 3PE"), "other");
  });

  test("dedupe keeps the Luma copy of a cross-listed event", () => {
    const base = { title: "OpenUK London Meet-up", startsAt: "2026-10-22T17:00:00.000Z", endsAt: null, venueName: null, address: null, lat: null, lng: null, community: null, attendees: null, isFree: null, tags: [], url: "" };
    const out = dedupeEvents([{ ...base, source: "meetup", externalId: "1" }, { ...base, source: "luma", externalId: "evt-1" }]);
    assert.deepEqual(out.map((e) => e.source), ["luma"]);
  });
});
