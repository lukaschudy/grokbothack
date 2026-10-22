// Fetch London tech events + venue evidence from Luma, Meetup, Devpost, BuilderBase.
// Writes data/seed/events.json (ranked, next ~3 weeks) and data/seed/venues.json (venues seen hosting).
// Raw responses are cached in data/raw/ for 12h, so re-runs are cheap.
//   npx tsx scripts/fetch-sources.ts
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { rankEvents } from "../lib/rank";
import { builderBaseToSourceEvent, fetchBuilderBase } from "../lib/sources/builderbase";
import { devpostToEvidence, devpostToSourceEvent, fetchDevpostList, fetchDevpostPlace, type DevpostHackathon, type DevpostPlace } from "../lib/sources/devpost";
import { fetchLumaCalendarIcs, fetchLumaDiscover, icsToEvidence, lumaEntryToEvidence, lumaEntryToSourceEvent } from "../lib/sources/luma";
import { fetchMeetupFind, fetchMeetupGroupPast, meetupToEvidence, meetupToSourceEvent, type MeetupEvent } from "../lib/sources/meetup";
import {
  areaFor, cachedJson, distanceM, extractPostcode, geocodePostcodes, hash, isTech,
  type SeedVenue, type Source, type SourceEvent, type VenueEvidence, type VenueKind
} from "../lib/sources/types";

const KIND_RULES: [VenueKind, RegExp][] = [
  ["university", /\b(universit|college|imperial|ucl|kcl|lse|qmul|queen mary|birkbeck|goldsmiths|school of|bancroft|students'? union|central saint martins|csm|royal college)\b/i],
  ["pub_or_bar", /\b(pub|bar|tavern|taverne|arms|inn|brewery|brewdog|taproom|beer|cocktail|wine|ale house|social club)\b/i],
  ["coworking", /\b(wework|techspace|huckletree|second home|uncommon|plexal|work\.life|runway east|regus|spaces|clockwise|mindspace|fora|the office group|tog|impact hub|innovation warehouse|rise london|level39|launchpad|incubator|accelerator|coworking|co-working|workspace|the trampery|shoreditch exchange|newspeak)\b/i],
  ["community_space", /\b(newspeak house|library|community|church|centre|center|foundation|catapult|trust|charity|council)\b/i],
  ["bookable", /\b(hotel|conference|venue|events? space|arena|theatre|theater|cinema|savoy place|iet|gallery|studios?|hall|museum|leonardo|hilton|marriott|novotel|exhibition)\b/i],
  ["company_office", /\b(ltd|limited|plc|inc|hq|headquarters|offices?|floor|level \d+|google|meta|microsoft|amazon|aws|cloudflare|github|snyk|monzo|revolut|wise|deliveroo|just eat|bloomberg|pwc|deloitte|kpmg|accenture|ibm|salesforce|spotify|ocado|zoopla|veed|tessl|neo4j|capital|ventures|partners|bank|labs?|technologies|software|ai)\b/i]
];

/** Heuristic venue type: the name decides first, then the address (not for pubs: "Lincoln's Inn Fields"). */
export function guessKind(name: string, address: string | null): VenueKind {
  if (/newspeak house/i.test(name)) return "community_space";
  for (const [kind, re] of KIND_RULES) if (re.test(name)) return kind;
  for (const [kind, re] of KIND_RULES) if (kind !== "pub_or_bar" && re.test(address ?? "")) return kind;
  return "other";
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 40);

const mostCommon = (xs: string[]) => {
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
};

const samePostcode = (a: VenueEvidence, b: VenueEvidence) => extractPostcode(a.address ?? a.venueName) === extractPostcode(b.address ?? b.venueName);
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const looksLikeAddress = (n: string) => /^\d/.test(n) || !!extractPostcode(n);

/** Group evidence into venues: by Google place_id first, else within ~50 m. Evidence must carry a full postcode. */
export function aggregateVenues(evidence: VenueEvidence[]): SeedVenue[] {
  const usable = evidence
    .filter((e) => extractPostcode(e.address ?? e.venueName))
    .sort((a, b) => Number(!a.googlePlaceId) - Number(!b.googlePlaceId) || a.eventDate.localeCompare(b.eventDate) || a.eventUrl.localeCompare(b.eventUrl));
  type Group = { pid: string | null; lat: number; lng: number; items: VenueEvidence[] };
  const groups: Group[] = [];
  for (const e of usable) {
    let g = e.googlePlaceId ? groups.find((x) => x.pid === e.googlePlaceId) : undefined;
    // Same place: within ~50 m, or same postcode/name within 300 m (postcode centroids drift from the building).
    g ??= groups.find((x) => {
      const d = distanceM(x.lat, x.lng, e.lat, e.lng);
      if (d <= 50) return !e.googlePlaceId || !x.pid;
      return d <= 300 && x.items.some((i) => samePostcode(i, e) || compact(i.venueName) === compact(e.venueName));
    });
    if (!g) groups.push((g = { pid: e.googlePlaceId, lat: e.lat, lng: e.lng, items: [] }));
    g.items.push(e);
  }
  return groups.map((g): SeedVenue => {
    const seen = new Set<string>();
    const hosts = g.items
      .filter((e) => !seen.has(e.eventUrl) && seen.add(e.eventUrl))
      .sort((a, b) => b.eventDate.localeCompare(a.eventDate) || a.eventUrl.localeCompare(b.eventUrl))
      .map(({ community, eventTitle, eventUrl, eventDate, attendees, source }) => ({ community, eventTitle, eventUrl, eventDate, attendees, source }));
    // Prefer a real name ("Tessl") over an address used as a name ("210 Pentonville Rd").
    const names = g.items.map((e) => e.venueName);
    const name = mostCommon(names.filter((n) => !looksLikeAddress(n))) || mostCommon(names);
    const address = [...g.items.map((e) => e.address).filter((a): a is string => !!a && !!extractPostcode(a))].sort((a, b) => b.length - a.length || a.localeCompare(b))[0] ?? null;
    const att = hosts.map((h) => h.attendees).filter((n): n is number => n != null && n > 0);
    return {
      name, address, area: areaFor(g.lat, g.lng), lat: g.lat, lng: g.lng, googlePlaceId: g.pid,
      kindGuess: guessKind(name, address), maxAttendeesSeen: att.length ? Math.max(...att) : null, hosts
    };
  });
}

const SOURCE_ORDER: Source[] = ["luma", "meetup", "devpost", "builderbase"];

/** Same event listed on two sources (e.g. Meetup pointing at Luma): keep the richer source. */
export function dedupeEvents(events: SourceEvent[]): SourceEvent[] {
  const byKey = new Map<string, SourceEvent>();
  const sorted = [...events].sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source));
  for (const e of sorted) {
    const key = `${norm(e.title)}|${e.startsAt.slice(0, 10)}`;
    if (!byKey.has(key)) byKey.set(key, e);
  }
  return [...byKey.values()];
}

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T, errors: string[]): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    errors.push(`${label}: ${(err as Error).message}`);
    console.warn(`! ${label}: ${(err as Error).message}`);
    return fallback;
  }
}

