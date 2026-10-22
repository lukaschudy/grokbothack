"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { publishVenueAction, resolveLumaAction, type VenueDraft } from "../actions";

const KINDS: [string, string][] = [
  ["bookable", "Bookable venue (you can hire it)"],
  ["company_office", "Company office"],
  ["community_space", "Community space"],
  ["coworking", "Coworking space"],
  ["university", "University"],
  ["pub_or_bar", "Pub or bar"],
  ["other", "Something else"]
];

export function AddVenue() {
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<VenueDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; updated: boolean; seconds: number } | null>(null);
  const started = useRef<number>(0);

  const [capacity, setCapacity] = useState("");
  const [eveningOk, setEveningOk] = useState(true);
  const [weekendOk, setWeekendOk] = useState(false);
  const [terms, setTerms] = useState("free_for_community");
  const [priceNote, setPriceNote] = useState("");
  const [kind, setKind] = useState("bookable");
  const [okToCall, setOkToCall] = useState(false);
  const [phone, setPhone] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [introViaMe, setIntroViaMe] = useState(false);

  const resolve = async (e: React.FormEvent) => {
    e.preventDefault();
    started.current = Date.now();
    setBusy(true); setError(null); setDraft(null); setDone(null); setBlocked(false);
    const r = await resolveLumaAction(url);
    setBusy(false);
    if ("error" in r) { setError(r.error); return; }
    setDraft(r);
    setKind(r.kindGuess === "other" ? "bookable" : r.kindGuess);
    if (r.guestCount) setCapacity(String(Math.ceil(r.guestCount / 10) * 10));
  };

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true); setError(null);
    const r = await publishVenueAction({
      draft, capacity: capacity ? Number(capacity) : null, eveningOk, weekendOk, terms, priceNote, kind,
      okToCall, phone, contactName, contactEmail, introViaMe
    });
    setBusy(false);
    if ("error" in r) { setError(r.error); setBlocked(Boolean(r.blocked)); return; }
    setDone({ ...r, seconds: Math.round((Date.now() - started.current) / 1000) });
  };

  if (done) {
    return (
      <div className="stack">
        <div className="takeaway">
          <span>{done.updated ? "Venue updated" : "Venue live"}</span>
          <h3 style={{ fontSize: 24 }}>{draft?.name}</h3>
          <p style={{ marginTop: 6 }}>Live in {done.seconds}s, from paste to published. Every field is signed with your name and today&apos;s date.</p>
        </div>
        <div className="venue-actions">
          <Link className="button" href={`/venues/${done.id}`}>Open venue <ArrowRight size={16} aria-hidden /></Link>
          <button className="button quiet" type="button" onClick={() => { setDone(null); setDraft(null); setUrl(""); }}>Add another</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <form className="ask" style={{ marginTop: 0 }} onSubmit={resolve}>
        <label className="sr-only" htmlFor="luma">Luma event link</label>
        <input id="luma" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://lu.ma/your-event" autoComplete="off" />
        <button className="button" disabled={busy || !url}>{busy && !draft ? "Reading…" : "Fill it in"}</button>
      </form>
      {error && (
        <p className={`notice ${blocked ? "bad" : "warn"}`} role="alert">
          {error}
        </p>
      )}

      {draft && (
        <form className="stack" onSubmit={publish}>
          <div>
            <p className="eyebrow">From Luma · {draft.area ?? "London"}</p>
            <h2 style={{ fontSize: 28 }}>{draft.name}</h2>
            <ul className="reasons">
              {draft.address && <li>{draft.address}</li>}
              <li>Hosted {draft.community ?? "an event"}: “{draft.eventTitle}”, {draft.eventDate}{draft.guestCount ? `, ${draft.guestCount} went` : ""}</li>
              {draft.existingId && <li>Already listed: this event is added as evidence, and your answers update it.</li>}
            </ul>
          </div>

          <fieldset className="stack" style={{ margin: 0, padding: 0, border: 0, gap: 16 }}>
            <legend className="section-title" style={{ padding: 0, marginBottom: 8 }}>1 · How many people fit?</legend>
            <div className="row">
              <div className="field">
                <label htmlFor="capacity">People, standing</label>
                <input id="capacity" type="number" min={1} max={5000} value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="kind">What kind of place is it?</label>
                <select id="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                  {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            </div>
          </fieldset>

          <fieldset className="stack" style={{ margin: 0, padding: 0, border: 0, gap: 16 }}>
            <legend className="section-title" style={{ padding: 0, marginBottom: 8 }}>2 · When can community events use it?</legend>
            <div className="pills">
              <label className="check"><input type="checkbox" checked={eveningOk} onChange={(e) => setEveningOk(e.target.checked)} /> Weekday evenings</label>
              <label className="check"><input type="checkbox" checked={weekendOk} onChange={(e) => setWeekendOk(e.target.checked)} /> Weekends</label>
            </div>
          </fieldset>

          <fieldset className="stack" style={{ margin: 0, padding: 0, border: 0, gap: 16 }}>
            <legend className="section-title" style={{ padding: 0, marginBottom: 8 }}>3 · What does it cost, and how do people reach it?</legend>
            <div className="row">
              <div className="field">
                <label htmlFor="terms">Terms</label>
                <select id="terms" value={terms} onChange={(e) => setTerms(e.target.value)}>
                  <option value="free_for_community">Free for community events</option>
                  <option value="free">Free</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="price">Price or deal (optional)</label>
                <input id="price" value={priceNote} onChange={(e) => setPriceNote(e.target.value)} placeholder="e.g. £250 + VAT, or free if you buy pizza" />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label htmlFor="cname">Contact name (members only)</label>
                <input id="cname" value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="cemail">Contact email (members only)</label>
                <input id="cemail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
              </div>
            </div>
            {kind === "bookable" ? (
              <div className="stack" style={{ gap: 10 }}>
                <label className="check">
                  <input type="checkbox" checked={okToCall} onChange={(e) => setOkToCall(e.target.checked)} />
                  The venue is happy for Roomline to phone and check dates
                </label>
                {okToCall && (
                  <div className="field">
                    <label htmlFor="phone">Bookings phone number</label>
                    <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="020 7946 0000" required />
                    <span className="hint">At most one call a week. Every answer is shared with all organisers, so the venue isn&apos;t asked twice.</span>
                  </div>
                )}
              </div>
            ) : (
              <label className="check">
                <input type="checkbox" checked={introViaMe} onChange={(e) => setIntroViaMe(e.target.checked)} />
                Intro via me: organisers ask me, not the venue
              </label>
            )}
          </fieldset>

          <div className="venue-actions">
            <button className="button" disabled={busy}>{busy ? "Publishing…" : draft.existingId ? "Update venue" : "Publish venue"} <ArrowRight size={16} aria-hidden /></button>
            <span className="hint">Your name goes on every field you set, with today&apos;s date.</span>
          </div>
        </form>
      )}
    </div>
  );
}
