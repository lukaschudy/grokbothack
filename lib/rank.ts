// Rank events with reasons a human can read. Deterministic for a given `now`.
import { areaFor, londonDate, type RankedEvent, type SourceEvent } from "./sources/types";

export type RankOpts = {
  /** Past events per community (e.g. from Luma calendar .ics history). */
  pastEventsByCommunity?: Record<string, number>;
};

const DAY = 86400_000;

// Event type from the title (README: hackathons and build days > talks > networking;
// penalise recurring drinks and recruiter-led events). Talks are the neutral default.
const HACK_RE = /\b(hack(athon|ers?|s)?|buildathon|hack ?(day|night))\b/i;
const WORKSHOP_RE = /\b(workshop|hands-on|game jam)\b/i;
const SOCIAL_RE = /\b(network(ing)?|social|drinks|pub|mixer|party|run ?club|running|walks?|stroll|games? night|chess|movie|screening)\b/i;
const CAREERS_RE = /\b(recruit\w*|hiring|jobs?|careers?|layoffs?)\b/i;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today" / "Tomorrow" / "This Thursday" / "Next Tuesday" / "Thu 12 Nov", in Europe/London. */
export function whenLabel(startsAt: string, now: Date): string {
  const day = (iso: string) => Date.parse(`${londonDate(iso)}T00:00:00Z`) / DAY;
  const ev = day(startsAt), today = day(now.toISOString());
  const diff = ev - today;
  const wd = new Date(ev * DAY).getUTCDay();
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  const mondayOf = (d: number) => d - ((new Date(d * DAY).getUTCDay() + 6) % 7);
  const weeks = (mondayOf(ev) - mondayOf(today)) / 7;
  if (diff > 0 && weeks === 0) return `This ${WEEKDAYS[wd]}`;
  if (diff > 0 && weeks === 1) return `Next ${WEEKDAYS[wd]}`;
  const d = new Date(ev * DAY);
  return `${WEEKDAYS[wd]!.slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function rankEvents(events: SourceEvent[], now: Date, opts: RankOpts = {}): RankedEvent[] {
  const upcomingByCommunity = new Map<string, number>();
  for (const e of events) if (e.community) upcomingByCommunity.set(e.community, (upcomingByCommunity.get(e.community) ?? 0) + 1);

  const ranked = events.map((e): RankedEvent => {
    const reasons: string[] = [];
    let score = 0;
    const start = Date.parse(e.startsAt);
    const end = e.endsAt ? Date.parse(e.endsAt) : start + 2 * 3600_000;

    if (end < now.getTime()) {
      reasons.push("Already happened");
      score -= 100;
    } else {
      reasons.push(whenLabel(e.startsAt, now));
      score += 3 * Math.max(0, 1 - (start - now.getTime()) / (21 * DAY));
    }

    if (e.tags.includes("hackathon") || HACK_RE.test(e.title)) {
      reasons.push("Hackathon");
      score += 3;
    } else if (WORKSHOP_RE.test(e.title)) {
      reasons.push("Workshop");
      score += 3;
    } else if (SOCIAL_RE.test(e.title)) {
      reasons.push("Networking or social");
      score -= 3;
    } else if (CAREERS_RE.test(e.title)) {
      reasons.push("Careers or recruiting");
      score -= 3;
    }

    // Free is the norm for community events (Meetup only marks paid ones), so penalise paid instead of boosting free.
    if (e.isFree === true) {
      reasons.push("Free");
    } else if (e.isFree === false) {
      reasons.push("Paid");
      score -= 2;
    }

    if (e.attendees && e.attendees > 0) {
      reasons.push(`${e.attendees} ${e.source === "devpost" || e.source === "builderbase" ? "registered" : "going"}`);
      score += Math.min(3, Math.log10(e.attendees + 1) * 1.2);
    }

    if (e.community) {
      const past = opts.pastEventsByCommunity?.[e.community] ?? 0;
      const upcoming = upcomingByCommunity.get(e.community) ?? 0;
      reasons.push(past > 0 ? `Run by ${e.community}, ${past} past event${past === 1 ? "" : "s"}` : `Run by ${e.community}`);
      score += Math.min(2, Math.log2(past + upcoming) / 2);
    }

    if (e.venueName) {
      const area = e.lat != null && e.lng != null ? areaFor(e.lat, e.lng) : null;
      reasons.push(area ? `At ${e.venueName}, ${area}` : `At ${e.venueName}`);
      score += 0.5;
    } else if (e.source === "luma") {
      reasons.push("Venue shown after registering");
    }

    return { ...e, score: Math.round(score * 100) / 100, reasons };
  });

  return ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.startsAt.localeCompare(b.startsAt) ||
      `${a.source}:${a.externalId}`.localeCompare(`${b.source}:${b.externalId}`)
  );
}
