import { createHmac, timingSafeEqual } from "node:crypto";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

export const publicUrl = () => env("PUBLIC_URL").replace(/\/$/, "");

async function twilio(path: string, form: Record<string, string | string[]>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) for (const item of [v].flat()) body.append(k, item);
  const sid = env("TWILIO_ACCOUNT_SID");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64")}` },
    body
  });
  const json = (await res.json()) as { sid?: string; message?: string };
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${json.message ?? "request failed"}`);
  return json;
}

/** Place the outbound call. Twilio fetches TwiML from us once it connects. */
export async function dial(callId: string, to: string): Promise<string> {
  const base = publicUrl();
  const call = await twilio("/Calls.json", {
    To: process.env.CALL_TARGET_OVERRIDE || to,
    From: env("TWILIO_PHONE_NUMBER"),
    Url: `${base}/twilio/twiml/${callId}`,
    StatusCallback: `${base}/twilio/status/${callId}`,
    StatusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    Record: "true",
    RecordingChannels: "dual",
    RecordingStatusCallback: `${base}/twilio/recording/${callId}`,
    Timeout: "25",
    TimeLimit: "240"
  });
  if (!call.sid) throw new Error("Twilio returned no call SID");
  return call.sid;
}

export async function hangUp(twilioSid: string) {
  await twilio(`/Calls/${twilioSid}.json`, { Status: "completed" });
}

/** Verify X-Twilio-Signature (HMAC-SHA1 of URL + sorted form params). */
export function validTwilioSignature(url: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", env("TWILIO_AUTH_TOKEN")).update(data).digest("base64");
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
