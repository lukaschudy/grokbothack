import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND, TAGLINE } from "./data";
import { Avatar, C, Highlight, Logo, Paper, pop, ramp, Rise, SANS, SERIF, Stripes, Underline } from "./ui";

const NEED = ["80 people.", "Next Thursday.", "Near Old Street.", "Free."];

// Fictional group-chat replies.
const DMS = [
  { who: "Cara Lin", text: "anyone know a free room for 80 near Old St next Thursday?", x: 1150, y: 110, r: -2.5, seen: false },
  { who: "Priya Shah", text: "try the studio on Kiln Lane? not sure they do evenings", x: 1230, y: 285, r: 1.8, seen: false },
  { who: "Tom Webb", text: "we're booked that week, sorry!", x: 1170, y: 450, r: -1.2, seen: true },
  { who: "Jo King", text: "could you do 40 instead?", x: 1340, y: 575, r: 2.4, seen: false },
  { who: "Mo Ali", text: "our office stopped hosting", x: 1190, y: 705, r: -1.8, seen: true }
];

const Bubble: React.FC<{ who: string; text: string; x: number; y: number; r: number; seen: boolean; at: number; hue: number }> = ({ who, text, x, y, r, seen, at, hue }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = pop(f, fps, at, 12);
  return (
    <div style={{ position: "absolute", left: x, top: y, display: "flex", gap: 16, alignItems: "flex-end", opacity: f < at ? 0 : 1, transform: `scale(${0.5 + 0.5 * p}) rotate(${r + (1 - p) * 8}deg)`, transformOrigin: "left bottom" }}>
      <Avatar name={who} size={54} hue={hue} />
      <div>
        <div style={{ maxWidth: 500, padding: "16px 22px", borderRadius: "22px 22px 22px 4px", background: C.paper, border: `2.5px solid ${C.navy}`, boxShadow: `6px 6px 0 ${C.navy}`, color: C.navy, fontFamily: SANS, fontSize: 26, lineHeight: 1.35 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.muted, marginBottom: 2 }}>{who}</div>
          {text}
        </div>
        {seen ? <div style={{ marginTop: 8, fontFamily: SANS, fontSize: 16, fontWeight: 600, color: C.tomato }}>Seen, no reply</div> : null}
      </div>
    </div>
  );
};

export const Problem: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dim = ramp(f, 96, 36);
  return (
    <Paper color={C.cream}>
      <AbsoluteFill style={{ color: C.navy }}>
        <div style={{ position: "absolute", left: 140, top: 150, opacity: 1 - 0.35 * dim }}>
          {NEED.map((line, i) => {
            const at = 6 + i * 16;
            const p = pop(f, fps, at, 16);
            const last = i === NEED.length - 1;
            return (
              <div key={line} style={{ fontFamily: SERIF, fontSize: 120, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.12, opacity: f < at ? 0 : 1, transform: `translateY(${(1 - p) * 60}px)` }}>
                {last ? <Highlight p={ramp(f, at + 8, 14)}>{line}</Highlight> : line}
              </div>
            );
          })}
        </div>
        {DMS.map((m, i) => (
          <Bubble key={m.who} {...m} at={92 + i * 11} hue={i} />
        ))}
        <Rise at={150} style={{ position: "absolute", left: 140, bottom: 100, fontFamily: SERIF, fontSize: 66, fontWeight: 700 }}>
          Today: <span style={{ position: "relative" }}>
            a week of DMs.
            <Underline width={430} p={ramp(f, 160, 16)} seed={3} style={{ position: "absolute", left: 0, bottom: -18 }} />
          </span>
        </Rise>
      </AbsoluteFill>
    </Paper>
  );
};

export const Title: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mark = pop(f, fps, 4, 11);
  return (
    <Paper color={C.navy}>
      <AbsoluteFill style={{ color: C.cream, alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
          <Logo size={170} style={{ transform: `scale(${mark}) rotate(${(1 - mark) * -25}deg)`, boxShadow: `12px 12px 0 ${C.gold}` }} />
          <div style={{ display: "flex", fontFamily: SERIF, fontSize: 196, fontWeight: 700, letterSpacing: "-0.025em" }}>
            {BRAND.split("").map((ch, i) => {
              const p = pop(f, fps, 12 + i * 2.5, 16);
              return (
                <span key={i} style={{ display: "inline-block", opacity: f < 12 + i * 2.5 ? 0 : 1, transform: `translateY(${(1 - p) * 70}px)` }}>
                  {ch}
                </span>
              );
            })}
          </div>
        </div>
        <Stripes width={760} height={12} p={ramp(f, 30, 30)} style={{ marginTop: 26, marginLeft: 220 }} />
        <Rise at={46} y={20} style={{ marginTop: 34, marginLeft: 220, width: 760, fontFamily: SANS, fontSize: 46, fontWeight: 500, color: C.gold }}>
          {TAGLINE}
        </Rise>
      </AbsoluteFill>
    </Paper>
  );
};
