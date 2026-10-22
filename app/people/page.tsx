import Link from "next/link";
import { sql } from "@/lib/db";
import { currentMember } from "@/lib/session";
import { VouchButton } from "./vouch-button";

export const dynamic = "force-dynamic";

type Person = {
  id: string; display_name: string; community: string | null; is_root: boolean; banned: boolean;
  can_post: boolean; can_vouch: boolean; vouched_by: string[]; vouched_by_me: boolean; venues: number; joined: Date;
};

export default async function People({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const me = await currentMember();
  const { welcome } = await searchParams;
  const people = await sql<Person[]>`
    select p.id, p.display_name, p.community, p.is_root, p.banned_at is not null as banned,
           can_post(p.id) as can_post, can_vouch(p.id) as can_vouch, p.created_at as joined,
           coalesce((select array_agg(v.display_name order by vo.created_at) from vouches vo join profiles v on v.id = vo.voucher_id where vo.vouchee_id = p.id), '{}') as vouched_by,
           exists (select 1 from vouches vo where vo.vouchee_id = p.id and vo.voucher_id = ${me?.id ?? null}::uuid) as vouched_by_me,
           (select count(*) from venues where created_by = p.id and junk_at is null)::int as venues
    from profiles p
    order by p.is_root desc, can_post(p.id) desc, p.created_at`;

  return (
    <main className="page">
      <div className="shell">
        <header className="product-heading">
          <h1>Organisers who vouch for each other</h1>
          <p>Anyone can search. Posting needs a vouch from a member in good standing, so the list stays real.</p>
        </header>
        {welcome && me && !me.can_post && (
          <p className="notice warn" style={{ marginBottom: 24, maxWidth: 680 }}>
            Welcome, {me.display_name}. You can search and ask for calls once someone vouches for you. Send this page to an organiser who knows you.
          </p>
        )}
        <div className="two-col">
          <section className="list" aria-label="Members">
            {people.map((p) => (
              <div key={p.id} className="list-row">
                <div>
                  <h3>{p.display_name}{me?.id === p.id ? " (you)" : ""}</h3>
                  <p>
                    {p.community ?? "No community listed"}
                    {p.venues ? ` · ${p.venues} venue${p.venues === 1 ? "" : "s"} posted` : ""}
                  </p>
                  <div className="pills" style={{ marginTop: 4 }}>
                    {p.banned ? <span className="pill">Banned for junk</span>
                      : p.is_root ? <span className="pill accent">Founding organiser</span>
                      : p.can_post ? <span className="pill accent">Vouched by {p.vouched_by.join(", ")}</span>
                      : <span className="pill">Not vouched yet</span>}
                    {!p.banned && p.can_post && !p.can_vouch && <span className="pill">Lost vouching rights</span>}
                  </div>
                </div>
                {me && me.id !== p.id && !p.banned && (
                  p.vouched_by_me ? <span className="side">You vouched</span>
                    : me.can_vouch ? <VouchButton id={p.id} name={p.display_name} /> : null
                )}
              </div>
            ))}
          </section>
          <aside className="aside">
            <h2 className="section-title">How trust works</h2>
            <p>1. Founding organisers can post. Anyone they vouch for can post too.</p>
            <p>2. A vouch says: <em>I know this person runs real events.</em></p>
            <p>3. If someone posts junk, they&apos;re banned, and whoever vouched for them loses the right to vouch.</p>
            <p>4. Every venue field records who set it and when it was last confirmed.</p>
            <p className="hint">Enforced in the database with row-level security, not just in the app.</p>
            {!me && <Link className="button" href="/signin?next=/people">Sign in</Link>}
          </aside>
        </div>
      </div>
    </main>
  );
}
