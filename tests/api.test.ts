import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { sql } from "../lib/db";
import { createApp, toE164, type Email } from "../server/app";
import { parseLondonTime, whenRange } from "../server/time";
import type { ResolvedLumaEvent } from "../lib/sources/luma";
import { member, OLD_STREET, resetDb, venueAt } from "./helpers";
import { signSession } from "../lib/auth";

const sent: Email[] = [];
const dialled: string[] = [];
const lumaEvent: ResolvedLumaEvent = {
  title: "London.js October", url: "https://luma.com/ljs-oct", startsAt: "2026-10-15T17:30:00.000Z", endsAt: null,
  venueName: "Techspace Shoreditch", address: "25 Luke St, London EC2A 4DS, UK", lat: 51.5249, lng: -0.0817,
  googlePlaceId: "place-techspace", community: "London.js", hosts: [], guestCount: 95, isFree: true
};

let server: http.Server;
let base = "";
before(async () => {
  server = createApp({
    geocode: async (near) => (/old street/i.test(near) ? { ...OLD_STREET, label: "Old Street" } : null),
    resolveLuma: async (url) => (url.includes("paris") ? { ...lumaEvent, lat: 48.85, lng: 2.35, address: "Paris" } : lumaEvent),
    sendEmail: async (m) => void sent.push(m),
    placeCall: async (id) => void dialled.push(id)
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.close();
  await sql.end();
});
beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  dialled.length = 0;
  process.env.MAIL_FROM = "Mates Rates <bot@matesrates.test>";
});

