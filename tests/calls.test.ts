import { after, afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import { sql } from "../lib/db";
import { attachCallStreams, applyTwilioStatus, placeCall } from "../lib/calls";
import { CallBridge, recordResult } from "../lib/calls/bridge";
import { buildInstructions, buildSessionUpdate, spokenSlot, spokenTime } from "../lib/calls/prompt";
import { buildCallParams, buildTwiml, nextStatus, twilioSignature, validSignature } from "../lib/calls/twilio";
import { member, resetDb, venueAt } from "./helpers";

Object.assign(process.env, {
  TWILIO_ACCOUNT_SID: "ACtest", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+15005550006",
  PUBLIC_URL: "https://calls.example.dev", XAI_API_KEY: "xai-test"
});

// Thu 29 Oct 2026, 18:30–21:30 London (GMT: clocks went back on the 25th).
const STARTS = new Date("2026-10-29T18:30:00Z");
const ENDS = new Date("2026-10-29T21:30:00Z");

type Sent = { url: string; body: URLSearchParams; auth: string | null };
let sent: Sent[] = [];
let reply: () => Response = () => Response.json({ sid: "CA123" }, { status: 201 });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  sent.push({ url: String(url), body: new URLSearchParams(String(init?.body ?? "")), auth: new Headers(init?.headers).get("authorization") });
  return reply();
}) as typeof fetch;

after(async () => {
  globalThis.fetch = realFetch;
  await sql.end();
});

async function makeCall(opts: { okToCall?: boolean; phone?: string | null; status?: string; sid?: string } = {}) {
  const uid = await member("Ada", { root: true });
  await sql`update profiles set community = 'London Rust' where id = ${uid}`;
  const venue = await venueAt(uid, { name: "Shoreditch Works", ok_to_call: opts.okToCall ?? true, ...(opts.phone === null ? {} : { phone: opts.phone ?? "+447700900123" }) });
  const [c] = await sql<{ id: string }[]>`
    insert into calls (venue_id, requested_by, starts_at, ends_at, headcount, status, twilio_sid)
    values (${venue}, ${uid}, ${STARTS}, ${ENDS}, 80, ${opts.status ?? "queued"}, ${opts.sid ?? null}) returning id`;
  return { callId: c!.id, venue, uid };
}

const callRow = async (id: string) =>
  (await sql<any[]>`select * from calls where id = ${id}`)[0];

beforeEach(async () => {
  await resetDb();
  sent = [];
  reply = () => Response.json({ sid: "CA123" }, { status: 201 });
});

