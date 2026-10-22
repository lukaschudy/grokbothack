import { asUser } from "@/lib/db";
import {
  bool, email, HttpError, int, json, oneOf, preflight, readJson, requirePoster, requireUser, route, str, toE164, uuid, venueView
} from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

type Ctx = { params: Promise<{ id: string }> };
const KINDS = ["bookable", "company_office", "community_space", "university", "coworking", "pub_or_bar", "other"] as const;
const TERMS = ["free", "free_for_community", "paid", "unknown"] as const;
const FIELDS = ["capacity", "av", "evening_ok", "weekend_ok", "terms", "price_note", "kind", "ok_to_call", "intro_via_poster"] as const;

export const GET = route(async (req, ctx: Ctx) => {
  await requireUser(req);
  return json({ venue: await venueView(uuid((await ctx.params).id, "venue id")) });
});

/** Fill in what only organisers know. Changed fields are logged by trigger; unchanged ones are re-confirmed. */
export const PATCH = route(async (req, ctx: Ctx) => {
  const uid = await requireUser(req);
  const id = uuid((await ctx.params).id, "venue id");
  const b = await readJson(req);
  await requirePoster(uid);

  const given: Record<string, unknown> = {};
  if (b.capacity !== undefined) given.capacity = int(b.capacity, "capacity", { optional: true });
  if (b.av !== undefined) {
    const av = typeof b.av === "string" ? b.av.split(/[,;]/) : Array.isArray(b.av) ? b.av : null;
    if (!av || av.some((x) => typeof x !== "string")) throw new HttpError(400, "invalid_input", "av must be a list like [\"screen\", \"mics\"]");
    given.av = (av as string[]).map((s) => s.trim()).filter(Boolean).slice(0, 20);
  }
  for (const k of ["evening_ok", "weekend_ok", "ok_to_call", "intro_via_poster"] as const) {
    const v = bool(b[k], k);
    if (v !== undefined) given[k] = k === "ok_to_call" || k === "intro_via_poster" ? Boolean(v) : v;
  }
  if (b.terms !== undefined) given.terms = oneOf(b.terms, "terms", TERMS);
  if (b.kind !== undefined) given.kind = oneOf(b.kind, "kind", KINDS);
  if (b.price_note !== undefined) given.price_note = str(b.price_note, "price_note", { max: 300, optional: true });

  let contact: { contact_name: string | null; contact_role: string | null; email: string | null; phone: string | null } | null = null;
  if (b.contact != null) {
    if (typeof b.contact !== "object") throw new HttpError(400, "invalid_input", "contact must be an object");
    const c = b.contact as Record<string, unknown>;
    const rawPhone = str(c.phone, "contact.phone", { max: 40, optional: true });
    const phone = rawPhone ? toE164(rawPhone) : null;
    if (rawPhone && !phone) throw new HttpError(400, "invalid_input", `contact.phone must be E.164, e.g. +442079460000 (got ${rawPhone})`);
    contact = {
      contact_name: str(c.contact_name, "contact.contact_name", { max: 120, optional: true }),
      contact_role: str(c.contact_role, "contact.contact_role", { max: 120, optional: true }),
      email: email(c.email, "contact.email", true), phone
    };
  }
  const known = new Set<string>([...FIELDS, "contact"]);
  const ignored = Object.keys(b).filter((k) => !known.has(k));

  const result = await asUser(uid, async (tx) => {
    const [before] = await tx<{ j: Record<string, unknown> }[]>`select to_jsonb(v) as j from venues v where id = ${id}`;
    if (!before) throw new HttpError(404, "venue_not_found", "No such venue (or it was removed as junk).");
    const changed = Object.keys(given).filter((k) => JSON.stringify(before.j[k] ?? null) !== JSON.stringify(given[k] ?? null));
    const same = Object.keys(given).filter((k) => !changed.includes(k));
    if (changed.length) {
      const rows = await tx`update venues set ${tx(Object.fromEntries(changed.map((k) => [k, given[k]])) as Record<string, string>, ...changed)} where id = ${id} returning id`;
      if (!rows.length) throw new HttpError(403, "not_trusted", "You can't edit this venue.");
    }
    if (same.length) await tx`select confirm_venue_fields(${id}, ${same}::text[])`;
    const saveContact = contact && Object.values(contact).some((x) => x != null);
    if (saveContact) {
      await tx`
        insert into venue_contacts (venue_id, contact_name, contact_role, email, phone)
        values (${id}, ${contact!.contact_name}, ${contact!.contact_role}, ${contact!.email}, ${contact!.phone})
        on conflict (venue_id) do update set
          contact_name = coalesce(excluded.contact_name, venue_contacts.contact_name),
          contact_role = coalesce(excluded.contact_role, venue_contacts.contact_role),
          email = coalesce(excluded.email, venue_contacts.email),
          phone = coalesce(excluded.phone, venue_contacts.phone),
          updated_at = now()`;
    }
    return { changed, same, contactSaved: Boolean(saveContact) };
  });
  const venue = await venueView(id);
  return json({
    venue, updated: result.changed, confirmed: result.same, contact_saved: result.contactSaved, ignored,
    message: `${venue.name} is live.${result.contactSaved ? " The contact stays private: only the assistant uses it." : ""}`
  });
});
