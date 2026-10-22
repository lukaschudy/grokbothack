// What Grok says on the phone: the spoken date/time, the system prompt and the
// one tool it can call. Pure functions so they can be tested without a call.

const TZ = "Europe/London";
const HOURS = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];

export type CallContext = {
  organiser: string;
  community: string | null;
  venue: string;
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  eventTitle: string | null;
};

function londonParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "numeric", hourCycle: "h23"
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { weekday: get("weekday"), day: Number(get("day")), month: get("month"), hour: Number(get("hour")), minute: Number(get("minute")) };
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/** British spoken clock time: "half six", "quarter to eight", "seven", "6:20". */
export function spokenTime(hour: number, minute: number): string {
  if (minute === 0 && hour === 12) return "midday";
  if (minute === 0 && hour === 0) return "midnight";
  const h = HOURS[hour % 12]!;
  if (minute === 0) return h;
  if (minute === 30) return `half ${h}`;
  if (minute === 15) return `quarter past ${h}`;
  if (minute === 45) return `quarter to ${HOURS[(hour + 1) % 12]}`;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")}`;
}

/** "Thursday the 29th of October from half six to half nine", in London time. */
export function spokenSlot(startsAt: Date, endsAt: Date): string {
  const s = londonParts(startsAt);
  const e = londonParts(endsAt);
  const day = (p: typeof s) => `${p.weekday} the ${ordinal(p.day)} of ${p.month}`;
  const sameDay = s.day === e.day && s.month === e.month;
  return `${day(s)} from ${spokenTime(s.hour, s.minute)} to ${spokenTime(e.hour, e.minute)}${sameDay ? "" : ` on ${day(e)}`}`;
}

export function buildInstructions(ctx: CallContext): string {
  const onBehalf = ctx.community ? `${ctx.organiser} from ${ctx.community}` : ctx.organiser;
  const what = ctx.eventTitle ? `a community event, "${ctx.eventTitle}",` : "a community event";
  return `# Role
You are a phone assistant making a short outbound call to ${ctx.venue}, a venue in London, on behalf of ${onBehalf}. You speak with a natural London accent, politely and briefly, like a friendly local.

# Goal
Find out whether ${ctx.venue} is free for ${what} on ${spokenSlot(ctx.startsAt, ctx.endsAt)}, for ${ctx.headcount} people.

# Flow
1. You speak first. Open with: "Hi, I'm an assistant calling on behalf of ${onBehalf}." Then ask if they're the right person to talk to about booking the space.
2. Ask whether ${ctx.venue} is free on ${spokenSlot(ctx.startsAt, ctx.endsAt)} for ${ctx.headcount} people.
3. Ask whether it would be free of charge for a community group, or what it costs.
4. Ask about any conditions (for example: insurance, catering, finish time, a host who must be present, deposit).
5. Ask their name. Offer to have ${ctx.organiser} email the details; if they want that, ask for the best email address and include it in the summary.
6. Call report_result with what you learned, then thank them and say goodbye.

# Rules
- Never claim to be human. If asked, say you're an AI assistant calling for ${ctx.organiser}.
- Keep the whole call under two minutes. One question at a time; short sentences.
- If they can't say now, don't know, or ask you to call back: thank them, call report_result with status "partial" and what they said, then say goodbye.
- If they say it's not available, call report_result with status "unavailable".
- Don't negotiate, promise payment, or agree to anything on the organiser's behalf.
- If you reach voicemail or an automated menu with no person, say goodbye without leaving details.
- Always call report_result exactly once before you say goodbye.`;
}

export const REPORT_TOOL = {
  type: "function",
  name: "report_result",
  description: "Record what the venue said about availability. Call exactly once, just before saying goodbye.",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["available", "unavailable", "partial"],
        description: "available = free for that slot; unavailable = not free; partial = maybe, part of the slot, or they need to check"
      },
      price_note: { type: "string", description: "Free of charge, or what it costs, in their words. Empty if unknown." },
      conditions: { type: "string", description: "Any conditions or caveats they mentioned. Empty if none." },
      confirmed_by_name: { type: "string", description: "Name of the person you spoke to. Empty if not given." },
      summary: { type: "string", description: "One or two sentences summarising the answer, including any email address they gave." }
    },
    required: ["status", "summary"]
  }
} as const;

export function buildSessionUpdate(ctx: CallContext) {
  return {
    type: "session.update",
    session: {
      voice: "leo",
      instructions: buildInstructions(ctx),
      audio: {
        input: { format: { type: "audio/pcmu" } },
        output: { format: { type: "audio/pcmu" } }
      },
      turn_detection: { type: "server_vad" },
      tools: [REPORT_TOOL]
    }
  };
}
