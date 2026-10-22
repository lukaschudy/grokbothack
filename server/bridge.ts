// Twilio Media Streams <-> Grok realtime voice. μ-law passes straight through
// both ways; we also tap it for live levels and transcript for the call card.
import WebSocket from "ws";
import { emitCall } from "../lib/bus";
import { sql } from "../lib/db";
import {
  agentInstructions, agentTools, appendTranscript, loadCall, openingLine, parseResult,
  saveCallResult, setCallStatus, type CallContext
} from "../lib/calls";
import { hangUp } from "../lib/twilio";
import { extractResultFromTranscript } from "../lib/grok";

const XAI_URL = `${process.env.XAI_REALTIME_URL ?? "wss://api.x.ai/v1/realtime"}?model=${process.env.XAI_VOICE_MODEL ?? "grok-voice-latest"}`;
const VOICE = process.env.XAI_VOICE ?? "leo"; // Grok's British voice (README: calling script)
const BYTES_PER_100MS = 800; // μ-law 8 kHz
// After the answer is saved the agent should say goodbye and call end_call; hang up anyway after this.
const goodbyeMs = () => Number(process.env.CALL_GOODBYE_MS ?? 15_000);

type Session = {
  ctx: CallContext;
  xai: WebSocket;
  ready: Promise<void>;
};

// Opened when Twilio fetches TwiML (the moment the call is answered), so the
// model is configured by the time the media stream starts.
const prewarmed = new Map<string, Session>();

export async function prewarm(callId: string) {
  if (prewarmed.has(callId)) return;
  const ctx = await loadCall(callId);
  if (!ctx) return;
  prewarmed.set(callId, openXai(ctx));
  setTimeout(() => {
    const s = prewarmed.get(callId);
    if (s) { prewarmed.delete(callId); s.xai.close(); }
  }, 30_000).unref();
}

