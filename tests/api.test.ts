// Route tests for the Grok Bot JSON API (app/api/**). Handlers are called directly with Web Requests.
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "../lib/db";
import { signSession } from "../lib/auth";
import type { ResolvedLumaEvent } from "../lib/sources/luma";
import { deps, parseLondonTime, toE164, type Email } from "../app/api/_lib/http";
import * as join from "../app/api/join/route";
import * as login from "../app/api/login/route";
import * as me from "../app/api/me/route";
import * as vouch from "../app/api/vouch/route";
import * as search from "../app/api/venues/search/route";
import * as fromLuma from "../app/api/venues/from-luma/route";
import * as venue from "../app/api/venues/[id]/route";
import * as report from "../app/api/venues/[id]/report/route";
import * as requests from "../app/api/requests/route";
import * as calls from "../app/api/calls/route";
import * as callById from "../app/api/calls/[id]/route";
import * as events from "../app/api/events/route";
import * as communities from "../app/api/communities/route";
import * as stats from "../app/api/stats/route";
import { member, OLD_STREET, resetDb, venueAt } from "./helpers";

const sent: Email[] = [];
const dialled: string[] = [];
const lumaEvent: ResolvedLumaEvent = {
  title: "London.js October", url: "https://luma.com/ljs-oct", startsAt: "2026-10-15T17:30:00.000Z", endsAt: null,
  venueName: "Techspace Shoreditch", address: "25 Luke St, London EC2A 4DS, UK", lat: 51.5249, lng: -0.0817,
  googlePlaceId: "place-techspace", community: "London.js", hosts: [], guestCount: 95, isFree: true
};
deps.geocode = async (near) => (/old street/i.test(near) ? { name: "Old Street", ...OLD_STREET } : null);
deps.resolveLuma = async (url) => (url.includes("paris") ? { ...lumaEvent, lat: 48.85, lng: 2.35, address: "Paris" } : lumaEvent);
deps.sendEmail = async (m) => void sent.push(m);
deps.emailConfigured = () => true;
deps.placeCall = async (id) => void dialled.push(id);
process.env.MAIL_FROM = "Mates Rates <bot@matesrates.test>";

after(() => sql.end());
beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  dialled.length = 0;
});

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
async function api(handler: unknown, method: string, path: string, opts: { token?: string; body?: unknown; id?: string } = {}) {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), "content-type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const res = await (handler as Handler)(req, { params: Promise.resolve({ id: opts.id ?? "" }) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

const joinAs = async (name: string, extra: Record<string, unknown> = {}) => {
  const r = await api(join.POST, "POST", "/api/join", {
    body: { email: `${name.toLowerCase().replace(/\W/g, "")}@test.dev`, password: "correct-horse", display_name: name, community: "London.js", ...extra }
  });
  assert.equal(r.status, 201, r.text);
  return r.json.token as string;
};
const rootToken = async () => signSession(await member("Root", { root: true }));

describe("join, login, vouch", () => {
  test("join → pending; a member vouches by name → can_post", async () => {
    const root = await rootToken();
    const ada = await joinAs("Ada Lovelace", { luma_url: "https://lu.ma/ljs-oct" });
    let m = await api(me.GET, "GET", "/api/me", { token: ada });
    assert.equal(m.json.can_post, false);
    assert.equal(m.json.status, "pending");

    const v = await api(vouch.POST, "POST", "/api/vouch", { token: root, body: { display_name: "ada lovelace" } });
    assert.equal(v.status, 200, v.text);
    assert.equal(v.json.can_post, true);
    m = await api(me.GET, "GET", "/api/me", { token: ada });
    assert.equal(m.json.can_post, true);
    assert.deepEqual(m.json.vouched_by, ["Root"]);

    const ok = await api(login.POST, "POST", "/api/login", { body: { email: "adalovelace@test.dev", password: "correct-horse" } });
    assert.equal(ok.status, 200);
    assert.ok(ok.json.token);
    assert.equal((await api(login.POST, "POST", "/api/login", { body: { email: "adalovelace@test.dev", password: "nope" } })).status, 401);
  });

  test("duplicate email and name are refused; bad input is a 400", async () => {
    await joinAs("Grace");
    const j = (body: unknown) => api(join.POST, "POST", "/api/join", { body });
    assert.equal((await j({ email: "grace@test.dev", password: "12345678", display_name: "Other" })).json.error, "email_taken");
    assert.equal((await j({ email: "g2@test.dev", password: "12345678", display_name: "grace" })).json.error, "name_taken");
    assert.equal((await j({ email: "nope", password: "1", display_name: "" })).status, 400);
    assert.equal((await j({ email: "x@test.dev", password: "12345678", display_name: "X", luma_url: "https://example.com/e" })).status, 400);
  });

  test("unvouched members can't vouch; no self-vouch; a partial name never vouches", async () => {
    const root = await rootToken();
    const a = await joinAs("A");
    await joinAs("B");
    await joinAs("Samantha");
    const v = (token: string, display_name: string) => api(vouch.POST, "POST", "/api/vouch", { token, body: { display_name } });
    assert.equal((await v(a, "B")).status, 403);
    assert.equal((await v(root, "Root")).status, 400);
    const fuzzy = await v(root, "Sam");
    assert.equal(fuzzy.status, 404);
    assert.equal(fuzzy.json.did_you_mean[0].display_name, "Samantha");
  });

  test("no token or a forged token is a 401", async () => {
    assert.equal((await api(me.GET, "GET", "/api/me")).status, 401);
    assert.equal((await api(me.GET, "GET", "/api/me", { token: "abc.def.ghi" })).status, 401);
  });
});

