import { headers } from "next/headers";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CalendarPlus } from "lucide-react";
import { sql } from "@/lib/db";
import { upcomingEvents } from "@/lib/events";
import { chipReasons, relativeDay, safeHref, whereLine } from "@/lib/event-display";
import { currentMember } from "@/lib/session";
import { formatDay, formatTime } from "@/lib/time";
import { Finder } from "./components/finder";

export const dynamic = "force-dynamic";

type Stats = { venues: number; organisers: number; calls: number; tonight: number; communities: number; events: number; hosts: number };

export default async function Home() {
  const me = await currentMember();
  const [[stats], events, host] = await Promise.all([
    sql<Stats[]>`
      select (select count(*) from venues where junk_at is null)::int as venues,
             (select count(*) from profiles where can_post(id))::int as organisers,
             (select count(*) from availability where source = 'call')::int as calls,
             (select count(*) from venues where junk_at is null and created_by is not null and created_at > now() - interval '12 hours')::int as tonight,
             (select count(distinct c) from (select community as c from venue_hosts
                union select community from events where community is not null) x)::int as communities,
             (select count(*) from events where coalesce(ends_at, starts_at + interval '3 hours') > now())::int as events,
             (select count(*) from venue_hosts)::int as hosts`,
    upcomingEvents(6),
    headers().then((h) => h.get("host") ?? "localhost:3000")
  ]);
  // Bracket access so the link is read at request time, not baked in at build time.
  const grokBot = safeHref(process.env["NEXT_PUBLIC_GROK_BOT_URL"]);
  const webcal = `webcal://${host}/events.ics`;
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  const now = new Date();

  return (
    <main className="page home">
      <div className="shell">
        <section className="home-hero" aria-labelledby="home-title">
          <div>
            <p className="eyebrow">Mates Rates · London{stats!.tonight > 0 && <> · {stats!.tonight} venues added tonight</>}</p>
            <h1 id="home-title">Free venues for London communities, sorted by mates.</h1>
            <p className="home-lede">
              Ask the shared Grok Bot for a room. Organisers vouch for each other, so the venues are real, and the
              assistant can ring the venue to check it&apos;s free.
            </p>
            <div className="home-cta">
              {grokBot ? (
                <a className="button home-primary" href={grokBot} target="_blank" rel="noreferrer">
                  Open Mates Rates in Grok Bot <ArrowRight size={18} aria-hidden />
                </a>
              ) : (
                <span className="button home-primary" aria-disabled="true">
                  Open Mates Rates in Grok Bot <ArrowRight size={18} aria-hidden />
                </span>
              )}
              <a className="button secondary" href={webcal}>
                <CalendarPlus size={16} aria-hidden /> Subscribe to London builder events
              </a>
            </div>
            <p className="hint home-cta-note">
              {grokBot ? null : <>Grok Bot link coming soon. </>}
              Or <a className="link" href="#find">search here</a>
              {" · "}<a className="link" href={google} target="_blank" rel="noreferrer">Google Calendar</a>
              {" · "}<a className="link" href="/events.ics">.ics feed</a>
            </p>
          </div>

          <figure className="home-chat" aria-label="Example question and answer in Grok Bot">
            <figcaption>Example in Grok Bot · real venues from the database</figcaption>
            <p className="home-chat-me">Free space for 80 next Thursday near Old Street?</p>
            <div className="home-chat-bot">
              <p>Two rooms within 400 m that have hosted crowds that size:</p>
              <ol>
                <li><strong>Civo Tech Junction</strong> <span>Cloud Native London and Elastic London User Group met here · up to 180 people</span></li>
                <li><strong>Incubeta</strong> <span>London.js and the Data Intelligence Network met here · up to 145 people</span></li>
              </ol>
              <p>Want me to ring them to check Thursday, or draft a request?</p>
            </div>
            <p className="home-chat-me">Ring Civo.</p>
          </figure>
        </section>

        <dl className="home-stats" aria-label="Live numbers">
          <div><dt>venues</dt><dd className="tnum">{stats!.venues}</dd></div>
          <div><dt>communities</dt><dd className="tnum">{stats!.communities}</dd></div>
          <div><dt>upcoming events</dt><dd className="tnum">{stats!.events}</dd></div>
          <div><dt>past hosts recorded</dt><dd className="tnum">{stats!.hosts}</dd></div>
          <div><dt>vouched organisers</dt><dd className="tnum">{stats!.organisers}</dd></div>
        </dl>

        <section id="find" className="home-find" aria-labelledby="find-title">
          <div className="section-head">
            <h2 id="find-title" className="section-title">Search the shared venue list</h2>
            <p>The same search the bot runs. Plain English is fine.</p>
          </div>
          <Finder me={me ? { name: me.display_name, canPost: me.can_post } : null} stats={stats!} />
        </section>

        <section className="home-events" aria-labelledby="events-title">
          <div className="section-head">
            <h2 id="events-title" className="section-title">The best London builder events, ranked</h2>
            <Link className="link" href="/events">All ranked events</Link>
          </div>
          {events.length === 0 ? (
            <p className="empty">No ranked events yet. The feed refreshes from Luma, Meetup, Devpost and BuilderBase.</p>
          ) : (
            <ol className="home-event-grid">
              {events.map((e, i) => {
                const at = new Date(e.startsAt);
                const rel = relativeDay(at, now);
                const href = safeHref(e.url);
                return (
                  <li key={`${e.source}-${e.externalId}`} className="home-event">
                    <p className="home-event-when tnum">
                      <span className="muted">#{i + 1}</span>
                      <time dateTime={e.startsAt}>{formatDay(at)}, {formatTime(at)}</time>
                      {rel && <span className="home-event-rel">{rel}</span>}
                    </p>
                    <h3>
                      {href ? <a href={href} target="_blank" rel="noreferrer">{e.title} <ArrowUpRight size={15} aria-hidden /></a> : e.title}
                    </h3>
                    <p className="home-event-where">{whereLine(e)}</p>
                    <ul className="pills" aria-label="Why it's ranked">
                      {chipReasons(e.reasons).map((r) => (
                        <li key={r} className={r === "Free" ? "pill green" : r === "Hackathon" ? "pill orange" : "pill soft"}>{r}</li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="home-trust" aria-labelledby="trust-title">
          <h2 id="trust-title" className="section-title">How trust works</h2>
          <ol>
            <li>
              <h3>Organisers vouch for each other</h3>
              <p>A few known London organisers start the network. To post a venue you need a vouch. If someone you vouched for posts junk, you lose the right to vouch.</p>
            </li>
            <li>
              <h3>Every field shows its source</h3>
              <p>Capacity, AV, evening access and terms each record who added them and when they were last confirmed. Venues come from events that actually happened there.</p>
            </li>
            <li>
              <h3>Contacts stay private</h3>
              <p>Venue contacts are members-only. The assistant calls or emails the venue for you, and every answer is saved so one call serves every organiser.</p>
            </li>
          </ol>
        </section>
      </div>
    </main>
  );
}
