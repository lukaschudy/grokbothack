import React from "react";
import { Search } from "lucide-react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { CARA, CLASH, QUERY, RESULTS, SEARCH_SECONDS, WINDOW, type VenueRow } from "./data";
import { Avatar, C, Card, Loop, Paper, pop, ramp, Rise, SANS, SERIF, Tag, Tape, type Tone } from "./ui";

export const ASK_DUR = 420;
const TYPE_AT = 24;
const CHARS_PER_FRAME = 0.8;
const PRESS = TYPE_AT + Math.ceil(QUERY.length / CHARS_PER_FRAME) + 8;
const FOUND = PRESS + 14;
const ROW_AT = [FOUND + 10, FOUND + 26, FOUND + 42];
const CLASH_AT = 236;
const FOCUS_AT = 296;

const toneFor = (reason: string): Tone => {
  if (reason.startsWith("OK to call")) return "tomato";
  if (reason.startsWith("Hosted")) return "sandy";
  if (reason.startsWith("Fits") || reason.startsWith("Seen hosting") || reason.startsWith("Free")) return "gold";
  return "outline";
};

const Row: React.FC<{ v: VenueRow; i: number; at: number; focus: number }> = ({ v, i, at, focus }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = pop(f, fps, at, 16);
  return (
    <div style={{ position: "relative", display: "grid", gridTemplateColumns: "44px 1fr", padding: "24px 0", borderTop: `2px dashed ${C.line}`, opacity: f < at ? 0 : 1, transform: `translateY(${(1 - p) * 40}px)` }}>
      <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 700, color: C.faint }}>{i + 1}</div>
      <div>
        <div style={{ position: "relative", display: "flex", alignItems: "baseline", gap: 16 }}>
          {i === 0 ? <Loop w={400} h={80} p={focus} style={{ left: -28, top: -14 }} /> : null}
          <div style={{ fontFamily: SERIF, fontSize: 36, fontWeight: 700, letterSpacing: "-0.01em" }}>{v.name}</div>
          <div style={{ fontFamily: SANS, fontSize: 18, color: C.muted }}>
            {v.kind} · {v.area}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
          {v.reasons.map((r, k) => (
            <Rise key={r} at={at + 6 + k * 4} y={10} dur={14}>
              <Tag tone={toneFor(r)} size={16}>
                {r}
              </Tag>
            </Rise>
          ))}
        </div>
      </div>
    </div>
  );
};

