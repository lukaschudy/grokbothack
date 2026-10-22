import { asUser, sql } from "../lib/db";
const [r] = await sql`select current_user, (select count(*) from venues)::int as venues, extensions.postgis_version() as gis`;
console.log(r);
const anon = await asUser(null, (tx) => tx`select current_user as role, count(*)::int as n from venues group by 1`);
console.log("anon read ok", anon);
await sql.end();
