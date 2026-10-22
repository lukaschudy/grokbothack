import { asUser, sql } from "@/lib/db";
import { LumaVenueHiddenError, type ResolvedLumaEvent } from "@/lib/sources/luma";
import { areaFor, isInLondon, londonDate } from "@/lib/sources/types";
import { guessKind } from "@/scripts/fetch-sources";
import { deps, HttpError, json, preflight, readJson, requirePoster, requireUser, route, str, venueView } from "@/lib/api";

export const OPTIONS = preflight;

/** Paste a Luma link: find or create the venue (Google place id, else within 60 m), record the event as evidence. */
export const POST = route(async (req) => {
  const uid = await requireUser(req);
  const url = str((await readJson(req)).url, "url")!;
  await requirePoster(uid);
  let ev: ResolvedLumaEvent;
  try {
    ev = await deps.resolveLuma(url);
  } catch (e) {
    if (e instanceof LumaVenueHiddenError) throw new HttpError(422, "venue_hidden", "This event hides its venue until you register. Try a past event from the same place.");
    throw new HttpError(422, "luma_failed", (e as Error).message || "Couldn't read that Luma link.");
  }
  if (!isInLondon(ev.lat, ev.lng)) throw new HttpError(422, "not_london", `That event isn't in London (${ev.address ?? "no address"}).`);
  const name = (ev.venueName?.trim() || ev.address?.split(",")[0]?.trim() || ev.title).slice(0, 120);
  const point = sql`st_setsrid(st_makepoint(${ev.lng}, ${ev.lat}), 4326)::geography`;
  const [existing] = await sql<{ id: string }[]>`
    select id from venues
    where junk_at is null and ((${ev.googlePlaceId}::text is not null and google_place_id = ${ev.googlePlaceId}) or st_dwithin(location, ${point}, 60))
    order by (google_place_id is not distinct from ${ev.googlePlaceId}) desc, st_distance(location, ${point}) limit 1`;
  const [me] = await sql<{ community: string | null }[]>`select community from profiles where id = ${uid}`;
  const id = await asUser(uid, async (tx) => {
    let vid = existing?.id;
    if (!vid) {
      const [v] = await tx<{ id: string }[]>`
        insert into venues (name, address, area, location, kind, google_place_id, created_by)
        values (${name}, ${ev.address}, ${areaFor(ev.lat, ev.lng)}, ${point}, ${guessKind(name, ev.address)}, ${ev.googlePlaceId}, ${uid})
        returning id`;
      vid = v!.id;
    }
    await tx`
      insert into venue_hosts (venue_id, community, event_title, event_url, event_date, attendees, source)
      values (${vid}, ${ev.community ?? me?.community ?? "Community event"}, ${ev.title}, ${ev.url}, ${londonDate(ev.startsAt)}, ${ev.guestCount}, 'luma')
      on conflict (venue_id, event_url) do nothing`;
    return vid;
  });
  return json({
    created: !existing, venue: await venueView(id),
    event: { title: ev.title, url: ev.url, starts_at: ev.startsAt, community: ev.community, attendees: ev.guestCount },
    questions: [
      { fields: ["capacity", "av"], ask: "Roughly how many people does it hold, and does it have AV (screen, mics)?" },
      { fields: ["terms", "price_note", "evening_ok", "weekend_ok"], ask: "Is it free, free for communities, or paid (and roughly what)? Evenings and weekends OK?" },
      { fields: ["contact", "ok_to_call", "intro_via_poster"], ask: "Who's the contact (name, role, email, phone), and is it OK for our assistant to phone them? Or should people go through you for an intro?" }
    ],
    next: `PATCH /api/venues/${id} with the answers`
  }, existing ? 200 : 201);
});
