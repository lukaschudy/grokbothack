import { randomBytes } from "node:crypto";
import { asUser, sql } from "./db";
import { bus, emitCall } from "./bus";
import { loadCall, setCallStatus } from "./calls";
import { dial } from "./twilio";
import { runScriptedCall } from "./scripted";
import { formatWindow } from "./time";

/**
 * CALL_MODE decides how a call reaches the venue:
 * - "virtual" (default): rings the in-browser phone at /phone; Grok voice talks live.
 * - "twilio": dials the venue's real number.
 * - "scripted": plays a written conversation (no phone, no voice model).
 */
export const callMode = () => (process.env.CALL_MODE ?? (process.env.XAI_API_KEY ? "virtual" : "scripted")) as "virtual" | "twilio" | "scripted";

export type RingEvent = { type: "ring"; callId: string; token: string; venue: string; organiser: string; when: string } | { type: "cancel"; callId: string };

export async function placeCall(callId: string) {
  const mode = callMode();
  if (mode === "twilio") {
    const ctx = await loadCall(callId);
    if (!ctx?.phone) throw new Error("no phone");
    await setCallStatus(callId, "dialing");
    try {
      const sid = await dial(callId, ctx.phone);
      await sql`update calls set twilio_sid = ${sid} where id = ${callId}`;
    } catch (e) {
      await sql`update calls set error = ${(e as Error).message} where id = ${callId}`;
      await setCallStatus(callId, "failed");
      throw e;
    }
    return;
  }
  if (mode === "scripted") {
    void runScriptedCall(callId);
    return;
  }
  await ringVirtualLine(callId);
}

async function ringVirtualLine(callId: string) {
  const token = randomBytes(12).toString("base64url");
  await sql`update calls set twilio_sid = ${`virtual:${token}`} where id = ${callId}`;
  await setCallStatus(callId, "dialing");
  const ctx = await loadCall(callId);
  if (!ctx) return;
  setTimeout(async () => {
    await setCallStatus(callId, "ringing");
    bus.emit("phone", { type: "ring", callId, token, venue: ctx.venue_name, organiser: ctx.organiser, when: formatWindow(ctx.starts_at, ctx.ends_at) } satisfies RingEvent);
  }, 900);
  setTimeout(async () => {
    const [row] = await sql<{ status: string }[]>`select status from calls where id = ${callId}`;
    if (row && (row.status === "ringing" || row.status === "dialing")) {
      await setCallStatus(callId, "no_answer");
      bus.emit("phone", { type: "cancel", callId } satisfies RingEvent);
      emitCall(callId, { type: "error", message: "No answer." });
    }
  }, 40_000).unref();
}

export async function currentlyRinging(): Promise<RingEvent | null> {
  const [row] = await sql<{ id: string; twilio_sid: string }[]>`
    select id, twilio_sid from calls
    where status = 'ringing' and twilio_sid like 'virtual:%' and created_at > now() - interval '60 seconds'
    order by created_at desc limit 1`;
  if (!row) return null;
  const ctx = await loadCall(row.id);
  if (!ctx) return null;
  return { type: "ring", callId: row.id, token: row.twilio_sid.slice("virtual:".length), venue: ctx.venue_name, organiser: ctx.organiser, when: formatWindow(ctx.starts_at, ctx.ends_at) };
}

export type CallOutcome = "new" | "in_progress" | "reused" | "called_recently";

/**
 * Ask for a call as `uid`. The database decides: a fresh call, an existing one
 * in progress, or a recent answer to reuse (one call per venue per week).
 * Throws not_trusted / not_ok_to_call / no_phone / venue_not_found.
 */
export async function startCall(uid: string, i: { venueId: string; startsAt: string; endsAt: string; headcount: number; title: string | null }): Promise<{ outcome: CallOutcome; callId: string }> {
  const [row] = await asUser(uid, (tx) => tx<{ r: { outcome: CallOutcome; call_id: string } }[]>`
    select request_call(${i.venueId}, ${i.startsAt}, ${i.endsAt}, ${i.headcount}, ${i.title}) as r`);
  const r = row!.r;
  if (r.outcome === "new") await placeCall(r.call_id);
  return { outcome: r.outcome, callId: r.call_id };
}
