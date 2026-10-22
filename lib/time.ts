// All user-facing times are Europe/London. Clocks go back on 25 Oct 2026.
export const TZ = "Europe/London";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** Minutes London is ahead of UTC at this instant (0 in winter, 60 in summer). */
export function londonOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = name?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** London wall-clock date (YYYY-MM-DD) and time (HH:MM) to a UTC instant. */
export function londonToUtc(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - londonOffsetMinutes(new Date(guess)) * 60_000;
  return new Date(guess - londonOffsetMinutes(new Date(first)) * 60_000);
}

/** London calendar date (YYYY-MM-DD) for an instant. */
export function londonDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Resolve a relative day phrase against "now" in London.
 * "next Thursday" said on a Thursday means a week later; on a Monday it means
 * the coming Thursday. "this Thursday" said on a Thursday means today.
 */
export function resolveDay(phrase: string, now: Date): string | null {
  const p = phrase.toLowerCase().trim();
  const today = londonDate(now);
  if (/\b(today|tonight)\b/.test(p)) return today;
  if (/\btomorrow\b/.test(p)) return addDays(today, 1);
  const iso = p.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1]!;
  const wd = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w.slice(0, 3)}(${w.slice(3)})?\\b`).test(p));
  if (wd === -1) return null;
  const diff = (wd - weekdayOf(today) + 7) % 7;
  if (/\bnext\b/.test(p)) return addDays(today, diff === 0 ? 7 : diff);
  return addDays(today, diff);
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts });

/** "Thu 29 Oct" */
export const formatDay = (at: Date) => fmt({ weekday: "short", day: "numeric", month: "short" }).format(at);
/** "18:30" */
export const formatTime = (at: Date) => fmt({ hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
/** "Thu 29 Oct, 18:30–21:30" */
export const formatWindow = (start: Date, end: Date) => `${formatDay(start)}, ${formatTime(start)}–${formatTime(end)}`;

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/** "Thursday the 29th of October" — for the voice agent. */
export function spokenDay(at: Date): string {
  const parts = fmt({ weekday: "long", day: "numeric", month: "long" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} the ${ordinal(Number(get("day")))} of ${get("month")}`;
}

/** "6:30 pm" — for the voice agent. */
export function spokenTime(at: Date): string {
  return fmt({ hour: "numeric", minute: "2-digit", hour12: true }).format(at).replace(":00", "").toLowerCase();
}

/** "4 min ago", "2 h ago", "3 days ago" */
export function ago(at: Date, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
