import { sql } from "./db";
import { emitCall, type CallResult } from "./bus";
import { formatWindow, londonDate, londonToUtc, spokenDay, spokenTime } from "./time";

export type CallContext = {
  id: string;
  venue_id: string;
  venue_name: string;
  address: string | null;
  capacity: number | null;
  terms: string;
  phone: string | null;
  contact_name: string | null;
  organiser: string;
  community: string | null;
  requested_by: string | null;
  event_title: string | null;
  headcount: number;
  starts_at: Date;
  ends_at: Date;
  status: string;
  twilio_sid: string | null;
  result: CallResult | null;
};

export async function loadCall(callId: string): Promise<CallContext | null> {
  const [row] = await sql<CallContext[]>`
    select c.id, c.venue_id, v.name as venue_name, v.address, v.capacity, v.terms,
           vc.phone, vc.contact_name, coalesce(p.display_name, 'a local organiser') as organiser, p.community,
           c.requested_by, c.event_title, c.headcount, c.starts_at, c.ends_at, c.status, c.twilio_sid, c.result
    from calls c
    join venues v on v.id = c.venue_id
    left join venue_contacts vc on vc.venue_id = c.venue_id
    left join profiles p on p.id = c.requested_by
    where c.id = ${callId}`;
  return row ?? null;
}

const TERMS: Record<string, string> = {
  free: "free to use",
  free_for_community: "free for community events",
  paid: "a paid venue",
  unknown: "of unknown cost"
};

/** Opener from the README's calling script, then the AI and recording disclosure. */
export function openingLine(c: CallContext): string {
  const who = c.community ? `${c.organiser}, ${c.community}` : c.organiser;
  return `Hi, I'm an assistant calling on behalf of ${who}. Just so you know, I'm an AI and this call is recorded. Have you got a quick minute to check whether a room's free?`;
}

export function agentInstructions(c: CallContext): string {
  const day = spokenDay(c.starts_at);
  const from = spokenTime(c.starts_at);
  const to = spokenTime(c.ends_at);
  return `# Role
You are Roomline, an AI phone assistant for London tech community organisers. You are on a live outbound phone call to ${c.venue_name}. Speak with a natural London accent and British English: warm, brisk and brief, like a good events coordinator.

# Context
- You are calling on behalf of ${c.organiser}${c.community ? `, who runs ${c.community}` : ""}.
- They want to host ${c.event_title ? `"${c.event_title}"` : "a community tech meetup"} for about ${c.headcount} people on ${day}, from ${from} to ${to}.
- ${c.venue_name}${c.address ? ` is at ${c.address}. ` : ". "}Our records say it holds about ${c.capacity ?? "an unknown number of"} people and is ${TERMS[c.terms] ?? "of unknown cost"}.
- You have already introduced yourself, said you are an AI and that the call is recorded. Don't repeat it unless asked.

# Goal
Find out, in under two minutes:
1. Is the space free on ${day} from ${from} to ${to}?
2. Can it fit ${c.headcount} people?
3. The price, or whether it's free for community events.
4. Any conditions: guest list, finish time, catering, AV, deposit.
5. Who handles the booking, and the next step.
If it isn't free, ask once whether another evening that week works, and note it.

# Style
- One short question at a time. At most two sentences per turn.
- Acknowledge answers briefly and move on.
- Never invent details about the event. If you don't know something, say ${c.organiser} will follow up by email.

# Rules
- Never claim to be human. If anyone asks whether you're a person or a bot, say you're an AI assistant calling for ${c.organiser}.
- Don't book, pay or commit to anything. You are only checking availability.
- Don't share phone numbers or email addresses.
- If you reach voicemail or an automated menu you can't get through, call end_call straight away without leaving a message.
- If they ask not to be called again, apologise, confirm, and call end_call.

# Tools
- As soon as you have the answers, or they can't help, call record_availability once with exactly what they said.
- Then thank them, say ${c.organiser} will be in touch by email, say goodbye, and call end_call.`;
}

export const agentTools = [
  {
    type: "function",
    name: "record_availability",
    description: "Save what the venue said about availability for the requested evening. Call once, before saying goodbye.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["available", "unavailable", "partial"],
          description: "partial = free, but with a shorter window, smaller room, or other big caveat"
        },
        start_time: { type: ["string", "null"], description: "Start of the window they can offer, 24h HH:MM London time" },
        end_time: { type: ["string", "null"], description: "End of the window they can offer, 24h HH:MM London time" },
        max_people: { type: ["integer", "null"], description: "How many people they said fit" },
        price: { type: ["string", "null"], description: "Price in their words, e.g. 'free for community events' or '£250 plus VAT'" },
        conditions: { type: ["string", "null"], description: "Conditions in a short phrase, e.g. 'guest list 48 hours before; out by 9:30'" },
        contact_name: { type: ["string", "null"], description: "Name of the person you spoke to" },
        contact_role: { type: ["string", "null"], description: "Their role, e.g. events manager" },
        next_step: { type: ["string", "null"], description: "How to book, e.g. 'email bookings with the date and headcount'" },
        alternative: { type: ["string", "null"], description: "Another date they offered, if the requested one is not free" }
      },
      required: ["status"]
    }
  },
  {
    type: "function",
    name: "end_call",
    description: "Hang up after saying goodbye, or immediately on voicemail.",
    parameters: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"]
    }
  }
] as const;

