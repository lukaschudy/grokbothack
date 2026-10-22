import { test } from "node:test";
import assert from "node:assert/strict";

type Ev = { title: string; url: string | null; startsAt: string; venueName: string | null; area: string | null; address: string | null; reasons: string[] };
type App = {
  formatLondon(iso: string): string;
  relativeDay(iso: string, now?: Date): string;
  safeUrl(u: unknown): string | null;
  eventsFrom(json: unknown): Ev[];
  chipReasons(r: string[]): string[];
  postcodeDistrict(a: string | null): string | null;
  whereLine(ev: Ev): string;
  feedUrls(ics: string | undefined, href: string): { https: string; webcal: string };
  pickStats(json: unknown): Record<"venues" | "communities" | "events" | "past_hosts", number | null>;
};
// public/app.js is a plain browser module (no build step); a non-literal specifier keeps tsc from resolving it.
const appPath: string = "../public/app.js";
const app = (await import(appPath)) as App;

test("formats London times across the 25 Oct clock change", () => {
  assert.equal(app.formatLondon("2026-10-29T18:30:00.000Z"), "Thu 29 Oct, 18:30");
  assert.equal(app.formatLondon("2026-10-24T08:00:00.000Z"), "Sat 24 Oct, 09:00");
  assert.equal(app.formatLondon("2026-10-27T19:00:00.000Z"), "Tue 27 Oct, 19:00");
  assert.equal(app.formatLondon("not a date"), "");
});

test("relative day uses the London calendar day", () => {
  const now = new Date("2026-10-22T22:30:00.000Z"); // 23:30 BST on Thu 22 Oct
  assert.equal(app.relativeDay("2026-10-22T22:45:00.000Z", now), "Today");
  assert.equal(app.relativeDay("2026-10-22T23:15:00.000Z", now), "Tomorrow"); // 00:15 BST Fri
  assert.equal(app.relativeDay("2026-10-24T08:00:00.000Z", now), "");
});

test("normalises API rows and the seed's camelCase rows", () => {
  const api = app.eventsFrom({ events: [{ title: "A", url: "https://luma.com/x", starts_at: "2026-10-29T18:30:00Z", venue_name: "Granola", area: "Shoreditch", address: null, reasons: ["Free"] }] });
  const seed = app.eventsFrom([{ title: "B", url: "javascript:alert(1)", startsAt: "2026-10-29T18:30:00Z", venueName: null, reasons: null }]);
  assert.deepEqual(api[0], { title: "A", url: "https://luma.com/x", startsAt: "2026-10-29T18:30:00Z", venueName: "Granola", area: "Shoreditch", address: null, reasons: ["Free"] });
  assert.equal(seed[0]!.url, null);
  assert.deepEqual(seed[0]!.reasons, []);
  assert.deepEqual(app.eventsFrom({ nope: true }), []);
});

test("chips drop date and venue reasons the card already shows", () => {
  const reasons = ["Today", "Next Thursday", "This Saturday", "Wed 4 Nov", "Sat 12 Sept", "Hackathon", "Free", "126 going", "Run by X, 7 past events", "At Granola, Shoreditch", "Venue shown after registering"];
  assert.deepEqual(app.chipReasons(reasons), ["Hackathon", "Free", "126 going", "Run by X, 7 past events"]);
});

test("where line prefers the ranker's area, then the postcode district", () => {
  const ev = (o: Partial<Ev>): Ev => ({ title: "", url: null, startsAt: "", venueName: null, area: null, address: null, reasons: [], ...o });
  assert.equal(app.whereLine(ev({ venueName: "Granola", area: "Old Street", reasons: ["At Granola, Shoreditch"] })), "Granola · Old Street");
  assert.equal(app.whereLine(ev({ venueName: "Granola", reasons: ["At Granola, Shoreditch"] })), "Granola · Shoreditch");
  assert.equal(app.whereLine(ev({ venueName: "Civo", address: "32-37 Cowper St, EC2A 4AW" })), "Civo · EC2A");
  assert.equal(app.whereLine(ev({ reasons: ["Venue shown after registering"] })), "Venue shown after registering");
  assert.equal(app.whereLine(ev({})), "Venue to be confirmed");
  assert.equal(app.postcodeDistrict("11 Pilgrim St, London EC4V 6RN, UK"), "EC4V");
});

test("feed URLs: webcal on the current host, absolute config kept", () => {
  assert.deepEqual(app.feedUrls("/events.ics", "https://mates.example/?x=1"), { https: "https://mates.example/events.ics", webcal: "webcal://mates.example/events.ics" });
  assert.deepEqual(app.feedUrls(undefined, "http://localhost:8000/"), { https: "http://localhost:8000/events.ics", webcal: "webcal://localhost:8000/events.ics" });
  assert.equal(app.feedUrls("https://api.example/events.ics", "https://site.example/").webcal, "webcal://api.example/events.ics");
});

test("stats accept a few key spellings and leave gaps as null", () => {
  assert.deepEqual(app.pickStats({ venues: 143, communities: "98", events: 60, past_hosts: 389 }), { venues: 143, communities: 98, events: 60, past_hosts: 389 });
  assert.deepEqual(app.pickStats({ stats: { venues: 1, pastHosts: 2 } }), { venues: 1, communities: null, events: null, past_hosts: 2 });
  // api-server shape
  assert.deepEqual(app.pickStats({ venues: 153, communities: 98, events: 60, hosts: 389 }), { venues: 153, communities: 98, events: 60, past_hosts: 389 });
  assert.deepEqual(app.pickStats(null), { venues: null, communities: null, events: null, past_hosts: null });
});
