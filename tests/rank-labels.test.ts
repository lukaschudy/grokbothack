// How well lib/rank.ts orders real seeded events against hand labels (data/labels.json).
// "good" = a London builder would want to go (hackathons, build days, hands-on workshops, technical talks
// by established dev communities); "ok" = relevant but not hands-on; "filler" = networking, socials,
// drinks, recruiter-led, vendor marketing, paid, non-tech. Labels were set before any rank change.
// Tune on the "tune" half only; the "holdout" half checks that a change generalises.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rankEvents } from "../lib/rank";
import type { RankedEvent, SourceEvent } from "../lib/sources/types";

// Thursday 22 Oct 2026, 12:00 London, for the unit check below.
const NOON = new Date("2026-10-22T11:00:00Z");
const ev = (o: Partial<SourceEvent>): SourceEvent => ({
  source: "luma", externalId: "x", title: "Event", url: "https://luma.com/x", startsAt: "2026-10-29T18:00:00Z", endsAt: null,
  venueName: null, address: null, lat: null, lng: null, community: null, attendees: null, isFree: null, tags: [], ...o
});

type Label = { id: string; title: string; label: "good" | "ok" | "filler"; reason: string; set: "tune" | "holdout" };

// When data/seed/events.json was fetched (Thu 22 Oct 2026, ~19:00 BST).
const NOW = new Date("2026-10-22T18:00:00Z");
const GAIN = { good: 2, ok: 1, filler: 0 } as const;

const seeded = JSON.parse(readFileSync("data/seed/events.json", "utf8")) as RankedEvent[];
const labels = JSON.parse(readFileSync("data/labels.json", "utf8")) as Label[];
const byId = new Map(labels.map((l) => [l.id, l]));
const key = (e: SourceEvent) => `${e.source}:${e.externalId}`;

// The fetcher passes Luma calendar history to rankEvents; recover it from the stored reasons.
const pastEventsByCommunity: Record<string, number> = {};
for (const e of seeded) for (const r of e.reasons) {
  const m = r.match(/^Run by (.+), (\d+) past events?$/);
  if (m) pastEventsByCommunity[m[1]!] = Number(m[2]);
}
const events: SourceEvent[] = seeded.map(({ score: _s, reasons: _r, ...e }) => e);

export function metrics(order: Label[]) {
  const top = order.slice(0, 10);
  const dcg = (ls: Label[]) => ls.reduce((s, l, i) => s + GAIN[l.label] / Math.log2(i + 2), 0);
  const ideal = [...order].sort((a, b) => GAIN[b.label] - GAIN[a.label]).slice(0, 10);
  let right = 0, pairs = 0;
  for (let i = 0; i < order.length; i++)
    for (let j = i + 1; j < order.length; j++) {
      const d = GAIN[order[i]!.label] - GAIN[order[j]!.label];
      if (d !== 0) { pairs++; if (d > 0) right++; }
    }
  return {
    "good@10": top.filter((l) => l.label === "good").length / 10,
    "filler@10": top.filter((l) => l.label === "filler").length / 10,
    "ndcg@10": dcg(top) / dcg(ideal),
    pairwise: right / pairs
  };
}

const round = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 100) / 100]));

test("every seeded event has a label", () => {
  assert.equal(labels.length, seeded.length);
  for (const e of seeded) assert.ok(byId.has(key(e)), `no label for ${key(e)} ${e.title}`);
  assert.equal(labels.filter((l) => l.set === "tune").length, 30);
});

test("ranking puts builder events ahead of filler", () => {
  const ranked = rankEvents(events, NOW, { pastEventsByCommunity }).map((e) => byId.get(key(e))!);
  const report: Record<string, Record<string, number>> = {};
  for (const set of ["tune", "holdout"] as const) report[set] = round(metrics(ranked.filter((l) => l.set === set)));
  report.all = round(metrics(ranked));
  console.table(report);
  console.log("top 10:\n" + ranked.slice(0, 10).map((l, i) => `${String(i + 1).padStart(2)}. [${l.label}] ${l.title}`).join("\n"));

  // Floors just under the numbers after the type/paid change (before it: all good@10 0.4, filler@10 0.4,
  // pairwise 0.51; holdout pairwise 0.40). See docs/judges.md.
  assert.ok(report.all!["good@10"]! >= 0.7, "good@10");
  assert.ok(report.all!["filler@10"]! <= 0.1, "filler@10");
  assert.ok(report.all!.pairwise! >= 0.8, "pairwise");
  assert.ok(report.holdout!.pairwise! >= 0.75, "holdout pairwise");
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
    NOON
  );
  assert.deepEqual(out.map((e) => e.externalId), ["hack", "workshop", "talk", "drinks", "jobs"]);
  assert.ok(out[0]!.reasons.includes("Hackathon"));
  assert.ok(out[1]!.reasons.includes("Workshop"));
  assert.ok(out.find((e) => e.externalId === "drinks")!.reasons.includes("Networking or social"));
  assert.ok(out.find((e) => e.externalId === "jobs")!.reasons.includes("Careers or recruiting"));
});
