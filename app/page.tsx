import { headers } from "next/headers";
import { ArrowRight, CalendarPlus } from "lucide-react";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type Counts = { venues: number; communities: number; events: number; hosts: number };

async function liveCounts(): Promise<Counts | null> {
  try {
    const [c] = await sql<Counts[]>`
      select (select count(*) from venues where junk_at is null)::int as venues,
             (select count(distinct c) from (select community as c from venue_hosts
                union select community from events where community is not null) x)::int as communities,
             (select count(*) from events where coalesce(ends_at, starts_at + interval '3 hours') > now())::int as events,
             (select count(*) from venue_hosts)::int as hosts`;
    return c ?? null;
  } catch (e) {
    console.error("[home] counts", e);
    return null; // the landing still works without the database
  }
}

function botUrl(): string | null {
  // Bracket access so the link is read at request time, not baked in at build time.
  const raw = process.env["NEXT_PUBLIC_GROK_BOT_URL"];
  try {
    const u = new URL(raw ?? "");
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

export default async function Home() {
  const [counts, host] = await Promise.all([liveCounts(), headers().then((h) => h.get("host") ?? "localhost:3000")]);
  const bot = botUrl();
  const n = (x: number) => x.toLocaleString("en-GB");

  return (
    <main className="landing">
      <div className="landing-inner">
        <p className="landing-name">Mates Rates</p>
        <h1>Free venues for London communities, sorted by mates.</h1>
        <div className="landing-cta">
          {bot ? (
            <a className="landing-button primary" href={bot} target="_blank" rel="noreferrer">
              Open in Grok Bot <ArrowRight size={18} aria-hidden />
            </a>
          ) : (
            <span className="landing-button primary" aria-disabled="true" aria-describedby="bot-soon">
              Open in Grok Bot <ArrowRight size={18} aria-hidden />
            </span>
          )}
          <a className="landing-button" href={`webcal://${host}/events.ics`}>
            <CalendarPlus size={17} aria-hidden /> Subscribe to London builder events
          </a>
        </div>
        {!bot && <p className="landing-note" id="bot-soon">Grok Bot link coming soon.</p>}
        {counts && (
          <p className="landing-counts tnum">
            {n(counts.venues)} venues · {n(counts.communities)} communities · {n(counts.events)} upcoming events ·{" "}
            {n(counts.hosts)} past hosts recorded
          </p>
        )}
      </div>
    </main>
  );
}
