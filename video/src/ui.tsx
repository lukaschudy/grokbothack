// Shared look: a printed community noticeboard. Cream paper, navy ink, three spot colours,
// hard offset shadows, and marker strokes that wobble like hand animation.
import React from "react";
import { DoorOpen } from "lucide-react";
import { AbsoluteFill, cancelRender, continueRender, delayRender, Easing, Img, interpolate, spring, staticFile, useCurrentFrame } from "remotion";

export const C = {
  navy: "#0D3B66",
  cream: "#FAF0CA",
  gold: "#F4D35E",
  sandy: "#EE964B",
  tomato: "#F95738",
  paper: "#FFFAE8",
  muted: "rgba(13,59,102,0.66)",
  faint: "rgba(13,59,102,0.4)",
  line: "rgba(13,59,102,0.16)"
};

export const SANS = "Inter";
export const SERIF = "Gelasio";
const fonts = delayRender("Loading fonts");
Promise.all(
  [
    [SANS, "fonts/Inter.ttf", "100 900"],
    [SERIF, "fonts/Gelasio.ttf", "400 700"]
  ].map(([family, file, weight]) => new FontFace(family, `url('${staticFile(file)}') format('truetype')`, { weight }).load())
).then((faces) => {
  faces.forEach((face) => document.fonts.add(face));
  continueRender(fonts);
}, cancelRender);

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const easeOut = Easing.bezier(0.2, 0.9, 0.25, 1);
export const easeInOut = Easing.bezier(0.7, 0, 0.3, 1);

/** 0 → 1 over `dur` frames from frame `at`. */
export const ramp = (f: number, at: number, dur = 20, easing = easeOut) => interpolate(f, [at, at + dur], [0, 1], { ...clamp, easing });
/** Spring from frame `at`; damping 200 is smooth, ~12 overshoots a little. */
export const pop = (f: number, fps: number, at: number, damping = 200) => spring({ frame: f - at, fps, config: { damping } });
/** Changes every 4 frames, so marker strokes "boil" like drawn-on-twos animation. */
export const boil = (f: number) => Math.floor(f / 4);
const rand = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Slides in from below with a little paper tilt that settles. */
export const Rise: React.FC<{ at: number; y?: number; tilt?: number; dur?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({ at, y = 34, tilt = 0, dur = 20, style, children }) => {
  const p = ramp(useCurrentFrame(), at, dur);
  return <div style={{ opacity: Math.min(1, p * 2), transform: `translateY(${(1 - p) * y}px) rotate(${(1 - p) * tilt}deg)`, ...style }}>{children}</div>;
};

export const Card: React.FC<{ style?: React.CSSProperties; shadow?: string; children: React.ReactNode }> = ({ style, shadow = C.navy, children }) => (
  <div style={{ background: C.paper, color: C.navy, border: `3px solid ${C.navy}`, borderRadius: 14, boxShadow: `10px 10px 0 ${shadow}`, ...style }}>{children}</div>
);

const TAGS = {
  gold: [C.gold, C.navy, C.gold],
  sandy: [C.sandy, C.navy, C.sandy],
  tomato: [C.tomato, C.paper, C.tomato],
  navy: [C.navy, C.paper, C.navy],
  outline: ["transparent", C.navy, C.navy]
} as const;
export type Tone = keyof typeof TAGS;

export const Tag: React.FC<{ tone?: Tone; size?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({ tone = "gold", size = 17, style, children }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: `${size * 0.25}px ${size * 0.6}px`, borderRadius: 6, border: `2px solid ${TAGS[tone][2]}`, background: TAGS[tone][0], color: TAGS[tone][1], fontFamily: SANS, fontSize: size, fontWeight: 600, whiteSpace: "nowrap", ...style }}>
    {children}
  </span>
);

const FILLS = [C.gold, C.sandy, C.tomato, C.cream];
export const Avatar: React.FC<{ name: string; size?: number; hue?: number; style?: React.CSSProperties }> = ({ name, size = 48, hue = 0, style }) => (
  <div style={{ width: size, height: size, flex: "none", borderRadius: "50%", border: `${Math.max(2, size * 0.05)}px solid ${C.navy}`, background: FILLS[hue % FILLS.length], color: hue % FILLS.length === 2 ? C.paper : C.navy, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: SERIF, fontSize: size * 0.4, fontWeight: 700, ...style }}>
    {name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)}
  </div>
);

export const Logo: React.FC<{ size?: number; style?: React.CSSProperties }> = ({ size = 120, style }) => (
  <div style={{ width: size, height: size, flex: "none", borderRadius: size * 0.24, background: C.tomato, border: `${size * 0.035}px solid ${C.navy}`, boxShadow: `${size * 0.07}px ${size * 0.07}px 0 ${C.navy}`, display: "flex", alignItems: "center", justifyContent: "center", ...style }}>
    <DoorOpen size={size * 0.56} color={C.paper} strokeWidth={2.2} />
  </div>
);