describe("venues", () => {
  test("search returns venues with reasons and a clash, and never contacts", async () => {
    const rootId = await member("Root", { root: true });
    const id = await venueAt(rootId, { name: "Callable Hall", phone: "+447700900123" });
    await sql`update venue_contacts set email = 'secret@venue.test', contact_name = 'Secret Person' where venue_id = ${id}`;
    await sql`insert into venue_hosts (venue_id, community, event_title, event_url, event_date, attendees)
              values (${id}, 'AI Tinkerers', 'Demo night', 'https://lu.ma/demo', '2026-09-10', 70)`;
    await sql`insert into events (source, external_id, title, url, starts_at, location, attendees)
              values ('luma', 'clash-1', 'Big AI Night', 'https://lu.ma/big', '2026-10-29T18:00:00Z',
                      st_setsrid(st_makepoint(-0.088, 51.526), 4326)::geography, 300)`;
    const r = await api(search.GET, "GET", "/api/venues/search?near=Old%20Street&headcount=80&start=2026-10-29T18:30&end=2026-10-29T21:30", { token: signSession(rootId) });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.query.when, "Thu 29 Oct, 18:30–21:30");
    assert.equal(r.json.query.start, "2026-10-29T18:30:00.000Z", "29 Oct is after the clocks go back: GMT");
    const [v] = r.json.venues;
    assert.equal(v.name, "Callable Hall");
    assert.equal(v.ok_to_call, true);
    assert.ok(v.reasons.some((x: string) => /from Old Street/.test(x)), v.reasons.join(" | "));
    assert.ok(v.reasons.some((x: string) => /AI Tinkerers/.test(x)));
    assert.ok(v.reasons.some((x: string) => /Last hosted 10 Sept? 2026/.test(x)), v.reasons.join(" | "));
    assert.ok(v.reasons.includes("Biggest turnout seen: 70"));
    assert.match(r.json.clash_warning, /Big AI Night \(300 going\)/);
    assert.ok(!/secret@venue|Secret Person|7700900123/.test(r.text), "contacts leaked");
  });

  test("search needs a known place, a headcount and a token", async () => {
    const token = await rootToken();
    const s = (q: string, t?: string) => api(search.GET, "GET", `/api/venues/search?${q}`, { token: t });
    assert.equal((await s("near=Atlantis&headcount=10&start=2026-10-29T18:30", token)).status, 422);
    assert.equal((await s("near=Old%20Street&start=2026-10-29T18:30", token)).status, 400);
    assert.equal((await s("near=Old%20Street&headcount=10&start=next%20thursday", token)).status, 400);
    assert.equal((await s("near=Old%20Street&headcount=10&start=2026-10-29T18:30")).status, 401);
  });

  test("an unvouched member can't add a venue from Luma; a vouched one can, and it dedupes", async () => {
    const root = await rootToken();
    const stranger = await joinAs("Stranger");
    const add = (token: string, url: string) => api(fromLuma.POST, "POST", "/api/venues/from-luma", { token, body: { url } });
    const blocked = await add(stranger, "https://lu.ma/ljs-oct");
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.error, "not_trusted");
    assert.equal(Number((await sql`select count(*) from venues`)[0]!.count), 0);

    const first = await add(root, "https://lu.ma/ljs-oct");
    assert.equal(first.status, 201, first.text);
    assert.equal(first.json.venue.name, "Techspace Shoreditch");
    assert.equal(first.json.venue.past_hosts[0].community, "London.js");
    assert.equal(first.json.questions.length, 3);
    const again = await add(root, "https://lu.ma/ljs-oct");
    assert.equal(again.status, 200);
    assert.equal(again.json.venue.id, first.json.venue.id);
    assert.equal(again.json.venue.past_hosts.length, 1);
    assert.equal((await add(root, "https://lu.ma/paris")).json.error, "not_london");
  });

  test("PATCH saves fields with provenance and contacts privately; unchanged fields are re-confirmed", async () => {
    const root = await rootToken();
    const { json } = await api(fromLuma.POST, "POST", "/api/venues/from-luma", { token: root, body: { url: "https://lu.ma/ljs-oct" } });
    const id = json.venue.id;
    const patch = (token: string, body: unknown) => api(venue.PATCH, "PATCH", `/api/venues/${id}`, { token, body, id });
    const r = await patch(root, {
      capacity: 120, av: "screen, mics", terms: "free_for_community", evening_ok: true, kind: "bookable", ok_to_call: true,
      contact: { contact_name: "Sam", contact_role: "Events", email: "sam@techspace.test", phone: "020 7946 0000" }
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.venue.capacity, 120);
    assert.deepEqual(r.json.venue.av, ["screen", "mics"]);
    assert.equal(r.json.venue.can_call, true);
    assert.ok(!r.text.includes("sam@techspace.test"));
    assert.equal((await sql`select phone from venue_contacts where venue_id = ${id}`)[0]!.phone, "+442079460000");
    assert.equal((await sql`select confirmed_by from venue_field_status where venue_id = ${id} and field = 'capacity'`)[0]!.confirmed_by, "Root");

    const again = await patch(root, { capacity: 120 });
    assert.deepEqual(again.json.confirmed, ["capacity"]);
    assert.equal((await sql`select count(*)::int as n from field_log where venue_id = ${id} and field = 'capacity'`)[0]!.n, 2);

    assert.equal((await patch(await joinAs("Stranger"), { capacity: 5 })).status, 403);
    assert.equal((await patch(root, { contact: { phone: "call me" } })).status, 400);
    assert.equal((await patch(root, { terms: "cheap" })).status, 400);
  });

  test("a root's report hides the venue", async () => {
    const rootId = await member("Root", { root: true });
    const id = await venueAt(rootId);
    const r = await api(report.POST, "POST", `/api/venues/${id}/report`, { token: signSession(rootId), body: { reason: "fake" }, id });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.junk, true);
  });
});

