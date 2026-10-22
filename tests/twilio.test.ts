// Twilio mode end to end with a fake Twilio API (mocked fetch), a fake Grok
// realtime socket and a fake Twilio media stream.
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";

// Fake Grok voice. `onForce` decides what it says once the agent has opened the call.
let onForce: (ws: WebSocket) => void = () => {};
const xaiGot: any[] = [];
const fakeXai = new WebSocketServer({ port: 0 });
fakeXai.on("connection", (ws) => ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  xaiGot.push(m);
  if (m.type === "session.update") ws.send(JSON.stringify({ type: "session.updated" }));
  if (m.type === "conversation.item.create" && m.item?.type === "force_message") onForce(ws);
}));
await new Promise((r) => fakeXai.on("listening", r));

Object.assign(process.env, {
  CALL_MODE: "twilio", TWILIO_ACCOUNT_SID: "ACtest", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+15005550006",
  PUBLIC_URL: "https://calls.example.dev", XAI_API_KEY: "xai-test", CALL_GOODBYE_MS: "300",
  XAI_REALTIME_URL: `ws://127.0.0.1:${(fakeXai.address() as AddressInfo).port}`
});

type Sent = { url: string; body: URLSearchParams };
let sent: Sent[] = [];
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  sent.push({ url: String(url), body: new URLSearchParams(typeof init?.body === "string" || init?.body instanceof URLSearchParams ? init.body : "") });
  return Response.json({ sid: "CA123" }, { status: 201 });
}) as typeof fetch;

const { sql } = await import("../lib/db");
const { placeCall } = await import("../lib/dialer");
const { handleCallRoutes } = await import("../server/routes");
const { attachMediaStream } = await import("../server/bridge");
const { member, resetDb, venueAt } = await import("./helpers");

let server: http.Server;
let base = "";
before(async () => {
  server = http.createServer(async (req, res) => {
    try {
      if (!(await handleCallRoutes(req, res))) res.writeHead(404).end();
    } catch {
      res.writeHead(500).end();
    }
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => attachMediaStream(ws)));
  await new Promise<void>((r) => server.listen(0, r));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  await resetDb();
  sent = [];
  xaiGot.length = 0;
  onForce = () => {};
  process.env.TWILIO_FROM = "+15005550006";
});
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await new Promise((r) => fakeXai.close(r));
  await sql.end();
});

async function makeCall(status = "queued", sid: string | null = null) {
  const ada = await member("Ada", { root: true });
  const venue = await venueAt(ada, { name: "Shoreditch Works", phone: "+447700900123" });
  const [c] = await sql<{ id: string }[]>`
    insert into calls (venue_id, requested_by, starts_at, ends_at, headcount, status, twilio_sid)
    values (${venue}, ${ada}, '2026-10-29T18:30:00Z', '2026-10-29T21:30:00Z', 80, ${status}, ${sid}) returning id`;
  return c!.id;
}
const row = async (id: string) => (await sql<any[]>`select * from calls where id = ${id}`)[0];
const sign = (url: string, form: Record<string, string>) =>
  createHmac("sha1", "tok").update(url + Object.keys(form).sort().map((k) => k + form[k]).join("")).digest("base64");
const twilioPost = (path: string, form: Record<string, string>, sig = sign(`https://calls.example.dev${path}`, form)) =>
  fetchReal(`http://${base}${path}`, { method: "POST", body: new URLSearchParams(form), headers: { "x-twilio-signature": sig } });
const until = async (ok: () => Promise<boolean> | boolean, ms = 5000) => {
  for (const end = Date.now() + ms; !(await ok());) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};
// Requests to our own test server must bypass the fetch mock.
const fetchReal: typeof fetch = (url, init) => new Promise((resolve, reject) => {
  const u = new URL(String(url));
  const body = init?.body ? String(init.body) : "";
  const req = http.request(u, { method: init?.method ?? "GET", headers: { ...(init?.headers as Record<string, string>), "content-type": "application/x-www-form-urlencoded" } }, (res) => {
    res.resume();
    res.on("end", () => resolve(new Response(null, { status: res.statusCode })));
  });
  req.on("error", reject);
  req.end(body);
});

describe("dialing", () => {
  test("asks Twilio for async voicemail detection, from TWILIO_FROM", async () => {
    const id = await makeCall();
    await placeCall(id);
    const call = sent.find((s) => s.url.endsWith("/Accounts/ACtest/Calls.json"))!;
    assert.equal(call.body.get("From"), "+15005550006");
    assert.equal(call.body.get("To"), "+447700900123");
    assert.equal(call.body.get("MachineDetection"), "Enable");
    assert.equal(call.body.get("AsyncAmd"), "true");
    assert.equal(call.body.get("AsyncAmdStatusCallback"), `https://calls.example.dev/twilio/amd/${id}`);
    const r = await row(id);
    assert.equal(r.status, "dialing");
    assert.equal(r.twilio_sid, "CA123");
  });

  test("falls back to TWILIO_PHONE_NUMBER", async () => {
    delete process.env.TWILIO_FROM;
    process.env.TWILIO_PHONE_NUMBER = "+15005550007";
    await placeCall(await makeCall());
    assert.equal(sent[0]!.body.get("From"), "+15005550007");
    delete process.env.TWILIO_PHONE_NUMBER;
  });
});

