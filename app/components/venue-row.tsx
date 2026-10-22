import Link from "next/link";
import type { VenueHit } from "@/lib/search";
import type { CallResult } from "@/lib/bus";

const KIND: Record<string, string> = {
  bookable: "Bookable", company_office: "Company office", community_space: "Community space", university: "University",
  coworking: "Coworking", pub_or_bar: "Pub or bar", other: "Venue"
};

export const answerLine = (r: CallResult) =>
  r.status === "available" ? "Confirmed free by phone, just now" : r.status === "partial" ? "Partly free, confirmed by phone just now" : "Not free that evening, called just now";

/** One search result. Pure, so the preview page and the video can render it too. */
export function VenueRow({ v, n, answer, active, children }: {
  v: Pick<VenueHit, "id" | "name" | "kind" | "area" | "address" | "reasons">;
  n: number;
  answer?: string | null;
  active?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <article className={`venue-row${active ? " active" : ""}`}>
      <span className="n tnum">{String(n).padStart(2, "0")}</span>
      <div>
        <h3><Link href={`/venues/${v.id}`}>{v.name}</Link></h3>
        <p className="meta">{[KIND[v.kind] ?? "Venue", v.area, v.address].filter(Boolean).join(" · ")}</p>
        <ul className="reasons">
          {answer && <li className="answer">{answer}</li>}
          {v.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
        {children && <div className="venue-actions">{children}</div>}
      </div>
    </article>
  );
}
