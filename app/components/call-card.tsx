"use client";

import { useEffect, useRef, useState } from "react";
import type { CallResult } from "@/lib/bus";
import { CallView, type Bar, type Line } from "./call-view";

const BARS = 48;
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

/** Live call state from the server's event stream, rendered by CallView. */
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
  const [bars, setBars] = useState<Bar[]>(() => Array.from({ length: BARS }, () => ({ who: "none", h: 0.05 })));
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
        const who = e.who as "agent" | "venue";
        levels.current[who] = Math.max(levels.current[who], e.level);
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
      setBars((prev) => [...prev.slice(1), { who, h: Math.max(0.05, agent, venue) }]);
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

  const finished = reused || ["completed", "no_answer", "busy", "failed", "canceled"].includes(status);
  const label = reused
    ? `Answered by phone ${ago(result?.recorded_at)}`
    : ENDED[status] ?? (status === "in_progress" ? "Live call" : status === "completed" ? "Call recorded" : status === "ringing" ? "Ringing" : "Dialling");

  return (
    <CallView
      venue={props.venue}
      window={props.window}
      headcount={props.headcount}
      status={status}
      label={label}
      timer={!reused && answeredAt ? mmss((endedAt ?? now) - answeredAt) : null}
      lines={lines}
      bars={bars}
      result={result}
      finished={finished}
      reused={reused}
      error={error}
      onDraft={props.onDraft}
      scrollerRef={scroller}
    />
  );
}
