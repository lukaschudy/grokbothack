import type { ParsedAsk } from "./grok";

const DAY_WORDS = "(?:today|tonight|tomorrow|(?:next|this)\\s+\\w+|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";

/** Deterministic parser: the fallback when Grok is slow or unavailable. */
export function parseAskLocally(text: string): ParsedAsk {
  const t = text.toLowerCase();
  const head = t.match(/\b(?:for|of)\s+(\d{1,4})\b/) ?? t.match(/\b(\d{1,4})\s*(?:people|ppl|pax|guests|attendees|devs|folks)\b/);
  const day = t.match(new RegExp(`\\b${DAY_WORDS}\\b`));
  const near = text.match(/\b(?:near|around|by|in)\s+([A-Z][\w'’]*(?:\s+(?:[A-Z][\w'’]*|and|&))*)/);
  const time = t.match(/\b(?:at|from)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  let start: string | null = null;
  if (time) {
    let h = Number(time[1]);
    if (time[3] === "pm" && h < 12) h += 12;
    if (!time[3] && h < 12) h += 12;
    start = `${String(h).padStart(2, "0")}:${time[2] ?? "00"}`;
  }
  return {
    headcount: head ? Number(head[1]) : null,
    day_phrase: day ? day[0] : null,
    date: null,
    start_time: start,
    end_time: null,
    near: near ? near[1]!.trim() : null,
    free_only: /\bfree\b/.test(t),
    event_title: null
  };
}