describe("Twilio callbacks", () => {
  test("status callbacks need a valid signature", async () => {
    const id = await makeCall("dialing", "CA1");
    assert.equal((await twilioPost(`/twilio/status/${id}`, { CallSid: "CA1", CallStatus: "ringing" }, "forged")).status, 403);
    assert.equal((await row(id)).status, "dialing");
    assert.equal((await twilioPost(`/twilio/status/${id}`, { CallSid: "CA1", CallStatus: "ringing" })).status, 204);
    assert.equal((await row(id)).status, "ringing");
  });

  test("voicemail: no_answer, hang up, and a late 'completed' doesn't change it", async () => {
    const id = await makeCall("in_progress", "CA1");
    assert.equal((await twilioPost(`/twilio/amd/${id}`, { CallSid: "CA1", AnsweredBy: "machine_start" })).status, 204);
    const r = await row(id);
    assert.equal(r.status, "no_answer");
    assert.match(r.error, /machine_start/);
    const hang = sent.find((s) => s.url.endsWith("/Calls/CA1.json"));
    assert.equal(hang?.body.get("Status"), "completed");
    await twilioPost(`/twilio/status/${id}`, { CallSid: "CA1", CallStatus: "completed" });
    assert.equal((await row(id)).status, "no_answer");
  });

  test("a person answering changes nothing", async () => {
    const id = await makeCall("in_progress", "CA1");
    await twilioPost(`/twilio/amd/${id}`, { CallSid: "CA1", AnsweredBy: "human" });
    assert.equal((await row(id)).status, "in_progress");
    assert.equal(sent.length, 0);
  });
});

describe("media bridge (twilio mode)", () => {
  async function stream(id: string) {
    const tw = new WebSocket(`ws://${base}/twilio/stream`);
    await new Promise((r) => tw.on("open", r));
    tw.send(JSON.stringify({ event: "start", start: { streamSid: "MZ1", callSid: "CA1", customParameters: { callId: id } } }));
    return tw;
  }

  test("uses the cookbook session settings with Leo", async () => {
    const id = await makeCall("in_progress", "CA1");
    const tw = await stream(id);
    await until(() => xaiGot.some((m) => m.type === "session.update"));
    const s = xaiGot.find((m) => m.type === "session.update").session;
    assert.equal(s.voice, "leo");
    assert.equal(s.audio.input.format.type, "audio/pcmu");
    assert.equal(s.audio.output.format.type, "audio/pcmu");
    assert.equal(s.turn_detection.type, "server_vad");
    assert.match(s.instructions, /natural London accent/);
    assert.match(s.instructions, /Never claim to be human/);
    tw.close();
  });

  test("saves the answer and hangs up even if the agent never calls end_call", async () => {
    onForce = (ws) => ws.send(JSON.stringify({
      type: "response.function_call_arguments.done", call_id: "fc1", name: "record_availability",
      arguments: JSON.stringify({ status: "available", price: "Free for community groups", contact_name: "Sam" })
    }));
    const id = await makeCall("in_progress", "CA1");
    const tw = await stream(id);
    await until(async () => (await sql`select 1 from availability where call_id = ${id}`).length === 1);
    assert.equal((await row(id)).result.status, "available");
    await until(() => sent.some((s) => s.url.endsWith("/Calls/CA1.json") && s.body.get("Status") === "completed"));
    tw.close();
  });

  test("a voicemail greeting is never turned into an answer", async () => {
    onForce = (ws) => {
      ws.send(JSON.stringify({ type: "response.output_audio_transcript.done", item_id: "a1", transcript: "Hi, I'm an assistant calling on behalf of Ada." }));
      ws.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "v1", transcript: "You've reached Shoreditch Works, leave a message." }));
    };
    const id = await makeCall("in_progress", "CA1");
    const tw = await stream(id);
    await until(async () => (await row(id)).transcript.length === 2);
    await twilioPost(`/twilio/amd/${id}`, { CallSid: "CA1", AnsweredBy: "machine_end_beep" });
    tw.close();
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(sent.filter((s) => s.url.includes("api.x.ai")).length, 0, "no transcript extraction");
    assert.equal((await sql`select 1 from availability where call_id = ${id}`).length, 0);
    assert.equal((await row(id)).status, "no_answer");
  });
});
