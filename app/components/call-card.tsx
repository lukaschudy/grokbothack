"use client";

import { useEffect, useRef, useState } from "react";
import { Mail, PhoneCall } from "lucide-react";
import type { CallResult } from "@/lib/bus";

type Line = { id: string; who: "agent" | "venue"; text: string; final: boolean };
type Bar = { who: "agent" | "venue" | "none"; h: number };

const BARS = 56;
const STEPS = [
  { key: "dialing", label: "Dialling" },
  { key: "ringing", label: "Ringing" },
  { key: "in_progress", label: "Talking" },
  { key: "completed", label: "Recorded" }
];
const ORDER: Record<string, number> = { queued: 0, dialing: 0, ringing: 1, in_progress: 2, completed: 3 };
const ENDED: Record<string, string> = { no_answer: "No answer", busy: "Declined", failed: "Call failed", canceled: "Cancelled" };

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function ago(iso: string | undefined) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

const timeOf = (iso: string | undefined) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";

export function CallCard(props: {
  callId: string; outcome: string; venue: string; window: string; headcount: number;
  onDraft: () => void; onResult?: (r: CallResult) => void;
}) {
  const [status, setStatus] = useState("dialing");
  const [lines, setLines] = useState<Line[]>([]);
  const [result, setResult] = useState<CallResult | null>(null);
  const [answeredAt, setAnsweredAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bars, setBars] = useState<Bar[]>(() => Array.from({ length: BARS }, () => ({ who: "none", h: 0.06 })));
  const [now, setNow] = useState(Date.now());
  const levels = useRef({ agent: 0, venue: 0 });
  const scroller = useRef<HTMLDivElement>(null);
  const reused = props.outcome === "reused" || props.outcome === "called_recently";

  useEffect(() => {
    const es = new EventSource(`/calls/${props.callId}/events`);
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data);
      if (e.type === "snapshot") {
        setStatus(e.status);
        setLines((e.transcript ?? []).map((l: Omit<Line, "final">) => ({ ...l, final: true })));
        if (e.result?.status) setResult(e.result);
        if (e.answered_at) setAnsweredAt(new Date(e.answered_at).getTime());
        if (e.ended_at) setEndedAt(new Date(e.ended_at).getTime());
      } else if (e.type === "status") {
        setStatus(e.status);
        if (e.status === "in_progress") setAnsweredAt((t) => t ?? new Date(e.at).getTime());
        if (["completed", "no_answer", "busy", "failed", "canceled"].includes(e.status)) setEndedAt((t) => t ?? new Date(e.at).getTime());
      } else if (e.type === "level") {
        levels.current[e.who as "agent" | "venue"] = Math.max(levels.current[e.who as "agent" | "venue"], e.level);
      } else if (e.type === "transcript") {
        setLines((prev) => {
          const i = prev.findIndex((l) => l.id === e.id);
          const line = { id: e.id, who: e.who, text: e.text, final: e.final };
          if (i === -1) return [...prev, line];
          const next = prev.slice();
          next[i] = line;
          return next;
        });
      } else if (e.type === "result") {
        setResult(e.result);
      } else if (e.type === "error") {
        setError(e.message);
      }
    };
    return () => es.close();
  }, [props.callId]);

  useEffect(() => {
    const t = setInterval(() => {
      const { agent, venue } = levels.current;
      const who = agent < 0.04 && venue < 0.04 ? "none" : agent >= venue ? "agent" : "venue";
      const h = Math.max(0.06, Math.max(agent, venue));
      setBars((prev) => [...prev.slice(1), { who, h }]);
      levels.current = { agent: agent * 0.35, venue: venue * 0.35 };
      setNow(Date.now());
    }, 100);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lines]);

  // Report the answer once; a ref keeps a new callback identity from re-firing it.
  const onResult = useRef(props.onResult);
  onResult.current = props.onResult;
  useEffect(() => {
    if (result) onResult.current?.(result);
  }, [result]);

  const live = status === "in_progress";
  const finished = reused || ["completed", "no_answer", "busy", "failed", "canceled"].includes(status);
  const transcript = lines.map((l) => (
    <div key={l.id} className={`line ${l.who}${l.final ? "" : " interim"}`}>
      <span className="who">{l.who === "agent" ? "Roomline" : "Venue"}</span>
      <p>{l.text}</p>
    </div>
  ));
  const ended = ENDED[status];
  const stepIndex = ORDER[status] ?? 3;
  const elapsed = answeredAt ? (endedAt ?? now) - answeredAt : 0;
  const label = reused
    ? `Answered by phone ${ago(result?.recorded_at)}`
    : ended ?? (live ? "Live call" : status === "completed" ? "Call recorded" : status === "ringing" ? "Ringing" : "Dialling");

  return (
    <section className="call-card" aria-label={`Call to ${props.venue}`}>
      <div className="call-head">
        <div className="call-status">
          <span>{live && <span className="live-dot" aria-hidden />}{label}</span>
          {!reused && answeredAt && <span className="timer tnum" aria-label="Call length">{mmss(elapsed)}</span>}
        </div>
        <h3>{props.venue}</h3>
        <p>Checking {props.window} for {props.headcount} people</p>
        {!reused && (
          <div className="steps" aria-hidden>
            {STEPS.map((s, i) => (
              <div key={s.key} className={`step ${ended && i >= stepIndex ? "" : i < stepIndex || (i === 3 && status === "completed") ? "done" : i === stepIndex ? "now" : ""}`}>
                <i />{s.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {!reused && !finished && (
        <>
          <div className="wave" aria-hidden>
            {bars.map((b, i) => <span key={i} className={b.who} style={{ height: `${Math.round(b.h * 100)}%` }} />)}
          </div>
          <div className="wave-legend" aria-hidden>
            <span><b style={{ background: "var(--ink)" }} />Roomline AI</span>
            <span><b style={{ background: "var(--orange)" }} />Venue</span>
          </div>
          <div className="transcript" ref={scroller}>
            {lines.length === 0 && <p className="call-empty">{status === "ringing" ? "Ringing the venue…" : ended ? "" : "Connecting…"}</p>}
            {transcript}
          </div>
        </>
      )}

      {error && <p className="result-note">{error}</p>}

      {result && (
        <>
          <div className={`takeaway result ${result.status}`} style={finished ? { marginTop: 22 } : undefined}>
            <span>Availability record</span>
            <h4>
              {result.status === "available" ? "Free" : result.status === "partial" ? "Partly free" : "Not free"} · {props.window}
            </h4>
            <dl>
              {result.max_people && (<><dt>Fits</dt><dd>{result.max_people} people</dd></>)}
              {result.price && (<><dt>Price</dt><dd>{result.price}</dd></>)}
              {result.conditions && (<><dt>Conditions</dt><dd>{result.conditions}</dd></>)}
              {result.alternative && (<><dt>Also offered</dt><dd>{result.alternative}</dd></>)}
              {result.next_step && (<><dt>To book</dt><dd>{result.next_step}</dd></>)}
              <dt>Confirmed by</dt>
              <dd>{[result.contact_name, result.contact_role].filter(Boolean).join(", ") || "Venue staff"} · {timeOf(result.recorded_at)} by phone</dd>
            </dl>
          </div>
          {finished && (
            <>
              <div className="result-foot">
                <button className="button" type="button" onClick={props.onDraft}><Mail size={16} aria-hidden /> Draft request</button>
              </div>
              <p className="result-note">
                {reused
                  ? "Another organiser asked about this evening recently, so we reused their answer. No new call."
                  : "Saved to the venue. The next organiser who asks about this evening gets this answer without a new call."}
              </p>
            </>
          )}
        </>
      )}
      {!result && reused && <p className="result-note"><PhoneCall size={14} aria-hidden /> This venue was called recently. We don&apos;t call a venue more than once a week.</p>}
      {!reused && finished && lines.length > 0 && (
        <details className="transcript-fold">
          <summary>Transcript · {lines.length} lines · {mmss(elapsed)}</summary>
          <div className="transcript">{transcript}</div>
        </details>
      )}
    </section>
  );
}