describe("prompt", () => {
  test("spoken slot is in London time with British clock phrases", () => {
    assert.equal(spokenSlot(STARTS, ENDS), "Thursday the 29th of October from half six to half nine");
    // Before the clocks change: 17:30Z is 18:30 BST.
    assert.equal(spokenSlot(new Date("2026-10-22T17:30:00Z"), new Date("2026-10-22T20:00:00Z")),
      "Thursday the 22nd of October from half six to nine");
    assert.equal(spokenSlot(new Date("2026-11-01T22:00:00Z"), new Date("2026-11-02T01:00:00Z")),
      "Sunday the 1st of November from ten to one on Monday the 2nd of November");
  });

  test("spoken times", () => {
    assert.equal(spokenTime(18, 15), "quarter past six");
    assert.equal(spokenTime(18, 45), "quarter to seven");
    assert.equal(spokenTime(23, 45), "quarter to twelve");
    assert.equal(spokenTime(12, 0), "midday");
    assert.equal(spokenTime(19, 20), "7:20");
  });

  test("instructions carry the opener, the ask and the AI disclosure", () => {
    const ctx = { organiser: "Ada", community: "London Rust", venue: "Shoreditch Works", startsAt: STARTS, endsAt: ENDS, headcount: 80, eventTitle: null };
    const text = buildInstructions(ctx);
    assert.match(text, /"Hi, I'm an assistant calling on behalf of Ada from London Rust\."/);
    assert.match(text, /Shoreditch Works is free on Thursday the 29th of October from half six to half nine for 80 people/);
    assert.match(text, /Never claim to be human/);
    assert.match(text, /London accent/);
    assert.match(text, /under two minutes/);
    assert.match(buildInstructions({ ...ctx, community: null }), /calling on behalf of Ada\."/);
    const s = buildSessionUpdate(ctx).session;
    assert.equal(s.voice, "leo");
    assert.equal(s.audio.input.format.type, "audio/pcmu");
    assert.equal(s.audio.output.format.type, "audio/pcmu");
    assert.deepEqual(s.tools.map((t) => t.name), ["report_result"]);
  });
});

describe("twilio requests", () => {
  test("TwiML connects a media stream for this call", () => {
    assert.equal(buildTwiml("calls.example.dev", "abc"),
      `<Response><Connect><Stream url="wss://calls.example.dev/twilio/media?call=abc"/></Connect></Response>`);
  });

  test("call params", () => {
    const p = buildCallParams({ to: "+447700900123", from: "+15005550006", publicUrl: "https://h.dev", publicHost: "h.dev", callId: "abc" });
    assert.equal(p.get("To"), "+447700900123");
    assert.equal(p.get("From"), "+15005550006");
    assert.equal(p.get("StatusCallback"), "https://h.dev/twilio/status?call=abc");
    assert.equal(p.get("MachineDetection"), "Enable");
    assert.match(p.get("Twiml")!, /wss:\/\/h\.dev\/twilio\/media\?call=abc/);
    assert.deepEqual(p.getAll("StatusCallbackEvent"), ["initiated", "ringing", "answered", "completed"]);
  });

  test("signatures round-trip and reject tampering", () => {
    const params = new URLSearchParams({ CallSid: "CA1", CallStatus: "ringing" });
    const sig = twilioSignature("tok", "https://h.dev/twilio/status?call=abc", params);
    assert.ok(validSignature("tok", "https://h.dev/twilio/status?call=abc", params, sig));
    assert.ok(!validSignature("tok", "https://h.dev/twilio/status?call=xyz", params, sig));
    assert.ok(!validSignature("tok", "https://h.dev/twilio/status?call=abc", new URLSearchParams({ CallSid: "CA1", CallStatus: "completed" }), sig));
    assert.ok(!validSignature("tok", "https://h.dev/twilio/status?call=abc", params, undefined));
  });

  test("status transitions", () => {
    assert.equal(nextStatus("dialing", { CallStatus: "ringing" }), "ringing");
    assert.equal(nextStatus("ringing", { CallStatus: "in-progress" }), "in_progress");
    assert.equal(nextStatus("in_progress", { CallStatus: "ringing" }), null);
    assert.equal(nextStatus("ringing", { CallStatus: "no-answer" }), "no_answer");
    assert.equal(nextStatus("ringing", { CallStatus: "busy" }), "busy");
    assert.equal(nextStatus("dialing", { CallStatus: "failed" }), "failed");
    assert.equal(nextStatus("ringing", { CallStatus: "completed" }), "no_answer");
    assert.equal(nextStatus("in_progress", { CallStatus: "completed" }), "completed");
    assert.equal(nextStatus("in_progress", { AnsweredBy: "machine_start" }), "no_answer");
    assert.equal(nextStatus("in_progress", { AnsweredBy: "human" }), null);
    assert.equal(nextStatus("completed", { CallStatus: "completed" }), null);
  });
});

describe("placeCall", () => {
  test("dials the venue through Twilio and stores the sid", async () => {
    const { callId } = await makeCall();
    await placeCall(callId);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.url, "https://api.twilio.com/2010-04-01/Accounts/ACtest/Calls.json");
    assert.equal(sent[0]!.auth, `Basic ${Buffer.from("ACtest:tok").toString("base64")}`);
    assert.equal(sent[0]!.body.get("To"), "+447700900123");
    assert.equal(sent[0]!.body.get("From"), "+15005550006");
    assert.equal(sent[0]!.body.get("Twiml"),
      `<Response><Connect><Stream url="wss://calls.example.dev/twilio/media?call=${callId}"/></Connect></Response>`);
    const c = await callRow(callId);
    assert.equal(c.status, "dialing");
    assert.equal(c.twilio_sid, "CA123");
  });

  test("refuses venues that are not ok to call", async () => {
    const { callId } = await makeCall({ okToCall: false });
    await assert.rejects(placeCall(callId), /not_ok_to_call/);
    assert.equal(sent.length, 0);
    assert.equal((await callRow(callId)).status, "canceled");
  });

  test("refuses calls that are already placed", async () => {
    const { callId } = await makeCall({ status: "dialing", sid: "CA1" });
    await assert.rejects(placeCall(callId), /call_not_queued/);
    assert.equal(sent.length, 0);
  });

  test("marks the call failed when Twilio rejects it", async () => {
    reply = () => Response.json({ message: "The number is unverified" }, { status: 400 });
    const { callId } = await makeCall();
    await assert.rejects(placeCall(callId), /twilio 400: The number is unverified/);
    const c = await callRow(callId);
    assert.equal(c.status, "failed");
    assert.match(c.error, /unverified/);
  });
});