/** The palette as a brand mark: three stripes. */
export const Stripes: React.FC<{ width: number; height?: number; p?: number; style?: React.CSSProperties }> = ({ width, height = 14, p = 1, style }) => (
  <div style={{ display: "grid", gap: height * 0.45, width, ...style }}>
    {[C.gold, C.sandy, C.tomato].map((c, i) => (
      <div key={c} style={{ height, background: c, transformOrigin: "left", transform: `scaleX(${interpolate(p, [i * 0.15, 0.7 + i * 0.15], [0, 1], { ...clamp, easing: easeOut })})` }} />
    ))}
  </div>
);

/** A flat ground colour with printed-paper grain that shifts every few frames. */
export const Paper: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => {
  const k = boil(useCurrentFrame());
  return (
    <AbsoluteFill style={{ background: color, overflow: "hidden" }}>
      {children}
      <Img src={staticFile("grain.jpg")} style={{ position: "absolute", left: -Math.round(rand(k) * 640), top: -Math.round(rand(k + 9) * 640), width: 2600, height: 1760, mixBlendMode: "multiply", opacity: 0.5, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};

// Marker strokes. `p` is how much has been drawn (0 → 1); the wobble re-rolls every 4 frames.
const strokeStyle = (p: number) => ({ pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - p, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const });

export const Underline: React.FC<{ width: number; p: number; color?: string; thick?: number; seed?: number; style?: React.CSSProperties }> = ({ width, p, color = C.tomato, thick = 7, seed = 1, style }) => {
  const k = boil(useCurrentFrame()) + seed * 100;
  const pts = Array.from({ length: 7 }, (_, i) => `${(width * i) / 6},${12 + (rand(k + i) - 0.5) * 7 + (i === 6 ? -4 : 0)}`);
  return (
    <svg width={width + 10} height={26} style={{ overflow: "visible", ...style }}>
      <polyline points={pts.join(" ")} stroke={color} strokeWidth={thick} {...strokeStyle(p)} />
    </svg>
  );
};

/** A marker loop around something, overshooting where it closes like a real one. */
export const Loop: React.FC<{ w: number; h: number; p: number; color?: string; thick?: number; seed?: number; style?: React.CSSProperties }> = ({ w, h, p, color = C.tomato, thick = 5, seed = 2, style }) => {
  const k = boil(useCurrentFrame()) + seed * 100;
  const pts = Array.from({ length: 52 }, (_, i) => {
    const a = ((-25 + (i * 410) / 51) * Math.PI) / 180;
    const wob = 1 + (rand(k + i * 0.37) - 0.5) * 0.035 + i * 0.0012;
    return `${w / 2 + Math.cos(a) * (w / 2) * wob},${h / 2 + Math.sin(a) * (h / 2) * wob}`;
  });
  return (
    <svg width={w} height={h} style={{ position: "absolute", overflow: "visible", pointerEvents: "none", ...style }}>
      <polyline points={pts.join(" ")} stroke={color} strokeWidth={thick} {...strokeStyle(p)} />
    </svg>
  );
};

/** Gold highlighter swiped behind inline text. */
export const Highlight: React.FC<{ p: number; color?: string; children: React.ReactNode }> = ({ p, color = C.gold, children }) => (
  <span style={{ position: "relative", display: "inline-block" }}>
    <span style={{ position: "absolute", left: "-0.08em", right: "-0.08em", top: "0.18em", bottom: "0.02em", background: color, transformOrigin: "left", transform: `scaleX(${p}) rotate(-1.2deg)`, borderRadius: 4 }} />
    <span style={{ position: "relative" }}>{children}</span>
  </span>
);

/** A rubber stamp that slams down. */
export const Stamp: React.FC<{ at: number; rotate?: number; color?: string; size?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({ at, rotate = -8, color = C.tomato, size = 30, style, children }) => {
  const f = useCurrentFrame();
  const p = ramp(f, at, 9, Easing.in(Easing.quad));
  return (
    <div style={{ opacity: f < at ? 0 : 0.92, transform: `rotate(${rotate}deg) scale(${1.9 - 0.9 * p})`, padding: `${size * 0.22}px ${size * 0.5}px`, border: `${size * 0.13}px solid ${color}`, outline: `${size * 0.06}px solid ${color}`, outlineOffset: size * 0.1, borderRadius: 8, color, fontFamily: SANS, fontSize: size, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap", mixBlendMode: "multiply", ...style }}>
      {children}
    </div>
  );
};

/** A strip of masking tape. */
export const Tape: React.FC<{ rotate?: number; style?: React.CSSProperties }> = ({ rotate = -4, style }) => (
  <div style={{ position: "absolute", width: 130, height: 34, background: "rgba(244,211,94,0.62)", border: "1px solid rgba(13,59,102,0.1)", transform: `rotate(${rotate}deg)`, ...style }} />
);
