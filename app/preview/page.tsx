// Dev-only: every key screen from fixture data, no database. For design review and the video.
import { notFound } from "next/navigation";
import { CallView, type Bar, type Line } from "../components/call-view";
import { VenueRow, answerLine } from "../components/venue-row";
import { Finder } from "../components/finder";
import { PhoneLine } from "../phone/phone-line";
import type { CallResult } from "@/lib/bus";

const VENUES = [
  { id: "00000000-0000-0000-0000-000000000001", name: "Kiln Lane Studios", kind: "bookable", area: "Hoxton", address: "14 Kiln Lane, N1",
    reasons: ["Fits 120 — you need 80", "650 m from Old Street", "Hosted Agents & Coffee, Rust Hoxton", "Free for community events"] },
  { id: "00000000-0000-0000-0000-000000000002", name: "Civo Tech Junction", kind: "company_office", area: "Old Street", address: "32-37 Cowper St, EC2A 4AW",
    reasons: ["Seen hosting 180", "120 m from Old Street", "Hosted Cloud Native London, DevSecOps London Gathering and 1 more", "Company office — ask a past host for an intro"] },
  { id: "00000000-0000-0000-0000-000000000003", name: "Code Node", kind: "other", area: "Moorgate", address: "10 South Pl, EC2M 7EB",
    reasons: ["Seen hosting 147", "700 m from Old Street", "Hosted Redis London, Cerebral Valley and 1 more", "Terms not confirmed yet"] }
];

const LINES: Line[] = [
  { id: "1", who: "agent", text: "Hi, this is Roomline, an AI assistant calling for Ada from Agents & Coffee. This call is recorded. Is now a good time to check a date?", final: true },
  { id: "2", who: "venue", text: "Sure, Sam here, I run events. Go ahead.", final: true },
  { id: "3", who: "agent", text: "Is your main room free next Thursday, the 29th, from 6:30 to 9:30, for about 80 people?", final: true },
  { id: "4", who: "venue", text: "Yes, that evening's free. It takes 120 standing, so", final: false }
];

const RESULT: CallResult = {
  status: "available", start_time: "18:30", end_time: "21:30", max_people: 120, price: "Free for tech meetups",
  conditions: "Guest list 48 hours before; out by 21:30", contact_name: "Sam", contact_role: "events",
  next_step: "Email the events inbox with date and headcount", alternative: null, recorded_at: "2026-10-22T18:42:00Z"
};

const bars: Bar[] = Array.from({ length: 48 }, (_, i) => {
  const t = i / 47;
  const who = i < 18 ? "agent" : i < 22 ? "none" : "venue";
  return { who, h: who === "none" ? 0.05 : 0.2 + 0.7 * Math.abs(Math.sin(i * 1.7) * Math.cos(t * 9)) };
});

const WINDOW = "Thu 29 Oct, 18:30–21:30";

function Results({ call }: { call?: "live" | "done" }) {
  return (
    <main className="page">
      <div className="shell">
        <header className="product-heading home"><h1>Find a room.</h1></header>
        <div className="home">
          <div className="ask">
            <input readOnly value="free space for 80 next Thursday near Old Street" />
            <button className="button" type="button">Find</button>
          </div>
        </div>
        <section className="results">
          <div className="results-head">
            <div>
              <h2>3 rooms that fit</h2>
              <div className="pills"><span className="pill">80 people</span><span className="pill">{WINDOW}</span><span className="pill">near Old Street</span><span className="pill">free</span></div>
            </div>
            <p className="speed tnum">0.8s</p>
          </div>
          <p className="clash"><span className="dot" aria-hidden /><b>Same evening:</b> Is AI making us less creative?: An Oxford-style debate, 126 going, at Granola.</p>
          <div className={`results-grid${call ? " calling" : ""}`}>
            <div className="venue-stack">
              {VENUES.map((v, i) => (
                <VenueRow key={v.id} v={call === "done" && i === 0 ? { ...v, reasons: v.reasons.slice(1) } : v} n={i + 1}
                  answer={call === "done" && i === 0 ? answerLine(RESULT) : null} active={Boolean(call) && i === 0}>
                  {i === 0 && <button className="button" type="button" disabled={Boolean(call)}>{call === "live" ? "Calling…" : call === "done" ? "Called" : "Call to check"}</button>}
                  <button className="button quiet" type="button">{v.kind === "company_office" ? "Ask for an intro" : "Draft request"}</button>
                </VenueRow>
              ))}
            </div>
            {call && (
              <div className="call-column">
                <CallView venue="Kiln Lane Studios" window={WINDOW} headcount={80}
                  status={call === "live" ? "in_progress" : "completed"} label={call === "live" ? "Live call" : "Call recorded"}
                  timer={call === "live" ? "00:21" : "00:38"} lines={LINES} bars={bars}
                  result={call === "done" ? RESULT : null} finished={call === "done"} reused={false} onDraft={undefined} />
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default async function Preview({ searchParams }: { searchParams: Promise<{ screen?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { screen = "home" } = await searchParams;
  if (screen === "results") return <Results />;
  if (screen === "call") return <Results call="live" />;
  if (screen === "done") return <Results call="done" />;
  if (screen === "phone") {
    return <PhoneLine lineName="Kiln Lane Studios" preview={{ state: "ringing", ring: { type: "ring", callId: "x", token: "x", venue: "Kiln Lane Studios", organiser: "Ada Okafor", when: WINDOW } }} />;
  }
  return (
    <main className="page">
      <div className="shell">
        <header className="product-heading home">
          <h1>Find a room.</h1>
          <p>London venues, vouched for by the organisers who&apos;ve hosted there. We can phone the venue to check the date.</p>
        </header>
        <Finder me={null} counts="143 venues · 12 vouched organisers · 3 answers from calls" />
      </div>
    </main>
  );
}
