import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND, EVENTS, REPO, SITE, STATS, TAGLINE } from "./data";
import { C, easeOut, Highlight, Logo, Paper, pop, ramp, Rise, SANS, SERIF, Stripes, Tag, Underline, type Tone } from "./ui";

export const EVENTS_DUR = 270;
const ROW_AT = 26;
const CHIP_AT = 120;
const STUBS = [C.gold, C.sandy, C.tomato, C.gold, C.sandy];

const reasonTone = (r: string): Tone => (r === "Hackathon" ? "tomato" : r === "Free" ? "gold" : r.endsWith("going") ? "sandy" : "outline");

// Calendar grid: Mon 19 Oct to Sun 8 Nov 2026.
const DAYS = Array.from({ length: 21 }, (_, i) => (i < 13 ? { d: 19 + i, m: "Oct" } : { d: i - 12, m: "Nov" }));
const dayOf = (when: string) => {
  const m = /(\d+) (Oct|Nov)/.exec(when);
  return m ? DAYS.findIndex((d) => d.d === Number(m[1]) && d.m === m[2]) : -1;
};

/** A ticket stub: coloured score end, perforation, then the event. */
const Ticket: React.FC<{ e: (typeof EVENTS)[number]; i: number; at: number }> = ({ e, i, at }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = pop(f, fps, at, 15);
  const notch: React.CSSProperties = { position: "absolute", left: 104, width: 24, height: 24, borderRadius: "50%", background: C.cream, border: `3px solid ${C.navy}` };
  return (
    <div style={{ position: "relative", display: "flex", height: 124, border: `3px solid ${C.navy}`, borderRadius: 12, background: C.paper, boxShadow: `6px 6px 0 ${C.navy}`, opacity: f < at ? 0 : 1, transform: `translateX(${(1 - p) * -90}px) rotate(${(i % 2 ? 0.6 : -0.6) * (1 - p) * 4}deg)` }}>
      <div style={{ width: 116, flex: "none", background: STUBS[i], borderRadius: "9px 0 0 9px", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: SERIF, fontSize: 36, fontWeight: 700, color: STUBS[i] === C.tomato ? C.paper : C.navy }}>{e.score}</div>
      <div style={{ width: 0, borderLeft: `3px dashed ${C.navy}` }} />
      <div style={{ ...notch, top: -15, clipPath: "inset(50% 0 0 0)" }} />
      <div style={{ ...notch, bottom: -15, clipPath: "inset(0 0 50% 0)" }} />
      <div style={{ minWidth: 0, padding: "14px 24px" }}>
        <div style={{ fontFamily: SANS, fontSize: 16, fontWeight: 600, color: C.muted }}>
          {e.when} · {e.source}
        </div>
        <div style={{ marginTop: 2, fontFamily: SERIF, fontSize: 26, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "nowrap", overflow: "hidden" }}>
          {e.reasons.slice(0, 4).map((r) => (
            <Tag key={r} tone={reasonTone(r)} size={14}>
              {r}
            </Tag>
          ))}
        </div>
      </div>
    </div>
  );
};

