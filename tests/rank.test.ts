import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { rankEvents, whenLabel } from "../lib/rank";
import type { SourceEvent } from "../lib/sources/types";

// Thursday 22 Oct 2026, 12:00 London (BST).
const NOW = new Date("2026-10-22T11:00:00Z");

const ev = (o: Partial<SourceEvent>): SourceEvent => ({
  source: "luma", externalId: "x", title: "Event", url: "https://luma.com/x", startsAt: "2026-10-29T18:00:00Z", endsAt: null,
  venueName: null, address: null, lat: null, lng: null, community: null, attendees: null, isFree: null, tags: [], ...o
});

describe("whenLabel (Europe/London)", () => {
  test("relative days", () => {
    assert.equal(whenLabel("2026-10-22T17:00:00Z", NOW), "Today");
    assert.equal(whenLabel("2026-10-23T17:00:00Z", NOW), "Tomorrow");
    assert.equal(whenLabel("2026-10-25T10:00:00Z", NOW), "This Sunday");
    assert.equal(whenLabel("2026-10-29T18:00:00Z", NOW), "Next Thursday");
    assert.equal(whenLabel("2026-11-12T18:00:00Z", NOW), "Thu 12 Nov");
  });
  test("uses London date, not UTC date", () => {
    // 23:30 UTC on Fri 23 Oct is 00:30 BST on Sat 24 Oct.
    assert.equal(whenLabel("2026-10-23T23:30:00Z", NOW), "This Saturday");
  });
});

describe("rankEvents", () => {
  test("readable reasons", () => {
    const [r] = rankEvents(
      [ev({ isFree: true, attendees: 142, community: "London.js", tags: ["hackathon"], venueName: "Techspace", lat: 51.5236, lng: -0.0824, startsAt: "2026-10-22T17:00:00Z" })],
      NOW,
      { pastEventsByCommunity: { "London.js": 9 } }
    );
    assert.deepEqual(r!.reasons, ["Today", "Hackathon", "Free", "142 going", "Run by London.js, 9 past events", "At Techspace, Shoreditch"]);
  });

  test("free, popular, sooner, established communities rank higher", () => {
    const out = rankEvents(
      [
        ev({ externalId: "paid", isFree: false, attendees: 10 }),
        ev({ externalId: "free", isFree: true, attendees: 10 }),
        ev({ externalId: "big", isFree: false, attendees: 300 }),
        ev({ externalId: "late", isFree: false, attendees: 10, startsAt: "2026-11-10T18:00:00Z" })
      ],
      NOW
    );
    assert.deepEqual(out.map((e) => e.externalId), ["free", "big", "paid", "late"]);
    assert.ok(out[0]!.reasons.includes("Free"));
    assert.ok(out.find((e) => e.externalId === "paid")!.reasons.includes("Paid"));
  });

  test("hackathons and workshops beat talks; networking and recruiting sink", () => {
    const out = rankEvents(
      [
        ev({ externalId: "drinks", title: "Tech Startups in the Pub - Relaxed Networking", attendees: 60 }),
        ev({ externalId: "talk", title: "What Breaks When You Let an Agent Loose on Your Repo", attendees: 60 }),
        ev({ externalId: "jobs", title: "Life After Layoffs: Finding a Job in Tech", attendees: 60 }),
        ev({ externalId: "hack", title: "Open Source Hack Day", attendees: 60 }),
        ev({ externalId: "workshop", title: "Graphs AI Workshop", attendees: 60 })
      ],
      NOW
    );
    assert.deepEqual(out.map((e) => e.externalId), ["hack", "workshop", "talk", "drinks", "jobs"]);
    assert.ok(out[0]!.reasons.includes("Hackathon"));
    assert.ok(out[1]!.reasons.includes("Workshop"));
    assert.ok(out.find((e) => e.externalId === "drinks")!.reasons.includes("Networking or social"));
    assert.ok(out.find((e) => e.externalId === "jobs")!.reasons.includes("Careers or recruiting"));
  });

  test("past events sink and say so", () => {
    const out = rankEvents([ev({ externalId: "old", startsAt: "2026-10-20T18:00:00Z" }), ev({ externalId: "new" })], NOW);
    assert.equal(out.at(-1)!.externalId, "old");
    assert.ok(out.at(-1)!.reasons.includes("Already happened"));
  });

  test("devpost counts registrations, luma hidden venue explained", () => {
    const [d] = rankEvents([ev({ source: "devpost", attendees: 50 })], NOW);
    assert.ok(d!.reasons.includes("50 registered"));
    const [l] = rankEvents([ev({})], NOW);
    assert.ok(l!.reasons.includes("Venue shown after registering"));
  });

  test("deterministic: same input, same order, ties broken by id", () => {
    const input = [ev({ externalId: "b" }), ev({ externalId: "a" }), ev({ externalId: "c" })];
    const a = rankEvents(input, NOW);
    const b = rankEvents([...input].reverse(), NOW);
    assert.deepEqual(a, b);
    assert.deepEqual(a.map((e) => e.externalId), ["a", "b", "c"]);
  });
});