describe("status callbacks", () => {
  test("ringing, answered, then hung up without a result", async () => {
    const { callId } = await makeCall({ status: "dialing", sid: "CA1" });
    await applyTwilioStatus(callId, new URLSearchParams({ CallSid: "CA1", CallStatus: "ringing" }));
    assert.equal((await callRow(callId)).status, "ringing");
    await applyTwilioStatus(callId, new URLSearchParams({ CallSid: "CA1", CallStatus: "in-progress" }));
    assert.ok((await callRow(callId)).answered_at);
    await applyTwilioStatus(callId, new URLSearchParams({ CallSid: "CA1", CallStatus: "completed" }));
    const c = await callRow(callId);
    assert.equal(c.status, "completed");
    assert.equal(c.error, "ended_without_result");
    assert.ok(c.ended_at);
  });

  test("no answer and busy", async () => {
    const a = await makeCall({ status: "ringing", sid: "CA1" });
    await applyTwilioStatus(a.callId, new URLSearchParams({ CallSid: "CA1", CallStatus: "no-answer" }));
    assert.equal((await callRow(a.callId)).status, "no_answer");
    const b = await makeCall({ status: "dialing", sid: "CA2" });
    await applyTwilioStatus(b.callId, new URLSearchParams({ CallSid: "CA2", CallStatus: "busy" }));
    assert.equal((await callRow(b.callId)).status, "busy");
  });

  test("voicemail is no_answer, gets hung up, and writes no availability", async () => {
    const { callId } = await makeCall({ status: "in_progress", sid: "CA1" });
    await applyTwilioStatus(callId, new URLSearchParams({ CallSid: "CA1", AnsweredBy: "machine_start" }));
    assert.equal((await callRow(callId)).status, "no_answer");
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.url, /\/Calls\/CA1\.json$/);
    assert.equal(sent[0]!.body.get("Status"), "completed");
    await applyTwilioStatus(callId, new URLSearchParams({ CallSid: "CA1", CallStatus: "completed" }));
    assert.equal((await callRow(callId)).status, "no_answer");
    assert.equal((await sql`select 1 from availability`).length, 0);
  });

  test("a completed callback after a result keeps the result", async () => {
    const { callId } = await makeCall({ status: "in_progress", sid: "CA1" });
    await recordResult(callId, { status: "available", summary: "Free" });
    await applyTwilioStatus(callId, new URLSearchParams({ CallSid: "CA1", CallStatus: "completed" }));
    const c = await callRow(callId);
    assert.equal(c.status, "completed");
    assert.equal(c.error, null);
    assert.ok(c.ended_at);
  });

  test("ignores callbacks for a different Twilio call", async () => {
    const { callId } = await makeCall({ status: "ringing", sid: "CA1" });
    await applyTwilioStatus(callId, new URLSearchParams({ CallSid: "CA999", CallStatus: "busy" }));
    assert.equal((await callRow(callId)).status, "ringing");
  });
});

class FakeSocket {
  sent: any[] = [];
  closed = false;
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; }
  types() { return this.sent.map((m) => m.type ?? m.event); }
}