async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.body ? { "content-type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

const join = async (name: string, extra: Record<string, unknown> = {}) => {
  const r = await api("POST", "/api/join", {
    body: { email: `${name.toLowerCase().replace(/\W/g, "")}@test.dev`, password: "correct-horse", display_name: name, community: "London.js", ...extra }
  });
  assert.equal(r.status, 201, r.text);
  return r.json.token as string;
};
const rootToken = async () => signSession(await member("Root", { root: true }));

describe("join, login, vouch", () => {
  test("join → pending; vouch by name → can_post", async () => {
    const root = await rootToken();
    const ada = await join("Ada Lovelace", { luma_url: "https://lu.ma/ljs-oct" });
    let me = await api("GET", "/api/me", { token: ada });
    assert.equal(me.json.can_post, false);
    assert.equal(me.json.status, "pending");

    const v = await api("POST", "/api/vouch", { token: root, body: { display_name: "ada lovelace" } });
    assert.equal(v.status, 200, v.text);
    assert.equal(v.json.can_post, true);
    me = await api("GET", "/api/me", { token: ada });
    assert.equal(me.json.can_post, true);
    assert.deepEqual(me.json.vouched_by, ["Root"]);

    const login = await api("POST", "/api/login", { body: { email: "adalovelace@test.dev", password: "correct-horse" } });
    assert.equal(login.status, 200);
    assert.ok(login.json.token);
    assert.equal((await api("POST", "/api/login", { body: { email: "adalovelace@test.dev", password: "nope" } })).status, 401);
  });

  test("duplicate email and name are refused; bad input is a 400", async () => {
    await join("Grace");
    assert.equal((await api("POST", "/api/join", { body: { email: "grace@test.dev", password: "12345678", display_name: "Other" } })).status, 409);
    assert.equal((await api("POST", "/api/join", { body: { email: "g2@test.dev", password: "12345678", display_name: "grace" } })).json.error, "name_taken");
    assert.equal((await api("POST", "/api/join", { body: { email: "nope", password: "1", display_name: "" } })).status, 400);
    assert.equal((await api("POST", "/api/join", { body: { email: "x@test.dev", password: "12345678", display_name: "X", luma_url: "https://example.com/e" } })).status, 400);
  });

  test("an unvouched member can't vouch; nobody can vouch for themselves", async () => {
    const root = await rootToken();
    const a = await join("A");
    await join("B");
    assert.equal((await api("POST", "/api/vouch", { token: a, body: { display_name: "B" } })).status, 403);
    assert.equal((await api("POST", "/api/vouch", { token: root, body: { display_name: "Root" } })).status, 400);
    assert.equal((await api("POST", "/api/vouch", { token: root, body: { display_name: "Nobody" } })).status, 404);
  });

  test("no token or a forged token is a 401", async () => {
    assert.equal((await api("GET", "/api/me")).status, 401);
    assert.equal((await api("GET", "/api/me", { token: "abc.def.ghi" })).status, 401);
  });
});

describe("venues", () => {
  test("search returns top venues with reasons and never contacts", async () => {
    const rootId = await member("Root", { root: true });
    const token = signSession(rootId);
    const id = await venueAt(rootId, { name: "Callable Hall", phone: "+447700900123" });
    await sql`insert into venue_contacts (venue_id, phone) values (${id}, '+447700900123')
              on conflict (venue_id) do update set email = 'secret@venue.test', contact_name = 'Secret Person'`;
    await sql`insert into venue_hosts (venue_id, community, event_title, event_url, event_date, attendees)
              values (${id}, 'AI Tinkerers', 'Demo night', 'https://lu.ma/demo', '2026-09-10', 70)`;
    await sql`insert into events (source, external_id, title, url, starts_at, location, attendees)
              values ('luma', 'clash-1', 'Big AI Night', 'https://lu.ma/big', '2026-10-29T18:00:00Z',
                      st_setsrid(st_makepoint(-0.088, 51.526), 4326)::geography, 300)`;

    const r = await api("GET", "/api/venues/search?near=Old%20Street&headcount=80&start=2026-10-29T18:30&end=2026-10-29T21:30", { token });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.query.when, "Thu 29 Oct, 18:30–21:30");
    assert.equal(r.json.query.start, "2026-10-29T18:30:00.000Z", "29 Oct is after clocks go back: GMT");
    const [v] = r.json.venues;
    assert.equal(v.name, "Callable Hall");
    assert.equal(v.ok_to_call, true);
    assert.ok(v.reasons.some((x: string) => /from Old Street/.test(x)));
    assert.ok(v.reasons.some((x: string) => /AI Tinkerers/.test(x)));
    assert.ok(v.reasons.some((x: string) => /Last hosted 10 Sept? 2026/.test(x)), v.reasons.join(" | "));
    assert.match(r.json.clash_warning, /Big AI Night \(300 going\)/);
    assert.ok(!/secret@venue|Secret Person|7700900123/.test(r.text), "contacts leaked");
  });

  test("search needs a known place and a headcount", async () => {
    const token = await rootToken();
    assert.equal((await api("GET", "/api/venues/search?near=Atlantis&headcount=10&start=2026-10-29T18:30", { token })).status, 422);
    assert.equal((await api("GET", "/api/venues/search?near=Old%20Street&start=2026-10-29T18:30", { token })).status, 400);
    assert.equal((await api("GET", "/api/venues/search?near=Old%20Street&headcount=10&start=2026-10-29T18:30")).status, 401);
  });

  test("an unvouched member can't add a venue from Luma; a vouched one can, and it dedupes", async () => {
    const root = await rootToken();
    const stranger = await join("Stranger");
    const blocked = await api("POST", "/api/venues/from-luma", { token: stranger, body: { url: "https://lu.ma/ljs-oct" } });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.error, "not_trusted");
    assert.equal(Number((await sql`select count(*) from venues`)[0]!.count), 0);

    const first = await api("POST", "/api/venues/from-luma", { token: root, body: { url: "https://lu.ma/ljs-oct" } });
    assert.equal(first.status, 201, first.text);
    assert.equal(first.json.created, true);
    assert.equal(first.json.venue.name, "Techspace Shoreditch");
    assert.equal(first.json.venue.past_hosts[0].community, "London.js");
    assert.equal(first.json.questions.length, 3);

    const again = await api("POST", "/api/venues/from-luma", { token: root, body: { url: "https://lu.ma/ljs-oct" } });
    assert.equal(again.status, 200);
    assert.equal(again.json.venue.id, first.json.venue.id);
    assert.equal(again.json.venue.past_hosts.length, 1);

    assert.equal((await api("POST", "/api/venues/from-luma", { token: root, body: { url: "https://lu.ma/paris" } })).status, 422);
  });

  test("PATCH saves fields with provenance, contacts privately, and confirms unchanged fields", async () => {
    const root = await rootToken();
    const { json } = await api("POST", "/api/venues/from-luma", { token: root, body: { url: "https://lu.ma/ljs-oct" } });
    const id = json.venue.id;
    const r = await api("PATCH", `/api/venues/${id}`, {
      token: root,
      body: {
        capacity: 120, av: "screen, mics", terms: "free_for_community", evening_ok: true, kind: "bookable", ok_to_call: true,
        contact: { contact_name: "Sam", contact_role: "Events", email: "sam@techspace.test", phone: "020 7946 0000" }
      }
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.venue.capacity, 120);
    assert.deepEqual(r.json.venue.av, ["screen", "mics"]);
    assert.equal(r.json.venue.can_call, true);
    assert.ok(!r.text.includes("sam@techspace.test"));
    const [c] = await sql`select phone, email from venue_contacts where venue_id = ${id}`;
    assert.equal(c!.phone, "+442079460000");
    const [log] = await sql`select confirmed_by from venue_field_status where venue_id = ${id} and field = 'capacity'`;
    assert.equal(log!.confirmed_by, "Root");

    const again = await api("PATCH", `/api/venues/${id}`, { token: root, body: { capacity: 120 } });
    assert.deepEqual(again.json.confirmed, ["capacity"]);
    const [{ n }] = await sql`select count(*)::int as n from field_log where venue_id = ${id} and field = 'capacity'`;
    assert.equal(n, 2);

    const stranger = await join("Stranger");
    assert.equal((await api("PATCH", `/api/venues/${id}`, { token: stranger, body: { capacity: 5 } })).status, 403);
    assert.equal((await api("PATCH", `/api/venues/${id}`, { token: root, body: { contact: { phone: "call me" } } })).status, 400);
  });

  test("a root's report hides the venue", async () => {
    const rootId = await member("Root", { root: true });
    const id = await venueAt(rootId);
    const r = await api("POST", `/api/venues/${id}/report`, { token: signSession(rootId), body: { reason: "fake" } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.junk, true);
  });
});

describe("requests and calls", () => {
  test("a request is emailed with Reply-To and CC set to the organiser", async () => {
    const rootId = await member("Root", { root: true });
    const id = await venueAt(rootId);
    await sql`insert into venue_contacts (venue_id, email) values (${id}, 'venue@test.dev')`;
    const r = await api("POST", "/api/requests", {
      token: signSession(rootId),
      body: { venue_id: id, start: "2026-10-29T18:30", end: "2026-10-29T21:30", headcount: 80, message: "Hi! Could we host London.js?" }
    });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.status, "sent");
    assert.equal(sent.length, 1);
    const mail = sent[0]!;
    assert.deepEqual(mail.to, ["venue@test.dev"]);
    assert.equal(mail.reply_to, mail.cc[0]);
    assert.match(mail.reply_to, /^root\d*@test\.dev$/);
    assert.match(mail.subject, /80 people, Thu 29 Oct, 18:30–21:30/);
    assert.ok(!r.text.includes("venue@test.dev"));
    const [row] = await sql`select status, sent_at from requests where id = ${r.json.request_id}`;
    assert.equal(row!.status, "sent");
  });

  test("no contact email → kept as a draft", async () => {
    const rootId = await member("Root", { root: true });
    const id = await venueAt(rootId);
    const r = await api("POST", "/api/requests", {
      token: signSession(rootId), body: { venue_id: id, start: "2026-10-29T18:30", headcount: 80, message: "Hi" }
    });
    assert.equal(r.json.status, "draft");
    assert.equal(r.json.reason, "no_contact_email");
    assert.equal(sent.length, 0);
  });

  test("a call is queued and handed to the dialler once; the second organiser joins it", async () => {
    const rootId = await member("Root", { root: true });
    const id = await venueAt(rootId, { phone: "+447700900123" });
    const body = { venue_id: id, start: "2026-10-29T18:30", end: "2026-10-29T21:30", headcount: 80, event_title: "Meetup" };
    const r = await api("POST", "/api/calls", { token: signSession(rootId), body });
    assert.equal(r.status, 202, r.text);
    assert.equal(r.json.outcome, "new");
    assert.deepEqual(dialled, [r.json.call_id]);
    const again = await api("POST", "/api/calls", { token: signSession(rootId), body });
    assert.equal(again.json.outcome, "in_progress");
    assert.equal(dialled.length, 1);
    const status = await api("GET", `/api/calls/${r.json.call_id}`, { token: signSession(rootId) });
    assert.equal(status.json.status, "queued");
    assert.equal(status.json.done, false);
  });

  test("a venue not marked OK to call is refused with not_ok_to_call", async () => {
    const rootId = await member("Root", { root: true });
    const id = await venueAt(rootId, { ok_to_call: false, phone: "+447700900123" });
    const r = await api("POST", "/api/calls", { token: signSession(rootId), body: { venue_id: id, start: "2026-10-29T18:30", headcount: 80 } });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "not_ok_to_call");
  });
});

