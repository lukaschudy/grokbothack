import React from "react";
import { Phone, PhoneOff, Send } from "lucide-react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND, CALL_SCRIPT, CALLED, CARA, RESULT, WINDOW } from "./data";
import { Avatar, C, Card, easeInOut, Highlight, Logo, Paper, pop, ramp, Rise, SANS, SERIF, Stamp, Tag, Underline } from "./ui";

const CLICK = 78;
const PROMPT_END = 112;
const RING = 128;
const ANSWER = 196;
const FRAMES_PER_WORD = 6;
const GAP = 10;

const LINES = (() => {
  let t = ANSWER + 16;
  return CALL_SCRIPT.map((l) => {
    const words = l.text.split(" ");
    const start = t;
    const end = start + words.length * FRAMES_PER_WORD + 6;
    t = end + GAP;
    return { ...l, words, start, end };
  });
})();
const HANGUP = LINES[LINES.length - 1].end + 10;
const RESULT_AT = HANGUP + 8;
export const CALL_DUR = RESULT_AT + 150;

const clock = (frames: number) => {
  const s = Math.max(0, Math.floor(frames / 30));
  const ss = s % 60;
  return `${Math.floor(s / 60)}:${ss < 10 ? "0" : ""}${ss}`;
};

/** A chunky button that physically presses down when clicked. */
const PressButton: React.FC<{ down: boolean; bg: string; color: string; shadow?: string; size?: number; children: React.ReactNode }> = ({ down, bg, color, shadow = C.navy, size = 25, children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: `${size * 0.66}px ${size * 1.3}px`, borderRadius: 12, border: `3px solid ${C.navy}`, background: bg, color, fontFamily: SANS, fontSize: size, fontWeight: 700, boxShadow: down ? "none" : `5px 5px 0 ${shadow}`, transform: down ? "translate(5px, 5px)" : undefined }}>{children}</div>
);

const Cursor: React.FC<{ f: number }> = ({ f }) => {
  const move = ramp(f, 34, 40, easeInOut);
  const down = f >= CLICK && f < CLICK + 6 ? 0.85 : 1;
  return (
    <div style={{ position: "absolute", left: 160, top: 46, transform: `translate(${(1 - move) * 560}px, ${(1 - move) * 260}px)`, opacity: f < 26 ? 0 : 1 }}>
      <svg width={46} height={54} viewBox="0 0 22 26" style={{ transform: `scale(${down})`, transformOrigin: "top left" }}>
        <path d="M1 1 L1 20 L6 15.5 L9.5 23.5 L13 22 L9.6 14.2 L16 14.2 Z" fill={C.navy} stroke={C.paper} strokeWidth={1.6} strokeLinejoin="round" />
      </svg>
    </div>
  );
};

const Prompt: React.FC<{ f: number; out: number }> = ({ f, out }) => {
  const down = f >= CLICK && f < CLICK + 7;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: 1 - out, transform: `translateY(${-out * 80}px)` }}>
      <Rise at={0} y={50} tilt={-2}>
        <Card style={{ width: 1040, padding: "52px 60px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Tag tone="tomato">OK to call</Tag>
            <div style={{ fontFamily: SANS, fontSize: 20, color: C.muted }}>
              {CALLED.name} · {CALLED.address}
            </div>
          </div>
          <div style={{ marginTop: 22, fontFamily: SERIF, fontSize: 54, fontWeight: 700, lineHeight: 1.12 }}>Call {CALLED.name} to check the date?</div>
          <div style={{ marginTop: 12, fontFamily: SANS, fontSize: 26, color: C.muted }}>{WINDOW} · 80 people · takes about a minute</div>
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 36, marginTop: 40 }}>
            <PressButton down={down} bg={C.tomato} color={C.paper}>
              <Phone size={24} strokeWidth={2.6} /> Call now
            </PressButton>
            <div style={{ fontFamily: SANS, fontSize: 24, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 6 }}>Not now</div>
            <Cursor f={f} />
          </div>
        </Card>
      </Rise>
      <Rise at={18} y={20} style={{ position: "relative", marginTop: 54, fontFamily: SERIF, fontSize: 42, fontWeight: 700, color: C.navy }}>
        It never dials on its own. Cara confirms.
        <Underline width={300} p={ramp(f, 34, 14)} color={C.tomato} seed={5} style={{ position: "absolute", right: 0, bottom: -20 }} />
      </Rise>
    </AbsoluteFill>
  );
};

