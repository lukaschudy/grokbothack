import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { asUser, sql } from "../lib/db";
import { member, OLD_STREET, resetDb, venueAt } from "./helpers";

const postVenue = (uid: string | null, name = "Posted Hall") =>
  asUser(uid, (tx) => tx`
    insert into venues (name, capacity, location, created_by)
    values (${name}, 80, st_setsrid(st_makepoint(${OLD_STREET.lng}, ${OLD_STREET.lat}), 4326)::geography, ${uid})
    returning id`);

const vouch = (voucher: string, vouchee: string) =>
  asUser(voucher, (tx) => tx`insert into vouches (voucher_id, vouchee_id) values (${voucher}, ${vouchee})`);

beforeEach(resetDb);
after(() => sql.end());

describe("posting needs a vouch", () => {
  test("an unvouched account cannot post a venue", async () => {
    const stranger = await member("Stranger");
    await assert.rejects(postVenue(stranger), /row-level security/);
  });

  test("anonymous visitors cannot post", async () => {
    await assert.rejects(postVenue(null), /permission denied|row-level security/);
  });

  test("a root can post, and the people it vouches for can post", async () => {
    const a = await member("A", { root: true });
    const b = await member("B");
    const c = await member("C");
    await postVenue(a, "Root Hall");
    await vouch(a, b);
    await postVenue(b, "B Hall");
    await vouch(b, c);
    await postVenue(c, "C Hall");
    const [row] = await sql<{ count: string }[]>`select count(*) from venues`;
    assert.equal(Number(row!.count), 3);
  });

  test("an unvouched account cannot vouch for anyone", async () => {
    const x = await member("X");
    const y = await member("Y");
    await assert.rejects(vouch(x, y), /row-level security/);
  });

  test("you cannot vouch on someone else's behalf", async () => {
    const a = await member("A", { root: true });
    const b = await member("B");
    const c = await member("C");
    await assert.rejects(
      asUser(b, (tx) => tx`insert into vouches (voucher_id, vouchee_id) values (${a}, ${c})`),
      /row-level security/
    );
  });
});

describe("contacts are members-only", () => {
  test("anon and unvouched accounts see no contacts; members do", async () => {
    const a = await member("A", { root: true });
    const stranger = await member("Stranger");
    await venueAt(a, { phone: "+447700900123" });
    await assert.rejects(asUser(null, (tx) => tx`select * from venue_contacts`), /permission denied/);
    assert.equal((await asUser(stranger, (tx) => tx`select * from venue_contacts`)).length, 0);
    assert.equal((await asUser(a, (tx) => tx`select * from venue_contacts`)).length, 1);
  });
});

describe("junk costs the poster and their vouchers", () => {
  test("a root's report bans the poster and strips their voucher's vouching rights", async () => {
    const root = await member("Root", { root: true });
    const b = await member("B");
    const c = await member("C");
    const d = await member("D");
    await vouch(root, b);
    await vouch(b, c);
    const [junk] = await postVenue(c, "Totally Real Venue");

    const [res] = await asUser(root, (tx) => tx`select report_junk(${junk!.id}, 'fake') as r`);
    assert.equal(res!.r.junk, true);

    const visible = await asUser(null, (tx) => tx`select id from venues where id = ${junk!.id}`);
    assert.equal(visible.length, 0, "junk is hidden");
    await assert.rejects(postVenue(c, "Again"), /row-level security/, "poster is banned");
    await assert.rejects(vouch(b, d), /row-level security/, "voucher lost vouching rights");
    await postVenue(b, "B can still post");
  });

  test("one member's report is not enough; two are", async () => {
    const root = await member("Root", { root: true });
    const [b, c, poster] = [await member("B"), await member("C"), await member("P")];
    for (const m of [b, c, poster]) await vouch(root, m);
    const [v] = await postVenue(poster);
    const [first] = await asUser(b, (tx) => tx`select report_junk(${v!.id}) as r`);
    assert.equal(first!.r.junk, false);
    const [second] = await asUser(c, (tx) => tx`select report_junk(${v!.id}) as r`);
    assert.equal(second!.r.junk, true);
  });
});

