import { geocode } from "@/lib/places";
import { OLD_STREET, searchStructured, searchVenues } from "@/lib/search";
import { bearerUid, fail, ok } from "@/lib/api";

/** GET /api/venues/search?near=Old Street&headcount=80&start=ISO&end=ISO[&free=1] or ?q=free text */
export async function GET(req: Request) {
  const t0 = performance.now();
  const p = new URL(req.url).searchParams;
  const uid = bearerUid(req);
  let found;
  if (p.get("q") && !p.get("start")) {
    found = await searchVenues(p.get("q")!, uid);
  } else {
    const start = new Date(p.get("start") ?? "");
    const end = p.get("end") ? new Date(p.get("end")!) : new Date(start.getTime() + 3 * 3600_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return fail(400, "Send start and end as ISO times, e.g. 2026-10-29T18:30:00+00:00.");
    const headcount = Number(p.get("headcount") ?? 0);
    if (!(headcount > 0)) return fail(400, "Send headcount.");
    const place = (p.get("near") && (await geocode(p.get("near")!))) || OLD_STREET;
    found = await searchStructured({ place, headcount, startsAt: start, endsAt: end, freeOnly: /^(1|true|yes)$/i.test(p.get("free") ?? ""), eventTitle: null }, uid);
  }
  return ok({
    window: found.parsed.window,
    near: found.parsed.place.name,
    headcount: found.parsed.headcount,
    radius_m: found.parsed.radius_m,
    venues: found.venues.map((v) => ({
      id: v.id, name: v.name, kind: v.kind, area: v.area, address: v.address, distance_m: Math.round(v.distance_m),
      capacity: v.capacity, terms: v.terms, ok_to_call: v.callable, intro_via_poster: v.intro_via_poster,
      past_hosts: v.hosts, last_hosted: v.last_hosted, availability: v.availability_status
        ? { status: v.availability_status, conditions: v.availability_conditions, recorded_at: v.availability_at } : null,
      reasons: v.reasons, url: `/venues/${v.id}`
    })),
    clashes: found.clashes,
    ms: Math.round(performance.now() - t0)
  });
}