describe("requests and calls", () => {
  test("a request is emailed with Reply-To and CC set to the organiser", async () => {
    const rootId = await member("Root", { root: true });
    const id = await venueAt(rootId);
    await sql`insert into venue_contacts (venue_id, email) values (${id}, 'venue@test.dev')`;
    const r = await api(requests.POST, "POST", "/api/requests", {
      token: signSession(rootId),
      body: { venue_id: id, start: "2026-10-29T18:30", end: "2026-10-29T21:30", headcount: 80, message: "Hi! Could we host London.js?" }
    });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.status, "sent");
    const mail = sent[0]!;
    assert.deepEqual(mail.to, ["venue@test.dev"]);
    assert.equal(mail.reply_to, mail.cc[0]);
    assert.match(mail.reply_to, /^root\d*@test\.dev$/);
    assert.match(mail.subject, /80 people, Thu 29 Oct, 18:30–21:30/);
    assert.ok(!r.text.includes("venue@test.dev"));
    assert.equal((await sql`select status from requests where id = ${r.json.request_id}`)[0]!.status, "sent");
  });

  test("no contact email, or email not configured → kept as a draft", async () => {
    const rootId = await member("Root", { root: true });
    const id = await venueAt(rootId);
    const send = () => api(requests.POST, "POST", "/api/requests", {
      token: signSession(rootId), body: { venue_id: id, start: "2026-10-29T18:30", headcount: 80, message: "Hi" }
    });
    assert.equal((await send()).json.reason, "no_contact_email");
    await sql`insert into venue_contacts (venue_id, email) values (${id}, 'venue@test.dev')`;
    deps.emailConfigured = () => false;
    try {
      const r = await send();
      assert.equal(r.json.status, "draft");
      assert.equal(r.json.reason, "email_not_configured");
    } finally {
      deps.emailConfigured = () => true;
    }
    assert.equal(sent.length, 0);
  });

  test("an unvouched member can't send a request", async () => {
    const rootId = await member("Root", { root: true });
    const id = await venueAt(rootId);
    const r = await api(requests.POST, "POST", "/api/requests", {
      token: await joinAs("Stranger"), body: { venue_id: id, start: "2026-10-29T18:30", headcount: 80, message: "Hi" }
    });
    assert.equal(r.status, 403);
  });

  test("a call is handed to the dialler once; the next organiser joins it", async () => {
    const rootId = await member("Root", { root: true });
    const id = await venueAt(rootId, { phone: "+447700900123" });
    const body = { venue_id: id, start: "2026-10-29T18:30", end: "2026-10-29T21:30", headcount: 80, event_title: "Meetup" };
    const r = await api(calls.POST, "POST", "/api/calls", { token: signSession(rootId), body });
    assert.equal(r.status, 202, r.text);
    assert.equal(r.json.outcome, "new");
    assert.deepEqual(dialled, [r.json.call_id]);
    const again = await api(calls.POST, "POST", "/api/calls", { token: signSession(rootId), body });
    assert.equal(again.json.outcome, "in_progress");
    assert.equal(dialled.length, 1);
    const s = await api(callById.GET, "GET", `/api/calls/${r.json.call_id}`, { token: signSession(rootId), id: r.json.call_id });
    assert.equal(s.json.status, "queued");
    assert.equal(s.json.done, false);
    assert.equal(s.json.when, "Thu 29 Oct, 18:30–21:30");
  });

  test("a venue not marked OK to call is refused with not_ok_to_call", async () => {
    const rootId = await member("Root", { root: true });
    const id = await venueAt(rootId, { ok_to_call: false, phone: "+447700900123" });
    const r = await api(calls.POST, "POST", "/api/calls", { token: signSession(rootId), body: { venue_id: id, start: "2026-10-29T18:30", headcount: 80 } });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "not_ok_to_call");
  });
});

