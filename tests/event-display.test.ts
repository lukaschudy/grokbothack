import { test } from "node:test";
import assert from "node:assert/strict";
import { chipReasons, relativeDay, safeHref, whereLine } from "../lib/event-display";

test("chips drop the date and venue reasons the card already shows", () => {
  const reasons = ["Today", "Next Thursday", "This Saturday", "Wed 4 Nov", "Sat 12 Sept", "Hackathon", "Free", "126 going",
    "Run by X, 7 past events", "At Granola, Shoreditch", "Venue shown after registering"];
  assert.deepEqual(chipReasons(reasons), ["Hackathon", "Free", "126 going", "Run by X, 7 past events"]);
});

test("relative day uses the London calendar day, across midnight BST", () => {
  const now = new Date("2026-10-22T22:30:00Z"); // 23:30 BST, Thu 22 Oct
  assert.equal(relativeDay(new Date("2026-10-22T22:45:00Z"), now), "Today");
  assert.equal(relativeDay(new Date("2026-10-22T23:15:00Z"), now), "Tomorrow"); // 00:15 BST Fri
  assert.equal(relativeDay(new Date("2026-10-24T08:00:00Z"), now), null);
});

test("relative day after the clocks go back", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  assert.equal(relativeDay(new Date("2026-10-26T00:30:00Z"), now), "Tomorrow"); // 00:30 GMT Mon
});

test("where line: venue and area, else what we know", () => {
  const base = { venueName: null, lat: null, lng: null, reasons: [] as string[] };
  assert.equal(whereLine({ ...base, venueName: "Granola", lat: 51.5262, lng: -0.0794 }), "Granola · Shoreditch");
  assert.equal(whereLine({ ...base, venueName: "Granola" }), "Granola");
  assert.equal(whereLine({ ...base, reasons: ["Venue shown after registering"] }), "Venue shown after registering");
  assert.equal(whereLine(base), "Venue to be confirmed");
});

test("only http(s) links are used", () => {
  assert.equal(safeHref("https://luma.com/x"), "https://luma.com/x");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref(null), null);
});