describe("call bridge", () => {
  let bridge: CallBridge | null = null;
  afterEach(async () => { await bridge?.close(); bridge = null; });

  async function started(callId: string) {
    const twilio = new FakeSocket();
    const xai = new FakeSocket();
    bridge = new CallBridge(callId, twilio, () => xai, () => {});
    assert.equal(await bridge.start({ streamSid: "MZ1", callSid: "CA1" }), true);
    bridge.onXaiOpen();
    return { twilio, xai, bridge };
  }

  test("refuses a stream whose CallSid is not ours", async () => {
    const { callId } = await makeCall({ status: "ringing", sid: "CA1" });
    const twilio = new FakeSocket();
    let opened = false;
    bridge = new CallBridge(callId, twilio, () => { opened = true; return new FakeSocket(); }, () => {});
    assert.equal(await bridge.start({ streamSid: "MZ1", callSid: "CA-other" }), false);
    assert.equal(opened, false);
    assert.ok(twilio.closed);
  });

  test("configures Grok, speaks first and relays audio both ways", async () => {
    const { callId } = await makeCall({ status: "ringing", sid: "CA1" });
    const { twilio, xai, bridge: b } = await started(callId);
    assert.equal((await callRow(callId)).status, "in_progress");
    assert.equal(xai.sent[0].type, "session.update");
    assert.match(xai.sent[0].session.instructions, /Ada from London Rust/);
    assert.match(xai.sent[0].session.instructions, /Shoreditch Works/);

    b.onTwilio({ event: "media", media: { track: "inbound", payload: "early" } });
    assert.ok(!xai.types().includes("input_audio_buffer.append"), "no audio before the session is configured");

    b.onXai({ type: "session.updated" });
    assert.equal(xai.sent.at(-1).type, "response.create");
    b.onTwilio({ event: "media", media: { track: "inbound", payload: "AAAA" } });
    assert.deepEqual(xai.sent.at(-1), { type: "input_audio_buffer.append", audio: "AAAA" });
    b.onXai({ type: "response.output_audio.delta", delta: "BBBB" });
    assert.deepEqual(twilio.sent.at(-1), { event: "media", streamSid: "MZ1", media: { payload: "BBBB" } });
    b.onXai({ type: "input_audio_buffer.speech_started" });
    assert.deepEqual(twilio.sent.at(-1), { event: "clear", streamSid: "MZ1" });
  });

  test("report_result writes availability, result, transcript, then hangs up after goodbye", async () => {
    const { callId, venue } = await makeCall({ status: "ringing", sid: "CA1" });
    const { twilio, xai, bridge: b } = await started(callId);
    b.onXai({ type: "session.updated" });
    b.onXai({ type: "response.output_audio_transcript.done", transcript: "Hi, I'm an assistant calling on behalf of Ada from London Rust." });
    b.onXai({ type: "conversation.item.input_audio_transcription.completed", transcript: "Yes, we're free, no charge for community groups. I'm Sam." });
    const args = JSON.stringify({ status: "available", price_note: "Free for community groups", conditions: "Out by 10pm", confirmed_by_name: "Sam", summary: "Free, out by 10." });
    b.onXai({ type: "response.function_call_arguments.done", call_id: "fc1", name: "report_result", arguments: args });
    b.onXai({ type: "response.output_item.done", item: { type: "function_call", call_id: "fc1", name: "report_result", arguments: args } });
    await b.flush();

    const avail = await sql<any[]>`select * from availability`;
    assert.equal(avail.length, 1, "duplicate tool events write one row");
    assert.equal(avail[0].venue_id, venue);
    assert.equal(avail[0].status, "available");
    assert.equal(avail[0].source, "call");
    assert.equal(avail[0].call_id, callId);
    assert.equal(avail[0].price_note, "Free for community groups");
    assert.equal(avail[0].conditions, "Out by 10pm");
    assert.equal(avail[0].confirmed_by_name, "Sam");
    assert.equal(avail[0].starts_at.toISOString(), STARTS.toISOString());

    const c = await callRow(callId);
    assert.equal(c.status, "completed");
    assert.equal(c.result.status, "available");
    assert.deepEqual(c.transcript.map((t: any) => t.role), ["agent", "venue"]);

    const out = xai.sent.find((m) => m.type === "conversation.item.create");
    assert.equal(out.item.type, "function_call_output");
    assert.equal(out.item.call_id, "fc1");
    assert.equal(xai.sent.at(-1).type, "response.create");

    assert.equal(sent.length, 0, "no hang up until the goodbye has played");
    b.onXai({ type: "response.done" });
    assert.deepEqual(twilio.sent.at(-1), { event: "mark", streamSid: "MZ1", mark: { name: "goodbye" } });
    b.onTwilio({ event: "mark", mark: { name: "goodbye" } });
    await b.hangUp();
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.url, /\/Calls\/CA1\.json$/);
    assert.equal(sent[0]!.body.get("Status"), "completed");
  });

  test("invalid tool arguments write nothing and tell Grok", async () => {
    const { callId } = await makeCall({ status: "ringing", sid: "CA1" });
    const { xai, bridge: b } = await started(callId);
    b.onXai({ type: "response.function_call_arguments.done", call_id: "fc1", name: "report_result", arguments: JSON.stringify({ status: "maybe" }) });
    await b.flush();
    assert.equal((await sql`select 1 from availability`).length, 0);
    const out = xai.sent.find((m) => m.type === "conversation.item.create");
    assert.match(out.item.output, /Invalid arguments/);
    assert.equal((await callRow(callId)).status, "in_progress");
  });
});

