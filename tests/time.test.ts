import { test } from "node:test";
import assert from "node:assert/strict";
import { formatWindow, londonToUtc, resolveDay, spokenDay, spokenTime } from "../lib/time";

// Hackathon night: Thursday 22 Oct 2026, 19:30 BST.
const now = new Date("2026-10-22T18:30:00Z");

test("next Thursday on a Thursday is a week later", () => {
  assert.equal(resolveDay("next Thursday", now), "2026-10-29");
  assert.equal(resolveDay("this thursday", now), "2026-10-22");
  assert.equal(resolveDay("tonight", now), "2026-10-22");
  assert.equal(resolveDay("tomorrow", now), "2026-10-23");
  assert.equal(resolveDay("next tue", now), "2026-10-27");
  assert.equal(resolveDay("sometime", now), null);
});

test("London wall clock converts across the 25 Oct clock change", () => {
  // Before the change: BST (UTC+1).
  assert.equal(londonToUtc("2026-10-22", "18:30").toISOString(), "2026-10-22T17:30:00.000Z");
  // After the change: GMT (UTC+0).
  assert.equal(londonToUtc("2026-10-29", "18:30").toISOString(), "2026-10-29T18:30:00.000Z");
});

test("formats for screen and for speech", () => {
  const start = londonToUtc("2026-10-29", "18:30");
  const end = londonToUtc("2026-10-29", "21:30");
  assert.equal(formatWindow(start, end), "Thu 29 Oct, 18:30–21:30");
  assert.equal(spokenDay(start), "Thursday the 29th of October");
  assert.equal(spokenTime(start), "6:30 pm");
  assert.equal(spokenTime(londonToUtc("2026-10-29", "18:00")), "6 pm");
});
