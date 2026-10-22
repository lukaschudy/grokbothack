// Twilio REST calls with plain fetch, plus webhook signature checks.

import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_CALL_SECONDS = 180;

export function twilioEnv() {
  const need = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  const publicUrl = need("PUBLIC_URL").replace(/\/+$/, "");
  return {
    sid: need("TWILIO_ACCOUNT_SID"),
    token: need("TWILIO_AUTH_TOKEN"),
    from: process.env.TWILIO_FROM || need("TWILIO_PHONE_NUMBER"),
    publicUrl,
    publicHost: new URL(publicUrl).host
  };
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function buildTwiml(publicHost: string, callId: string): string {
  const url = `wss://${publicHost}/twilio/media?call=${encodeURIComponent(callId)}`;
  return `<Response><Connect><Stream url="${escapeXml(url)}"/></Connect></Response>`;
}

/** Form body for POST /Calls.json. Async AMD so a person hears Grok straight away. */
export function buildCallParams(opts: { to: string; from: string; publicUrl: string; publicHost: string; callId: string }): URLSearchParams {
  const status = `${opts.publicUrl}/twilio/status?call=${encodeURIComponent(opts.callId)}`;
  const p = new URLSearchParams({
    To: opts.to,
    From: opts.from,
    Twiml: buildTwiml(opts.publicHost, opts.callId),
    StatusCallback: status,
    StatusCallbackMethod: "POST",
    MachineDetection: "Enable",
    AsyncAmd: "true",
    AsyncAmdStatusCallback: status,
    AsyncAmdStatusCallbackMethod: "POST",
    TimeLimit: String(MAX_CALL_SECONDS)
  });
  for (const e of ["initiated", "ringing", "answered", "completed"]) p.append("StatusCallbackEvent", e);
  return p;
}

async function twilioPost(path: string, body: URLSearchParams): Promise<Record<string, unknown>> {
  const { sid, token } = twilioEnv();
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`twilio ${res.status}: ${json.message ?? res.statusText}`);
  return json;
}

export async function createCall(to: string, callId: string): Promise<string> {
  const env = twilioEnv();
  const json = await twilioPost("/Calls.json", buildCallParams({ ...env, to, callId }));
  return String(json.sid);
}

export async function hangUp(twilioSid: string): Promise<void> {
  await twilioPost(`/Calls/${twilioSid}.json`, new URLSearchParams({ Status: "completed" }));
}

/** X-Twilio-Signature: base64 HMAC-SHA1 of the full URL plus sorted POST params. */
export function twilioSignature(token: string, url: string, params: URLSearchParams): string {
  const data = [...params.keys()].sort().reduce((acc, k) => acc + k + params.getAll(k).join(""), url);
  return createHmac("sha1", token).update(data).digest("base64");
}

export function validSignature(token: string, url: string, params: URLSearchParams, header: string | undefined): boolean {
  if (!header) return false;
  const a = Buffer.from(twilioSignature(token, url, params));
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

const TERMINAL = new Set(["completed", "failed", "no_answer", "busy", "canceled"]);

/**
 * Next calls.status given the current one and a Twilio status callback.
 * Returns null when nothing should change. Terminal states never move.
 */
export function nextStatus(current: string, p: { CallStatus?: string | null; AnsweredBy?: string | null }): string | null {
  if (TERMINAL.has(current)) return null;
  const answeredBy = p.AnsweredBy ?? "";
  if (answeredBy.startsWith("machine") || answeredBy === "fax") return "no_answer";
  switch (p.CallStatus) {
    case "queued":
    case "initiated": return current === "queued" ? "dialing" : null;
    case "ringing": return current === "in_progress" ? null : "ringing";
    case "in-progress": return "in_progress";
    case "busy": return "busy";
    case "no-answer": return "no_answer";
    case "failed": return "failed";
    case "canceled": return "canceled";
    // Answered but hung up before Grok recorded a result: still a real call.
    case "completed": return current === "in_progress" ? "completed" : "no_answer";
    default: return null;
  }
}
