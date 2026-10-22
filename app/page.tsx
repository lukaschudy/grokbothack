import { sql } from "@/lib/db";
import { currentMember } from "@/lib/session";
import { Finder } from "./components/finder";

export const dynamic = "force-dynamic";

export default async function Home() {
  const me = await currentMember();
  const [stats] = await sql<{ venues: number; organisers: number; calls: number; tonight: number }[]>`
    select (select count(*) from venues where junk_at is null)::int as venues,
           (select count(*) from profiles where can_post(id))::int as organisers,
           (select count(*) from availability where source = 'call')::int as calls,
           (select count(*) from venues where junk_at is null and created_at > now() - interval '12 hours')::int as tonight`;
  return (
    <main className="page">
      <div className="shell">
        <header className="product-heading">
          <p className="eyebrow">London · {stats!.venues} venues · {stats!.tonight} added tonight</p>
          <h1>Find a room for your next meetup.</h1>
          <p>
            Free and bookable London venues, posted and vouched for by organisers who&apos;ve hosted there.
            Ask in plain English. If a venue is happy to take calls, our AI rings them to check the date.
          </p>
        </header>
        <Finder
          me={me ? { name: me.display_name, canPost: me.can_post } : null}
          stats={stats!}
        />
      </div>
    </main>
  );
}
