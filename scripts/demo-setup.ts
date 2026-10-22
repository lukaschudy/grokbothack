// One-time demo setup: demo organisers + the fictional venue the scripted call rings.
// Idempotent. Usage: npm run demo:setup
import { sql } from "../lib/db";
import { createAccount } from "../lib/auth";

const PASSWORD = process.env.DEMO_PASSWORD ?? "roomline-demo";
const PEOPLE = [
  { email: "ada@demo.roomline", name: "Ada Okafor", community: "Agents & Coffee", root: true },
  { email: "ben@demo.roomline", name: "Ben Hart", community: "Rust Hoxton", root: false },
  { email: "cara@demo.roomline", name: "Cara Lin", community: "Data Dumplings", root: false }
];

const ids: Record<string, string> = {};
for (const p of PEOPLE) {
  const [existing] = await sql<{ id: string }[]>`select id from accounts where email = ${p.email}`;
  ids[p.email] = existing?.id ?? (await createAccount({ email: p.email, password: PASSWORD, displayName: p.name, community: p.community }));
  if (p.root) await sql`update profiles set is_root = true where id = ${ids[p.email]!}`;
}
await sql`insert into vouches (voucher_id, vouchee_id) values (${ids["ada@demo.roomline"]!}, ${ids["ben@demo.roomline"]!}) on conflict do nothing`;

// Fictional, so the scripted call never puts words in a real venue's mouth. 07700 900xxx is Ofcom's drama range.
const ada = ids["ada@demo.roomline"]!;
let [venue] = await sql<{ id: string }[]>`select id from venues where name = 'Kiln Lane Studios'`;
if (!venue) {
  [venue] = await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claim.sub', ${ada}, true)`;
    return tx<{ id: string }[]>`
      insert into venues (name, address, area, location, kind, capacity, av, evening_ok, weekend_ok, terms, ok_to_call, created_by)
      values ('Kiln Lane Studios', '14 Kiln Lane, N1', 'Hoxton', st_setsrid(st_makepoint(-0.0838, 51.5314), 4326)::geography,
              'bookable', 120, '{projector,mics}', true, true, 'free_for_community', true, ${ada})
      returning id`;
  });
  await sql`insert into venue_contacts (venue_id, contact_name, contact_role, email, phone)
            values (${venue!.id}, 'Sam', 'events', 'events@kilnlane.example', '+447700900182')`;
  await sql`insert into venue_hosts (venue_id, community, event_title, event_url, event_date, attendees, source) values
    (${venue!.id}, 'Agents & Coffee', 'Agents & Coffee #12: Evals in prod', 'https://example.com/agents-coffee-12', '2026-10-08', 94, 'organiser'),
    (${venue!.id}, 'Rust Hoxton', 'Rust Hoxton: async night', 'https://example.com/rust-hoxton-9', '2026-09-17', 61, 'organiser')
    on conflict do nothing`;
}
// Fresh demo: forget previous calls to the demo venue so "Call to check" rings again.
await sql`delete from availability where venue_id = ${venue!.id} and source = 'call'`;
await sql`delete from calls where venue_id = ${venue!.id}`;

console.log(`Demo ready. Sign in as ada@ / ben@ / cara@demo.roomline, password: ${PASSWORD}`);
console.log("Ada is a founding organiser, Ben is vouched by Ada, Cara is not vouched (posting is blocked).");
await sql.end();
