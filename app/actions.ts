"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAccount, signIn, signSession } from "@/lib/auth";
import { asUser, sql } from "@/lib/db";
import { currentMember, currentUid, SESSION_COOKIE } from "@/lib/session";
import { searchVenues, type SearchResult } from "@/lib/search";
import { startCall } from "@/lib/dialer";
import { draftRequestWithGrok } from "@/lib/grok";
import { formatWindow } from "@/lib/time";
import { normalisePhone, resolveVenueDraft, saveVenue, type VenueDraft, type VenueFacts } from "@/lib/venues";

export type { VenueDraft };

const pgMessage = (e: unknown) => (e as { message?: string })?.message ?? String(e);

async function setSession(uid: string) {
  (await cookies()).set(SESSION_COOKIE, signSession(uid), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30
  });
}

export type FormState = { error?: string; ok?: string } | null;

export async function signInAction(_: FormState, form: FormData): Promise<FormState> {
  const uid = await signIn(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  if (!uid) return { error: "That email and password don't match." };
  await setSession(uid);
  redirect(String(form.get("next") || "/"));
}

export async function signUpAction(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const displayName = String(form.get("name") ?? "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter a valid email." };
  if (password.length < 8) return { error: "Use at least 8 characters for your password." };
  if (!displayName) return { error: "Tell people your name." };
  try {
    const uid = await createAccount({ email, password, displayName, community: String(form.get("community") ?? "") });
    await setSession(uid);
  } catch (e) {
    return { error: /unique|duplicate/.test(pgMessage(e)) ? "There's already an account with that email. Sign in instead." : "Couldn't create your account." };
  }
  redirect("/people?welcome=1");
}

export async function signOutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/");
}

export async function searchAction(text: string): Promise<SearchResult | { error: string }> {
  const q = text.trim().slice(0, 300);
  if (!q) return { error: "Ask for a room, e.g. “free space for 80 next Thursday near Old Street”." };
  try {
    return await searchVenues(q, await currentUid());
  } catch (e) {
    console.error("[search]", e);
    return { error: "Search failed. Try again in a moment." };
  }
}

export type CallStart =
  | { outcome: "new" | "in_progress" | "reused" | "called_recently"; callId: string }
  | { error: string };

export async function startCallAction(input: { venueId: string; startsAt: string; endsAt: string; headcount: number; title: string | null }): Promise<CallStart> {
  const me = await currentMember();
  if (!me) return { error: "Sign in to have Roomline call a venue." };
  if (!me.can_post) return { error: "Only vouched members can trigger calls. Ask a member to vouch for you." };
  try {
    return await startCall(me.id, input);
  } catch (e) {
    const msg = pgMessage(e);
    if (msg.includes("not_ok_to_call")) return { error: "This venue hasn't agreed to calls. Send a request instead." };
    if (msg.includes("no_phone")) return { error: "No phone number on file for this venue." };
    console.error("[call]", e);
    return { error: "Couldn't start the call." };
  }
}

