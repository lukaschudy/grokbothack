import React from "react";
import { Check, Link2, Phone, ShieldAlert } from "lucide-react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ADA, BEN, CALLED, CARA } from "./data";
import { Avatar, boil, C, Card, easeInOut, Paper, pop, ramp, Rise, SANS, SERIF, Stamp, Tag, Underline } from "./ui";

const TITLE_UP = 62;
const P0 = 92;
const HOLD = 124;
const MOVE = 30;
const panelAt = (i: number) => P0 + i * (HOLD + MOVE);
export const TRUST_DUR = panelAt(3) + HOLD + 16;
const SHADOWS = [C.gold, C.sandy, C.tomato, C.gold];

const Heading: React.FC<{ n: number; at: number; children: React.ReactNode }> = ({ n, at, children }) => (
  <Rise at={at} y={24} style={{ display: "flex", alignItems: "center", gap: 22, marginBottom: 36, color: C.cream }}>
    <div style={{ width: 62, height: 62, borderRadius: "50%", background: C.gold, color: C.navy, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: SERIF, fontSize: 32, fontWeight: 700 }}>{n}</div>
    <div style={{ fontFamily: SERIF, fontSize: 58, fontWeight: 700 }}>{children}</div>
  </Rise>
);

const Answer: React.FC<{ q: string; a: string; at: number }> = ({ q, a, at }) => (
  <Rise at={at} y={14} dur={16} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 25 }}>
    <div style={{ width: 34, height: 34, borderRadius: "50%", background: C.gold, border: `2.5px solid ${C.navy}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Check size={19} color={C.navy} strokeWidth={3.2} />
    </div>
    <span style={{ color: C.muted }}>{q}</span>
    <b style={{ fontWeight: 700 }}>{a}</b>
  </Rise>
);

const AddVenue: React.FC<{ at: number }> = ({ at }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pasted = f >= at + 14;
  const flash = pasted ? 1 - ramp(f, at + 14, 22) : 0;
  const live = pop(f, fps, at + 92, 11);
  return (
    <>
      <Heading n={1} at={at}>Add a room: paste a Luma link.</Heading>
      <Rise at={at + 4} y={40} tilt={-1.5}>
        <Card shadow={SHADOWS[0]} style={{ width: 1240, padding: "38px 52px", fontFamily: SANS }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 19, color: C.muted }}>
            <Avatar name={ADA.name} size={42} hue={0} />
            <b style={{ color: C.navy, fontWeight: 700 }}>{ADA.name}</b> · {ADA.community}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 20, padding: "14px 20px", borderRadius: 10, border: `2.5px solid ${C.navy}`, background: flash > 0 ? `rgba(244,211,94,${0.25 + 0.75 * flash})` : C.paper, fontSize: 30, fontWeight: 500 }}>
            <Link2 size={30} color={C.navy} />
            {pasted ? <span>{CALLED.luma}</span> : <span style={{ color: C.faint }}>Paste a Luma event link</span>}
          </div>
          <Rise at={at + 30} y={16} style={{ marginTop: 26, display: "flex", alignItems: "baseline", gap: 18 }}>
            <div style={{ fontFamily: SERIF, fontSize: 40, fontWeight: 700 }}>{CALLED.name}</div>
            <div style={{ fontSize: 20, color: C.muted }}>{CALLED.address}</div>
          </Rise>
          <Rise at={at + 38} y={12} style={{ marginTop: 10 }}>
            <Tag tone="sandy" size={18}>
              Hosted {CALLED.lumaEvent} · 8 Oct · {CALLED.went} went
            </Tag>
          </Rise>
          <div style={{ display: "grid", gap: 14, marginTop: 26 }}>
            <Answer q="How many fit?" a="120 standing" at={at + 52} />
            <Answer q="Free for community events?" a="Yes" at={at + 64} />
            <Answer q="OK for the agent to call?" a="Yes" at={at + 76} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 30, opacity: f < at + 92 ? 0 : 1, transform: `scale(${0.7 + 0.3 * live})`, transformOrigin: "left center" }}>
            <Tag tone="navy" size={22}>
              <span style={{ width: 11, height: 11, borderRadius: "50%", background: C.gold }} /> Live
            </Tag>
            <span style={{ fontSize: 22, color: C.muted }}>Every organiser can find it now.</span>
          </div>
        </Card>
      </Rise>
    </>
  );
};

/** Hand-drawn arc arrow from x1 to x2, drawn on over `p`. */
const Arrow: React.FC<{ x1: number; x2: number; y: number; p: number; color: string; seed: number }> = ({ x1, x2, y, p, color, seed }) => {
  const k = boil(useCurrentFrame());
  const j = (n: number) => Math.sin((k + seed) * 91.7 + n * 13.1) * 2.5;
  const mid = (x1 + x2) / 2;
  const head = interpolate(p, [0.85, 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <g fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M ${x1} ${y + j(1)} Q ${mid + j(2)} ${y - 70 + j(3)} ${x2} ${y + j(4)}`} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
      <path d={`M ${x2 - 28} ${y - 12 + j(5)} L ${x2} ${y + j(4)} L ${x2 - 12} ${y - 30 + j(6)}`} opacity={head} />
    </g>
  );
};

