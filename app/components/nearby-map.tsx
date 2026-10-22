import type { VenueHit } from "@/lib/search";
import type { Place } from "@/lib/places";

const SIZE = 420;
const R = 170;

/** Distance rings around the place they asked for, with the ranked venues pinned. */
export function NearbyMap({ place, venues, activeId }: { place: Place; venues: VenueHit[]; activeId?: string }) {
  const cos = Math.cos((place.lat * Math.PI) / 180);
  const pts = venues.map((v) => ({ v, x: (v.lng - place.lng) * cos * 111_320, y: -(v.lat - place.lat) * 110_540 }));
  const far = Math.max(500, ...pts.map((p) => Math.hypot(p.x, p.y)));
  const ringKm = far <= 1000 ? 0.5 : far <= 2500 ? 1 : far <= 6000 ? 2 : 4;
  const rings = Math.ceil(far / 1000 / ringKm);
  const outer = rings * ringKm * 1000;
  // Square-root radial scale: spreads out the close venues, keeps true bearings.
  const toPx = (m: number) => R * Math.sqrt(m / outer);
  const c = SIZE / 2;
  return (
    <figure className="map-panel">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Venues around ${place.name}`}>
        {Array.from({ length: rings }, (_, i) => (i + 1) * ringKm).map((km) => (
          <g key={km}>
            <circle cx={c} cy={c} r={toPx(km * 1000)} className="ring" />
            <text x={c + toPx(km * 1000) * 0.707 + 4} y={c - toPx(km * 1000) * 0.707 - 4} className="ring-label">{km} km</text>
          </g>
        ))}
        <line x1={c - 8} y1={c} x2={c + 8} y2={c} className="cross" />
        <line x1={c} y1={c - 8} x2={c} y2={c + 8} className="cross" />
        <text x={c} y={c + 24} textAnchor="middle" className="place-label">{place.name}</text>
        {pts.map(({ v, x, y }, i) => {
          const d = Math.hypot(x, y) || 1;
          const k = toPx(d) / d;
          return (
          <g key={v.id} transform={`translate(${c + x * k} ${c + y * k})`} className={v.id === activeId ? "pin active" : "pin"}>
            <circle r="15" />
            <text y="5" textAnchor="middle">{i + 1}</text>
          </g>
          );
        })}
      </svg>
      <figcaption>
        {venues.map((v, i) => (
          <span key={v.id}><b>{i + 1}</b> {v.name}</span>
        ))}
      </figcaption>
    </figure>
  );
}
