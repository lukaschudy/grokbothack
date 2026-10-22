import Link from "next/link";
import { notFound } from "next/navigation";
import { asUser, sql } from "@/lib/db";
import { currentMember } from "@/lib/session";
import { ago, formatWindow } from "@/lib/time";
import { VenueActions } from "./venue-actions";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = {
  bookable: "Bookable venue", company_office: "Company office", community_space: "Community space", university: "University",
  coworking: "Coworking space", pub_or_bar: "Pub or bar", other: "Venue"
};
const TERMS: Record<string, string> = { free: "Free", free_for_community: "Free for community events", paid: "Paid", unknown: "Not confirmed" };
const SOURCE: Record<string, string> = { organiser: "", call: "by phone", luma: "from Luma", meetup: "from Meetup", devpost: "from Devpost" };

type Status = { field: string; source: string; confirmed_at: Date; confirmed_by: string | null };

export default async function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const me = await currentMember();
  const [v] = await sql<{ id: string; name: string; address: string | null; area: string | null; kind: string; capacity: number | null; av: string[];
    evening_ok: boolean | null; weekend_ok: boolean | null; terms: string; price_note: string | null; ok_to_call: boolean; intro_via_poster: boolean;
    poster: string | null; created_at: Date }[]>`
    select v.*, p.display_name as poster from venues v left join profiles p on p.id = v.created_by where v.id = ${id} and v.junk_at is null`;
  if (!v) notFound();
  const status = await sql<Status[]>`select field, source, confirmed_at, confirmed_by from venue_field_status where venue_id = ${id}`;
  const hosts = await sql<{ community: string; event_title: string | null; event_url: string | null; event_date: string | null; attendees: number | null; source: string }[]>`
    select community, event_title, event_url, event_date::text, attendees, source from venue_hosts where venue_id = ${id} order by event_date desc nulls last limit 12`;
  const availability = await sql<{ starts_at: Date; ends_at: Date; status: string; conditions: string | null; price_note: string | null; confirmed_by_name: string | null; source: string; created_at: Date }[]>`
    select starts_at, ends_at, status, conditions, price_note, confirmed_by_name, source, created_at from availability where venue_id = ${id} order by created_at desc limit 8`;
  const contact = me?.can_post
    ? (await asUser(me.id, (tx) => tx<{ contact_name: string | null; email: string | null; phone: string | null }[]>`select contact_name, email, phone from venue_contacts where venue_id = ${id}`))[0]
    : undefined;

  const prov = (field: string) => {
    const s = status.find((x) => x.field === field);
    if (!s) return null;
    const who = s.confirmed_by ?? (s.source.includes("luma") || s.source.includes("meetup") || s.source.includes("devpost") ? "Seeded" : "Roomline");
    if (s.source === "call") return <span className="provenance">By phone{s.confirmed_by ? `, asked by ${s.confirmed_by}` : ""} · {ago(new Date(s.confirmed_at))}</span>;
    const via = SOURCE[s.source] ?? `from ${s.source.replace("+", " and ")}`;
    return <span className="provenance">{who}{via ? ` ${via}` : ""} · {ago(new Date(s.confirmed_at))}</span>;
  };
  const yesNo = (b: boolean | null) => (b == null ? "Not confirmed" : b ? "Yes" : "No");

  return (
    <main className="page">
      <div className="shell">
        <p className="eyebrow"><Link href="/venues">Venues</Link> · {KIND[v.kind]}{v.area ? ` · ${v.area}` : ""}</p>
        <header className="product-heading">
          <h1>{v.name}</h1>
          <p>{v.address}</p>
        </header>
        <div className="two-col">
          <div className="stack" style={{ gap: 40 }}>
            <section>
              <div className="section-head"><h2 className="section-title">Facts</h2><p>Each one shows who set it and when.</p></div>
              <dl className="facts">
                <div><dt>Fits</dt><dd><span>{v.capacity ? `${v.capacity} people` : "Not confirmed"}</span>{prov("capacity")}</dd></div>
                <div><dt>Type</dt><dd><span>{KIND[v.kind]}</span>{prov("kind")}</dd></div>
                <div><dt>Terms</dt><dd><span>{TERMS[v.terms]}{v.price_note && !v.price_note.toLowerCase().startsWith(TERMS[v.terms]!.toLowerCase()) ? ` · ${v.price_note}` : ""}</span>{prov("price_note") ?? prov("terms")}</dd></div>
                <div><dt>Weekday evenings</dt><dd><span>{yesNo(v.evening_ok)}</span>{prov("evening_ok")}</dd></div>
                <div><dt>Weekends</dt><dd><span>{yesNo(v.weekend_ok)}</span>{prov("weekend_ok")}</dd></div>
                <div><dt>Calls</dt><dd><span>{v.ok_to_call ? "Happy for Roomline to call" : v.intro_via_poster ? `Intro via ${v.poster ?? "the poster"}` : "No calls"}</span>{prov("ok_to_call")}</dd></div>
                <div><dt>Posted by</dt><dd><span>{v.poster ?? "Seeded from past events"}</span><span className="provenance">{ago(v.created_at)}</span></dd></div>
              </dl>
            </section>
            {availability.length > 0 && (
              <section>
                <div className="section-head"><h2 className="section-title">Availability answers</h2><p>Reused for every organiser for a week.</p></div>
                <div className="list">
                  {availability.map((a, i) => (
                    <div key={i} className="list-row">
                      <div>
                        <h3>{a.status === "available" ? "Free" : a.status === "partial" ? "Partly free" : "Not free"} · {formatWindow(a.starts_at, a.ends_at)}</h3>
                        <p>{[a.price_note, a.conditions].filter(Boolean).join(" · ") || "No conditions given"}</p>
                      </div>
                      <span className="pill soft">{a.confirmed_by_name ?? "Venue"} · {a.source === "call" ? "by phone" : a.source} · {ago(a.created_at)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <section>
              <div className="section-head"><h2 className="section-title">Who has hosted here</h2><p>Evidence from events that happened.</p></div>
              {hosts.length === 0 ? <p className="muted">No past events recorded yet.</p> : (
                <div className="list">
                  {hosts.map((h, i) => (
                    <div key={i} className="list-row">
                      <div>
                        <h3>{h.community}</h3>
                        <p>{h.event_title}{h.event_date ? ` · ${h.event_date}` : ""}{h.attendees ? ` · ${h.attendees} went` : ""}</p>
                      </div>
                      {h.event_url && <a className="link" href={h.event_url} target="_blank" rel="noreferrer">{h.source}</a>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
          <aside className="stack">
            <div className="panel soft stack" style={{ gap: 10 }}>
              <h2 className="section-title" style={{ fontSize: 22 }}>Contact</h2>
              {v.intro_via_poster ? <p>Intro via {v.poster}. Ask them on the People page.</p>
                : contact ? (
                  <>
                    <p>{contact.contact_name ?? "Bookings"}</p>
                    {contact.email && <a className="link" href={`mailto:${contact.email}`}>{contact.email}</a>}
                    {contact.phone && <p className="tnum">{contact.phone}</p>}
                  </>
                ) : me?.can_post ? <p className="muted">No contact on file yet.</p>
                : <p className="muted">Contacts are for vouched members. Free venues are a shared resource.</p>}
            </div>
            {me?.can_post && <VenueActions id={v.id} />}
          </aside>
        </div>
      </div>
    </main>
  );
}