describe("attachCallStreams", () => {
  let server: http.Server;
  let fakeXai: WebSocketServer;
  let base: string;
  const xaiReceived: any[] = [];

  beforeEach(async () => {
    xaiReceived.length = 0;
    fakeXai = new WebSocketServer({ port: 0 });
    fakeXai.on("connection", (ws) => ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      xaiReceived.push(m);
      if (m.type === "session.update") ws.send(JSON.stringify({ type: "session.updated" }));
      if (m.type === "response.create" && xaiReceived.filter((x) => x.type === "response.create").length === 1) {
        ws.send(JSON.stringify({ type: "response.output_audio.delta", delta: "SGk=" }));
        ws.send(JSON.stringify({ type: "response.function_call_arguments.done", call_id: "fc1", name: "report_result",
          arguments: JSON.stringify({ status: "partial", summary: "Needs to check with the manager" }) }));
      }
    }));
    await new Promise<void>((r) => fakeXai.on("listening", () => r()));
    process.env.XAI_REALTIME_URL = `ws://localhost:${(fakeXai.address() as AddressInfo).port}`;

    server = http.createServer((_req, res) => res.end("app"));
    attachCallStreams(server);
    await new Promise<void>((r) => server.listen(0, r));
    base = `localhost:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    delete process.env.XAI_REALTIME_URL;
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await new Promise((r) => fakeXai.close(r));
  });

  test("other requests still reach the app", async () => {
    assert.equal(await (await realFetch(`http://${base}/anything`)).text(), "app");
  });

  test("status route checks the Twilio signature", async () => {
    const { callId } = await makeCall({ status: "dialing", sid: "CA1" });
    const body = new URLSearchParams({ CallSid: "CA1", CallStatus: "ringing" });
    const path = `/twilio/status?call=${callId}`;
    const post = (sig: string) => realFetch(`http://${base}${path}`, {
      method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig }
    });
    assert.equal((await post("forged")).status, 403);
    assert.equal((await callRow(callId)).status, "dialing");
    assert.equal((await post(twilioSignature("tok", `https://calls.example.dev${path}`, body))).status, 204);
    assert.equal((await callRow(callId)).status, "ringing");
  });

  test("media socket bridges Twilio to Grok and records the result", async () => {
    const { callId } = await makeCall({ status: "ringing", sid: "CA1" });
    const tw = new WebSocket(`ws://${base}/twilio/media?call=${callId}`);
    const fromBridge: any[] = [];
    tw.on("message", (d) => fromBridge.push(JSON.parse(d.toString())));
    await new Promise((r) => tw.on("open", r));
    tw.send(JSON.stringify({ event: "connected" }));
    tw.send(JSON.stringify({ event: "start", start: { streamSid: "MZ1", callSid: "CA1" } }));

    const until = async (ok: () => boolean | Promise<boolean>) => {
      for (let i = 0; i < 100 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 20));
    };
    await until(async () => (await callRow(callId)).status === "completed");
    tw.send(JSON.stringify({ event: "media", media: { track: "inbound", payload: "AAAA" } }));
    await until(() => xaiReceived.some((m) => m.type === "input_audio_buffer.append"));

    assert.deepEqual(fromBridge[0], { event: "media", streamSid: "MZ1", media: { payload: "SGk=" } });
    assert.equal((await callRow(callId)).result.status, "partial");
    assert.ok(xaiReceived.some((m) => m.type === "conversation.item.create" && m.item.call_id === "fc1"));
    assert.ok(xaiReceived.some((m) => m.type === "input_audio_buffer.append" && m.audio === "AAAA"));
    tw.close();
  });
});
