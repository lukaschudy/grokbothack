import { asUser, sql, type Tx } from "./db";

export type VenueDraft = {
  url: string;
  name: string;
  address: string | null;
  area: string | null;
  lat: number;
  lng: number;
  googlePlaceId: string | null;
  community: string | null;
  eventTitle: string;
  eventDate: string;
  guestCount: number | null;
  existingId: string | null;
  kindGuess: string;
};

export type VenueFacts = Partial<{
  capacity: number | null;
  av: string[];
  evening_ok: boolean | null;
  weekend_ok: boolean | null;
  terms: "free" | "free_for_community" | "paid" | "unknown";
  price_note: string | null;
  kind: string;
  ok_to_call: boolean;
  intro_via_poster: boolean;
}>;

export type VenueContact = Partial<{ contact_name: string | null; contact_role: string | null; email: string | null; phone: string | null }>;

/** Read a Luma event and turn its venue into a draft. Throws with a message an organiser can act on. */
export async function resolveVenueDraft(url: string): Promise<VenueDraft> {
  const { resolveLumaEvent, LumaVenueHiddenError } = await import("./sources/luma");
  const { areaFor, londonDate } = await import("./sources/types");
  const { guessKind } = await import("../scripts/fetch-sources");
  let e;
  try {
    e = await resolveLumaEvent(url.trim());
  } catch (err) {
    if (err instanceof LumaVenueHiddenError) throw new Error("This event hides its venue until you register. Try a past event from the same place.");
    throw new Error((err as Error).message.startsWith("Not a Luma link") ? "Paste a Luma event link, like lu.ma/abc123." : "Couldn't read that Luma event.");
  }
  if (!e.venueName && !e.address) throw new Error("That Luma event doesn't show a venue.");
  const name = e.venueName ?? e.address!.split(",")[0]!;
  const [existing] = await sql<{ id: string }[]>`
    select id from venues where junk_at is null and (
      (${e.googlePlaceId}::text is not null and google_place_id = ${e.googlePlaceId})
      or (lower(name) = lower(${name}) and st_dwithin(location, st_setsrid(st_makepoint(${e.lng}, ${e.lat}), 4326)::geography, 100)))
    limit 1`;
  return {
    url: e.url, name, address: e.address, area: areaFor(e.lat, e.lng), lat: e.lat, lng: e.lng,
    googlePlaceId: e.googlePlaceId, community: e.community, eventTitle: e.title, eventDate: londonDate(e.startsAt),
    guestCount: e.guestCount, existingId: existing?.id ?? null, kindGuess: guessKind(name, e.address)
  };
}

export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const p = raw.replace(/[\s()-]/g, "").replace(/^0/, "+44");
  return /^\+[1-9]\d{6,14}$/.test(p) ? p : null;
}

async function writeContact(tx: Tx, venueId: string, c: VenueContact | undefined) {
  if (!c || !(c.contact_name || c.contact_role || c.email || c.phone)) return;
  await tx`
    insert into venue_contacts (venue_id, contact_name, contact_role, email, phone)
    values (${venueId}, ${c.contact_name ?? null}, ${c.contact_role ?? null}, ${c.email ?? null}, ${normalisePhone(c.phone)})
    on conflict (venue_id) do update set
      contact_name = coalesce(excluded.contact_name, venue_contacts.contact_name),
      contact_role = coalesce(excluded.contact_role, venue_contacts.contact_role),
      email = coalesce(excluded.email, venue_contacts.email),
      phone = coalesce(excluded.phone, venue_contacts.phone), updated_at = now()`;
}

const callable = (f: VenueFacts) => (f.ok_to_call === undefined ? {} : { ok_to_call: f.ok_to_call && (f.kind ?? "bookable") === "bookable" });

/**
 * Create the venue from a draft (or add evidence to the existing one), as `uid`.
 * RLS rejects members nobody has vouched for.
 */
export async function saveVenue(uid: string, d: VenueDraft, facts: VenueFacts = {}, contact?: VenueContact): Promise<{ id: string; updated: boolean }> {
  return asUser(uid, async (tx) => {
    const f = { ...facts, ...callable(facts) };
    let id = d.existingId;
    if (id) {
      if (Object.keys(f).length) await tx`update venues set ${tx(f)} where id = ${id}`;
    } else {
      const [row] = await tx<{ id: string }[]>`
        insert into venues (name, address, area, location, google_place_id, kind, created_by)
        values (${d.name}, ${d.address}, ${d.area}, st_setsrid(st_makepoint(${d.lng}, ${d.lat}), 4326)::geography,
                ${d.googlePlaceId}, ${f.kind ?? (d.kindGuess === "other" ? "bookable" : d.kindGuess)}, ${uid})
        returning id`;
      id = row!.id;
      if (Object.keys(f).length) await tx`update venues set ${tx(f)} where id = ${id}`;
    }
    await writeContact(tx, id, contact);
    await tx`
      insert into venue_hosts (venue_id, community, event_title, event_url, event_date, attendees, source)
      values (${id}, ${d.community ?? "Community event"}, ${d.eventTitle}, ${d.url}, ${d.eventDate}, ${d.guestCount}, 'luma')
      on conflict (venue_id, event_url) do nothing`;
    return { id, updated: Boolean(d.existingId) };
  });
}

/** Update facts and contact on an existing venue, as `uid`. */
export async function updateVenue(uid: string, id: string, facts: VenueFacts, contact?: VenueContact): Promise<boolean> {
  return asUser(uid, async (tx) => {
    const f = { ...facts, ...callable(facts) };
    if (Object.keys(f).length) {
      const r = await tx`update venues set ${tx(f)} where id = ${id}`;
      if (r.count === 0) return false;
    }
    await writeContact(tx, id, contact);
    return true;
  });
}
