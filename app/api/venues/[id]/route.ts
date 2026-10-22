import { body, CANT_POST, fail, isRls, ok, requireMember } from "@/lib/api";
import { updateVenue, type VenueContact, type VenueFacts } from "@/lib/venues";

const TERMS = ["free", "free_for_community", "paid", "unknown"];
const KINDS = ["bookable", "company_office", "community_space", "university", "coworking", "pub_or_bar", "other"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember(req);
  if (me instanceof Response) return me;
  if (!me.can_post) return fail(403, CANT_POST);
  const { id } = await params;
  const b = await body<VenueFacts & { contact: VenueContact; av: string[] | string }>(req);
  const facts: VenueFacts = {};
  if (b.capacity !== undefined) facts.capacity = b.capacity === null ? null : Math.round(Number(b.capacity)) || null;
  if (b.av !== undefined) facts.av = Array.isArray(b.av) ? b.av.map(String) : String(b.av).split(",").map((s) => s.trim()).filter(Boolean);
  if (typeof b.evening_ok === "boolean") facts.evening_ok = b.evening_ok;
  if (typeof b.weekend_ok === "boolean") facts.weekend_ok = b.weekend_ok;
  if (b.terms !== undefined) {
    if (!TERMS.includes(String(b.terms))) return fail(400, `terms must be one of ${TERMS.join(", ")}.`);
    facts.terms = b.terms;
  }
  if (b.price_note !== undefined) facts.price_note = b.price_note ? String(b.price_note) : null;
  if (b.kind !== undefined) {
    if (!KINDS.includes(String(b.kind))) return fail(400, `kind must be one of ${KINDS.join(", ")}.`);
    facts.kind = String(b.kind);
  }
  if (typeof b.ok_to_call === "boolean") facts.ok_to_call = b.ok_to_call;
  if (typeof b.intro_via_poster === "boolean") facts.intro_via_poster = b.intro_via_poster;
  try {
    const found = await updateVenue(me.id, id, facts, b.contact);
    return found ? ok({ id, updated: Object.keys(facts), contact_saved: Boolean(b.contact) }) : fail(404, "No such venue.");
  } catch (e) {
    if (isRls(e)) return fail(403, CANT_POST);
    if (/phone_check|violates check/.test((e as Error).message)) return fail(400, "Phone must be in E.164 format, e.g. +442079460000.");
    throw e;
  }
}
