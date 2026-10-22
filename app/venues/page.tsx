import Link from "next/link";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = {
  bookable: "Bookable", company_office: "Company office", community_space: "Community space", university: "University",
  coworking: "Coworking", pub_or_bar: "Pub or bar", other: "Venue"
};

export default async function Venues({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const like = `%${q.trim()}%`;
  const rows = await sql<{ id: string; name: string; area: string | null; kind: string; capacity: number | null; hosts: number; communities: string[]; last: string | null; poster: string | null }[]>`
    select v.id, v.name, v.area, v.kind, v.capacity,
           (select count(*) from venue_hosts h where h.venue_id = v.id)::int as hosts,
           coalesce((select (array_agg(distinct h.community))[1:3] from venue_hosts h where h.venue_id = v.id), '{}') as communities,
           (select max(event_date)::text from venue_hosts h where h.venue_id = v.id) as last,
           p.display_name as poster
    from venues v left join profiles p on p.id = v.created_by
    where v.junk_at is null and (${q} = '' or v.name ilike ${like} or v.area ilike ${like} or v.address ilike ${like})
    order by (v.created_by is not null) desc, hosts desc, v.name
    limit 200`;
  return (
    <main className="page">
      <div className="shell">
        <header className="product-heading">
          <h1>Venues</h1>
          <p>Seeded from events that actually happened there, then confirmed by organisers. {rows.length} shown.</p>
        </header>
        <form className="ask" style={{ marginTop: 0, marginBottom: 28 }}>
          <input name="q" defaultValue={q} placeholder="Search by name or area, e.g. Shoreditch" />
          <button className="button">Search</button>
        </form>
        <div className="list">
          {rows.map((v) => (
            <Link key={v.id} href={`/venues/${v.id}`} className="list-row">
              <div>
                <h3>{v.name}</h3>
                <p>
                  {KIND[v.kind] ?? "Venue"}{v.area ? ` · ${v.area}` : ""}{v.capacity ? ` · fits ${v.capacity}` : ""}
                  {v.hosts ? ` · ${v.hosts} past event${v.hosts === 1 ? "" : "s"}` : ""}{v.communities.length ? ` (${v.communities.join(", ")})` : ""}
                </p>
              </div>
              <span className="side">{v.poster ? `Posted by ${v.poster}` : "Seeded from events"}</span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
