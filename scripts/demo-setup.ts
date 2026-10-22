// Put the database in the demo's start state. Idempotent: run it before every rehearsal and before going on stage.
//   DEMO_PASSWORD=… DEMO_VENUE_PHONE=+44… npx tsx --env-file-if-exists=.env.local scripts/demo-setup.ts [--tokens]
// Works on local Postgres and on Supabase (DATABASE_URL as the postgres user, which bypasses RLS).
//
// Creates or updates:
//   - root organisers (DEMO_ROOTS, comma-separated, default "Lukas")
//   - Lead A and Lead B, vouched for by the first root (DEMO_A, DEMO_B)
//   - Organiser C, with every vouch for C removed so C starts blocked (DEMO_C)
//   - one bookable, OK-to-call, free-for-community venue near Old Street, posted by B, whose phone is
//     DEMO_VENUE_PHONE (the person who picks up on stage); previous calls and availability on it are cleared
//     so the call on stage really dials instead of reusing a rehearsal answer.
// People are "Name|Community|email" (community and email optional; email defaults to <slug>@DEMO_EMAIL_DOMAIN).
// Phone numbers, emails and passwords come from env only. --tokens prints Bearer tokens (needs the server's SESSION_SECRET).
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createAccount, signSession } from "../lib/auth";
import { sql } from "../lib/db";

export type Person = { name: string; community: string | null; email: string };

export type DemoConfig = {
  roots: Person[];
  a: Person;
  b: Person;
  c: Person;
  password: string | null;
  venue: {
    name: string; address: string | null; lat: number; lng: number; capacity: number;
    phone: string | null; email: string | null; contactName: string | null;
  };
};

const E164 = /^\+[1-9][0-9]{6,14}$/;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function parsePerson(spec: string, domain: string): Person {
  const [name = "", community = "", email = ""] = spec.split("|").map((s) => s.trim());
  if (!name) throw new Error(`Empty name in "${spec}"`);
  return { name, community: community || null, email: (email || `${slug(name)}@${domain}`).toLowerCase() };
}

export function demoConfig(env: Record<string, string | undefined> = process.env): DemoConfig {
  const domain = env.DEMO_EMAIL_DOMAIN || "example.com";
  const roots = (env.DEMO_ROOTS || "Lukas").split(",").filter((s) => s.trim()).map((s) => parsePerson(s, domain));
  if (roots.length === 0) throw new Error("DEMO_ROOTS needs at least one name");
  const phone = env.DEMO_VENUE_PHONE?.replace(/[\s()-]/g, "") || null;
  if (phone && !E164.test(phone)) throw new Error("DEMO_VENUE_PHONE must be E.164, e.g. +447700900123");
  const people = [...roots, parsePerson(env.DEMO_A || "Lead A", domain), parsePerson(env.DEMO_B || "Lead B", domain), parsePerson(env.DEMO_C || "Organiser C", domain)];
  const names = people.map((p) => p.name.toLowerCase()), emails = people.map((p) => p.email);
  if (new Set(names).size !== names.length || new Set(emails).size !== emails.length) throw new Error("Demo names and emails must be unique");
  return {
    roots,
    a: people.at(-3)!, b: people.at(-2)!, c: people.at(-1)!,
    password: env.DEMO_PASSWORD || null,
    venue: {
      name: env.DEMO_VENUE_NAME || "Demo Hall, Old Street",
      address: env.DEMO_VENUE_ADDRESS || null,
      // ~150 m north-east of Old Street station.
      lat: Number(env.DEMO_VENUE_LAT || 51.5265),
      lng: Number(env.DEMO_VENUE_LNG || -0.086),
      capacity: Number(env.DEMO_VENUE_CAPACITY || 120),
      phone,
      email: env.DEMO_VENUE_EMAIL || null,
      contactName: env.DEMO_VENUE_CONTACT || "Bookings"
    }
  };
}

/** Deterministic id so re-runs update the same venue row. */
export const DEMO_VENUE_ID = (() => {
  const h = createHash("md5").update("mates-rates:demo-venue").digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
})();

async function ensureAccount(p: Person, password: string | null): Promise<string> {
  const [own] = await sql<{ id: string }[]>`select id from accounts where email = ${p.email}`;
  const [clash] = await sql<{ id: string }[]>`
    select id from profiles where lower(display_name) = lower(${p.name}) and id is distinct from ${own?.id ?? null}`;
  if (clash) throw new Error(`Another account is already called "${p.name}"; pick a different demo name`);
  if (own) {
    await sql`update profiles set display_name = ${p.name}, community = ${p.community}, banned_at = null, vouch_revoked_at = null
              where id = ${own.id}`;
    return own.id;
  }
  if (!password) throw new Error("DEMO_PASSWORD must be set to create demo accounts");
  return createAccount({ email: p.email, password, displayName: p.name, community: p.community });
}

