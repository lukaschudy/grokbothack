import { after, afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { asUser, sql } from "../lib/db";
import { bus, type CallEvent } from "../lib/bus";
import { agentInstructions, loadCall, normaliseTime, openingLine, parseResult, type CallContext } from "../lib/calls";
import { callMode, placeCall } from "../lib/dialer";
import { member, resetDb, venueAt } from "./helpers";

// Thu 29 Oct 2026, 18:30–21:30 London (GMT: clocks went back on the 25th).
const STARTS = new Date("2026-10-29T18:30:00Z");
const ENDS = new Date("2026-10-29T21:30:00Z");

const ENV_KEYS = ["CALL_MODE", "XAI_API_KEY", "SCRIPTED_PACE"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const realFetch = globalThis.fetch;

beforeEach(async () => {
  await resetDb();
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
after(async () => {
  for (const k of ENV_KEYS) if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  await sql.end();
});

const ctx = (over: Partial<CallContext> = {}): CallContext => ({
  id: "c1", venue_id: "v1", venue_name: "Shoreditch Works", address: null, capacity: 100, terms: "free",
  phone: "+447700900123", contact_name: null, organiser: "Ada", community: "London Rust", requested_by: null,
  event_title: null, headcount: 80, starts_at: STARTS, ends_at: ENDS, status: "queued", twilio_sid: null, result: null, ...over
});

/** What the UI does: request_call as the organiser, then placeCall for a new call. */
async function requestCall() {
  const ada = await member("Ada", { root: true });
  await sql`update profiles set community = 'London Rust' where id = ${ada}`;
  const venue = await venueAt(ada, { name: "Shoreditch Works", capacity: 100, phone: "+447700900123" });
  await sql`update venues set price_note = 'Ask about community rate' where id = ${venue}`;
  const [{ r }] = (await asUser(ada, (tx) => tx`select request_call(${venue}, ${STARTS}, ${ENDS}, 80, 'Rust Hack Night') as r`)) as unknown as [{ r: { outcome: string; call_id: string } }];
  assert.equal(r.outcome, "new");
  return { ada, venue, callId: r.call_id };
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("calling script (README on main)", () => {
  test("opens with the README line, then discloses AI and recording", () => {
    assert.match(openingLine(ctx()), /^Hi, I'm an assistant calling on behalf of Ada, London Rust\. Just so you know, I'm an AI/);
    assert.match(openingLine(ctx({ community: null })), /^Hi, I'm an assistant calling on behalf of Ada\. /);
  });

  test("instructions ask for a London accent and never claim to be human", () => {
    const text = agentInstructions(ctx());
    assert.match(text, /natural London accent/);
    assert.match(text, /Never claim to be human\. If anyone asks .* say you're an AI assistant/);
    assert.match(text, /Thursday 29 October|Thursday the 29th/);
    assert.match(text, /under two minutes/);
  });
});

describe("result parsing", () => {
  test("times normalise to 24h London", () => {
    assert.equal(normaliseTime("6:30pm"), "18:30");
    assert.equal(normaliseTime("21.30"), "21:30");
    assert.equal(normaliseTime("9"), "21:00");
    assert.equal(normaliseTime("nonsense"), null);
  });

  test("unknown status becomes partial; blanks become null", () => {
    const r = parseResult({ status: "maybe", price: "  ", max_people: 120.4 });
    assert.equal(r.status, "partial");
    assert.equal(r.price, null);
    assert.equal(r.max_people, 120);
  });
});

describe("call mode", () => {
  test("virtual falls back to scripted without XAI_API_KEY", () => {
    assert.equal(callMode(), "scripted");
    process.env.CALL_MODE = "virtual";
    assert.equal(callMode(), "scripted");
    process.env.XAI_API_KEY = "xai-test";
    assert.equal(callMode(), "virtual");
    process.env.CALL_MODE = "twilio";
    assert.equal(callMode(), "twilio");
  });

  test("twilio mode without XAI_API_KEY fails before dialing", async () => {
    process.env.CALL_MODE = "twilio";
    let dialed = false;
    globalThis.fetch = (async () => { dialed = true; return Response.json({}); }) as typeof fetch;
    const { callId } = await requestCall();
    await assert.rejects(placeCall(callId), /XAI_API_KEY is not set/);
    assert.equal(dialed, false);
    const [c] = await sql`select status, error from calls where id = ${callId}`;
    assert.equal(c!.status, "failed");
    assert.equal(c!.error, "XAI_API_KEY is not set");
  });
});

describe("scripted call end to end", () => {
  test("request → scripted conversation → result on the card → availability row", async () => {
    process.env.CALL_MODE = "scripted";
    process.env.SCRIPTED_PACE = "0";
    const { callId, venue } = await requestCall();
    const events: CallEvent[] = [];
    const onEvent = (e: CallEvent) => events.push(e);
    bus.on(`call:${callId}`, onEvent);
    try {
      await placeCall(callId);
      const call = await waitFor(async () => {
        const [c] = await sql<any[]>`select * from calls where id = ${callId}`;
        return c?.status === "completed" ? c : null;
      });

      const avail = await sql<any[]>`select * from availability where call_id = ${callId}`;
      assert.equal(avail.length, 1);
      assert.equal(avail[0].venue_id, venue);
      assert.equal(avail[0].status, "available");
      assert.equal(avail[0].source, "call");
      assert.equal(avail[0].starts_at.toISOString(), STARTS.toISOString());
      assert.equal(avail[0].ends_at.toISOString(), ENDS.toISOString());
      assert.match(avail[0].price_note, /Free for community/);

      assert.equal(call.result.status, "available");
      assert.equal(call.result.availability_id, avail[0].id);
      assert.equal(call.transcript.length, 10);
      assert.match(call.transcript[0].text, /^Hi, I'm an assistant calling on behalf of Ada, London Rust\./);
      assert.ok(call.answered_at && call.ended_at);

      // The call card is driven by these events.
      const statuses = events.filter((e) => e.type === "status").map((e) => (e as { status: string }).status);
      assert.deepEqual(statuses, ["dialing", "ringing", "in_progress", "completed"]);
      assert.equal(events.filter((e) => e.type === "result").length, 1);

      // A rehearsal doesn't rewrite the venue's facts.
      const [v] = await sql`select capacity, price_note from venues where id = ${venue}`;
      assert.equal(v!.capacity, 100);
      assert.equal(v!.price_note, "Ask about community rate");

      // One call answers every organiser: the next request reuses it.
      const ben = await member("Ben", { root: true });
      const [{ r }] = (await asUser(ben, (tx) => tx`select request_call(${venue}, ${STARTS}, ${ENDS}, 60) as r`)) as unknown as [{ r: { outcome: string; call_id: string } }];
      assert.equal(r.outcome, "reused");
      assert.equal(r.call_id, callId);
    } finally {
      bus.off(`call:${callId}`, onEvent);
    }
  });

  test("placing a call whose row is gone does not throw", async () => {
    process.env.CALL_MODE = "scripted";
    process.env.SCRIPTED_PACE = "0";
    const { callId } = await requestCall();
    const ctxBefore = await loadCall(callId);
    assert.ok(ctxBefore);
    await sql`delete from calls where id = ${callId}`;
    await placeCall(callId); // no row: returns without throwing
  });
});
