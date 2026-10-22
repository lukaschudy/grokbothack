// One phone call: Twilio Media Stream <-> Grok realtime voice, plus the DB
// writes for the transcript and the report_result tool. Sockets are passed in
// so tests can drive it with fakes.

import { z } from "zod";
import { sql } from "../db";
import { buildSessionUpdate, type CallContext } from "./prompt";
import { hangUp } from "./twilio";

export const xaiRealtimeUrl = () => process.env.XAI_REALTIME_URL ?? "wss://api.x.ai/v1/realtime?model=grok-voice-latest";
const GOODBYE_GRACE_MS = 12_000;

export type Sendable = { send(data: string): void; close(): void };
type Turn = { role: "agent" | "venue"; text: string; at: string };

const Result = z.object({
  status: z.enum(["available", "unavailable", "partial"]),
  price_note: z.string().nullish(),
  conditions: z.string().nullish(),
  confirmed_by_name: z.string().nullish(),
  summary: z.string().default("")
});
export type CallResult = z.infer<typeof Result>;

type CallRow = {
  status: string; twilio_sid: string | null; venue: string; organiser: string | null; community: string | null;
  starts_at: Date; ends_at: Date; headcount: number; event_title: string | null;
};

export async function loadCall(callId: string): Promise<(CallContext & { status: string; twilioSid: string | null }) | null> {
  const [r] = await sql<CallRow[]>`
    select c.status, c.twilio_sid, v.name as venue, p.display_name as organiser, p.community,
           c.starts_at, c.ends_at, c.headcount, c.event_title
    from calls c join venues v on v.id = c.venue_id left join profiles p on p.id = c.requested_by
    where c.id = ${callId}`;
  if (!r) return null;
  return {
    status: r.status, twilioSid: r.twilio_sid, venue: r.venue, organiser: r.organiser ?? "a London community organiser",
    community: r.community, startsAt: r.starts_at, endsAt: r.ends_at, headcount: r.headcount, eventTitle: r.event_title
  };
}

export async function appendTranscript(callId: string, turns: Turn[]): Promise<void> {
  await sql`update calls set transcript = transcript || ${sql.json(turns)}::jsonb where id = ${callId}`;
}

/** Write the venue's answer: one availability row per call, result on the call. */
export async function recordResult(callId: string, raw: unknown): Promise<CallResult> {
  const r = Result.parse(raw);
  const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
  await sql.begin(async (tx) => {
    await tx`delete from availability where call_id = ${callId}`;
    await tx`
      insert into availability (venue_id, starts_at, ends_at, status, conditions, price_note, confirmed_by_name, source, call_id)
      select venue_id, starts_at, ends_at, ${r.status}, ${blank(r.conditions)}, ${blank(r.price_note)},
             ${blank(r.confirmed_by_name)}, 'call', id
      from calls where id = ${callId}`;
    await tx`update calls set result = ${tx.json(r)}, status = 'completed', error = null where id = ${callId}`;
  });
  return r;
}

export class CallBridge {
  private streamSid: string | null = null;
  private twilioSid: string | null = null;
  private handledToolCalls = new Set<string>();
  private ending = false;
  private hungUp = false;
  private timer: NodeJS.Timeout | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private xai: Sendable | null = null;
  private session: object | null = null;
  private ready = false;

  constructor(
    readonly callId: string,
    private twilio: Sendable,
    private openXai: () => Sendable,
    private log: (msg: string) => void = (m) => console.log(`[call ${callId}] ${m}`)
  ) {}

  /** Twilio "start": check it's the call we placed, then open Grok. Returns false if refused. */
  async start(msg: { streamSid: string; callSid: string }): Promise<boolean> {
    const call = await loadCall(this.callId);
    if (!call || call.twilioSid !== msg.callSid || !["dialing", "ringing", "in_progress"].includes(call.status)) {
      this.log(`refused stream (status=${call?.status}, sid match=${call?.twilioSid === msg.callSid})`);
      this.twilio.close();
      return false;
    }
    this.streamSid = msg.streamSid;
    this.twilioSid = msg.callSid;
    await sql`update calls set status = 'in_progress', answered_at = coalesce(answered_at, now())
              where id = ${this.callId} and status in ('dialing', 'ringing')`;
    this.session = buildSessionUpdate(call);
    this.xai = this.openXai();
    return true;
  }