function openXai(ctx: CallContext): Session {
  const xai = new WebSocket(XAI_URL, { headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` } });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Grok voice connection timed out")), 10_000);
    xai.on("error", (e) => { clearTimeout(timer); reject(e); });
    xai.on("message", function onMessage(data) {
      const msg = JSON.parse(data.toString()) as { type: string };
      if (msg.type === "session.updated") {
        clearTimeout(timer);
        xai.off("message", onMessage);
        resolve();
      }
    });
    xai.on("open", () => {
      xai.send(JSON.stringify({
        type: "session.update",
        session: {
          instructions: agentInstructions(ctx),
          voice: VOICE,
          turn_detection: { type: "server_vad" },
          ...(process.env.XAI_VOICE_REASONING ? { reasoning: { effort: process.env.XAI_VOICE_REASONING } } : {}),
          audio: {
            input: {
              format: { type: "audio/pcmu" },
              transcription: {
                model: "grok-transcribe",
                language_hint: "en-GB",
                keyterms: [ctx.venue_name, ctx.organiser, ctx.community ?? ""].filter(Boolean).slice(0, 100)
              }
            },
            output: { format: { type: "audio/pcmu" } }
          },
          tools: agentTools
        }
      }));
    });
  });
  ready.catch(() => {});
  return { ctx, xai, ready };
}

function mulawToLinear(byte: number): number {
  const u = ~byte & 0xff;
  const exponent = (u >> 4) & 0x07;
  const sample = (((u & 0x0f) << 3) + 0x84) << exponent;
  return (u & 0x80 ? -(sample - 0x84) : sample - 0x84) / 32768;
}

function level(chunk: Buffer): number {
  if (chunk.length === 0) return 0;
  let sum = 0;
  for (const b of chunk) { const s = mulawToLinear(b); sum += s * s; }
  return Math.min(1, Math.sqrt(Math.sqrt(sum / chunk.length)) * 1.4);
}

export function attachMediaStream(twilio: WebSocket) {
  let session: Session | null = null;
  let ctx: CallContext | null = null;
  let streamSid = "";
  let live = false;
  let venueBuf = Buffer.alloc(0);
  let playhead = 0; // when the agent's queued audio finishes playing, ms epoch
  let timers: NodeJS.Timeout[] = [];
  let hangingUp = false;
  let goodbyeTimer: NodeJS.Timeout | undefined;
  let resultSaved = false;
  let failed = false;
  let firstTurnTranscribed = false;
  let firstTurnDone = false;
  const agentText = new Map<string, string>();
  const handledFnCalls = new Set<string>();
  const lines: { who: "agent" | "venue"; text: string }[] = [];

  const isVirtual = () => Boolean(ctx?.twilio_sid?.startsWith("virtual:"));
  const sendTwilio = (msg: object) => twilio.readyState === WebSocket.OPEN && twilio.send(JSON.stringify(msg));
  const sendXai = (msg: object) => session?.xai.readyState === WebSocket.OPEN && session.xai.send(JSON.stringify(msg));
  const untilPlayed = () => new Promise<void>((r) => setTimeout(r, Math.max(0, playhead - Date.now()) + 300));

  const finalLine = (id: string, who: "agent" | "venue", text: string) => {
    if (!ctx || !text.trim()) return;
    lines.push({ who, text: text.trim() });
    emitCall(ctx.id, { type: "transcript", id, who, text: text.trim(), final: true });
    appendTranscript(ctx.id, { id, who, text: text.trim() }).catch((e) => console.error("[call] transcript", e));
  };

  const scheduleAgentLevels = (audio: Buffer) => {
    if (!ctx) return;
    const id = ctx.id;
    playhead = Math.max(playhead, Date.now());
    for (let i = 0; i < audio.length; i += BYTES_PER_100MS) {
      const lvl = level(audio.subarray(i, i + BYTES_PER_100MS));
      const t = setTimeout(() => emitCall(id, { type: "level", who: "agent", level: lvl }), playhead - Date.now());
      timers.push(t);
      playhead += 100;
    }
    if (timers.length > 400) timers = timers.slice(-200);
  };

  const endCall = async (reason: string) => {
    if (hangingUp || !ctx) return;
    hangingUp = true;
    console.log(`[call ${ctx.id}] end_call: ${reason}`);
    await untilPlayed();
    if (isVirtual()) {
      sendTwilio({ event: "hangup" });
      twilio.close();
    } else if (ctx.twilio_sid) {
      await hangUp(ctx.twilio_sid).catch((e) => console.error("[call] hangup", e));
    }
  };

  const onFunctionCall = async (name: string, fnCallId: string, rawArgs: string) => {
    if (!ctx || handledFnCalls.has(fnCallId)) return;
    handledFnCalls.add(fnCallId);
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(rawArgs || "{}"); } catch { /* keep empty */ }
    if (name === "record_availability") {
      let output = { saved: true };
      try {
        if (!resultSaved) {
          await saveCallResult(ctx, parseResult(args));
          resultSaved = true;
          goodbyeTimer = setTimeout(() => void endCall("goodbye timeout"), goodbyeMs());
        }
      } catch (e) {
        console.error("[call] save result", e);
        output = { saved: false };
      }
      sendXai({ type: "conversation.item.create", item: { type: "function_call_output", call_id: fnCallId, output: JSON.stringify(output) } });
      await untilPlayed();
      sendXai({ type: "response.create" });
    } else if (name === "end_call") {
      sendXai({ type: "conversation.item.create", item: { type: "function_call_output", call_id: fnCallId, output: "{\"ok\":true}" } });
      void endCall(String(args.reason ?? "done"));
    }
  };

  const onXaiMessage = (data: WebSocket.RawData) => {
    if (!ctx) return;
    const m = JSON.parse(data.toString()) as Record<string, any>;
    switch (m.type) {
      case "response.output_audio.delta": {
        if (!m.delta) break;
        sendTwilio({ event: "media", streamSid, media: { payload: m.delta } });
        scheduleAgentLevels(Buffer.from(m.delta, "base64"));
        break;
      }
      case "response.output_audio_transcript.delta": {
        const id = m.item_id ?? m.response_id ?? "agent";
        const text = (agentText.get(id) ?? "") + (m.delta ?? "");
        agentText.set(id, text);
        firstTurnTranscribed = true;
        emitCall(ctx.id, { type: "transcript", id, who: "agent", text, final: false });
        break;
      }
      case "response.output_audio_transcript.done": {
        const id = m.item_id ?? m.response_id ?? "agent";
        finalLine(id, "agent", m.transcript ?? agentText.get(id) ?? "");
        agentText.delete(id);
        break;
      }
      case "response.done": {
        if (!firstTurnDone) {
          firstTurnDone = true;
          if (!firstTurnTranscribed) finalLine("intro", "agent", openingLine(ctx));
        }
        for (const item of m.response?.output ?? []) {
          if (item?.type === "function_call") void onFunctionCall(item.name, item.call_id, item.arguments);
        }
        break;
      }
      case "response.function_call_arguments.done":
        void onFunctionCall(m.name, m.call_id, m.arguments);
        break;
      case "input_audio_buffer.speech_started":
        // Barge-in: drop whatever the agent still has queued.
        sendTwilio({ event: "clear", streamSid });
        for (const t of timers) clearTimeout(t);
        timers = [];
        playhead = Date.now();
        break;
      case "conversation.item.input_audio_transcription.updated":
        if (m.transcript) emitCall(ctx.id, { type: "transcript", id: m.item_id, who: "venue", text: m.transcript, final: false });
        break;
      case "conversation.item.input_audio_transcription.completed":
        finalLine(m.item_id, "venue", m.transcript ?? "");
        break;
      case "error":
        console.error(`[call ${ctx.id}] xai error`, m.error?.message ?? m);
        break;
    }
  };

  const start = async (callId: string, sid: string, twilioCallSid: string) => {
    ctx = await loadCall(callId);
    if (!ctx || ctx.twilio_sid !== twilioCallSid) {
      console.error(`[call] rejected stream for ${callId}`);
      twilio.close();
      return;
    }
    streamSid = sid;
    if (isVirtual()) await setCallStatus(callId, "in_progress");
    session = prewarmed.get(callId) ?? openXai(ctx);
    prewarmed.delete(callId);
    session.xai.on("message", onXaiMessage);
    session.xai.on("close", () => console.log(`[call ${callId}] xai closed`));
    try {
      await session.ready;
    } catch (e) {
      emitCall(callId, { type: "error", message: "Couldn't reach the voice agent." });
      console.error("[call] xai", e);
      // Failed, not completed: a completed call would block re-calling this venue for the cooldown.
      failed = true;
      await sql`update calls set error = ${`voice agent: ${(e as Error).message}`} where id = ${callId}`.catch(() => {});
      await setCallStatus(callId, "failed").catch(() => {});
      if (isVirtual()) twilio.close();
      else if (ctx.twilio_sid) await hangUp(ctx.twilio_sid).catch(() => {});
      return;
    }
    live = true;
    sendXai({
      type: "conversation.item.create",
      item: { type: "force_message", role: "assistant", interruptible: false, content: [{ type: "output_text", text: openingLine(ctx) }] }
    });
    // Hard stop well before Twilio's own limit.
    setTimeout(() => void endCall("time limit"), 210_000).unref();
  };

  twilio.on("message", (raw) => {
    let msg: Record<string, any>;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.event === "start") {
      void start(String(msg.start?.customParameters?.callId ?? ""), msg.start.streamSid, msg.start.callSid);
    } else if (msg.event === "media" && ctx) {
      const chunk = Buffer.from(msg.media.payload, "base64");
      venueBuf = Buffer.concat([venueBuf, chunk]);
      while (venueBuf.length >= BYTES_PER_100MS) {
        emitCall(ctx.id, { type: "level", who: "venue", level: level(venueBuf.subarray(0, BYTES_PER_100MS)) });
        venueBuf = venueBuf.subarray(BYTES_PER_100MS);
      }
      if (live) sendXai({ type: "input_audio_buffer.append", audio: msg.media.payload });
    } else if (msg.event === "stop") {
      twilio.close();
    }
  });

  twilio.on("close", async () => {
    for (const t of timers) clearTimeout(t);
    clearTimeout(goodbyeTimer);
    session?.xai.close();
    if (ctx && isVirtual() && !failed) await setCallStatus(ctx.id, "completed").catch(() => {});
    if (!ctx || resultSaved || lines.length < 2) return;
    // Voicemail or a failed call: don't invent an answer from a greeting.
    const [row] = await sql<{ status: string }[]>`select status from calls where id = ${ctx.id}`.catch(() => []);
    if (!row || !["in_progress", "completed"].includes(row.status)) return;
    // The agent hung up without recording an answer: extract it from the transcript.
    try {
      const extracted = await extractResultFromTranscript(ctx, lines);
      if (extracted) { await saveCallResult(ctx, extracted); resultSaved = true; }
    } catch (e) {
      console.error("[call] fallback extraction", e);
    }
  });
}

export { setCallStatus };
