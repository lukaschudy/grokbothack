import { findVenues, parseAsk } from "@/lib/find-venues";
import { deps, HttpError, int, json, preflight, requireUser, route, str, timeWindow } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

const OLD_STREET = { name: "Old Street", lat: 51.5257, lng: -0.0875 };

/**
 * GET /api/venues/search?near=Old Street&headcount=80&start=2026-10-29T18:30&end=...&free_only=true[&radius_m=]
 * or ?q=free space for 80 next Thursday near Old Street. Top 3 with reasons; never contacts.
 */
export const GET = route(async (req) => {
  const uid = await requireUser(req);
  const p = new URL(req.url).searchParams;
  const near = str(p.get("near"), "near", { max: 200, optional: true });
  const q = str(p.get("q"), "q", { max: 300, optional: true });
  const radiusM = int(p.get("radius_m"), "radius_m", { min: 200, max: 20_000, optional: true });

  if (q && !near && !p.get("lat")) {
    const ask = await parseAsk(q, new Date(), deps.geocode);
    if (ask.near && !ask.place) throw new HttpError(422, "place_not_found", `Couldn't find "${ask.near}" in London. Try a station, area or postcode.`);
    const r = await findVenues(uid, { ...ask, place: ask.place ?? OLD_STREET, radiusM });
    return json({ ...r, query: { ...r.query, q, near: ask.near } });
  }

  const headcount = int(p.get("headcount") ?? p.get("capacity"), "headcount")!;
  const { start, end } = timeWindow(p.get("start"), p.get("end"));
  const freeOnly = ["true", "1", "yes"].includes(p.get("free_only") ?? "");
  const lat = p.get("lat") ? Number(p.get("lat")) : null;
  const lng = p.get("lng") ? Number(p.get("lng")) : null;
  let place: { name: string; lat: number; lng: number } | null;
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) place = { name: near ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng };
  else if (near) place = await deps.geocode(near);
  else throw new HttpError(400, "invalid_input", "Give near (e.g. Old Street) or lat and lng.");
  if (!place) throw new HttpError(422, "place_not_found", `Couldn't find "${near}" in London. Try a station, area or postcode.`);
  const r = await findVenues(uid, { place, headcount, start, end, freeOnly, radiusM });
  return json({ ...r, query: { ...r.query, near } });
});