describe("public feeds and communities", () => {
  const seedEvents = () => sql`
    insert into events (source, external_id, title, url, starts_at, ends_at, venue_name, community, attendees, is_free, tags, score, reasons)
    values ('luma', 'e1', 'Hack Night, London', 'https://lu.ma/hack', now() + interval '2 days', now() + interval '2 days 3 hours',
            'Techspace', 'London.js', 120, true, '{hackathon}', 5, '{Hackathon,Free}'),
           ('luma', 'old', 'Old thing', 'https://lu.ma/old', now() - interval '3 days', null, null, 'London.js', 10, true, '{}', 1, '{}')`;

  test("events, stats and communities", async () => {
    await seedEvents();
    const ev = await api(events.GET, "GET", "/api/events?limit=5");
    assert.equal(ev.json.events.length, 1);
    assert.ok(ev.json.events[0].reasons.includes("Hackathon"));
    assert.match(ev.json.webcal_url, /^webcal:\/\/.*\/events\.ics$/);
    assert.deepEqual((await api(stats.GET, "GET", "/api/stats")).json, { venues: 0, communities: 1, events: 1, hosts: 0 });

    const token = await rootToken();
    const c = await api(communities.GET, "GET", "/api/communities?q=hack", { token });
    assert.equal(c.status, 200, c.text);
    assert.equal(c.json.communities[0].name, "London.js");
    assert.equal(c.json.communities[0].upcoming_events, 1);
    assert.equal(c.json.communities[0].past_events, 1);
    assert.equal((await api(communities.GET, "GET", "/api/communities?q=ondo", { token })).json.communities.length, 0, "words, not substrings");
    assert.equal((await api(communities.GET, "GET", "/api/communities?q=lond", { token })).json.communities.length, 1);
    assert.equal((await api(communities.GET, "GET", "/api/communities")).status, 401);
  });
});

describe("helpers", () => {
  test("London wall-clock times respect the 25 Oct clock change", () => {
    assert.equal(parseLondonTime("2026-10-22T18:30")!.toISOString(), "2026-10-22T17:30:00.000Z");
    assert.equal(parseLondonTime("2026-10-29T18:30")!.toISOString(), "2026-10-29T18:30:00.000Z");
    assert.equal(parseLondonTime("2026-10-29T18:30:00+00:00")!.toISOString(), "2026-10-29T18:30:00.000Z");
    assert.equal(parseLondonTime("next thursday"), null);
  });

  test("phone numbers normalise to E.164", () => {
    assert.equal(toE164("07700 900123"), "+447700900123");
    assert.equal(toE164("+44 (0)20 7946 0000"), "+442079460000");
    assert.equal(toE164("020 7946 0000"), "+442079460000");
    assert.equal(toE164("call me"), null);
  });
});
