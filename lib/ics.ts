// RFC 5545 calendar feed for ranked events.
import type { RankedEvent } from "./sources/types";

export type IcsOpts = { calendarName: string; now?: Date };

/** Escape a TEXT value: backslash, semicolon, comma, newlines. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold a content line at 75 octets (UTF-8), never splitting a character. Continuations start with a space. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > 75) {
      out.push(cur);
      cur = " ";
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

/** 2026-10-22T18:00:00.000Z → 20261022T180000Z */
export const icsUtc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function buildIcs(events: RankedEvent[], opts: IcsOpts): string {
  const stamp = icsUtc((opts.now ?? new Date()).toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Roomline//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.calendarName)}`,
    "X-WR-TIMEZONE:Europe/London",
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    "X-PUBLISHED-TTL:PT12H"
  ];
  for (const e of events) {
    const end = e.endsAt ?? new Date(Date.parse(e.startsAt) + 2 * 3600_000).toISOString();
    const location = [e.venueName, e.address && e.address !== e.venueName ? e.address : null].filter(Boolean).join(", ");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.source}-${e.externalId}@roomline`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsUtc(e.startsAt)}`,
      `DTEND:${icsUtc(end)}`,
      `SUMMARY:${escapeText(e.title)}`,
      `DESCRIPTION:${escapeText([...e.reasons.map((r) => `• ${r}`), "", e.url].join("\n"))}`,
      `URL:${e.url}`
    );
    if (location) lines.push(`LOCATION:${escapeText(location)}`);
    if (e.lat != null && e.lng != null) lines.push(`GEO:${e.lat.toFixed(6)};${e.lng.toFixed(6)}`);
    if (e.tags.length) lines.push(`CATEGORIES:${e.tags.map(escapeText).join(",")}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
