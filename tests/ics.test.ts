import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildIcs, escapeText, foldLine } from "../lib/ics";
import type { RankedEvent } from "../lib/sources/types";

const event: RankedEvent = {
  source: "luma", externalId: "evt-abc", title: "AI; Agents, and \\ backslashes", url: "https://luma.com/abc",
  startsAt: "2026-10-26T18:00:00.000Z", endsAt: "2026-10-26T20:30:00.000Z", venueName: "Techspace",
  address: "The Loading Bay, Clifton St, London EC2A 4HT, UK", lat: 51.5236, lng: -0.0824, community: "London.js",
  attendees: 142, isFree: true, tags: ["hackathon"], score: 7.5, reasons: ["Next Monday", "Free", "142 going"]
};

const unfold = (s: string) => s.replace(/\r\n[ \t]/g, "");

describe("escape and fold", () => {
  test("escapes , ; \\ and newlines", () => {
    assert.equal(escapeText("a,b;c\\d\ne\r\nf"), "a\\,b\\;c\\\\d\\ne\\nf");
  });

  test("folds at 75 octets, continuation lines start with a space", () => {
    const line = "DESCRIPTION:" + "x".repeat(200);
    const folded = foldLine(line).split("\r\n");
    assert.ok(folded.length > 1);
    for (const l of folded) assert.ok(Buffer.byteLength(l) <= 75, `${Buffer.byteLength(l)} > 75`);
    for (const l of folded.slice(1)) assert.equal(l[0], " ");
    assert.equal(unfold(folded.join("\r\n")), line);
  });

  test("never splits a multi-byte character", () => {
    const line = "SUMMARY:" + "é😀".repeat(40);
    const folded = foldLine(line);
    for (const l of folded.split("\r\n")) {
      assert.ok(Buffer.byteLength(l) <= 75);
      assert.ok(!l.includes("�"));
    }
    assert.equal(unfold(folded), line);
  });
});

describe("buildIcs", () => {
  const ics = buildIcs([event], { calendarName: "Roomline: London tech", now: new Date("2026-10-22T18:00:00Z") });
  const lines = unfold(ics).split("\r\n");

  test("valid calendar envelope with CRLF", () => {
    assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
    assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
    assert.ok(!/[^\r]\n/.test(ics), "bare LF found");
    for (const l of ics.split("\r\n")) assert.ok(Buffer.byteLength(l) <= 75);
    for (const h of ["VERSION:2.0", "X-WR-CALNAME:Roomline: London tech", "X-WR-TIMEZONE:Europe/London", "REFRESH-INTERVAL;VALUE=DURATION:PT12H"])
      assert.ok(lines.includes(h), h);
  });

  test("event fields: UTC times, stable UID, escaped text, reasons + URL in description", () => {
    assert.ok(lines.includes("UID:luma-evt-abc@roomline"));
    assert.ok(lines.includes("DTSTAMP:20261022T180000Z"));
    assert.ok(lines.includes("DTSTART:20261026T180000Z"));
    assert.ok(lines.includes("DTEND:20261026T203000Z"));
    assert.ok(lines.includes("SUMMARY:AI\\; Agents\\, and \\\\ backslashes"));
    assert.ok(lines.includes("LOCATION:Techspace\\, The Loading Bay\\, Clifton St\\, London EC2A 4HT\\, UK"));
    assert.ok(lines.includes("GEO:51.523600;-0.082400"));
    const desc = lines.find((l) => l.startsWith("DESCRIPTION:"))!;
    assert.equal(desc, "DESCRIPTION:• Next Monday\\n• Free\\n• 142 going\\n\\nhttps://luma.com/abc");
  });

  test("missing end defaults to two hours; UID stable across builds", () => {
    const again = buildIcs([{ ...event, endsAt: null }], { calendarName: "x", now: new Date("2026-10-23T00:00:00Z") });
    assert.match(again, /DTEND:20261026T200000Z/);
    assert.match(again, /UID:luma-evt-abc@roomline/);
  });
});
