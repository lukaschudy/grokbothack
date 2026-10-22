import type { Tx } from "@/lib/db";
import { formatWindow } from "@/lib/time";

/** A call as the bot sees it: status, transcript lines and the recorded answer. */
export async function callJson(tx: Tx, id: string) {
  const rows = await tx<{ id: string; status: string; venue: string; starts_at: Date; ends_at: Date; headcount: number; transcript: { who: string; text: string }[]; result: Record<string, unknown> | null; created_at: Date }[]>`
    select c.id, c.status, v.name as venue, c.starts_at, c.ends_at, c.headcount, c.transcript, c.result, c.created_at
    from calls c join venues v on v.id = c.venue_id where c.id = ${id}`;
  return rows.map((c) => ({
    id: c.id, status: c.status, done: ["completed", "no_answer", "busy", "failed", "canceled"].includes(c.status),
    venue: c.venue, window: formatWindow(c.starts_at, c.ends_at), headcount: c.headcount,
    transcript: c.transcript.map((l) => ({ who: l.who === "agent" ? "assistant" : "venue", text: l.text })),
    result: c.result, called_at: c.created_at
  }));
}
