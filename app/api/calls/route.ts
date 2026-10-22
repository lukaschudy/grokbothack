import { asUser } from "@/lib/db";
import { startCall } from "@/lib/dialer";
import { body, CANT_POST, fail, ok, requireMember } from "@/lib/api";
import { callJson } from "./shape";

/** POST /api/calls {venue_id, start, end, headcount, event_title} */
export async function POST(req: Request) {
  const me = await requireMember(req);
  if (me instanceof Response) return me;
  if (!me.can_post) return fail(403, CANT_POST);
  const b = await body<{ venue_id: string; start: string; end: string; headcount: number; event_title: string }>(req);
  const start = new Date(String(b.start ?? ""));
  const end = new Date(String(b.end ?? ""));
  if (!b.venue_id || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return fail(400, "Send venue_id, start and end (ISO), headcount.");
  try {
    const r = await startCall(me.id, {
      venueId: String(b.venue_id), startsAt: start.toISOString(), endsAt: end.toISOString(),
      headcount: Math.max(1, Math.round(Number(b.headcount) || 1)), title: b.event_title ? String(b.event_title) : null
    });
    const [call] = await asUser(me.id, (tx) => callJson(tx, r.callId));
    const message = {
      new: "Calling now, usually under a minute. Poll GET /api/calls/<id>.",
      in_progress: "Someone already asked; that call is in progress. Poll GET /api/calls/<id>.",
      reused: "This evening was checked by phone recently, so here's that answer. No new call.",
      called_recently: "This venue was called in the last week. We call a venue at most once a week; send a request instead."
    }[r.outcome];
    return ok({ outcome: r.outcome, message, call: call ?? null }, r.outcome === "new" ? 201 : 200);
  } catch (e) {
    const m = (e as Error).message;
    if (m.includes("not_ok_to_call")) return fail(409, "not_ok_to_call: this venue hasn't agreed to calls. Offer send-request, or an intro via a past host.");
    if (m.includes("no_phone")) return fail(409, "no_phone: no bookings number on file. Offer send-request.");
    if (m.includes("venue_not_found")) return fail(404, "No such venue.");
    throw e;
  }
}