/** Fill area for venues away from the named neighbourhoods using the borough from postcodes.io. */
async function fillAreas(venues: SeedVenue[]) {
  const missing = venues.filter((v) => !v.area);
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const geolocations = batch.map((v) => ({ latitude: v.lat, longitude: v.lng, limit: 1, radius: 500 }));
    const json = await cachedJson<{ result: { result: { admin_district: string; admin_ward: string }[] | null }[] }>(
      "https://api.postcodes.io/postcodes",
      {
        cacheKey: `postcodes/reverse-${hash(JSON.stringify(geolocations))}.json`,
        maxAgeMs: 30 * 86400_000,
        init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ geolocations }) }
      }
    );
    json.result.forEach((r, j) => (batch[j]!.area = r.result?.[0]?.admin_district ?? null));
  }
}

async function main() {
  const now = new Date();
  const until = new Date(now.getTime() + 21 * 86400_000).toISOString();
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  const evidence: VenueEvidence[] = [];
  const upcoming: SourceEvent[] = [];
  const inWindow = (e: SourceEvent) => e.startsAt <= until && Date.parse(e.endsAt ?? e.startsAt) + (e.endsAt ? 0 : 2 * 3600_000) >= now.getTime();

  // Luma discover → upcoming events + calendars to mine for history.
  const entries = await safe("luma discover", () => fetchLumaDiscover({ until }), [], errors);
  counts["luma discover entries"] = entries.length;
  const lumaEvents = entries.map(lumaEntryToSourceEvent).filter((e): e is SourceEvent => !!e && inWindow(e));
  counts["luma tech events (window)"] = lumaEvents.length;
  upcoming.push(...lumaEvents);
  for (const en of entries) if (Date.parse(en.event.start_at) < now.getTime()) {
    const ev = lumaEntryToEvidence(en);
    if (ev) evidence.push(ev);
  }

  // Luma calendar .ics history for tech communities seen in discover.
  const calendars = new Map<string, string>();
  for (const en of entries) {
    const cal = en.calendar;
    if (cal && !cal.is_personal && lumaEntryToSourceEvent(en)) calendars.set(cal.api_id, cal.name);
  }
  const pastByCommunity: Record<string, number> = {};
  let icsEvidence = 0;
  for (const [id, name] of [...calendars].slice(0, 80)) {
    const ics = await safe(`luma ics ${name}`, () => fetchLumaCalendarIcs(id), [], errors);
    pastByCommunity[name] = ics.filter((e) => Date.parse(e.start) < now.getTime()).length;
    const ev = icsToEvidence(ics, name, now);
    icsEvidence += ev.length;
    evidence.push(...ev);
  }
  counts["luma calendars"] = calendars.size;
  counts["luma ics evidence"] = icsEvidence;

  // Meetup: upcoming via /find, history via each London group's past events.
  const meetup: MeetupEvent[] = [];
  for (const kw of ["tech", "ai", "javascript", "python", "data", "cloud", "developer", "startup"])
    meetup.push(...(await safe(`meetup find ${kw}`, () => fetchMeetupFind(kw), [], errors)));
  const groups = [...new Set(meetup.filter((e) => e.country === "GB" && /london/i.test(e.city ?? "") && e.groupUrlname).map((e) => e.groupUrlname!))].sort();
  for (const g of groups.slice(0, 40)) meetup.push(...(await safe(`meetup past ${g}`, () => fetchMeetupGroupPast(g), [], errors)));
  counts["meetup events parsed"] = meetup.length;
  counts["meetup groups"] = groups.length;

  // Devpost: ended London hackathons (venue history) + upcoming ones.
  const ended = await safe("devpost ended", () => fetchDevpostList("ended", 7), [], errors);
  const soon = await safe("devpost upcoming", () => fetchDevpostList("upcoming", 1), [], errors);
  const places = new Map<number, DevpostPlace | null>();
  for (const h of [...soon, ...ended].slice(0, 220))
    places.set(h.id, await safe(`devpost page ${h.url}`, () => fetchDevpostPlace(h), null, errors));
  counts["devpost ended (in person)"] = ended.length;
  counts["devpost upcoming (in person)"] = soon.length;

  // Geocode every postcode we saw (Meetup + Devpost) in bulk.
  const postcodes = [...meetup.map((e) => e.postcode), ...[...places.values()].map((p) => p?.postcode)].filter((p): p is string => !!p);
  const coords = await safe("postcodes.io", () => geocodePostcodes(postcodes), new Map(), errors);

  const meetupSeen = new Set<string>();
  for (const e of meetup) {
    if (meetupSeen.has(e.id)) continue;
    meetupSeen.add(e.id);
    const se = meetupToSourceEvent(e, coords);
    if (se && inWindow(se) && isTech(e.title, e.groupName)) upcoming.push(se);
    const ev = meetupToEvidence(e, coords, now);
    if (ev) evidence.push(ev);
  }
  counts["meetup London events (window)"] = upcoming.filter((e) => e.source === "meetup").length;
  counts["meetup evidence"] = evidence.filter((e) => e.source === "meetup").length;

  const dedupeDevpost = new Map<number, DevpostHackathon>();
  for (const h of [...soon, ...ended]) dedupeDevpost.set(h.id, h);
  for (const h of dedupeDevpost.values()) {
    const p = places.get(h.id) ?? null;
    const se = devpostToSourceEvent(h, p, coords);
    if (se && inWindow(se)) upcoming.push(se);
    const ev = devpostToEvidence(h, p, coords, now);
    if (ev) evidence.push(ev);
  }
  counts["devpost London events (window)"] = upcoming.filter((e) => e.source === "devpost").length;
  counts["devpost evidence"] = evidence.filter((e) => e.source === "devpost").length;

  // BuilderBase.
  const bb = await safe("builderbase", fetchBuilderBase, [], errors);
  counts["builderbase worldwide"] = bb.length;
  const bbEvents = bb.map(builderBaseToSourceEvent).filter((e): e is SourceEvent => !!e && inWindow(e));
  counts["builderbase London events (window)"] = bbEvents.length;
  upcoming.push(...bbEvents);

  const events = rankEvents(dedupeEvents(upcoming), now, { pastEventsByCommunity: pastByCommunity });
  counts["events.json"] = events.length;

  const venues = aggregateVenues(evidence).sort((a, b) => b.hosts.length - a.hosts.length || a.name.localeCompare(b.name));
  await safe("postcodes.io reverse", () => fillAreas(venues), undefined, errors);
  counts["venue evidence"] = evidence.length;
  counts["venues.json"] = venues.length;

  await mkdir("data/seed", { recursive: true });
  await writeFile("data/seed/events.json", JSON.stringify(events, null, 2) + "\n");
  await writeFile("data/seed/venues.json", JSON.stringify(venues, null, 2) + "\n");
  console.table(counts);
  if (errors.length) console.warn(`${errors.length} errors:\n  ${errors.slice(0, 20).join("\n  ")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
