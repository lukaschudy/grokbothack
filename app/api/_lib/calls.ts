import { asUser } from "@/lib/db";
import { formatWindow } from "@/lib/time";
import { HttpError } from "./http";

const DONE = new Set(["completed", "failed", "no_answer", "busy", "canceled"]);

/** A call as the bot sees it: status, the venue's answer, and the dated availability record. Members only (RLS). */
export async function callView(uid: string, id: string) {
  const [c] = await asUser(uid, (tx) => tx`
    select c.id, c.venue_id, v.name as venue_name, c.status, c.starts_at, c.ends_at, c.headcount, c.event_title,
      c.answered_at, c.ended_at, c.result, c.error, c.created_at,
      (select json_build_object('status', a.status, 'conditions', a.conditions, 'price_note', a.price_note,
              'confirmed_by_name', a.confirmed_by_name, 'created_at', a.created_at)
       from availability a where a.call_id = c.id order by a.created_at desc limit 1) as availability
    from calls c join venues v on v.id = c.venue_id where c.id = ${id}`);
  if (!c) throw new HttpError(404, "call_not_found", "No such call (only vouched members can see calls).");
  return { ...c, when: formatWindow(c.starts_at, c.ends_at), done: DONE.has(c.status) };
}
