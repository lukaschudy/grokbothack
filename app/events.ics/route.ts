import { buildIcs } from "@/lib/ics";
import { upcomingEvents } from "@/lib/events";

export const dynamic = "force-dynamic";

export async function GET() {
  const body = buildIcs(await upcomingEvents(120), { calendarName: "Roomline · London tech events" });
  return new Response(body, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="roomline.ics"', "Cache-Control": "public, max-age=900" }
  });
}
