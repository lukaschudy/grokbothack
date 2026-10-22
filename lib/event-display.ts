// How a ranked event reads on the home page card.
import { areaFor } from "./sources/types";
import { londonDate } from "./time";

const DATE_REASON = /^(today|tomorrow|tonight|this \w+day|next \w+day|(mon|tue|wed|thu|fri|sat|sun) \d{1,2} [a-z]{3,4})$/i;
const HIDDEN_VENUE = "Venue shown after registering";

/** Reasons worth a chip. The card already shows the date and the venue. */
export function chipReasons(reasons: string[]): string[] {
  return reasons.filter((r) => !DATE_REASON.test(r.trim()) && !r.startsWith("At ") && r !== HIDDEN_VENUE);
}

/** "Today" / "Tomorrow" by London calendar day, else null. */
export function relativeDay(at: Date, now = new Date()): string | null {
  const days = (Date.parse(londonDate(at)) - Date.parse(londonDate(now))) / 86_400_000;
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : null;
}

/** "Granola · Shoreditch". */
export function whereLine(e: { venueName: string | null; lat: number | null; lng: number | null; reasons: string[] }): string {
  const area = e.lat != null && e.lng != null ? areaFor(e.lat, e.lng) : null;
  if (e.venueName && area && e.venueName !== area) return `${e.venueName} · ${area}`;
  if (e.venueName || area) return (e.venueName ?? area)!;
  return e.reasons.includes(HIDDEN_VENUE) ? HIDDEN_VENUE : "Venue to be confirmed";
}

/** Only http(s) links go into an href. */
export function safeHref(url: string | null | undefined): string | null {
  try {
    const u = new URL(url ?? "");
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}