const NODES = [
  { p: ADA, x: 210, hue: 0 },
  { p: BEN, x: 620, hue: 1 },
  { p: CARA, x: 1030, hue: 2 }
];

const Vouch: React.FC<{ at: number }> = ({ at }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const draw = ramp(f, at + 22, 26, easeInOut);
  const approved = f >= at + 56;
  const badge = pop(f, fps, at + 56, 10);
  const badges = [
    <Tag key="a" tone="navy">Root organiser</Tag>,
    <Tag key="b" tone="gold">Can post</Tag>,
    approved ? (
      <Tag key="c" tone="gold" style={{ transform: `scale(${0.7 + 0.3 * badge})` }}>
        Can post
      </Tag>
    ) : (
      <Tag key="c" tone="outline">Waiting for a vouch</Tag>
    )
  ];
  const y = 140;
  return (
    <>
      <Heading n={2} at={at}>Posting needs a vouch.</Heading>
      <Rise at={at + 4} y={40} tilt={1.5}>
        <Card shadow={SHADOWS[1]} style={{ position: "relative", width: 1240, height: 480, fontFamily: SANS }}>
          <svg width={1240} height={480} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            <Arrow x1={NODES[0].x + 90} x2={NODES[1].x - 90} y={y - 20} p={1} color={C.faint} seed={1} />
            <Arrow x1={NODES[1].x + 90} x2={NODES[2].x - 90} y={y - 20} p={draw} color={C.tomato} seed={2} />
          </svg>
          <div style={{ position: "absolute", left: (NODES[0].x + NODES[1].x) / 2 - 44, top: y - 118, fontSize: 19, fontWeight: 600, color: C.muted }}>vouched</div>
          <div style={{ position: "absolute", left: (NODES[1].x + NODES[2].x) / 2 - 46, top: y - 118, fontSize: 21, fontWeight: 800, color: C.tomato, opacity: draw > 0.5 ? 1 : 0 }}>vouches</div>
          {NODES.map((n, i) => (
            <div key={n.p.name} style={{ position: "absolute", left: n.x - 160, width: 320, top: y - 70, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
              <Avatar name={n.p.name} size={140} hue={n.hue} style={{ boxShadow: `6px 6px 0 ${C.navy}` }} />
              <div style={{ marginTop: 18, fontFamily: SERIF, fontSize: 32, fontWeight: 700 }}>{n.p.name}</div>
              <div style={{ marginTop: 2, fontSize: 19, color: C.muted }}>{n.p.community}</div>
              <div style={{ marginTop: 12 }}>{badges[i]}</div>
            </div>
          ))}
          <Rise at={at + 74} y={14} style={{ position: "absolute", left: 52, right: 52, bottom: 32, display: "flex", alignItems: "center", gap: 14, fontSize: 24, fontWeight: 600 }}>
            <ShieldAlert size={30} color={C.tomato} strokeWidth={2.4} />
            If Cara posts junk, Ben loses the right to vouch.
          </Rise>
        </Card>
      </Rise>
    </>
  );
};

const Blocked: React.FC<{ at: number }> = ({ at }) => {
  const f = useCurrentFrame();
  const POST = at + 34;
  const down = f >= POST && f < POST + 6;
  const shake = f >= POST && f < POST + 16 ? Math.sin((f - POST) * 2.4) * 14 * (1 - (f - POST) / 16) : 0;
  return (
    <>
      <Heading n={3} at={at}>No vouch, no post.</Heading>
      <Rise at={at + 4} y={40} tilt={-1}>
        <Card shadow={SHADOWS[2]} style={{ position: "relative", width: 1240, padding: "38px 52px 44px", transform: `translateX(${shake}px)`, fontFamily: SANS }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 19, color: C.muted }}>
            <div style={{ width: 42, height: 42, borderRadius: "50%", border: `2.5px dashed ${C.navy}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.navy, fontWeight: 800 }}>?</div>
            <b style={{ color: C.navy, fontWeight: 700 }}>new_account_47</b> · no vouches
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 20 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 16, padding: "14px 20px", borderRadius: 10, border: `2.5px solid ${C.navy}`, fontSize: 30, fontWeight: 500 }}>
              <Link2 size={30} color={C.navy} />
              <Rise at={at + 12} y={0} dur={6}>
                lu.ma/totally-real-venue
              </Rise>
            </div>
            <div style={{ padding: "16px 30px", borderRadius: 12, border: `3px solid ${C.navy}`, background: C.navy, color: C.paper, fontSize: 24, fontWeight: 700, boxShadow: down ? "none" : `5px 5px 0 ${C.tomato}`, transform: down ? "translate(5px, 5px)" : undefined }}>Post venue</div>
          </div>
          <Rise at={POST + 14} y={10} style={{ marginTop: 34, fontSize: 26, fontWeight: 600 }}>
            Posting needs a vouch from an approved organiser.
          </Rise>
          <Stamp at={POST + 4} rotate={-7} size={64} style={{ position: "absolute", right: 70, bottom: 26 }}>
            Blocked
          </Stamp>
        </Card>
      </Rise>
    </>
  );
};

const FIELDS: { field: string; value: string; by: string; when: string; phone: boolean }[] = [
  { field: "Capacity", value: "120 standing", by: "Ada, then Sam by phone", when: "Confirmed 22 Oct, 19:42", phone: true },
  { field: "Price", value: "Free for tech meetups", by: "Sam by phone", when: "Confirmed 22 Oct, 19:42", phone: true },
  { field: "Evenings", value: "Yes, out by 21:30", by: "Ada", when: "Added 22 Oct", phone: false },
  { field: "Past hosts", value: "Agents & Coffee, Rust Hoxton", by: "Luma events", when: "Seen 8 Oct", phone: false }
];

const Provenance: React.FC<{ at: number }> = ({ at }) => (
  <>
    <Heading n={4} at={at}>Every field has a source.</Heading>
    <Rise at={at + 4} y={40} tilt={1}>
      <Card shadow={SHADOWS[3]} style={{ width: 1240, padding: "34px 52px", fontFamily: SANS }}>
        <div style={{ display: "grid", gridTemplateColumns: "180px 420px 1fr", paddingBottom: 14, fontSize: 16, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint, borderBottom: `3px solid ${C.navy}` }}>
          <div>Field</div>
          <div>Value</div>
          <div>Who set it · when</div>
        </div>
        {FIELDS.map((r, i) => (
          <Rise key={r.field} at={at + 16 + i * 12} y={16} style={{ display: "grid", gridTemplateColumns: "180px 420px 1fr", alignItems: "center", padding: "22px 0", fontSize: 25, borderBottom: i < FIELDS.length - 1 ? `2px dashed ${C.line}` : "none" }}>
            <div style={{ color: C.muted }}>{r.field}</div>
            <div style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 700 }}>{r.value}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span>{r.by}</span>
              <Tag tone={r.phone ? "tomato" : "outline"} size={16}>
                {r.phone ? <Phone size={15} strokeWidth={2.6} /> : null}
                {r.when}
              </Tag>
            </div>
          </Rise>
        ))}
      </Card>
    </Rise>
  </>
);

export const Trust: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = pop(f, fps, 4, 16);
  const up = ramp(f, TITLE_UP, 30, easeInOut);
  const pos = [0, 1, 2].reduce((sum, i) => sum + ramp(f, panelAt(i) + HOLD, MOVE, easeInOut), 0);
  const panels = [AddVenue, Vouch, Blocked, Provenance];
  return (
    <Paper color={C.navy}>
      <AbsoluteFill style={{ color: C.cream }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: interpolate(up, [0, 1], [400, 46]), display: "flex", justifyContent: "center", opacity: f < 4 ? 0 : 1, transform: `translateY(${(1 - t) * 60}px)` }}>
          <div style={{ position: "relative", fontFamily: SERIF, fontSize: interpolate(up, [0, 1], [124, 44]), fontWeight: 700 }}>
            Why trust that answer?
            <Underline width={interpolate(up, [0, 1], [560, 200])} p={ramp(f, 22, 16)} color={C.gold} thick={interpolate(up, [0, 1], [9, 5])} seed={7} style={{ position: "absolute", right: 0, bottom: interpolate(up, [0, 1], [-24, -14]) }} />
          </div>
        </div>
        <div style={{ position: "absolute", top: 120, left: 0, display: "flex", transform: `translateX(${-pos * 1920}px)` }}>
          {panels.map((Panel, i) => (
            <div key={i} style={{ width: 1920, height: 940, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: interpolate(Math.abs(pos - i), [0, 0.8], [1, 0.3], { extrapolateRight: "clamp" }) }}>
              <div style={{ width: 1240 }}>
                <Panel at={i === 0 ? P0 : panelAt(i) - MOVE + 4} />
              </div>
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </Paper>
  );
};