export async function draftRequestAction(input: { venueId: string; startsAt: string; endsAt: string; headcount: number; title: string | null }): Promise<{ subject: string; body: string; to: string | null; requestId: string } | { error: string }> {
  const me = await currentMember();
  if (!me) return { error: "Sign in to draft a request." };
  if (!me.can_post) return { error: "Only vouched members can send requests." };
  const [v] = await asUser(me.id, (tx) => tx<{ name: string; email: string | null; contact_name: string | null; hosts: string[] }[]>`
    select v.name, c.email, c.contact_name,
           coalesce((select array_agg(distinct h.community) from venue_hosts h where h.venue_id = v.id), '{}') as hosts
    from venues v left join venue_contacts c on c.venue_id = v.id where v.id = ${input.venueId}`);
  if (!v) return { error: "Venue not found." };
  const [call] = await sql<{ result: { status: string; conditions: string | null; contact_name: string | null } | null }[]>`
    select result from calls where venue_id = ${input.venueId} and result is not null order by created_at desc limit 1`;
  const when = formatWindow(new Date(input.startsAt), new Date(input.endsAt));
  const callNote = call?.result ? `Spoke to ${call.result.contact_name ?? "the venue"} by phone: ${call.result.status}${call.result.conditions ? `; ${call.result.conditions}` : ""}` : null;
  let body: string | null = null;
  try {
    body = await draftRequestWithGrok({
      organiser: me.display_name, community: me.community, venue: v.name, contact: v.contact_name,
      when, headcount: input.headcount, eventTitle: input.title, hosts: v.hosts.slice(0, 3), callNote
    });
  } catch (e) {
    console.warn("[draft] grok failed:", pgMessage(e));
  }
  body ??= [
    `Hi ${v.contact_name ?? "there"},`,
    "",
    `I run ${me.community ?? "a London tech community"} and we'd love to host ${input.title ? `"${input.title}"` : "our next meetup"} at ${v.name} on ${when}, for about ${input.headcount} people.`,
    callNote ? `Thanks for confirming on the phone that the evening could work.` : v.hosts.length ? `${v.hosts.slice(0, 2).join(" and ")} have hosted with you before, which is how we found you.` : "",
    "",
    "We'd bring the speakers and the guest list, and leave the room as we found it. What would you need from us to confirm?",
    "",
    `Thanks,\n${me.display_name}`
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
  const subject = `Venue request: ${input.headcount} people, ${when}`;
  const [req] = await asUser(me.id, (tx) => tx<{ id: string }[]>`
    insert into requests (venue_id, subject, body) values (${input.venueId}, ${subject}, ${body}) returning id`);
  return { subject, body, to: v.email, requestId: req!.id };
}

export async function markRequestSentAction(requestId: string) {
  const uid = await currentUid();
  if (!uid) return;
  await asUser(uid, (tx) => tx`update requests set status = 'sent', sent_at = now() where id = ${requestId}`);
}

export async function vouchAction(voucheeId: string): Promise<FormState> {
  const me = await currentMember();
  if (!me) return { error: "Sign in first." };
  try {
    await asUser(me.id, (tx) => tx`insert into vouches (voucher_id, vouchee_id) values (${me.id}, ${voucheeId}) on conflict do nothing`);
  } catch (e) {
    return { error: /row-level security/.test(pgMessage(e)) ? "You can't vouch right now: you need to be a member in good standing with vouching rights." : "Couldn't save the vouch." };
  }
  revalidatePath("/people");
  return { ok: "Vouched." };
}

export async function reportJunkAction(venueId: string): Promise<FormState> {
  const me = await currentMember();
  if (!me?.can_post) return { error: "Only vouched members can report junk." };
  const [row] = await asUser(me.id, (tx) => tx<{ r: { junk: boolean; reports: number } }[]>`select report_junk(${venueId}, 'reported from venue page') as r`);
  revalidatePath("/venues");
  return row!.r.junk ? { ok: "Removed as junk. The poster is banned and their vouchers lost vouching rights." } : { ok: `Reported. ${row!.r.reports} of 2 reports needed.` };
}

export async function confirmVenueAction(venueId: string): Promise<FormState> {
  const me = await currentMember();
  if (!me?.can_post) return { error: "Only vouched members can confirm details." };
  await asUser(me.id, (tx) => tx`select confirm_venue_fields(${venueId}, array['name','address','capacity','av','evening_ok','weekend_ok','terms','price_note','kind'])`);
  revalidatePath(`/venues/${venueId}`);
  return { ok: "Thanks — marked as still correct." };
}

// Add a venue -------------------------------------------------------------------

export async function resolveLumaAction(url: string): Promise<VenueDraft | { error: string }> {
  try {
    return await resolveVenueDraft(url);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function publishVenueAction(input: {
  draft: VenueDraft;
  capacity: number | null;
  eveningOk: boolean;
  weekendOk: boolean;
  terms: string;
  priceNote: string;
  kind: string;
  okToCall: boolean;
  phone: string;
  contactName: string;
  contactEmail: string;
  introViaMe: boolean;
}): Promise<{ id: string; updated: boolean } | { error: string; blocked?: boolean }> {
  const me = await currentMember();
  if (!me) return { error: "Sign in to post a venue.", blocked: true };
  if (input.okToCall && !normalisePhone(input.phone)) return { error: "Add a phone number so Roomline can call." };
  try {
    const saved = await saveVenue(me.id, input.draft, {
      capacity: input.capacity, evening_ok: input.eveningOk, weekend_ok: input.weekendOk, terms: input.terms as VenueFacts["terms"],
      price_note: input.priceNote.trim() || null, kind: input.kind, ok_to_call: input.okToCall, intro_via_poster: input.introViaMe
    }, { contact_name: input.contactName.trim() || null, email: input.contactEmail.trim() || null, phone: input.phone });
    revalidatePath("/venues");
    return saved;
  } catch (e) {
    if (/row-level security/.test(pgMessage(e))) {
      return { error: me.banned ? "Your account can't post: a venue you posted was marked as junk." : "Posting needs a vouch from a member. Ask an organiser who knows you to vouch for you.", blocked: true };
    }
    console.error("[publish]", e);
    return { error: "Couldn't save the venue." };
  }
}
