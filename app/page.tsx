import { sql } from "@/lib/db";
import { currentMember } from "@/lib/session";
import { Finder } from "./components/finder";

export const dynamic = "force-dynamic";

export default async function Home() {
  const me = await currentMember();
  const [s] = await sql<{ venues: number; organisers: number; calls: number }[]>`
    select (select count(*) from venues where junk_at is null)::int as venues,
           (select count(*) from profiles where can_post(id))::int as organisers,
           (select count(*) from availability where source = 'call')::int as calls`;
  return (
    <main className="page">
      <div className="shell">
        <header className="product-heading home">
          <h1>Find a room.</h1>
          <p>London venues, vouched for by the organisers who&apos;ve hosted there. We can phone the venue to check the date.</p>
        </header>
        <Finder
          me={me ? { name: me.display_name, canPost: me.can_post } : null}
          counts={`${s!.venues} venues · ${s!.organisers} vouched organisers · ${s!.calls} answers from calls`}
        />
      </div>
    </main>
  );
}
