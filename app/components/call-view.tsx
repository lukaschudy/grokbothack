import type { CallResult } from "@/lib/bus";

export type Line = { id: string; who: "agent" | "venue"; text: string; final: boolean };
export type Bar = { who: "agent" | "venue" | "none"; h: number };

export type CallViewProps = {
  venue: string;
  window: string;
  headcount: number;
  status: string;
  label: string;
  timer: string | null;
  lines: Line[];
  bars: Bar[];
  result: CallResult | null;
  finished: boolean;
  reused: boolean;
  error?: string | null;
  onDraft?: () => void;
  scrollerRef?: React.Ref<HTMLDivElement>;
};

const STEPS = ["Dialling", "Ringing", "Talking", "Recorded"];
const ORDER: Record<string, number> = { queued: 0, dialing: 0, ringing: 1, in_progress: 2, completed: 4 };

const timeOf = (iso: string | undefined) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";

/** The call, as the organiser sees it. Pure: state lives in CallCard (live) or the caller (preview, video). */
export function CallView(p: CallViewProps) {
  const step = ORDER[p.status] ?? 4;
  const live = p.status === "in_progress";
  const transcript = p.lines.map((l) => (
    <div key={l.id} className={`line ${l.who}${l.final ? "" : " interim"}`}>
      <span className="who">{l.who === "agent" ? "Roomline" : "Venue"}</span>
      <p>{l.text}</p>
    </div>
  ));

  return (
    <section className="call" aria-label={`Call to ${p.venue}`}>
      <div>
        <div className="call-status">
          <span>{live && <span className="live-dot" aria-hidden />}{p.label}</span>
          {p.timer && <span className="timer tnum">{p.timer}</span>}
        </div>
        <h3>{p.venue}</h3>
        <p className="call-sub">{p.window} · {p.headcount} people</p>
        {!p.reused && (
          <div className="steps" aria-hidden>
            {STEPS.map((s, i) => <div key={s} className={`step ${i < step ? "done" : i === step ? "now" : ""}`}><i />{s}</div>)}
          </div>
        )}
      </div>

      {!p.reused && !p.finished && (
        <div>
          <div className="wave" aria-hidden>
            {p.bars.map((b, i) => <span key={i} className={b.who} style={{ height: `${Math.round(b.h * 100)}%` }} />)}
          </div>
          <div className="wave-legend" aria-hidden>
            <span><b style={{ background: "var(--navy)" }} />Roomline AI</span>
            <span><b style={{ background: "var(--cyan)" }} />Venue</span>
          </div>
        </div>
      )}

      {!p.reused && !p.finished && (
        <div className="transcript" ref={p.scrollerRef}>
          {p.lines.length === 0 ? <p className="call-empty">{p.status === "ringing" ? "Ringing…" : "Connecting…"}</p> : transcript}
        </div>
      )}

      {p.error && <p className="result-note">{p.error}</p>}

      {p.result && (
        <div className="takeaway result">
          <span>Availability record</span>
          <h4>{p.result.status === "available" ? "Free" : p.result.status === "partial" ? "Partly free" : "Not free"} · {p.window}</h4>
          <dl>
            {p.result.max_people && (<><dt>Fits</dt><dd>{p.result.max_people} people</dd></>)}
            {p.result.price && (<><dt>Price</dt><dd>{p.result.price}</dd></>)}
            {p.result.conditions && (<><dt>Conditions</dt><dd>{p.result.conditions}</dd></>)}
            {p.result.alternative && (<><dt>Also offered</dt><dd>{p.result.alternative}</dd></>)}
            {p.result.next_step && (<><dt>To book</dt><dd>{p.result.next_step}</dd></>)}
            <dt>Confirmed by</dt>
            <dd>{[p.result.contact_name, p.result.contact_role].filter(Boolean).join(", ") || "Venue staff"} · {timeOf(p.result.recorded_at)} by phone</dd>
          </dl>
        </div>
      )}

      {p.finished && p.result && (
        <>
          {p.onDraft && <div className="result-foot"><button className="button" type="button" onClick={p.onDraft}>Draft request</button></div>}
          <p className="result-note">
            {p.reused
              ? "Another organiser asked about this evening recently, so this answer was reused. No new call."
              : "Saved to the venue. The next organiser who asks about this evening gets this answer, no new call."}
          </p>
        </>
      )}
      {p.finished && !p.result && p.reused && <p className="result-note">This venue was called recently. We call a venue at most once a week.</p>}

      {!p.reused && p.finished && p.lines.length > 0 && (
        <details className="transcript-fold">
          <summary>Transcript · {p.lines.length} lines{p.timer ? ` · ${p.timer}` : ""}</summary>
          <div className="transcript">{transcript}</div>
        </details>
      )}
    </section>
  );
}
