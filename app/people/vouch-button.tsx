"use client";

import { useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import { vouchAction } from "../actions";

export function VouchButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div style={{ display: "grid", justifyItems: "end", gap: 6 }}>
      <button className="button small" disabled={pending} onClick={() => start(async () => {
        const r = await vouchAction(id);
        setMsg(r?.error ?? null);
      })}>
        <ShieldCheck size={15} aria-hidden /> {pending ? "Vouching…" : `Vouch for ${name.split(" ")[0]}`}
      </button>
      {msg && <span className="hint" style={{ color: "var(--bad)", maxWidth: 260, textAlign: "right" }}>{msg}</span>}
    </div>
  );
}
