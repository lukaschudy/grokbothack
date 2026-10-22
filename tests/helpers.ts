import { sql } from "../lib/db";
import { createAccount } from "../lib/auth";

export async function resetDb() {
  await sql`truncate accounts, venues, events, calls, availability, requests cascade`;
  await sql`update app_settings set value = '7' where key = 'call_cooldown_days'`;
}

let n = 0;
export async function member(name: string, opts: { root?: boolean } = {}) {
  const id = await createAccount({ email: `${name.toLowerCase()}${++n}@test.dev`, password: "pw-123456", displayName: name });
  if (opts.root) await sql`update profiles set is_root = true where id = ${id}`;
  return id;
}

export const OLD_STREET = { lat: 51.5257, lng: -0.0875 };

export async function venueAt(owner: string, fields: Partial<{ name: string; capacity: number; lat: number; lng: number; kind: string; ok_to_call: boolean; terms: string; phone: string }> = {}) {
  const f = { name: "Test Hall", capacity: 100, lat: OLD_STREET.lat, lng: OLD_STREET.lng, kind: "bookable", ok_to_call: true, terms: "free", ...fields };
  const [v] = await sql<{ id: string }[]>`
    insert into venues (name, capacity, location, kind, ok_to_call, terms, evening_ok, weekend_ok, created_by)
    values (${f.name}, ${f.capacity}, st_setsrid(st_makepoint(${f.lng}, ${f.lat}), 4326)::geography,
            ${f.kind}, ${f.ok_to_call}, ${f.terms}, true, true, ${owner})
    returning id`;
  if (f.phone) await sql`insert into venue_contacts (venue_id, phone) values (${v!.id}, ${f.phone})`;
  return v!.id;
}