describe("provenance", () => {
  test("every field records who set it", async () => {
    const a = await member("Ada", { root: true });
    const [v] = await postVenue(a, "Provenance Hall");
    await asUser(a, (tx) => tx`update venues set capacity = 120 where id = ${v!.id}`);
    const rows = await sql<{ field: string; value: unknown; confirmed_by: string }[]>`
      select field, value, confirmed_by from venue_field_status where venue_id = ${v!.id} order by field`;
    const cap = rows.find((r) => r.field === "capacity");
    assert.equal(cap?.value, 120);
    assert.equal(cap?.confirmed_by, "Ada");
    assert.ok(rows.some((r) => r.field === "name"));
  });
});

describe("one call answers every organiser", () => {
  const window = { starts: "2026-10-29T18:30:00Z", ends: "2026-10-29T21:30:00Z" };
  const requestCall = (uid: string, venue: string) =>
    asUser(uid, (tx) => tx`select request_call(${venue}, ${window.starts}, ${window.ends}, 80, 'Meetup') as r`).then(
      (rows) => rows[0]!.r as { outcome: string; call_id: string }
    );

  test("first request creates a call; the next one joins it; a recorded answer is reused", async () => {
    const a = await member("A", { root: true });
    const b = await member("B");
    await vouch(a, b);
    const venue = await venueAt(a, { phone: "+447700900123" });

    const first = await requestCall(a, venue);
    assert.equal(first.outcome, "new");
    assert.equal((await requestCall(b, venue)).outcome, "in_progress");

    await sql`update calls set status = 'completed' where id = ${first.call_id}`;
    await sql`insert into availability (venue_id, starts_at, ends_at, status, source, call_id)
              values (${venue}, ${window.starts}, ${window.ends}, 'available', 'call', ${first.call_id})`;
    const again = await requestCall(b, venue);
    assert.equal(again.outcome, "reused");
    assert.equal(again.call_id, first.call_id);
  });

  test("only bookable venues marked OK to call can be called", async () => {
    const a = await member("A", { root: true });
    const office = await venueAt(a, { kind: "company_office", phone: "+447700900123" });
    await assert.rejects(requestCall(a, office), /not_ok_to_call/);
    const noConsent = await venueAt(a, { ok_to_call: false, phone: "+447700900124" });
    await assert.rejects(requestCall(a, noConsent), /not_ok_to_call/);
  });

  test("unvouched accounts cannot trigger calls", async () => {
    const a = await member("A", { root: true });
    const stranger = await member("Stranger");
    const venue = await venueAt(a, { phone: "+447700900123" });
    await assert.rejects(requestCall(stranger, venue), /not_trusted/);
  });
});

describe("search", () => {
  test("finds venues that fit, nearest and best-evidenced first", async () => {
    const a = await member("A", { root: true });
    const near = await venueAt(a, { name: "Near", capacity: 100 });
    await venueAt(a, { name: "Far", capacity: 100, lat: 51.5225, lng: -0.1102 });
    await venueAt(a, { name: "Too small", capacity: 40 });
    await venueAt(a, { name: "Out of range", capacity: 100, lat: 51.4613, lng: -0.1156 });
    await sql`insert into venue_hosts (venue_id, community, event_url, event_date) values (${near}, 'London AI', 'https://lu.ma/x', '2026-09-10')`;
    const rows = await asUser(null, (tx) => tx`
      select name, host_count from search_venues(${OLD_STREET.lat}, ${OLD_STREET.lng}, 80,
        '2026-10-29T18:30:00Z', '2026-10-29T21:30:00Z')`);
    assert.deepEqual(rows.map((r) => r.name), ["Near", "Far"]);
    assert.equal(Number(rows[0]!.host_count), 1);
  });

  test("free means not known to be paid: unconfirmed terms stay, free ranks first", async () => {
    const a = await member("A", { root: true });
    await venueAt(a, { name: "Free", terms: "free" });
    await venueAt(a, { name: "Unknown", terms: "unknown" });
    await venueAt(a, { name: "Paid", terms: "paid" });
    const rows = await asUser(null, (tx) => tx`
      select name from search_venues(${OLD_STREET.lat}, ${OLD_STREET.lng}, 80,
        '2026-10-29T18:30:00Z', '2026-10-29T21:30:00Z', 3000, true)`);
    assert.deepEqual(rows.map((r) => r.name), ["Free", "Unknown"]);
  });
});
