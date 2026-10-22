// AI availability calls. The API server uses exactly two things:
//   placeCall(callId)          dial the venue for a `calls` row made by request_call()
//   attachCallStreams(server)  mount /twilio/status and the /twilio/media WebSocket
//
// Env (read when used, not at import):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN   Twilio REST + webhook signatures
//   TWILIO_FROM (or TWILIO_PHONE_NUMBER)    caller ID, E.164
//   PUBLIC_URL                              https base Twilio can reach; wss host is derived from it
//   XAI_API_KEY                             Grok realtime voice
//   XAI_REALTIME_URL, XAI_VOICE_MODEL       optional; default wss://api.x.ai/v1/realtime, grok-voice-latest
// End-to-end test against your own phone: scripts/test-call.ts.

import type { IncomingMessage, Server, ServerResponse } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { sql } from "../db";
import { CallBridge, xaiRealtimeUrl } from "./bridge";
import { createCall, hangUp, nextStatus, twilioEnv, validSignature } from "./twilio";

export async function placeCall(callId: string): Promise<void> {
  const [c] = await sql<{ status: string; ok_to_call: boolean; junk_at: Date | null; phone: string | null }[]>`
    select c.status, v.ok_to_call, v.junk_at, vc.phone
    from calls c join venues v on v.id = c.venue_id left join venue_contacts vc on vc.venue_id = v.id
    where c.id = ${callId}`;
  if (!c) throw new Error("call_not_found");
  if (c.status !== "queued") throw new Error(`call_not_queued: ${c.status}`);
  const fail = async (status: string, error: string) => {
    await sql`update calls set status = ${status}, error = ${error}, ended_at = now() where id = ${callId}`;
    throw new Error(error);
  };
  if (!c.ok_to_call || c.junk_at) return fail("canceled", "not_ok_to_call");
  if (!c.phone) return fail("canceled", "no_phone");
  let sid: string;
  try {
    sid = await createCall(c.phone, callId);
  } catch (e) {
    return fail("failed", (e as Error).message);
  }
  // A status callback may already have moved it past 'queued'.
  await sql`update calls set twilio_sid = ${sid}, status = case when status = 'queued' then 'dialing' else status end where id = ${callId}`;
}

/** Apply a Twilio status / async AMD callback. Hangs up on voicemail. */
export async function applyTwilioStatus(callId: string, params: URLSearchParams): Promise<void> {
  const [c] = await sql<{ status: string; twilio_sid: string | null }[]>`select status, twilio_sid from calls where id = ${callId}`;
  if (!c || (c.twilio_sid && params.get("CallSid") && c.twilio_sid !== params.get("CallSid"))) return;
  const callStatus = params.get("CallStatus");
  const answeredBy = params.get("AnsweredBy");
  const next = nextStatus(c.status, { CallStatus: callStatus, AnsweredBy: answeredBy });
  const ended = ["completed", "busy", "no-answer", "failed", "canceled"].includes(callStatus ?? "") || next === "no_answer";
  if (next || ended) {
    await sql`
      update calls set
        status = coalesce(${next}, status),
        answered_at = case when ${next} = 'in_progress' then coalesce(answered_at, now()) else answered_at end,
        ended_at = case when ${ended} then coalesce(ended_at, now()) else ended_at end,
        error = case when ${next} = 'completed' and result is null then coalesce(error, 'ended_without_result') else error end
      where id = ${callId}`;
  }
  const machine = !!answeredBy && (answeredBy.startsWith("machine") || answeredBy === "fax");
  if (machine && next === "no_answer" && c.twilio_sid) await hangUp(c.twilio_sid).catch(() => {});
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 64_000) req.destroy();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://x");
  const callId = url.searchParams.get("call");
  const params = new URLSearchParams(await readBody(req));
  const { token, publicUrl } = twilioEnv();
  const sig = req.headers["x-twilio-signature"];
  if (req.method !== "POST" || !callId || !validSignature(token, publicUrl + url.pathname + url.search, params, typeof sig === "string" ? sig : undefined)) {
    res.writeHead(403).end();
    return;
  }
  await applyTwilioStatus(callId, params);
  res.writeHead(204).end();
}

function bridgeSocket(ws: WebSocket, callId: string): void {
  const bridge = new CallBridge(callId, ws, () => {
    const xai = new WebSocket(xaiRealtimeUrl(), { headers: { Authorization: `Bearer ${process.env.XAI_API_KEY ?? ""}` } });
    xai.on("open", () => bridge.onXaiOpen());
    xai.on("message", (data) => {
      try {
        bridge.onXai(JSON.parse(data.toString()));
      } catch (e) {
        console.error(`[call ${callId}] bad xai message`, e);
      }
    });
    xai.on("error", (e) => {
      console.error(`[call ${callId}] xai socket error: ${e.message}`);
      void sql`update calls set error = ${`xai: ${e.message}`} where id = ${callId}`.catch(() => {});
    });
    xai.on("close", (code) => {
      console.log(`[call ${callId}] xai closed ${code}`);
      ws.close();
    });
    return xai;
  });
  ws.on("message", (data) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.event === "start") void bridge.start({ streamSid: msg.start.streamSid, callSid: msg.start.callSid }).catch((e) => {
      console.error(`[call ${callId}] start failed`, e);
      ws.close();
    });
    else bridge.onTwilio(msg);
  });
  ws.on("close", () => void bridge.close());
}

/**
 * Mount the Twilio routes on an existing http.Server, whatever else handles
 * its requests (e.g. Next). Twilio paths are intercepted before other listeners.
 */
export function attachCallStreams(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  const emit = server.emit.bind(server) as (event: string, ...args: any[]) => boolean;
  server.emit = ((event: string, ...args: any[]) => {
    const req = args[0] as IncomingMessage | undefined;
    const path = event === "request" || event === "upgrade" ? new URL(req?.url ?? "/", "http://x").pathname : "";
    if (event === "request" && path === "/twilio/status") {
      handleStatus(req!, args[1]).catch((e) => {
        console.error("twilio status failed", e);
        if (!args[1].headersSent) args[1].writeHead(500).end();
      });
      return true;
    }
    if (event === "upgrade" && path === "/twilio/media") {
      const callId = new URL(req!.url!, "http://x").searchParams.get("call");
      if (!callId) {
        args[1].destroy();
        return true;
      }
      wss.handleUpgrade(req!, args[1], args[2], (ws) => bridgeSocket(ws, callId));
      return true;
    }
    return emit(event, ...args);
  }) as Server["emit"];
  // Node only emits "upgrade" if someone listens; drop upgrades nobody else claims.
  server.on("upgrade", (_req, socket) => {
    if (server.listenerCount("upgrade") === 1) socket.destroy();
  });
}