export const Events: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Paper color={C.cream}>
      <AbsoluteFill style={{ color: C.navy }}>
        <div style={{ position: "absolute", left: 100, top: 70, width: 1070 }}>
          <Rise at={0} y={20} style={{ fontFamily: SANS, fontSize: 17, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.tomato }}>
            Events feed
          </Rise>
          <Rise at={4} y={26} style={{ marginTop: 8, fontFamily: SERIF, fontSize: 60, fontWeight: 700, lineHeight: 1.1 }}>
            What&apos;s on in London, <Highlight p={ramp(f, 18, 16)}>ranked with reasons.</Highlight>
          </Rise>
          <div style={{ display: "grid", gap: 20, marginTop: 40 }}>
            {EVENTS.map((e, i) => (
              <Ticket key={e.title} e={e} i={i} at={ROW_AT + i * 9} />
            ))}
          </div>
        </div>

        <Rise at={12} y={40} tilt={2} style={{ position: "absolute", left: 1232, top: 86 }}>
          <div style={{ width: 590, padding: "30px 26px", borderRadius: 14, border: `3px solid ${C.navy}`, background: C.navy, color: C.cream, boxShadow: `10px 10px 0 ${C.tomato}` }}>
            <div style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 700 }}>Your calendar</div>
            <div style={{ marginTop: 4, fontFamily: SANS, fontSize: 18, fontWeight: 600, color: C.gold }}>Subscribed to {SITE}/events.ics</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginTop: 22, fontFamily: SANS }}>
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <div key={i} style={{ fontSize: 14, fontWeight: 700, color: "rgba(250,240,202,0.55)", textAlign: "center", paddingBottom: 4 }}>
                  {d}
                </div>
              ))}
              {DAYS.map((d, i) => {
                const today = d.d === 22 && d.m === "Oct";
                const chips = EVENTS.map((e, k) => ({ e, k })).filter(({ e }) => dayOf(e.when) === i);
                return (
                  <div key={i} style={{ height: 170, padding: 6, borderRadius: 6, border: "1.5px solid rgba(250,240,202,0.16)", display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ alignSelf: "flex-start", width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, background: today ? C.gold : "transparent", color: today ? C.navy : "rgba(250,240,202,0.85)" }}>{d.d}</div>
                    {chips.map(({ e, k }) => {
                      const p = pop(f, fps, CHIP_AT + k * 8, 11);
                      return (
                        <div key={e.title} style={{ padding: "4px 6px", borderRadius: 4, background: STUBS[k], color: STUBS[k] === C.tomato ? C.paper : C.navy, fontSize: 11, fontWeight: 700, lineHeight: 1.2, overflow: "hidden", maxHeight: 44, opacity: f < CHIP_AT + k * 8 ? 0 : 1, transform: `translateY(${(1 - p) * -30}px) rotate(${(1 - p) * 8}deg)` }}>
                          {e.title}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </Rise>
      </AbsoluteFill>
    </Paper>
  );
};

export const CLOSE_DUR = 300;
const BRAND_AT = 104;
const MARKS = [C.gold, C.sandy, C.tomato];

const Stat: React.FC<{ value: string; label: string; at: number; i: number }> = ({ value, label, at, i }) => {
  const f = useCurrentFrame();
  const n = Number(value);
  const shown = Number.isNaN(n) ? value : String(Math.round(interpolate(f, [at, at + 40], [0, n], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut })));
  return (
    <Rise at={at} y={36} style={{ width: 470, textAlign: "center" }}>
      <div style={{ position: "relative", display: "inline-block", fontFamily: SERIF, fontSize: 132, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
        {shown}
        <Underline width={240} p={ramp(f, at + 22, 14)} color={MARKS[i]} thick={9} seed={10 + i} style={{ position: "absolute", left: "50%", marginLeft: -120, bottom: -14 }} />
      </div>
      <div style={{ marginTop: 22, fontFamily: SANS, fontSize: 24, lineHeight: 1.35, color: "rgba(250,240,202,0.8)" }}>{label}</div>
    </Rise>
  );
};

export const Close: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lift = ramp(f, BRAND_AT - 10, 32);
  const mark = pop(f, fps, BRAND_AT, 12);
  return (
    <Paper color={C.navy}>
      <AbsoluteFill style={{ color: C.cream, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 50, marginTop: interpolate(lift, [0, 1], [320, 96]), transform: `scale(${1 - 0.2 * lift})` }}>
          {STATS.map(([v, l], i) => (
            <Stat key={v} value={v} label={l} at={6 + i * 12} i={i} />
          ))}
        </div>
        {f >= BRAND_AT ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 40 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 34, transform: `scale(${0.8 + 0.2 * mark}) rotate(${(1 - mark) * -3}deg)` }}>
              <Logo size={120} style={{ boxShadow: `9px 9px 0 ${C.gold}` }} />
              <div style={{ fontFamily: SERIF, fontSize: 140, fontWeight: 700, letterSpacing: "-0.02em" }}>{BRAND}</div>
            </div>
            <Stripes width={620} height={10} p={ramp(f, BRAND_AT + 10, 26)} style={{ marginTop: 18 }} />
            <Rise at={BRAND_AT + 16} y={18} style={{ marginTop: 26, fontFamily: SANS, fontSize: 40, fontWeight: 500, color: C.gold }}>
              {TAGLINE}
            </Rise>
            <Rise at={BRAND_AT + 28} y={18} style={{ display: "flex", alignItems: "center", gap: 24, marginTop: 34 }}>
              <Tag tone="gold" size={28} style={{ fontWeight: 800 }}>
                {SITE}
              </Tag>
              <span style={{ fontFamily: SANS, fontSize: 24, color: "rgba(250,240,202,0.75)" }}>{REPO}</span>
            </Rise>
          </div>
        ) : null}
        <Rise at={BRAND_AT + 40} y={10} style={{ position: "absolute", bottom: 56, fontFamily: SANS, fontSize: 20, color: "rgba(250,240,202,0.55)" }}>
          Built at the Grok Bot Community Engineering London Hackathon · 22 Oct 2026
        </Rise>
      </AbsoluteFill>
    </Paper>
  );
};
