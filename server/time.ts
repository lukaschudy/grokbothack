// Europe/London time helpers. Clocks go back on Sun 25 Oct 2026, so never assume a fixed offset.

const TZ = "Europe/London";

/** Minutes London is ahead of UTC at an instant (0 in GMT, 60 in BST). */
export function londonOffsetMin(at: Date): number {
  const name = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/**
 * Parse a time from the bot. With an offset or Z it is taken as given; without one
 * ("2026-10-29T18:30" or "2026-10-29 18:30") it is London wall-clock time.
 */
export function parseLondonTime(input: string): Date | null {
  const s = input.trim().replace(" ", "T");
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 18), +(m[5] ?? 30), +(m[6] ?? 0));
  let guess = wall - londonOffsetMin(new Date(wall)) * 60_000;
  guess = wall - londonOffsetMin(new Date(guess)) * 60_000;
  return new Date(guess);
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts });
const dayFmt = fmt({ weekday: "short", day: "numeric", month: "short" });
const hmFmt = fmt({ hour: "2-digit", minute: "2-digit", hour12: false });
const dateFmt = fmt({ day: "numeric", month: "short", year: "numeric" });

/** "Thu 29 Oct, 18:30–21:30" in London time. */
export function whenRange(start: Date, end: Date): string {
  const sameDay = dayFmt.format(start) === dayFmt.format(end);
  return sameDay
    ? `${dayFmt.format(start).replace(",", "")}, ${hmFmt.format(start)}–${hmFmt.format(end)}`
    : `${dayFmt.format(start).replace(",", "")}, ${hmFmt.format(start)} – ${dayFmt.format(end).replace(",", "")}, ${hmFmt.format(end)}`;
}

/** "10 Sep 2026" for a date or YYYY-MM-DD. */
export function shortDate(d: Date | string): string {
  const date = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00Z`) : new Date(d);
  return dateFmt.format(date);
}