export type DemoIds = { roots: string[]; a: string; b: string; c: string; venue: string };

export async function setupDemo(cfg: DemoConfig): Promise<DemoIds> {
  const roots: string[] = [];
  for (const r of cfg.roots) roots.push(await ensureAccount(r, cfg.password));
  const a = await ensureAccount(cfg.a, cfg.password);
  const b = await ensureAccount(cfg.b, cfg.password);
  const c = await ensureAccount(cfg.c, cfg.password);

  await sql`update profiles set is_root = true, banned_at = null, vouch_revoked_at = null where id = any(${roots}::uuid[])`;
  await sql`update profiles set is_root = false where id in (${a}, ${b}, ${c})`;
  for (const vouchee of [a, b])
    await sql`insert into vouches (voucher_id, vouchee_id) values (${roots[0]!}, ${vouchee}) on conflict do nothing`;
  await sql`delete from vouches where vouchee_id = ${c} or voucher_id = ${c}`;

  const v = cfg.venue;
  await sql.begin(async (tx) => {
    await tx`select set_config('roomline.source', 'demo-setup', true)`;
    await tx`
      insert into venues (id, name, address, area, location, kind, capacity, av, evening_ok, weekend_ok, terms,
                          ok_to_call, notes, created_by)
      values (${DEMO_VENUE_ID}, ${v.name}, ${v.address}, 'Old Street',
              st_setsrid(st_makepoint(${v.lng}, ${v.lat}), 4326)::geography, 'bookable', ${v.capacity},
              ${["projector", "mics"]}, true, true, 'free_for_community', true,
              'Demo venue for the 22 Oct 2026 hackathon; the phone is a teammate.', ${b})
      on conflict (id) do update set
        name = excluded.name, address = excluded.address, area = excluded.area, location = excluded.location,
        kind = excluded.kind, capacity = excluded.capacity, av = excluded.av, evening_ok = excluded.evening_ok,
        weekend_ok = excluded.weekend_ok, terms = excluded.terms, ok_to_call = excluded.ok_to_call,
        notes = excluded.notes, created_by = excluded.created_by, junk_at = null`;
  });
  await sql`
    insert into venue_contacts (venue_id, contact_name, email, phone) values (${DEMO_VENUE_ID}, ${v.contactName}, ${v.email}, ${v.phone})
    on conflict (venue_id) do update set contact_name = excluded.contact_name, email = excluded.email, phone = excluded.phone, updated_at = now()`;

  // Start state: no rehearsal calls, answers, requests or junk reports on the demo venue.
  await sql`delete from availability where venue_id = ${DEMO_VENUE_ID}`;
  await sql`delete from calls where venue_id = ${DEMO_VENUE_ID}`;
  await sql`delete from requests where venue_id = ${DEMO_VENUE_ID}`;
  await sql`delete from venue_reports where venue_id = ${DEMO_VENUE_ID}`;

  return { roots, a, b, c, venue: DEMO_VENUE_ID };
}

async function main() {
  const cfg = demoConfig();
  const ids = await setupDemo(cfg);
  const people: [string, Person, string][] = [
    ...cfg.roots.map((r, i): [string, Person, string] => ["root", r, ids.roots[i]!]),
    ["A", cfg.a, ids.a], ["B", cfg.b, ids.b], ["C", cfg.c, ids.c]
  ];
  for (const [role, p, id] of people) {
    const [s] = await sql<{ can_post: boolean }[]>`select can_post(${id}) as can_post`;
    console.log(`${role.padEnd(4)} ${p.name.padEnd(16)} ${p.email.padEnd(32)} ${s!.can_post ? "can post" : "BLOCKED (unvouched)"}`);
  }
  console.log(`venue ${cfg.venue.name} ${ids.venue} ${cfg.venue.phone ? "callable" : "NOT callable: set DEMO_VENUE_PHONE"}${cfg.venue.email ? "" : ", no email: set DEMO_VENUE_EMAIL for the request fallback"}`);
  if (process.argv.includes("--tokens")) {
    if (!process.env.SESSION_SECRET) console.warn("SESSION_SECRET is not set: these tokens only work against a dev server");
    for (const [role, p, id] of people) console.log(`token ${role} ${p.name}: ${signSession(id)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}
