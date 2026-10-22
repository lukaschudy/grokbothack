import type { CallResult } from "./bus";
import { parseResult, type CallContext } from "./calls";
import { londonDate } from "./time";

const TEXT_MODEL = process.env.XAI_TEXT_MODEL ?? "grok-4.20-0309-non-reasoning";

async function chatJson<T>(system: string, user: string, schema: object, timeoutMs: number): Promise<T | null> {
  if (!process.env.XAI_API_KEY) return null;
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TEXT_MODEL,
      temperature: 0,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name: "out", strict: true, schema } }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`xAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  return content ? (JSON.parse(content) as T) : null;
}

async function chatText(system: string, user: string, timeoutMs: number): Promise<string | null> {
  if (!process.env.XAI_API_KEY) return null;
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: TEXT_MODEL, temperature: 0.3, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`xAI ${res.status}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content?.trim() ?? null;
}

export type ParsedAsk = {
  headcount: number | null;
  day_phrase: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  near: string | null;
  free_only: boolean;
  event_title: string | null;
};

const nullable = (type: string) => ({ type: [type, "null"] });

export async function parseAskWithGrok(text: string, now: Date): Promise<ParsedAsk | null> {
  const today = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  return chatJson<ParsedAsk>(
    `You turn a London community organiser's venue request into search filters. Today is ${today} (${londonDate(now)}), Europe/London.
- headcount: number of people, or null.
- day_phrase: the day exactly as they said it ("next Thursday", "tomorrow", "29 Oct"), or null.
- date: that day as YYYY-MM-DD. "next <weekday>" said on that same weekday means 7 days later.
- start_time/end_time: 24h HH:MM if given; evening events default to null.
- near: the London place, station or area they want to be near (e.g. "Old Street"), or null.
- free_only: true only if they ask for free space.
- event_title: what the event is, if they say, else null.`,
    text,
    {
      type: "object",
      additionalProperties: false,
      properties: {
        headcount: nullable("integer"),
        day_phrase: nullable("string"),
        date: nullable("string"),
        start_time: nullable("string"),
        end_time: nullable("string"),
        near: nullable("string"),
        free_only: { type: "boolean" },
        event_title: nullable("string")
      },
      required: ["headcount", "day_phrase", "date", "start_time", "end_time", "near", "free_only", "event_title"]
    },
    2500
  );
}

export async function draftRequestWithGrok(input: {
  organiser: string; community: string | null; venue: string; contact: string | null;
  when: string; headcount: number; eventTitle: string | null; hosts: string[]; callNote: string | null;
}): Promise<string | null> {
  return chatText(
    "You write short, warm, specific venue request emails for London tech community organisers. British English. 90-140 words. No subject line, no placeholders in brackets, no exclamation marks. Sign off with the organiser's name.",
    JSON.stringify(input),
    6000
  );
}

/** Fallback when the voice agent hangs up without calling record_availability. */
export async function extractResultFromTranscript(
  c: CallContext,
  lines: { who: "agent" | "venue"; text: string }[]
): Promise<CallResult | null> {
  const transcript = lines.map((l) => `${l.who === "agent" ? "Roomline" : "Venue"}: ${l.text}`).join("\n");
  const out = await chatJson<Record<string, unknown>>(
    `Extract what the venue said about availability for ${c.headcount} people on ${londonDate(c.starts_at)}. Times as 24h HH:MM London. Use null when not said.`,
    transcript,
    {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["available", "unavailable", "partial"] },
        start_time: nullable("string"), end_time: nullable("string"), max_people: nullable("integer"),
        price: nullable("string"), conditions: nullable("string"), contact_name: nullable("string"),
        contact_role: nullable("string"), next_step: nullable("string"), alternative: nullable("string")
      },
      required: ["status", "start_time", "end_time", "max_people", "price", "conditions", "contact_name", "contact_role", "next_step", "alternative"]
    },
    8000
  );
  return out ? parseResult(out) : null;
}