const SCALE = 0.33; // px per metre
const MapPanel: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cx = 290;
  const cy = 300;
  const pulse = (f % 40) / 40;
  const show = ramp(f, 30, 30);
  return (
    <svg width={580} height={600} style={{ display: "block" }}>
      <g opacity={show}>
        {[0, 34, -58, 98, 150].map((deg, k) => (
          <line key={deg} x1={cx - 520} y1={cy} x2={cx + 520} y2={cy} transform={`rotate(${deg} ${cx} ${cy})`} stroke="rgba(250,240,202,0.13)" strokeWidth={k === 0 ? 18 : 10} />
        ))}
        {[250, 500, 750].map((m) => (
          <g key={m}>
            <circle cx={cx} cy={cy} r={m * SCALE} fill="none" stroke={C.gold} strokeOpacity={0.55} strokeDasharray="2 10" strokeLinecap="round" strokeWidth={3} />
            <text x={cx - m * SCALE * 0.71 - 52} y={cy + m * SCALE * 0.71 + 20} fill={C.gold} fontSize={16} fontWeight={600} fontFamily={SANS}>
              {m} m
            </text>
          </g>
        ))}
        <text x={cx - 236} y={cy - 18} fill="rgba(250,240,202,0.45)" fontSize={16} fontFamily={SANS}>
          Old St
        </text>
      </g>
      <circle cx={cx} cy={cy} r={12 + 30 * pulse} fill="none" stroke={C.cream} strokeWidth={3} opacity={(1 - pulse) * show} />
      <circle cx={cx} cy={cy} r={12} fill={C.cream} stroke={C.navy} strokeWidth={4} opacity={show} />
      <text x={cx - 20} y={cy + 36} textAnchor="end" fill={C.cream} fontSize={20} fontWeight={700} fontFamily={SANS} opacity={show}>
        Old Street
      </text>
      {RESULTS.map((v, i) => {
        const p = pop(f, fps, ROW_AT[i], 11);
        const rad = (v.bearing * Math.PI) / 180;
        const x = cx + Math.sin(rad) * v.distance * SCALE;
        const y = cy - Math.cos(rad) * v.distance * SCALE;
        const hot = i === 0;
        return (
          <g key={v.name} opacity={f < ROW_AT[i] ? 0 : 1} transform={`translate(${x} ${y - (1 - p) * 50})`}>
            <circle r={22} fill={hot ? C.tomato : C.gold} stroke={C.navy} strokeWidth={3} />
            <text y={7} textAnchor="middle" fill={hot ? C.paper : C.navy} fontSize={20} fontWeight={800} fontFamily={SANS}>
              {i + 1}
            </text>
            <text x={32} y={6} fill={C.cream} fontSize={17} fontWeight={600} fontFamily={SANS}>
              {v.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export const Ask: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const typed = QUERY.slice(0, Math.max(0, Math.floor((f - TYPE_AT) * CHARS_PER_FRAME)));
  const typing = f >= TYPE_AT && f < PRESS;
  const caret = typing || Math.floor(f / 15) % 2 === 0 ? 1 : 0;
  const pressed = f >= PRESS && f < PRESS + 6;
  const found = ramp(f, FOUND, 16);
  const secs = interpolate(f, [PRESS, FOUND], [0, SEARCH_SECONDS], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const focus = ramp(f, FOCUS_AT, 22);
  const clash = pop(f, fps, CLASH_AT, 13);

  return (
    <Paper color={C.cream}>
      <AbsoluteFill style={{ color: C.navy, fontFamily: SANS }}>
        <Rise at={0} y={40} style={{ position: "absolute", left: 100, top: 86 }}>
          <Card style={{ width: 1070, height: 890, padding: "40px 52px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Avatar name={CARA.name} size={46} hue={1} />
              <div style={{ fontSize: 19, color: C.muted }}>
                <b style={{ color: C.navy, fontWeight: 700 }}>{CARA.name}</b> · {CARA.community}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 22, paddingBottom: 14, borderBottom: `3px solid ${C.navy}` }}>
              <div style={{ flex: 1, fontSize: 36, fontWeight: 500, minHeight: 50, whiteSpace: "nowrap" }}>
                {typed || <span style={{ color: C.faint }}>Ask for a room…</span>}
                <span style={{ display: "inline-block", width: 3, height: 38, marginLeft: 3, verticalAlign: -6, background: C.tomato, opacity: caret }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 26px", borderRadius: 10, border: `2.5px solid ${C.navy}`, background: C.tomato, color: C.paper, fontSize: 22, fontWeight: 700, boxShadow: pressed ? "none" : `4px 4px 0 ${C.navy}`, transform: pressed ? "translate(4px, 4px)" : undefined }}>
                <Search size={22} strokeWidth={2.6} /> Find
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 26, marginBottom: 6, opacity: found, transform: `translateY(${(1 - found) * 16}px)` }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
                <div style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 700 }}>3 rooms that fit</div>
                <div style={{ fontSize: 18, color: C.muted }}>{WINDOW} · 80 people</div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.tomato, fontVariantNumeric: "tabular-nums" }}>found in {secs.toFixed(1)}s</div>
            </div>
            {RESULTS.map((v, i) => (
              <Row key={v.name} v={v} i={i} at={ROW_AT[i]} focus={i === 0 ? focus : 0} />
            ))}
          </Card>
        </Rise>

        <Rise at={12} y={40} style={{ position: "absolute", left: 1232, top: 86 }}>
          <div style={{ width: 590, height: 890, borderRadius: 14, border: `3px solid ${C.navy}`, background: C.navy, boxShadow: `10px 10px 0 ${C.sandy}`, overflow: "hidden" }}>
            <div style={{ padding: "26px 28px 0", fontSize: 16, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.gold }}>Within 750 m of Old Street</div>
            <MapPanel />
          </div>
        </Rise>

        <div style={{ position: "absolute", left: 1196, top: 744, width: 590, padding: "34px 32px 28px", background: C.gold, color: C.navy, boxShadow: `8px 8px 0 ${C.navy}`, opacity: f < CLASH_AT ? 0 : 1, transform: `translateY(${(1 - clash) * 80}px) rotate(${-2.5 + (1 - clash) * 6}deg)` }}>
          <Tape rotate={-3} style={{ top: -18, left: 230 }} />
          <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 700 }}>Heads up: same evening</div>
          <div style={{ marginTop: 8, fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>{CLASH.title}</div>
          <div style={{ marginTop: 6, fontSize: 18, color: C.muted }}>
            {CLASH.going} going · {CLASH.where} · {CLASH.when}
          </div>
        </div>
      </AbsoluteFill>
    </Paper>
  );
};