const Waveform: React.FC<{ f: number; who: "agent" | "venue" | null }> = ({ f, who }) => {
  const bars = 64;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, height: 76 }}>
      {Array.from({ length: bars }, (_, i) => {
        const env = Math.sin((i / bars) * Math.PI);
        const n = Math.abs(Math.sin(i * 0.9 + f * 0.37) * Math.sin(i * 0.31 - f * 0.13) + 0.35 * Math.sin(i * 2.3 + f * 0.71));
        const h = who ? 6 + 66 * env * Math.min(1, n) : 6;
        return <div key={i} style={{ flex: 1, height: h, borderRadius: 2, background: who === "agent" ? C.navy : who === "venue" ? C.tomato : C.line }} />;
      })}
    </div>
  );
};

const PhoneMock: React.FC<{ f: number }> = ({ f }) => {
  const ringing = f >= RING && f < ANSWER;
  const live = f >= ANSWER && f < HANGUP;
  const burst = Math.floor((f - RING) / 22) % 2 === 0;
  const shake = ringing && burst ? Math.sin(f * 2.1) * 2.6 : 0;
  const ring = ((f - RING) % 36) / 36;
  const accept = f >= ANSWER - 8 && f < ANSWER;
  const status = f < RING ? "Waiting…" : ringing ? "Incoming call" : live ? clock(f - ANSWER) : "Call ended";
  const round = (bg: string, icon: React.ReactNode, down = false) => (
    <div style={{ width: 86, height: 86, borderRadius: "50%", background: bg, border: `3px solid ${C.navy}`, boxShadow: down ? "none" : `4px 4px 0 ${C.navy}`, transform: down ? "translate(4px, 4px)" : undefined, display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</div>
  );
  return (
    <div style={{ position: "absolute", left: 190, top: 140, width: 380, height: 770, padding: 14, borderRadius: 60, background: C.navy, boxShadow: `14px 14px 0 ${C.tomato}`, transform: `rotate(${-2 + shake}deg)` }}>
      <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 46, overflow: "hidden", background: C.paper, color: C.navy, display: "flex", flexDirection: "column", alignItems: "center", padding: "78px 28px 54px" }}>
        <div style={{ position: "absolute", top: 14, width: 110, height: 30, borderRadius: 20, background: C.navy }} />
        <div style={{ fontFamily: SANS, fontSize: 20, fontWeight: 600, color: C.muted, fontVariantNumeric: "tabular-nums" }}>{status}</div>
        <div style={{ marginTop: 6, fontFamily: SERIF, fontSize: 50, fontWeight: 700 }}>{BRAND}</div>
        <div style={{ marginTop: 4, fontFamily: SANS, fontSize: 18, color: C.muted, textAlign: "center" }}>AI assistant for {CARA.name}</div>
        <div style={{ position: "relative", marginTop: 84, width: 150, height: 150, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {ringing
            ? [0, 0.5].map((o) => {
                const r = (ring + o) % 1;
                return <div key={o} style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `4px solid ${C.tomato}`, opacity: 1 - r, transform: `scale(${1 + r * 1.1})` }} />;
              })
            : null}
          {live ? <div style={{ position: "absolute", inset: -16, borderRadius: "50%", background: C.gold, transform: `scale(${1 + 0.1 * Math.abs(Math.sin(f / 5))})` }} /> : null}
          <Logo size={150} style={{ position: "relative" }} />
        </div>
        <div style={{ flex: 1 }} />
        {f < ANSWER ? (
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%", padding: "0 16px" }}>
            {round(C.tomato, <PhoneOff size={36} color={C.paper} />)}
            {round(C.gold, <Phone size={36} color={C.navy} />, accept)}
          </div>
        ) : (
          round(live ? C.tomato : C.cream, <PhoneOff size={36} color={live ? C.paper : C.faint} />)
        )}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: -66, textAlign: "center", fontFamily: SANS, fontSize: 22, fontWeight: 700, color: C.navy }}>Sam&apos;s phone at {CALLED.name}</div>
    </div>
  );
};

