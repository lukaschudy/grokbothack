"use client";

// The venue's phone, in a browser. Speaks the Twilio Media Streams protocol
// (8 kHz μ-law) to /phone/stream, so the server bridge is the same as for a
// real phone call.
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";

type Ring = { type: "ring"; callId: string; token: string; venue: string; organiser: string; when: string };
type State = "off" | "idle" | "ringing" | "connecting" | "live" | "ended";

function linearToMulaw(sample: number): number {
  const BIAS = 0x84;
  let s = Math.max(-1, Math.min(1, sample)) * 32767;
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  s = Math.min(32635, s + BIAS);
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function mulawToLinear(byte: number): number {
  const u = ~byte & 0xff;
  const exponent = (u >> 4) & 0x07;
  const sample = (((u & 0x0f) << 3) + 0x84) << exponent;
  return (u & 0x80 ? -(sample - 0x84) : sample - 0x84) / 32768;
}

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** UK ring: 400+450 Hz, 0.4 s on, 0.2 s off, 0.4 s on, 2 s off. */
function ringtone(ctx: AudioContext): () => void {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  const oscs = [400, 450].map((f) => { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(gain); o.start(); return o; });
  let t = ctx.currentTime + 0.05;
  for (let i = 0; i < 20; i++) {
    for (const [on, off] of [[0.4, 0.2], [0.4, 2]] as const) {
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.setValueAtTime(0, t + on);
      t += on + off;
    }
  }
  return () => { oscs.forEach((o) => o.stop()); gain.disconnect(); };
}

export function PhoneLine({ lineName, offline = null }: { lineName: string; offline?: string | null }) {
  const [state, setState] = useState<State>("off");
  const [ring, setRing] = useState<Ring | null>(null);
  const [muted, setMuted] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [level, setLevel] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const stopRing = useRef<(() => void) | null>(null);
  const playhead = useRef(0);
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const key = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("key") ?? "" : "";

  const goOnDuty = async () => {
    try {
      const ctx = new AudioContext();
      await ctx.resume();
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      ctxRef.current = ctx;
      micRef.current = mic;
      // Keep the screen on while waiting for a call.
      await (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<unknown> } }).wakeLock?.request("screen").catch(() => {});
      setState("idle");
    } catch {
      setProblem("Allow the microphone to use this line.");
    }
  };

  // Listen for rings.
  useEffect(() => {
    if (state === "off") return;
    const es = new EventSource(`/phone/events?key=${encodeURIComponent(key)}`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === "ring") { setRing(e); setState((s) => (s === "idle" || s === "ended" ? "ringing" : s)); }
      if (e.type === "cancel") setState((s) => (s === "ringing" ? "idle" : s));
    };
    return () => es.close();
  }, [state === "off", key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ringtone and vibration while ringing.
  useEffect(() => {
    if (state !== "ringing" || !ctxRef.current) return;
    stopRing.current = ringtone(ctxRef.current);
    navigator.vibrate?.([400, 200, 400, 2000, 400, 200, 400, 2000, 400, 200, 400]);
    return () => { stopRing.current?.(); stopRing.current = null; navigator.vibrate?.(0); };
  }, [state]);

  useEffect(() => {
    if (state !== "live") return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [state]);

  const endLocally = useCallback(() => {
    sources.current.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
    sources.current = [];
    setState("ended");
    setTimeout(() => setState((s) => (s === "ended" ? "idle" : s)), 3500);
  }, []);

  const answer = () => {
    const ctx = ctxRef.current;
    const mic = micRef.current;
    if (!ring || !ctx || !mic) return;
    setState("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/phone/stream?key=${encodeURIComponent(key)}`);
    wsRef.current = ws;
    const streamSid = `phone-${ring.callId}`;

    // Mic → 8 kHz μ-law, 20 ms frames.
    const src = ctx.createMediaStreamSource(mic);
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    const ratio = ctx.sampleRate / 8000;
    let pending: number[] = [];
    proc.onaudioprocess = (ev) => {
      const out = ev.outputBuffer.getChannelData(0);
      out.fill(0);
      if (ws.readyState !== WebSocket.OPEN) return;
      const input = ev.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!;
      const rms = Math.sqrt(sum / input.length);
      setLevel(rms);
      for (let pos = 0; pos < input.length; pos += ratio) {
        const a = Math.floor(pos);
        const b = Math.min(input.length - 1, Math.floor(pos + ratio));
        let acc = 0;
        for (let k = a; k <= b; k++) acc += input[k]!;
        pending.push(mutedRef.current ? 0 : acc / (b - a + 1));
      }
      while (pending.length >= 160) {
        const frame = pending.slice(0, 160);
        pending = pending.slice(160);
        ws.send(JSON.stringify({ event: "media", streamSid, media: { track: "inbound", payload: toB64(Uint8Array.from(frame.map(linearToMulaw))) } }));
      }
    };
    src.connect(proc);
    proc.connect(ctx.destination);

    ws.onopen = () => {
      ws.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));
      ws.send(JSON.stringify({ event: "start", start: { streamSid, callSid: `virtual:${ring.token}`, customParameters: { callId: ring.callId } } }));
      setStartedAt(Date.now());
      setState("live");
    };
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.event === "media") {
        const bytes = fromB64(msg.media.payload);
        const n = Math.round(bytes.length * (ctx.sampleRate / 8000));
        const buf = ctx.createBuffer(1, n, ctx.sampleRate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < n; i++) {
          const x = (i * 8000) / ctx.sampleRate;
          const j = Math.floor(x);
          const f = x - j;
          const s0 = mulawToLinear(bytes[j] ?? 0xff);
          const s1 = mulawToLinear(bytes[Math.min(bytes.length - 1, j + 1)] ?? 0xff);
          ch[i] = s0 + (s1 - s0) * f;
        }
        const s = ctx.createBufferSource();
        s.buffer = buf;
        s.connect(ctx.destination);
        const at = Math.max(ctx.currentTime + 0.04, playhead.current);
        s.start(at);
        playhead.current = at + buf.duration;
        sources.current.push(s);
        s.onended = () => { sources.current = sources.current.filter((x) => x !== s); };
      } else if (msg.event === "clear") {
        sources.current.forEach((s) => { try { s.stop(); } catch { /* ok */ } });
        sources.current = [];
        playhead.current = 0;
      } else if (msg.event === "hangup") {
        ws.close();
      }
    };
    ws.onclose = () => { src.disconnect(); proc.disconnect(); endLocally(); };
    ws.onerror = () => setProblem("Line dropped.");
  };

  const decline = async () => {
    if (!ring) return;
    await fetch(`/phone/decline/${ring.callId}?key=${encodeURIComponent(key)}`, { method: "POST" });
    setState("idle");
  };

  const hangUp = () => {
    wsRef.current?.send(JSON.stringify({ event: "stop" }));
    wsRef.current?.close();
  };

  const secs = startedAt ? Math.floor((now - startedAt) / 1000) : 0;
  const timer = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div className={`phone phone-${state}`}>
      {state === "off" && (
        <div className="phone-center">
          <p className="phone-kicker">Venue line</p>
          <h1>{lineName}</h1>
          <p className="phone-sub">This screen is the venue&apos;s phone. Keep it open and the AI&apos;s calls ring here.</p>
          <button className="phone-big" onClick={goOnDuty}><Phone size={22} aria-hidden /> Go on duty</button>
          <p className="phone-hint">Use earbuds so the AI doesn&apos;t hear itself.</p>
          {problem && <p className="phone-problem">{problem}</p>}
          {offline && <p className="phone-problem">{offline}</p>}
        </div>
      )}
      {state === "idle" && (
        <div className="phone-center">
          <p className="phone-kicker">On duty</p>
          <h1>{lineName}</h1>
          <p className="phone-sub">Waiting for calls…</p>
          {offline && <p className="phone-problem">{offline}</p>}
        </div>
      )}
      {(state === "ringing" || state === "connecting") && ring && (
        <div className="phone-call">
          <div className="phone-caller">
            <p className="phone-kicker">Incoming call</p>
            <div className="phone-avatar">R</div>
            <h1>Roomline AI</h1>
            <p className="phone-sub">For {ring.organiser}<br />about {ring.when}</p>
          </div>
          <div className="phone-buttons">
            <button className="phone-round decline" onClick={decline} aria-label="Decline"><PhoneOff size={30} /></button>
            <button className="phone-round answer" onClick={answer} aria-label="Answer" disabled={state === "connecting"}><Phone size={30} /></button>
          </div>
        </div>
      )}
      {state === "live" && ring && (
        <div className="phone-call">
          <div className="phone-caller">
            <p className="phone-kicker tnum">{timer}</p>
            <div className="phone-avatar" style={{ boxShadow: `0 0 0 ${Math.round(Math.min(1, level * 8) * 18)}px rgb(189 87 45 / 0.25)` }}>R</div>
            <h1>Roomline AI</h1>
            <p className="phone-sub">For {ring.organiser}</p>
          </div>
          <div className="phone-buttons">
            <button className={`phone-round ${muted ? "on" : "quiet"}`} onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"}>
              {muted ? <MicOff size={28} /> : <Mic size={28} />}
            </button>
            <button className="phone-round decline" onClick={hangUp} aria-label="Hang up"><PhoneOff size={30} /></button>
          </div>
        </div>
      )}
      {state === "ended" && (
        <div className="phone-center">
          <p className="phone-kicker">Call ended</p>
          <h1>{timer}</h1>
        </div>
      )}
    </div>
  );
}
