import { asUser, sql } from "@/lib/db";
import { formatWindow } from "@/lib/time";
import { deps, int, json, preflight, readJson, requireUser, route, str, timeWindow, uuid } from "../_lib/http";
import { callView } from "../_lib/calls";

export const OPTIONS = preflight;

/** Ask the assistant to phone a venue. One call answers every organiser: request_call reuses recent answers. */
export const POST = route(async (req) => {
  const uid = await requireUser(req);
  const b = await readJson(req);
  const venueId = uuid(b.venue_id, "venue_id");
  const { start, end } = timeWindow(b.start, b.end);
  const headcount = int(b.headcount, "headcount")!;
  const title = str(b.event_title, "event_title", { max: 200, optional: true });
  const [row] = await asUser(uid, (tx) => tx<{ r: { outcome: "new" | "reused" | "in_progress" | "called_recently"; call_id: string | null; availability_id?: string } }[]>`
    select request_call(${venueId}, ${start}, ${end}, ${headcount}, ${title}) as r`);
  const r = row!.r;
  if (r.outcome === "new") {
    try {
      await deps.placeCall(r.call_id!);
    } catch (e) {
      await sql`update calls set status = 'failed', error = coalesce(error, ${(e as Error).message}), ended_at = coalesce(ended_at, now())
                where id = ${r.call_id} and status in ('queued', 'dialing')`;
    }
    const call = await callView(uid, r.call_id!);
    return json({ ...call, call_id: r.call_id, outcome: "new", poll: `/api/calls/${r.call_id}`, message: "Calling now, usually under 2 minutes." }, 202);
  }
  if (r.outcome === "reused") {
    const [a] = await sql<{ status: string; conditions: string | null; price_note: string | null; confirmed_by_name: string | null; created_at: Date }[]>`
      select status, conditions, price_note, confirmed_by_name, created_at from availability where id = ${r.availability_id!}`;
    return json({
      call_id: r.call_id, outcome: "reused", availability: a ?? null, when: formatWindow(start, end),
      message: a ? `Already checked by phone ${a.created_at.toISOString().slice(0, 10)}: ${a.status}${a.conditions ? ` (${a.conditions})` : ""}. No new call needed.` : "Recently checked."
    });
  }
  const call = await callView(uid, r.call_id!);
  return json({
    ...call, call_id: r.call_id, outcome: r.outcome, poll: `/api/calls/${r.call_id}`,
    message: r.outcome === "in_progress"
      ? "Someone is already calling this venue; poll that call for the answer."
      : "This venue was called recently (max one call a week); here's that answer."
  });
});
