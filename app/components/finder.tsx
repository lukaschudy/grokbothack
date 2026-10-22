"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { searchAction, startCallAction, draftRequestAction, markRequestSentAction } from "../actions";
import type { SearchResult, VenueHit } from "@/lib/search";
import type { CallResult } from "@/lib/bus";
import { CallCard } from "./call-card";
import { VenueRow, answerLine } from "./venue-row";

const EXAMPLE = "free space for 80 next Thursday near Old Street";

type Me = { name: string; canPost: boolean } | null;
type ActiveCall = { venue: VenueHit; callId: string; outcome: string };
type Draft = { venueId: string; subject: string; body: string; to: string | null; requestId: string; sent?: boolean };

export function Finder({ me, counts }: { me: Me; counts: string }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [busyVenue, setBusyVenue] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, CallResult>>({});

  const run = (text: string) => {
    setQuery(text);
    setError(null);
    setNotice(null);
    setCall(null);
    setDraft(null);
    startSearch(async () => {
      const r = await searchAction(text);
      if ("error" in r) { setError(r.error); setResult(null); } else setResult(r);
    });
  };

  const input = (v: VenueHit) => ({
    venueId: v.id,
    startsAt: result!.parsed.starts_at,
    endsAt: result!.parsed.ends_at,
    headcount: result!.parsed.headcount,
    title: result!.parsed.event_title
  });

  const callVenue = async (v: VenueHit) => {
    setBusyVenue(v.id);
    setNotice(null);
    const r = await startCallAction(input(v));
    setBusyVenue(null);
    if ("error" in r) { setNotice(r.error); return; }
    setCall({ venue: v, callId: r.callId, outcome: r.outcome });
  };

  const draftFor = async (v: VenueHit) => {
    setBusyVenue(v.id);
    setNotice(null);
    const r = await draftRequestAction(input(v));
    setBusyVenue(null);
    if ("error" in r) { setNotice(r.error); return; }
    setDraft({ venueId: v.id, ...r });
  };

  const sendDraft = async () => {
    if (!draft) return;
    window.location.href = `mailto:${draft.to ?? ""}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
    await markRequestSentAction(draft.requestId);
    setDraft({ ...draft, sent: true });
  };

  return (
    <>
      <div className="home">
        <form className="ask" onSubmit={(e) => { e.preventDefault(); run(query); }}>
          <label className="sr-only" htmlFor="ask">What do you need?</label>
          <input id="ask" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="80 people, next Thursday, near Old Street" autoComplete="off" />
          <button className="button" type="submit" disabled={searching} aria-label="Find a room">
            {searching ? "Finding…" : "Find"} <ArrowRight size={16} aria-hidden />
          </button>
        </form>
        {!result && !searching && (
          <>
            <p className="examples">Try <button type="button" className="example" onClick={() => run(EXAMPLE)}>{EXAMPLE}</button></p>
            <p className="count-line">{counts}</p>
          </>
        )}
        {error && <p className="notice warn" style={{ marginTop: 24 }}>{error}</p>}
      </div>

      {result && (
        <section className="results" aria-live="polite">
          <div className="results-head">
            <div>
              <h2>{result.venues.length ? `${result.venues.length} rooms that fit` : "Nothing fits yet"}</h2>
              <div className="pills">
                <span className="pill">{result.parsed.headcount} people</span>
                <span className="pill">{result.parsed.window}</span>
                <span className="pill">near {result.parsed.place.name}</span>
                {result.parsed.free_only && <span className="pill">free</span>}
              </div>
            </div>
            <p className="speed tnum">{(result.ms / 1000).toFixed(1)}s</p>
          </div>

          {result.clashes[0] && (
            <p className="clash">
              <span className="dot" aria-hidden /><b>Same evening:</b> {result.clashes[0].title}
              {result.clashes[0].attendees ? `, ${result.clashes[0].attendees} going` : ""}
              {result.clashes[0].venue_name ? `, at ${result.clashes[0].venue_name}` : ""}.
            </p>
          )}
          {notice && <p className="notice warn" style={{ marginTop: 16 }}>{notice}</p>}

          <div className={`results-grid${call ? " calling" : ""}`}>
            <div className="venue-stack">
              {result.venues.length === 0 && (
                <p className="empty">
                  Nothing in the list fits {result.parsed.headcount} people near {result.parsed.place.name} that evening.{" "}
                  <Link className="link" href="/add">Add a venue you know</Link>
                </p>
              )}
              {result.venues.map((v, i) => (
                <VenueRow
                  key={v.id}
                  v={{ ...v, reasons: answers[v.id] ? v.reasons.filter((r) => !r.startsWith("Fits") && !r.startsWith("OK to call")) : v.reasons }}
                  n={i + 1}
                  answer={answers[v.id] ? answerLine(answers[v.id]!) : null}
                  active={call?.venue.id === v.id}
                >
                  {v.callable && !answers[v.id] && (
                    <button className="button" type="button" disabled={busyVenue === v.id || !me || call?.venue.id === v.id} onClick={() => callVenue(v)}>
                      {busyVenue === v.id ? "Starting…" : call?.venue.id === v.id ? "Calling…" : "Call to check"}
                    </button>
                  )}
                  <button className="button quiet" type="button" disabled={busyVenue === v.id || !me} onClick={() => draftFor(v)}>
                    {v.kind === "company_office" ? "Ask for an intro" : "Draft request"}
                  </button>
                  {draft?.venueId === v.id && (
                    <div className="draft stack" style={{ width: "100%" }}>
                      <div className="field">
                        <span>To {draft.to ?? "the venue"}</span>
                        <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                      </div>
                      <div className="venue-actions" style={{ marginTop: 0 }}>
                        <button className="button" type="button" onClick={sendDraft}>{draft.sent ? "Opened in your email" : "Send request"}</button>
                        <button className="button quiet" type="button" onClick={() => setDraft(null)}>Close</button>
                      </div>
                    </div>
                  )}
                </VenueRow>
              ))}
              {!me && result.venues.length > 0 && (
                <p className="hint" style={{ marginTop: 20 }}><Link className="link" href="/signin">Sign in</Link> to call venues or send requests.</p>
              )}
            </div>
            {call && (
              <div className="call-column">
                <CallCard
                  key={call.callId}
                  callId={call.callId}
                  outcome={call.outcome}
                  venue={call.venue.name}
                  window={result.parsed.window}
                  headcount={result.parsed.headcount}
                  onDraft={() => draftFor(call.venue)}
                  onResult={(r) => setAnswers((a) => ({ ...a, [call.venue.id]: r }))}
                />
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
