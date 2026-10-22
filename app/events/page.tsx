import { headers } from "next/headers";
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
          <a className="button" href={webcal}>Subscribe in your calendar</a>
          <a className="button quiet" href={google} target="_blank" rel="noreferrer">Google Calendar</a>
          <a className="button quiet" href="/events.ics">.ics file</a>
        </div>
        <div className="list">
          {events.map((e, i) => (
            <a key={`${e.source}-${e.externalId}`} href={e.url} target="_blank" rel="noreferrer" className="list-row">
              <div>
                <p className="tnum" style={{ marginTop: 0, fontSize: 13 }}>
                  {formatDay(new Date(e.startsAt))}, {formatTime(new Date(e.startsAt))} · {SOURCE[e.source]}
                </p>
                <h3 style={{ marginTop: 2 }}>{e.title}</h3>
                <p>{e.reasons.join(" · ")}</p>
              </div>
              <span className="side tnum" title="Rank score">{String(i + 1).padStart(2, "0")}</span>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
