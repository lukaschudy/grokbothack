// End-to-end Twilio call to your own phone through roomline's dialer and bridge.
//   npx tsx --env-file=.env.local scripts/test-call.ts
// Needs XAI_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (or TWILIO_PHONE_NUMBER), TEST_PHONE.
// Starts a bare server on PORT (8787) with the /twilio routes and media stream, opens a
// cloudflared quick tunnel (TUNNEL=ssh uses localhost.run) unless PUBLIC_URL is set, seeds a
// throwaway venue with TEST_PHONE, places the call, prints what happened, then deletes the
// test data (KEEP=1 keeps it). Refuses non-local databases unless ALLOW_REMOTE_DB=1.

import { spawn } from "node:child_process";
import http from "node:http";
import { WebSocketServer } from "ws";
import { sql } from "../lib/db";
import { placeCall } from "../lib/dialer";
import { attachMediaStream } from "../server/bridge";
import { handleCallRoutes } from "../server/routes";

const phone = process.env.TEST_PHONE;
if (!phone) throw new Error("TEST_PHONE is not set");
const dbHost = new URL(process.env.DATABASE_URL ?? "postgres://localhost").hostname;
if (!["localhost", "127.0.0.1"].includes(dbHost) && process.env.ALLOW_REMOTE_DB !== "1") {
  throw new Error(`DATABASE_URL points at ${dbHost}; set ALLOW_REMOTE_DB=1 to seed a test venue there`);
}
process.env.CALL_MODE = "twilio";
const port = Number(process.env.PORT ?? 8787);

const server = http.createServer(async (req, res) => {
  try {
    if (!(await handleCallRoutes(req, res))) res.writeHead(404).end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500).end();
  }
});
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (new URL(req.url ?? "/", "http://x").pathname === "/twilio/stream") wss.handleUpgrade(req, socket, head, (ws) => attachMediaStream(ws));
  else socket.destroy();
});
await new Promise<void>((r) => server.listen(port, r));
console.log(`server on :${port}`);

let tunnel: ReturnType<typeof spawn> | null = null;
if (!process.env.PUBLIC_URL) {
  const ssh = process.env.TUNNEL === "ssh";
  tunnel = ssh
    ? spawn("ssh", ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "ServerAliveInterval=15", "-R", `80:localhost:${port}`, "nokey@localhost.run"], { stdio: ["ignore", "pipe", "pipe"] })
    : spawn("cloudflared", ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", `http://localhost:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  const pattern = ssh ? /https:\/\/[a-z0-9]+\.lhr\.life/ : /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
  process.env.PUBLIC_URL = await new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no tunnel URL after 30s")), 30_000);
    const scan = (d: Buffer) => {
      const m = d.toString().match(pattern);
      if (m) { clearTimeout(t); resolve(m[0]); }
    };
    tunnel!.on("error", reject);
    tunnel!.stdout!.on("data", scan);
    tunnel!.stderr!.on("data", scan);
  });
  // Wait until the tunnel actually routes to us (our server 404s unknown paths).
  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    up = await fetch(`${process.env.PUBLIC_URL}/health`).then((r) => r.status === 404).catch(() => false);
    if (!up) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!up) {
    tunnel.kill();
    throw new Error(`tunnel ${process.env.PUBLIC_URL} is not reachable${ssh ? "" : "; if cloudflared can't reach the edge, retry with TUNNEL=ssh"}`);
  }
}
console.log(`public url ${process.env.PUBLIC_URL}`);

const [acct] = await sql<{ id: string }[]>`
  insert into accounts (email, password_hash) values (${`call-test-${Date.now()}@test.dev`}, 'x') returning id`;
await sql`insert into profiles (id, display_name, community, is_root) values (${acct!.id}, 'Lukas', 'London AI Hackers', true)`;
const [venue] = await sql<{ id: string }[]>`
  insert into venues (name, capacity, kind, ok_to_call, terms, created_by)
  values ('Test Hall Shoreditch', 120, 'bookable', true, 'unknown', ${acct!.id}) returning id`;
await sql`insert into venue_contacts (venue_id, phone) values (${venue!.id}, ${phone})`;
const [call] = await sql<{ id: string }[]>`
  insert into calls (venue_id, requested_by, starts_at, ends_at, headcount, event_title)
  values (${venue!.id}, ${acct!.id}, '2026-10-29 18:30 Europe/London', '2026-10-29 21:30 Europe/London', 80, 'AI Hack Night')
  returning id`;
const callId = call!.id;

let code = 0;
try {
  await placeCall(callId);
  console.log(`dialing ${phone.slice(0, 4)}… call ${callId}`);
  let last = "";
  for (let i = 0; i < 150; i++) {
    const [c] = await sql<{ status: string; ended_at: Date | null }[]>`select status, ended_at from calls where id = ${callId}`;
    if (c!.status !== last) console.log(`status: ${(last = c!.status)}`);
    if (c!.ended_at) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  await new Promise((r) => setTimeout(r, 3000)); // last transcript lines and fallback extraction
  const [c] = await sql`select status, twilio_sid, answered_at, ended_at, error, result, transcript from calls where id = ${callId}`;
  const avail = await sql`select status, price_note, conditions, confirmed_by_name, source from availability where call_id = ${callId}`;
  console.log(JSON.stringify({ call: c, availability: avail }, null, 2));
} catch (e) {
  code = 1;
  console.error("call failed:", (e as Error).message);
} finally {
  if (process.env.KEEP !== "1") await sql`delete from venues where id = ${venue!.id}`.then(() => sql`delete from accounts where id = ${acct!.id}`);
  tunnel?.kill();
  server.close();
  await sql.end();
  process.exit(code);
}
