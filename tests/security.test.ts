import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "../lib/db";
import { handleCallRoutes, phoneKeyOk } from "../server/routes";
import { member, resetDb, venueAt } from "./helpers";

const env = process.env as Record<string, string | undefined>; // NODE_ENV is typed read-only
const saved = { PHONE_KEY: process.env.PHONE_KEY, NODE_ENV: process.env.NODE_ENV };
const restore = () => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete env[k]; else env[k] = v;
};

let server: http.Server;
let base = "";
before(async () => {
  server = http.createServer(async (req, res) => {
    try {
      if (!(await handleCallRoutes(req, res))) res.writeHead(404).end();
    } catch {
      res.writeHead(500).end(); // as server/index.ts does
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(resetDb);
afterEach(restore);
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await sql.end();
});

describe("phone key", () => {
  const url = (key?: string) => new URL(`http://x/phone/events${key === undefined ? "" : `?key=${key}`}`);

  test("fails closed in production when PHONE_KEY is unset", () => {
    delete process.env.PHONE_KEY;
    env.NODE_ENV = "production";
    assert.equal(phoneKeyOk(url()), false);
    assert.equal(phoneKeyOk(url("anything")), false);
  });

  test("open in dev when PHONE_KEY is unset", () => {
    delete process.env.PHONE_KEY;
    env.NODE_ENV = "development";
    assert.equal(phoneKeyOk(url()), true);
  });

  test("needs the exact key when PHONE_KEY is set", () => {
    process.env.PHONE_KEY = "s3cret";
    env.NODE_ENV = "production";
    assert.equal(phoneKeyOk(url("s3cret")), true);
    assert.equal(phoneKeyOk(url("s3cre")), false);
    assert.equal(phoneKeyOk(url("s3cret2")), false);
    assert.equal(phoneKeyOk(url()), false);
  });

  test("the phone event stream is refused without the key", async () => {
    process.env.PHONE_KEY = "s3cret";
    assert.equal((await fetch(`${base}/phone/events?key=nope`)).status, 403);
  });
});

describe("declining a ring", () => {
  async function call(twilioSid: string, status = "ringing") {
    const ada = await member("Ada", { root: true });
    const venue = await venueAt(ada, { phone: "+447700900123" });
    const [c] = await sql<{ id: string }[]>`
      insert into calls (venue_id, requested_by, starts_at, ends_at, headcount, status, twilio_sid)
      values (${venue}, ${ada}, '2026-10-29T18:30:00Z', '2026-10-29T21:30:00Z', 80, ${status}, ${twilioSid}) returning id`;
    return c!.id;
  }
  const decline = (id: string, q: string) => fetch(`${base}/phone/decline/${id}?${q}`, { method: "POST" });
  const status = async (id: string) => (await sql`select status from calls where id = ${id}`)[0]!.status;

  beforeEach(() => { process.env.PHONE_KEY = "s3cret"; });

  test("needs the phone key", async () => {
    const id = await call("virtual:tok123");
    assert.equal((await decline(id, "key=wrong&token=tok123")).status, 403);
    assert.equal(await status(id), "ringing");
  });

  test("needs the ring token", async () => {
    const id = await call("virtual:tok123");
    assert.equal((await decline(id, "key=s3cret")).status, 403);
    assert.equal((await decline(id, "key=s3cret&token=guess")).status, 403);
    assert.equal(await status(id), "ringing");
  });

  test("can't touch real Twilio calls", async () => {
    const id = await call("CA0123456789");
    assert.equal((await decline(id, "key=s3cret&token=CA0123456789")).status, 403);
    assert.equal(await status(id), "ringing");
  });

  test("rejects ids that aren't call ids", async () => {
    assert.equal((await decline("not-a-uuid", "key=s3cret&token=x")).status, 403);
  });

  test("the rung phone can decline its own call", async () => {
    const id = await call("virtual:tok123");
    assert.equal((await decline(id, "key=s3cret&token=tok123")).status, 204);
    assert.equal(await status(id), "busy");
  });
});