  /** Grok socket opened. */
  onXaiOpen(): void {
    this.xai?.send(JSON.stringify(this.session));
  }

  onTwilio(msg: { event: string; media?: { track?: string; payload: string }; mark?: { name: string } }): void {
    if (msg.event === "media" && this.ready && msg.media && (msg.media.track ?? "inbound") === "inbound") {
      this.xai?.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.media.payload }));
    } else if (msg.event === "mark" && msg.mark?.name === "goodbye") {
      void this.hangUp();
    } else if (msg.event === "stop") {
      this.close();
    }
  }

  onXai(ev: Record<string, any>): void {
    switch (ev.type) {
      case "session.updated":
        if (this.ready) return;
        this.ready = true;
        this.xai?.send(JSON.stringify({ type: "response.create" })); // outbound: Grok speaks first
        return;
      case "response.output_audio.delta":
        if (ev.delta && this.streamSid) this.toTwilio({ event: "media", streamSid: this.streamSid, media: { payload: ev.delta } });
        return;
      case "input_audio_buffer.speech_started":
        if (this.streamSid) this.toTwilio({ event: "clear", streamSid: this.streamSid });
        return;
      case "response.output_audio_transcript.done":
        if (ev.transcript) this.queueTurn("agent", ev.transcript);
        return;
      case "conversation.item.input_audio_transcription.completed":
        if (ev.transcript) this.queueTurn("venue", ev.transcript);
        return;
      case "response.function_call_arguments.done":
        this.onToolCall(ev.call_id, ev.name, ev.arguments);
        return;
      case "response.output_item.done":
        if (ev.item?.type === "function_call") this.onToolCall(ev.item.call_id, ev.item.name, ev.item.arguments);
        return;
      case "response.done":
        // Goodbye generated; ask Twilio to tell us when it has finished playing.
        if (this.ending && this.streamSid) this.toTwilio({ event: "mark", streamSid: this.streamSid, mark: { name: "goodbye" } });
        return;
      case "error":
        this.log(`xai error: ${JSON.stringify(ev.error ?? ev)}`);
        return;
    }
  }

  private onToolCall(toolCallId: string, name: string, args: string): void {
    if (!toolCallId || this.handledToolCalls.has(toolCallId)) return;
    this.handledToolCalls.add(toolCallId);
    this.writes = this.writes.then(async () => {
      let output: object;
      if (name !== "report_result") {
        output = { error: `unknown tool ${name}` };
      } else {
        try {
          const r = await recordResult(this.callId, JSON.parse(args || "{}"));
          this.log(`result: ${r.status} ${r.summary}`);
          output = { ok: true, next: "Thank them warmly and say goodbye." };
          this.ending = true;
          this.timer = setTimeout(() => void this.hangUp(), GOODBYE_GRACE_MS);
        } catch (e) {
          this.log(`bad report_result: ${(e as Error).message}`);
          output = { ok: false, error: "Invalid arguments: status must be available, unavailable or partial." };
        }
      }
      this.xai?.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: toolCallId, output: JSON.stringify(output) } }));
      this.xai?.send(JSON.stringify({ type: "response.create" }));
    }).catch((e) => this.log(`tool write failed: ${(e as Error).message}`));
  }

  private queueTurn(role: Turn["role"], text: string): void {
    const turn = { role, text, at: new Date().toISOString() };
    this.writes = this.writes.then(() => appendTranscript(this.callId, [turn])).catch((e) => this.log(`transcript write failed: ${(e as Error).message}`));
  }

  private toTwilio(msg: object): void {
    this.twilio.send(JSON.stringify(msg));
  }

  async hangUp(): Promise<void> {
    if (this.hungUp || !this.twilioSid) return;
    this.hungUp = true;
    if (this.timer) clearTimeout(this.timer);
    try {
      await hangUp(this.twilioSid);
    } catch (e) {
      this.log(`hang up failed: ${(e as Error).message}`);
    }
  }

  /** Twilio stream ended. Wait for pending DB writes, then drop Grok. */
  close(): Promise<unknown> {
    if (this.timer) clearTimeout(this.timer);
    this.xai?.close();
    this.xai = null;
    return this.writes;
  }

  /** For tests: resolves when queued DB writes are done. */
  flush(): Promise<unknown> {
    return this.writes;
  }
}
