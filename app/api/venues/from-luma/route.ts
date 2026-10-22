import { body, CANT_POST, fail, isRls, ok, requireMember } from "@/lib/api";
import { resolveVenueDraft, saveVenue } from "@/lib/venues";

export async function POST(req: Request) {
  const me = await requireMember(req);
  if (me instanceof Response) return me;
  if (!me.can_post) return fail(403, CANT_POST);
  const url = String((await body<{ url: string }>(req)).url ?? "");
  let draft;
  try {
    draft = await resolveVenueDraft(url);
  } catch (e) {
    return fail(422, (e as Error).message);
  }
  try {
    const saved = await saveVenue(me.id, draft);
    return ok({
      venue: { id: saved.id, name: draft.name, address: draft.address, area: draft.area, kind_guess: draft.kindGuess, already_listed: saved.updated },
      evidence: { event: draft.eventTitle, community: draft.community, date: draft.eventDate, went: draft.guestCount },
      questions: [
        "Roughly how many people does it hold, and does it have AV (screen, mics)?",
        "Terms: free, free for communities, or paid (and roughly what)? Are evenings and weekends OK?",
        "Who's the contact (name, role, email, phone), and is it OK for our assistant to phone the bookings line?"
      ],
      next: `PATCH /api/venues/${saved.id} with capacity, av, terms, price_note, evening_ok, weekend_ok, kind, ok_to_call, contact{contact_name, contact_role, email, phone}`
    }, saved.updated ? 200 : 201);
  } catch (e) {
    if (isRls(e)) return fail(403, CANT_POST);
    throw e;
  }
}