const STEPS = ["Dialling", "Ringing", "Talking", "Noted"];

const CallCard: React.FC<{ f: number }> = ({ f }) => {
  const { fps } = useVideoConfig();
  const speaking = LINES.find((l) => f >= l.start && f < l.end - 4);
  const step = f < RING ? 0 : f < ANSWER ? 1 : f < HANGUP ? 2 : 3;
  const result = pop(f, fps, RESULT_AT, 20);
  const blink = Math.floor(f / 12) % 2 === 0 ? 1 : 0.25;
  return (
    <Card style={{ position: "absolute", left: 670, top: 100, width: 1110, height: 870, padding: "44px 56px", overflow: "hidden", fontFamily: SANS }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 16, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: step === 2 ? C.tomato : C.navy }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "currentColor", opacity: step === 3 ? 1 : blink }} />
          {step === 3 ? "Call done" : step === 2 ? "Live call" : STEPS[step]}
        </div>
        <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: 0, fontVariantNumeric: "tabular-nums" }}>{clock(Math.min(f, HANGUP) - ANSWER)}</div>
      </div>
      <div style={{ marginTop: 8, fontFamily: SERIF, fontSize: 48, fontWeight: 700 }}>{CALLED.name}</div>
      <div style={{ marginTop: 2, fontSize: 20, color: C.muted }}>
        {CALLED.phone} · {WINDOW} · 80 people
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 22 }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ fontSize: 16, fontWeight: 600, color: i <= step ? C.navy : C.faint }}>
            <div style={{ height: 6, borderRadius: 3, marginBottom: 8, background: i < step ? C.navy : i === step ? C.tomato : C.line }} />
            {s}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 24 }}>
        <Waveform f={f} who={speaking ? speaking.who : null} />
        <div style={{ display: "flex", gap: 26, marginTop: 8, fontSize: 16, fontWeight: 600, color: C.muted }}>
          <span>
            <b style={{ display: "inline-block", width: 11, height: 11, marginRight: 8, borderRadius: "50%", background: C.navy }} />
            {BRAND}
          </span>
          <span>
            <b style={{ display: "inline-block", width: 11, height: 11, marginRight: 8, borderRadius: "50%", background: C.tomato }} />
            Sam, {CALLED.name}
          </span>
        </div>
      </div>
      <div style={{ position: "relative", height: 410, marginTop: 22 }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 16, overflow: "hidden", opacity: 1 - result, WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 26%)" }}>
          {LINES.filter((l) => f >= l.start).map((l, k) => {
            const grow = ramp(f, l.start, 12);
            return (
              <div key={k} style={{ maxHeight: grow * 160, opacity: grow, flex: "none" }}>
                <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: l.who === "agent" ? C.faint : C.tomato }}>{l.who === "agent" ? BRAND : "Sam"}</div>
                <div style={{ marginTop: 2, fontSize: 28, lineHeight: 1.38 }}>
                  {l.words.map((w, i) => (
                    <span key={i} style={{ opacity: interpolate(f - l.start - i * FRAMES_PER_WORD, [0, FRAMES_PER_WORD], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
                      {w}{" "}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {f >= RESULT_AT ? (
          <div style={{ position: "absolute", inset: 0, opacity: result, transform: `translateY(${(1 - result) * 40}px)` }}>
            <div style={{ padding: "18px 26px", borderRadius: 10, border: `3px solid ${C.navy}`, background: C.gold, fontFamily: SERIF, fontSize: 36, fontWeight: 700 }}>{RESULT.heading}</div>
            <div style={{ display: "grid", gridTemplateColumns: "190px 1fr", rowGap: 14, marginTop: 24, fontSize: 24 }}>
              {RESULT.rows.map(([k, v], i) => (
                <React.Fragment key={k}>
                  <Rise at={RESULT_AT + 8 + i * 5} y={12} style={{ color: C.muted }}>
                    {k}
                  </Rise>
                  <Rise at={RESULT_AT + 8 + i * 5} y={12} style={{ fontWeight: 600 }}>
                    {v}
                  </Rise>
                </React.Fragment>
              ))}
            </div>
            <Stamp at={RESULT_AT + 40} rotate={-9} size={30} style={{ position: "absolute", right: 10, bottom: 34 }}>
              Confirmed by phone
            </Stamp>
          </div>
        ) : null}
      </div>
    </Card>
  );
};

export const Call: React.FC = () => {
  const f = useCurrentFrame();
  const out = ramp(f, PROMPT_END - 18, 20, easeInOut);
  const enter = ramp(f, PROMPT_END - 8, 26);
  return (
    <Paper color={C.gold}>
      <AbsoluteFill style={{ color: C.navy }}>
        {f < PROMPT_END + 8 ? <Prompt f={f} out={out} /> : null}
        {f >= PROMPT_END - 8 ? (
          <AbsoluteFill style={{ opacity: Math.min(1, enter * 2), transform: `translateY(${(1 - enter) * 120}px)` }}>
            <PhoneMock f={f} />
            <CallCard f={f} />
          </AbsoluteFill>
        ) : null}
      </AbsoluteFill>
    </Paper>
  );
};

export const REQUEST_DUR = 200;
const SEND = 62;

export const Request: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fly = ramp(f, SEND + 4, 26, easeInOut);
  const sent = pop(f, fps, SEND + 24, 12);
  const fields: [string, string][] = [
    ["To", `${CALLED.name} · events inbox`],
    ["Reply-To, CC", `${CARA.name}, ${CARA.community}`],
    ["Subject", `Room for 80 · ${WINDOW}`]
  ];
  return (
    <Paper color={C.cream}>
      <AbsoluteFill style={{ color: C.navy, alignItems: "center", justifyContent: "center" }}>
        <div style={{ opacity: 1 - fly, transform: `translate(${fly * 900}px, ${-fly * 200}px) rotate(${6 * fly}deg)` }}>
          <Rise at={0} y={50} tilt={2}>
            <Card style={{ width: 1120, padding: "42px 58px", fontFamily: SANS }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.tomato }}>Request drafted for Cara</div>
                <Avatar name={CARA.name} size={46} hue={1} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", rowGap: 12, marginTop: 20, fontSize: 22, paddingBottom: 20, borderBottom: `2px dashed ${C.line}` }}>
                {fields.map(([k, v]) => (
                  <React.Fragment key={k}>
                    <div style={{ color: C.muted }}>{k}</div>
                    <div style={{ fontWeight: 600 }}>{v}</div>
                  </React.Fragment>
                ))}
              </div>
              <div style={{ marginTop: 20, fontFamily: SERIF, fontSize: 25, lineHeight: 1.55 }}>
                Hi Sam, thanks for confirming on the phone just now. We&apos;d love the main room for Data Dumplings on Thursday 29 October, 18:30–21:30, for about 80 people. I&apos;ll send the guest list 48 hours before. Cara
              </div>
              <div style={{ marginTop: 28, width: "fit-content" }}>
                <PressButton down={f >= SEND && f < SEND + 6} bg={C.navy} color={C.paper} shadow={C.tomato} size={23}>
                  <Send size={22} /> Send
                </PressButton>
              </div>
            </Card>
          </Rise>
        </div>
        {f >= SEND + 20 ? (
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontFamily: SERIF, fontSize: 150, fontWeight: 700, opacity: f < SEND + 24 ? 0 : 1, transform: `scale(${0.6 + 0.4 * sent}) rotate(${(1 - sent) * -6}deg)` }}>
              <Highlight p={ramp(f, SEND + 30, 14)}>Sent.</Highlight>
            </div>
            <Rise at={SEND + 44} y={20} style={{ marginTop: 30, maxWidth: 1260, textAlign: "center", fontFamily: SERIF, fontSize: 42, lineHeight: 1.35, fontWeight: 500 }}>
              Saved as Kiln Lane&apos;s availability for that evening. The next organiser who asks gets this answer. <b style={{ color: C.tomato }}>No second call.</b>
            </Rise>
          </AbsoluteFill>
        ) : null}
      </AbsoluteFill>
    </Paper>
  );
};
