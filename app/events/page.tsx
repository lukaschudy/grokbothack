import { headers } from "next/headers";
import { CalendarPlus, Download } from "lucide-react";
import { upcomingEvents } from "@/lib/events";
import { formatDay, formatTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const SOURCE: Record<string, string> = { luma: "Luma", meetup: "Meetup", devpost: "Devpost", builderbase: "BuilderBase" };

export default async function Events() {
  const events = await upcomingEvents(80);
  const host = (await headers()).get("host") ?? "localhost:3000";
  const webcal = `webcal://${host}/events.ics`;
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  return (
    <main className="page">
      <div className="shell">
        <header className="product-heading">
          <h1>London tech events, ranked</h1>
          <p>From Luma, Meetup, Devpost and BuilderBase. Each one shows why it&apos;s ranked where it is. Subscribe once; it refreshes every 12 hours.</p>
        </header>
        <div className="venue-actions" style={{ marginBottom: 32 }}>
          <a className="button" href={webcal}><CalendarPlus size={16} aria-hidden /> Subscribe in your calendar</a>
          <a className="button quiet" href={google} target="_blank" rel="noreferrer">Add to Google Calendar</a>
          <a className="button quiet" href="/events.ics"><Download size={16} aria-hidden /> .ics</a>
        </div>
        <div className="list">
          {events.map((e, i) => (
            <a key={`${e.source}-${e.externalId}`} href={e.url} target="_blank" rel="noreferrer" className="list-row">
              <div>
                <p className="muted tnum" style={{ fontSize: 13, marginTop: 0 }}>
                  {String(i + 1).padStart(2, "0")} · {formatDay(new Date(e.startsAt))}, {formatTime(new Date(e.startsAt))} · {SOURCE[e.source]}
                </p>
                <h3 style={{ marginTop: 4 }}>{e.title}</h3>
                <div className="pills" style={{ marginTop: 10 }}>
                  {e.reasons.map((r) => <span key={r} className="pill soft">{r}</span>)}
                </div>
              </div>
              <span className="rank tnum" title="Score">{e.score.toFixed(1)}</span>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