describe("public feeds", () => {
  const seedEvent = () => sql`
    insert into events (source, external_id, title, url, starts_at, ends_at, venue_name, community, attendees, is_free, tags)
    values ('luma', 'e1', 'Hack Night, London', 'https://lu.ma/hack', now() + interval '2 days', now() + interval '2 days 3 hours',
            'Techspace', 'London.js', 120, true, '{hackathon}'),
           ('luma', 'old', 'Old thing', 'https://lu.ma/old', now() - interval '3 days', null, null, 'London.js', 10, true, '{}')`;

  test("events.ics is a valid calendar with upcoming events only", async () => {
    await seedEvent();
    const r = await api("GET", "/events.ics");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type")!, /^text\/calendar/);
    assert.ok(r.text.startsWith("BEGIN:VCALENDAR\r\n") && r.text.endsWith("END:VCALENDAR\r\n"));
    assert.equal(r.text.match(/BEGIN:VEVENT/g)?.length, 1);
    assert.match(r.text, /SUMMARY:Hack Night\\, London/);
    for (const line of r.text.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75);
  });

  test("events, stats and communities", async () => {
    await seedEvent();
    const ev = await api("GET", "/api/events?limit=5");
    assert.equal(ev.json.events.length, 1);
    assert.ok(ev.json.events[0].reasons.includes("Hackathon"));
    assert.match(ev.json.webcal_url, /^webcal:\/\/.*\/events\.ics$/);
    const stats = await api("GET", "/api/stats");
    assert.deepEqual(stats.json, { venues: 0, communities: 1, events: 1, hosts: 0 });
    const token = await rootToken();
    const c = await api("GET", "/api/communities?q=hack", { token });
    assert.equal(c.status, 200, c.text);
    assert.equal(c.json.communities[0].name, "London.js");
    assert.equal(c.json.communities[0].upcoming_events, 1);
    assert.equal(c.json.communities[0].past_events, 1);
    assert.equal((await api("GET", "/api/communities")).status, 401);
  });
});

describe("helpers", () => {
  test("London wall-clock times respect the 25 Oct clock change", () => {
    assert.equal(parseLondonTime("2026-10-22T18:30")!.toISOString(), "2026-10-22T17:30:00.000Z");
    assert.equal(parseLondonTime("2026-10-29T18:30")!.toISOString(), "2026-10-29T18:30:00.000Z");
    assert.equal(parseLondonTime("2026-10-29T18:30:00+00:00")!.toISOString(), "2026-10-29T18:30:00.000Z");
    assert.equal(parseLondonTime("next thursday"), null);
    assert.equal(whenRange(new Date("2026-10-22T17:30:00Z"), new Date("2026-10-22T20:30:00Z")), "Thu 22 Oct, 18:30–21:30");
  });

  test("phone numbers normalise to E.164", () => {
    assert.equal(toE164("07700 900123"), "+447700900123");
    assert.equal(toE164("+44 (0)20 7946 0000"), "+442079460000");
    assert.equal(toE164("call me"), null);
    assert.equal(toE164("020 7946 0000"), "+442079460000");
    assert.equal(toE164("0044 20 7946 0000"), "+442079460000");
  });
});
