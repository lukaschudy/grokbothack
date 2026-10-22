"use client";

import { useState, useTransition } from "react";
import { confirmVenueAction, reportJunkAction } from "../../actions";

export function VenueActions({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="panel stack" style={{ gap: 12 }}>
      <button className="button" disabled={pending} onClick={() => start(async () => { const r = await confirmVenueAction(id); setMsg(r?.ok ?? r?.error ?? null); })}>
        Still correct
      </button>
      <button className="button quiet" disabled={pending} onClick={() => start(async () => {
        if (!confirm("Report this venue as junk? Two reports, or one from a founding organiser, remove it and ban the poster.")) return;
        const r = await reportJunkAction(id);
        setMsg(r?.ok ?? r?.error ?? null);
      })}>
        Report junk
      </button>
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}
