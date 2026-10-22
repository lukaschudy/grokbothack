import type { IncomingMessage, ServerResponse } from "node:http";
import { asUser, sql } from "../lib/db";
import { bus, type CallEvent } from "../lib/bus";
import { readSession } from "../lib/auth";
import { setCallStatus } from "../lib/calls";
import { publicUrl, validTwilioSignature } from "../lib/twilio";
import { prewarm } from "./bridge";
import { currentlyRinging, type RingEvent } from "../lib/dialer";

export const phoneKeyOk = (url: URL) => !process.env.PHONE_KEY || url.searchParams.get("key") === process.env.PHONE_KEY;

const TWILIO_STATUS: Record<string, string> = {
  queued: "dialing", initiated: "dialing", ringing: "ringing", "in-progress": "in_progress",
  completed: "completed", busy: "busy", "no-answer": "no_answer", failed: "failed", canceled: "canceled"
};

async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  return req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function twilioForm(req: IncomingMessage, res: ServerResponse): Promise<Record<string, string> | null> {
  const form = await readForm(req);
  const sig = req.headers["x-twilio-signature"];
  if (!validTwilioSignature(`${publicUrl()}${req.url}`, form, Array.isArray(sig) ? sig[0] : sig)) {
    res.writeHead(403).end();
    return null;
  }
  return form;
}

/** Returns true when the request was handled here (otherwise Next handles it). */
export async function handleCallRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://local");
  const [, a, b, id] = url.pathname.split("/");

  if (a === "twilio" && req.method === "POST" && id) {
    const form = await twilioForm(req, res);
    if (!form) return true;
    if (b === "twiml") {
      void prewarm(id);
      const stream = `${publicUrl().replace(/^http/, "ws")}/twilio/stream`;
      res.writeHead(200, { "Content-Type": "text/xml" }).end(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${stream}"><Parameter name="callId" value="${id}"/></Stream></Connect></Response>`
      );
    } else if (b === "status") {
      const status = TWILIO_STATUS[form.CallStatus ?? ""];
      if (status) await setCallStatus(id, status);
      res.writeHead(204).end();
    } else if (b === "recording") {
      if (form.RecordingUrl) {
        await sql`update calls set result = coalesce(result, '{}'::jsonb) || jsonb_build_object('recording_sid', ${form.RecordingSid ?? null}::text)
                  where id = ${id}`;
      }
      res.writeHead(204).end();
    } else {
      res.writeHead(404).end();
    }
    return true;
  }

  if (a === "calls" && id === "events" && req.method === "GET" && b) {
    const uid = readSession(cookie(req, "rl_session"));
    const rows = await asUser(uid, (tx) => tx`
      select status, transcript, result, answered_at, ended_at, created_at from calls where id = ${b}`).catch(() => []);
    const call = rows[0];
    if (!call) {
      res.writeHead(404).end();
      return true;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const send = (e: CallEvent | { type: "snapshot"; status: string; transcript: unknown; result: unknown; answered_at: unknown; ended_at: unknown; created_at: unknown }) =>
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    send({ type: "snapshot", status: call.status, transcript: call.transcript, result: call.result, answered_at: call.answered_at, ended_at: call.ended_at, created_at: call.created_at });
    const onEvent = (e: CallEvent) => send(e);
    bus.on(`call:${b}`, onEvent);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => { bus.off(`call:${b}`, onEvent); clearInterval(ping); });
    return true;
  }

  if (a === "phone" && b === "events" && req.method === "GET") {
    if (!phoneKeyOk(url)) { res.writeHead(403).end(); return true; }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const send = (e: RingEvent | { type: "hello" }) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    send({ type: "hello" });
    const ringing = await currentlyRinging();
    if (ringing) send(ringing);
    const onPhone = (e: RingEvent) => send(e);
    bus.on("phone", onPhone);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => { bus.off("phone", onPhone); clearInterval(ping); });
    return true;
  }

  if (a === "phone" && b === "decline" && id && req.method === "POST") {
    if (!phoneKeyOk(url)) { res.writeHead(403).end(); return true; }
    const [row] = await sql<{ status: string }[]>`select status from calls where id = ${id}`;
    if (row && ["ringing", "dialing"].includes(row.status)) {
      await setCallStatus(id, "busy");
      bus.emit("phone", { type: "cancel", callId: id });
    }
    res.writeHead(204).end();
    return true;
  }

  return false;
}
