import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { Ask, ASK_DUR } from "./Ask";
import { Call, CALL_DUR, Request, REQUEST_DUR } from "./Call";
import { Problem, Title } from "./Intro";
import { Close, CLOSE_DUR, Events, EVENTS_DUR } from "./Outro";
import { Trust, TRUST_DUR } from "./Trust";
import { C, easeInOut } from "./ui";

const SCENES: { name: string; dur: number; Scene: React.FC }[] = [
  { name: "Problem", dur: 210, Scene: Problem },
  { name: "Title", dur: 120, Scene: Title },
  { name: "Ask", dur: ASK_DUR, Scene: Ask },
  { name: "Call", dur: CALL_DUR, Scene: Call },
  { name: "Request", dur: REQUEST_DUR, Scene: Request },
  { name: "Trust", dur: TRUST_DUR, Scene: Trust },
  { name: "Events", dur: EVENTS_DUR, Scene: Events },
  { name: "Close", dur: CLOSE_DUR, Scene: Close }
];

const STARTS = SCENES.map((_, i) => SCENES.slice(0, i).reduce((t, s) => t + s.dur, 0));
export const DURATION = STARTS[STARTS.length - 1] + SCENES[SCENES.length - 1].dur;

// Scene changes hide under the palette itself: gold, sandy and tomato panels sweep across,
// the cut happens while they cover the screen (frame COVER), then they sweep off.
const COVER = 16;
const SWEEP = 12;
const WIPE_DUR = 34;
const Wipe: React.FC<{ dir: 1 | -1 }> = ({ dir }) => {
  const f = useCurrentFrame();
  const opts = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeInOut } as const;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {[C.gold, C.sandy, C.tomato].map((color, k) => {
        const inP = interpolate(f, [k * 2, k * 2 + SWEEP], [1, 0], opts);
        const outP = interpolate(f, [COVER + 1 + (2 - k) * 2, COVER + 1 + (2 - k) * 2 + SWEEP], [0, -1], opts);
        return <AbsoluteFill key={color} style={{ background: color, transform: `translateX(${(inP + outP) * 100 * dir}%)` }} />;
      })}
    </AbsoluteFill>
  );
};

export const Demo: React.FC = () => {
  const f = useCurrentFrame();
  const fadeOut = interpolate(f, [DURATION - 24, DURATION], [0, 1], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ background: C.cream }}>
      {SCENES.map(({ name, dur, Scene }, i) => (
        <Sequence key={name} name={name} from={STARTS[i]} durationInFrames={dur}>
          <Scene />
        </Sequence>
      ))}
      {STARTS.slice(1).map((start, i) => (
        <Sequence key={start} name="Wipe" from={start - COVER} durationInFrames={WIPE_DUR}>
          <Wipe dir={i % 2 === 0 ? 1 : -1} />
        </Sequence>
      ))}
      <AbsoluteFill style={{ background: C.navy, opacity: fadeOut, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};
