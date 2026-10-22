import { sql } from "@/lib/db";
import { json, preflight, route } from "../_lib/http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** Public counts for the landing page. */
export const GET = route(async () => {
  const [s] = await sql`
    select (select count(*) from venues where junk_at is null)::int as venues,
      (select count(*) from (select community from venue_hosts union select community from events where community is not null) x)::int as communities,
      (select count(*) from events where coalesce(ends_at, starts_at + interval '3 hours') > now())::int as events,
      (select count(*) from venue_hosts)::int as hosts`;
  return json(s);
});
