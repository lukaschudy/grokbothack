import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { sql, asUser } from "../lib/db";
import { DEMO_VENUE_ID, demoConfig, parsePerson, setupDemo } from "../scripts/demo-setup";
import { OLD_STREET, resetDb } from "./helpers";

const env = { DEMO_PASSWORD: "pw-123456", DEMO_VENUE_PHONE: "+44 7700 900123", DEMO_ROOTS: "Lukas,Root Two|Builders Club" };
const canPost = async (id: string) => (await sql<{ ok: boolean }[]>`select can_post(${id}) as ok`)[0]!.ok;
const THU = { starts: "2026-10-29T18:30:00Z", ends: "2026-10-29T21:30:00Z" };

after(() => sql.end());

describe("demo setup", () => {
  beforeEach(resetDb);

  test("config: names, emails, phone validation", () => {
    assert.deepEqual(parsePerson("Ada Lovelace|London.js", "example.com"), { name: "Ada Lovelace", community: "London.js", email: "ada-lovelace@example.com" });
    assert.equal(parsePerson("C|X|C@Mail.dev", "example.com").email, "c@mail.dev");
    const cfg = demoConfig(env);
    assert.deepEqual(cfg.roots.map((r) => r.name), ["Lukas", "Root Two"]);
    assert.equal(cfg.venue.phone, "+447700900123");
    assert.throws(() => demoConfig({ ...env, DEMO_VENUE_PHONE: "07700 900123" }), /E\.164/);
    assert.throws(() => demoConfig({ ...env, DEMO_C: "Lukas" }), /unique/);
  });

  test("roots, A and B can post, C starts blocked; the venue is callable and found near Old Street", async () => {
    const ids = await setupDemo(demoConfig(env));
    for (const r of ids.roots) assert.equal((await sql`select is_root from profiles where id = ${r}`)[0]!.is_root, true);
    assert.equal(await canPost(ids.a), true);
    assert.equal(await canPost(ids.b), true);
    assert.equal(await canPost(ids.c), false);

    const found = await sql`select id, ok_to_call from search_venues(${OLD_STREET.lat}, ${OLD_STREET.lng}, 80, ${THU.starts}, ${THU.ends}, 2000)`;
    assert.equal(found[0]!.id, DEMO_VENUE_ID);

    // Provenance says B posted it.
    const [log] = await sql`select confirmed_by from venue_field_status where venue_id = ${DEMO_VENUE_ID} and field = 'capacity'`;
    assert.equal(log!.confirmed_by, "Lead B");

    // C is blocked from calling until vouched, then the call goes through.
    await assert.rejects(asUser(ids.c, (tx) => tx`select request_call(${DEMO_VENUE_ID}, ${THU.starts}, ${THU.ends}, 80)`), /not_trusted/);
    await asUser(ids.b, (tx) => tx`insert into vouches (voucher_id, vouchee_id) values (${ids.b}, ${ids.c})`);
    const [r] = await asUser(ids.c, (tx) => tx`select request_call(${DEMO_VENUE_ID}, ${THU.starts}, ${THU.ends}, 80) as r`);
    assert.equal(r!.r.outcome, "new");
  });

  test("re-running is idempotent and resets the start state", async () => {
    const cfg = demoConfig(env);
    const first = await setupDemo(cfg);
    // A rehearsal: C gets vouched, a call is answered.
    await sql`insert into vouches (voucher_id, vouchee_id) values (${first.b}, ${first.c})`;
    const [call] = await sql`insert into calls (venue_id, starts_at, ends_at, headcount, status) values (${DEMO_VENUE_ID}, ${THU.starts}, ${THU.ends}, 80, 'completed') returning id`;
    await sql`insert into availability (venue_id, starts_at, ends_at, status, source, call_id) values (${DEMO_VENUE_ID}, ${THU.starts}, ${THU.ends}, 'available', 'call', ${call!.id})`;

    const second = await setupDemo({ ...cfg, password: null }); // existing accounts don't need the password again
    assert.deepEqual(second, first);
    assert.equal((await sql`select count(*)::int as n from accounts`)[0]!.n, 5);
    assert.equal((await sql`select count(*)::int as n from venues`)[0]!.n, 1);
    assert.equal((await sql`select count(*)::int as n from vouches`)[0]!.n, 2);
    assert.equal(await canPost(first.c), false);
    assert.equal((await sql`select count(*)::int as n from calls`)[0]!.n, 0);
    assert.equal((await sql`select count(*)::int as n from availability`)[0]!.n, 0);
  });

  test("refuses to take over someone else's display name", async () => {
    await setupDemo(demoConfig(env));
    await assert.rejects(setupDemo(demoConfig({ ...env, DEMO_C: "Lead A|X|other@example.com", DEMO_A: "New A" })), /already called "Lead A"/);
  });
});
