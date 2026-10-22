// Local-only fixtures for UI work. Refuses to run against a remote database.
import { sql } from "../lib/db";
import { createAccount } from "../lib/auth";

const url = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("dev-fixtures only runs against a local database");

await sql`truncate accounts, venues, events, calls, availability, requests cascade`;
const ada = await createAccount({ email: "ada@dev.local", password: "password1", displayName: "Ada Okafor", community: "London AI Builders" });
const ben = await createAccount({ email: "ben@dev.local", password: "password1", displayName: "Ben Hart", community: "Rust London" });
await createAccount({ email: "cara@dev.local", password: "password1", displayName: "Cara Lin", community: null });
await sql`update profiles set is_root = true where id = ${ada}`;
await sql`insert into vouches (voucher_id, vouchee_id) values (${ada}, ${ben})`;

const venues: [string, string, string, number, number, string, number, string, boolean][] = [
  ["Shoreditch Works", "32 Hoxton Square, N1 6NN", "Hoxton", 51.5276, -0.0817, "bookable", 120, "free_for_community", true],
  ["Fora Old Street", "1 Bath Street, EC1V 9LB", "Old Street", 51.5262, -0.0905, "coworking", 90, "paid", false],
  ["Cloudflare London", "25 Lavington Street, SE1 0NZ", "Southwark", 51.5046, -0.0989, "company_office", 150, "free", false],
  ["The Trampery Old Street", "239 Old Street, EC1V 9EY", "Old Street", 51.5263, -0.0846, "community_space", 85, "free_for_community", false],
  ["Huckletree Shoreditch", "18 Finsbury Square, EC2A 1AH", "Moorgate", 51.5208, -0.0868, "coworking", 100, "paid", false],
  ["Second Home Spitalfields", "68 Hanbury Street, E1 5JL", "Spitalfields", 51.5203, -0.0716, "bookable", 60, "paid", false]
];
for (const [name, address, area, lat, lng, kind, capacity, terms, ok] of venues) {
  const [v] = await sql<{ id: string }[]>`
    insert into venues (name, address, area, location, kind, capacity, terms, evening_ok, weekend_ok, ok_to_call, av, created_by)
    values (${name}, ${address}, ${area}, st_setsrid(st_makepoint(${lng}, ${lat}), 4326)::geography, ${kind}, ${capacity}, ${terms},
            true, ${kind !== "company_office"}, ${ok}, ${["projector", "mics"]}, ${ada})
    returning id`;
  await sql`insert into venue_contacts (venue_id, contact_name, email, phone) values (${v!.id}, 'Sam Patel', 'events@example.com', ${ok ? "+447700900123" : null})`;
  await sql`insert into venue_hosts (venue_id, community, event_title, event_url, event_date, attendees, source) values
    (${v!.id}, 'London AI Builders', 'Agents night', ${`https://lu.ma/${name.length}a`}, '2026-09-18', 95, 'luma'),
    (${v!.id}, 'Women in Data', 'Lightning talks', ${`https://lu.ma/${name.length}b`}, '2026-07-02', 70, 'luma')`;
}
await sql`insert into events (source, external_id, title, url, starts_at, ends_at, venue_name, location, community, attendees, score, reasons)
  values ('luma', 'evt-dev-1', 'AI Tinkerers London', 'https://lu.ma/dev1', '2026-10-29T18:00:00Z', '2026-10-29T21:00:00Z', 'Google King''s Cross',
          st_setsrid(st_makepoint(-0.1256, 51.5336), 4326)::geography, 'AI Tinkerers', 140, 1, '{"140 going"}')`;
console.log("fixtures ready: ada@dev.local / ben@dev.local / cara@dev.local, password1");
await sql.end();