/** "18:30", "6:30pm", "6 pm", "18.30" → "18:30" */
export function normaliseTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? "0");
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (!m[3] && h >= 1 && h <= 11 && !m[2]) h += 12; // "6" on an evening call means 6 pm
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseResult(args: Record<string, unknown>): CallResult {
  const status = args.status === "available" || args.status === "unavailable" || args.status === "partial" ? args.status : "partial";
  const people = typeof args.max_people === "number" && Number.isFinite(args.max_people) ? Math.round(args.max_people) : null;
  return {
    status,
    start_time: normaliseTime(args.start_time),
    end_time: normaliseTime(args.end_time),
    max_people: people && people > 0 ? people : null,
    price: str(args.price),
    conditions: str(args.conditions),
    contact_name: str(args.contact_name),
    contact_role: str(args.contact_role),
    next_step: str(args.next_step),
    alternative: str(args.alternative)
  };
}

const TERMINAL = ["completed", "failed", "no_answer", "busy", "canceled"];

/** Ended calls stay ended: a late Twilio "completed" must not turn a failed call into a completed one. */
export async function setCallStatus(callId: string, status: string) {
  const terminal = TERMINAL.includes(status);
  const updated = await sql`
    update calls set status = ${status},
      answered_at = case when ${status} = 'in_progress' and answered_at is null then now() else answered_at end,
      ended_at = case when ${terminal} then coalesce(ended_at, now()) else ended_at end
    where id = ${callId} and status <> all(${TERMINAL})
    returning id`;
  if (updated.length) emitCall(callId, { type: "status", status, at: new Date().toISOString() });
}

export async function appendTranscript(callId: string, line: { id: string; who: "agent" | "venue"; text: string }) {
  const entry = { ...line, at: new Date().toISOString() };
  await sql`update calls set transcript = transcript || ${sql.json([entry])} where id = ${callId}`;
}

/**
 * Write the call's answer back as a dated availability record and confirm the
 * venue facts the call touched, attributed to the organiser who asked.
 */
export async function saveCallResult(c: CallContext, result: CallResult, opts: { updateVenue?: boolean } = {}): Promise<CallResult> {
  const updateVenue = opts.updateVenue ?? true;
  const day = londonDate(c.starts_at);
  const starts = result.start_time ? londonToUtc(day, result.start_time) : c.starts_at;
  let ends = result.end_time ? londonToUtc(day, result.end_time) : c.ends_at;
  if (ends <= starts) ends = new Date(starts.getTime() + 3 * 3600_000);
  const confirmedBy = [result.contact_name, result.contact_role].filter(Boolean).join(", ") || null;
  const conditions = [result.conditions, result.alternative ? `Also offered: ${result.alternative}` : null].filter(Boolean).join(". ") || null;

  const saved = await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claim.sub', ${c.requested_by ?? ""}, true),
                    set_config('roomline.source', 'call', true)`;
    const [row] = await tx<{ id: string; created_at: Date }[]>`
      insert into availability (venue_id, starts_at, ends_at, status, conditions, price_note, confirmed_by_name, source, call_id, recorded_by)
      values (${c.venue_id}, ${starts}, ${ends}, ${result.status}, ${conditions}, ${result.price}, ${confirmedBy}, 'call', ${c.id}, ${c.requested_by})
      returning id, created_at`;
    if (updateVenue && result.max_people && result.max_people !== c.capacity) {
      await tx`update venues set capacity = ${result.max_people} where id = ${c.venue_id}`;
    } else if (updateVenue && result.max_people) {
      await tx`select confirm_venue_fields(${c.venue_id}, array['capacity'], 'call')`;
    }
    if (updateVenue && result.price) await tx`update venues set price_note = ${result.price} where id = ${c.venue_id}`;
    const full: CallResult = { ...result, availability_id: row!.id, recorded_at: row!.created_at.toISOString() };
    await tx`update calls set result = ${tx.json(full)} where id = ${c.id}`;
    return full;
  });
  emitCall(c.id, { type: "result", result: saved as CallResult });
  return saved as CallResult;
}

export const describeWindow = (c: Pick<CallContext, "starts_at" | "ends_at">) => formatWindow(c.starts_at, c.ends_at);
