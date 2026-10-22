"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Check, MapPin, Phone, PhoneCall, Send, TriangleAlert, Users } from "lucide-react";
import { searchAction, startCallAction, draftRequestAction, markRequestSentAction } from "../actions";
import type { SearchResult, VenueHit } from "@/lib/search";
import { CallCard } from "./call-card";
import { NearbyMap } from "./nearby-map";
import type { CallResult } from "@/lib/bus";

const EXAMPLES = [
  "free space for 80 next Thursday near Old Street",
  "40 people tomorrow evening near King's Cross",
  "hackathon for 120 on Saturday near Farringdon"
];

const KIND: Record<string, string> = {
  bookable: "Bookable", company_office: "Company office", community_space: "Community space", university: "University",
  coworking: "Coworking", pub_or_bar: "Pub or bar", other: "Venue"
};

type Me = { name: string; canPost: boolean } | null;
type ActiveCall = { venue: VenueHit; callId: string; outcome: string };
type Draft = { venueId: string; subject: string; body: string; to: string | null; requestId: string; sent?: boolean };

export function Finder({ me, stats }: { me: Me; stats: { venues: number; organisers: number; calls: number } }) {
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
      <form className="ask" onSubmit={(e) => { e.preventDefault(); run(query); }}>
        <label className="sr-only" htmlFor="ask">What do you need?</label>
        <input
          id="ask"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="free space for 80 next Thursday near Old Street"
          autoComplete="off"
        />
        <button className="button" type="submit" disabled={searching}>
          {searching ? "Finding…" : "Find a room"} <ArrowRight size={18} aria-hidden />
        </button>
      </form>
      {!result && !searching && (
        <>
          <div className="examples" aria-label="Examples">
            {EXAMPLES.map((e) => (
              <button key={e} type="button" className="example" onClick={() => run(e)}>{e}</button>
            ))}
          </div>
          <div className="rules">
            <div><strong className="tnum">{stats.venues}</strong><span>London venues, seeded from events that actually happened there</span></div>
            <div><strong className="tnum">{stats.organisers}</strong><span>vouched organisers who can post and update venues</span></div>
            <div><strong className="tnum">{stats.calls}</strong><span>availability answers from calls, shared with every organiser</span></div>
          </div>
        </>
      )}
      {error && <p className="notice warn" style={{ marginTop: 20, maxWidth: 820 }}>{error}</p>}

      {result && (
        <section className="results" aria-live="polite">
          <div className="results-head">
            <div>
              <h2>{result.venues.length ? `${result.venues.length} rooms that fit` : "Nothing fits yet"}</h2>
              <div className="pills" style={{ marginTop: 10 }}>
                <span className="pill soft"><Users size={14} aria-hidden /> {result.parsed.headcount} people</span>
                <span className="pill soft">{result.parsed.window}</span>
                <span className="pill soft"><MapPin size={14} aria-hidden /> near {result.parsed.place.name}</span>
                {result.parsed.free_only && <span className="pill soft">Free only</span>}
              </div>
            </div>
            <p className="speed tnum">Found in {(result.ms / 1000).toFixed(1)}s</p>
          </div>

          {result.clashes[0] && (
            <p className="notice warn" style={{ marginBottom: 18 }}>
              <TriangleAlert size={16} aria-hidden style={{ verticalAlign: -3, marginRight: 8 }} />
              <strong>Clash:</strong> {result.clashes[0].title}
              {result.clashes[0].community ? ` (${result.clashes[0].community})` : ""}
              {result.clashes[0].attendees ? `, ${result.clashes[0].attendees} going,` : ""} runs the same evening
              {result.clashes[0].venue_name ? ` at ${result.clashes[0].venue_name}` : ""}.
              {result.clashes.length > 1 ? ` Plus ${result.clashes.length - 1} more.` : ""}
            </p>
          )}
          {notice && <p className="notice warn" style={{ marginBottom: 18 }}>{notice}</p>}

          <div className="results-grid">
            <div className="venue-stack">
              {result.venues.length === 0 && (
                <div className="empty">
                  No venue in our list fits {result.parsed.headcount} people near {result.parsed.place.name} that evening.{" "}
                  <Link className="link" href="/add">Add one you know</Link>.
                </div>
              )}
              {result.venues.map((v, i) => (
                <article key={v.id} className={`venue-card${call?.venue.id === v.id ? " active" : ""}`}>
                  <header>
                    <div>
                      <p className="kicker">{KIND[v.kind] ?? "Venue"}{v.area ? ` · ${v.area}` : ""}</p>
                      <h3><Link href={`/venues/${v.id}`}>{v.name}</Link></h3>
                    </div>
                    <span className="rank" aria-label={`Rank ${i + 1}`}>{i + 1}</span>
                  </header>
                  <div className="venue-body">
                    <ul className="reasons">
                      {answers[v.id] && (
                        <li><PhoneCall size={15} aria-hidden /><strong>
                          {answers[v.id]!.status === "available" ? "Confirmed free by phone just now" : answers[v.id]!.status === "partial" ? "Partly free, confirmed by phone just now" : "Not free that evening (called just now)"}
                        </strong></li>
                      )}
                      {v.reasons.filter((r) => !(answers[v.id] && r.startsWith("Fits"))).map((r) => <li key={r}><Check size={15} aria-hidden /><span>{r}</span></li>)}
                      {answers[v.id]?.max_people && <li><Check size={15} aria-hidden /><span>Fits {answers[v.id]!.max_people} — you need {result.parsed.headcount} (confirmed on the call)</span></li>}
                    </ul>
                    {draft?.venueId === v.id && (
                      <div className="draft stack">
                        <div className="field">
                          <span>Request to {draft.to ?? "the venue"}</span>
                          <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                        </div>
                        <div className="venue-actions">
                          <button className="button" type="button" onClick={sendDraft}>
                            <Send size={16} aria-hidden /> {draft.sent ? "Opened in your email" : "Send request"}
                          </button>
                          <button className="button quiet" type="button" onClick={() => setDraft(null)}>Close</button>
                        </div>
                      </div>
                    )}
                    <div className="venue-foot">
                      <span className="provenance">{v.address ?? ""}</span>
                      <div className="venue-actions">
                        {v.callable && (
                          <button className="button" type="button" disabled={busyVenue === v.id || !me || call?.venue.id === v.id} onClick={() => callVenue(v)}
                            title={me ? undefined : "Sign in to call"}>
                            <Phone size={16} aria-hidden />{" "}
                            {busyVenue === v.id ? "Starting…" : answers[v.id] ? "Called" : call?.venue.id === v.id ? "Calling…" : "Call to check"}
                          </button>
                        )}
                        <button className={`button ${v.callable ? "quiet" : ""}`} type="button" disabled={busyVenue === v.id || !me} onClick={() => draftFor(v)}>
                          {v.kind === "company_office" ? "Ask for an intro" : "Draft request"}
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
              {!me && result.venues.length > 0 && (
                <p className="hint"><Link className="link" href="/signin">Sign in</Link> to call venues or send requests. Contacts are members-only.</p>
              )}
            </div>
            <div className="call-column">
              {call ? (
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
              ) : (
                result.venues.length > 0 && <NearbyMap place={result.parsed.place} venues={result.venues} />
              )}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
