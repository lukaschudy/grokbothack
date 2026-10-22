# Demo runbook (3 minutes, 22:20)

Five people, three laptops and one phone. Every chat message below is typed exactly as written.

| Who | Where | Does |
|---|---|---|
| **Presenter** (Lukas) | Mic, laptop C (projected) | Pitch, drives Organiser C's Grok Bot chat, narrates |
| **Lead A** | Laptop A (switch to projector for beat 1) | Pastes a Luma link of an event they really ran, answers the 3 questions |
| **Lead B** | Laptop B or phone | Vouches for C |
| **Venue** | On stage with the phone whose number is `DEMO_VENUE_PHONE` | Answers the AI call, reads the script below |
| **Operator** | Back of room, laptop with server logs | Watches `/api/health`, server logs, the tunnel; plays the backup video if needed |

## Before going on (from 21:50)

1. Server up behind the tunnel; `curl -s $PUBLIC_URL/api/health` → `{"ok":true}`.
2. Reset the demo start state **after the last rehearsal** (otherwise the stage call is "reused" from the rehearsal and no phone rings):
   ```sh
   DATABASE_URL=… DEMO_PASSWORD=… DEMO_VENUE_PHONE=+44… DEMO_VENUE_EMAIL=… \
   DEMO_C="Organiser C||<real inbox>" npx tsx --env-file-if-exists=.env.local scripts/demo-setup.ts
   ```
   Expect: `C … BLOCKED (unvouched)` and `venue Demo Hall, Old Street … callable`. If Lukas already has an account, add his email: `DEMO_ROOTS="Lukas||<his email>"`.
3. Each laptop has its own copy of the bot from the share link and is logged in as A, B or C (`--tokens` prints tokens for the `MATES_RATES_TOKEN` bot secret; same `SESSION_SECRET` as the server). Each chat is a **fresh conversation**.
4. Lead A has a Luma link to an in-person event **they ran** at a venue **not yet in the database**, and has not pasted it in rehearsal.
5. The venue phone: ringer on, loud, not on Do Not Disturb. It must be the number in `DEMO_VENUE_PHONE`.
6. A calendar app (Apple Calendar: File → New Calendar Subscription → `webcal://<host>/events.ics`) subscribed **before** the demo. Google Calendar refreshes subscriptions only every few hours, so don't subscribe live there.
7. Backup video of a full call, recorded at the 21:30 rehearsal, open in a paused tab on the operator laptop.
8. Email: Resend without a verified domain only delivers to the Resend account owner's address and rejects other recipients, including the CC. Either verify the domain, or make both `DEMO_VENUE_EMAIL` and C's email the owner's address. Check with one test request after the reset; then reset again.

## The 3 minutes

### 0:00–0:30 Pitch (Presenter, no screen needed)

> If you run a London tech community, finding a free room for 80 people takes days of DMs, cold emails and "anyone know a space?" in five WhatsApp groups.
> Mates Rates makes that one message. Ask the shared Grok Bot "free space for 80 next Thursday near Old Street?" and you get venues backed by evidence, events that really happened there, a clash check, an AI assistant that rings the venue to check the date, and a request sent with you in CC.
> It stays clean because of mates: you can only post if an organiser vouches for you, and if someone you vouched for posts junk, you lose your vouching rights.

At "one message", Lead A presses Enter on beat 1 so the bot is already working.

### 0:30–1:00 Beat 1: a lead adds a real venue (Laptop A on screen)

Lead A types:

> Add this venue: https://lu.ma/XXXXXXXX

Should appear: the venue name and address from Luma, A's event as a past host, and the 3 questions (capacity and AV, terms and evenings, contact and OK to call).

Lead A answers in one message (their real answers), for example:

> About 60, screen and two mics. Free for community groups, evenings fine, no weekends. Contact is via me, don't call them.

Should appear: "It's live", with a note that the contact stays private.

Presenter: "Thirty seconds, from a Luma link. Every field records who set it and when."

Fallback: Luma fetch fails or is slow → Lead A pastes their second, already-tested Luma link. Still failing → Presenter says "this one's in already" and moves on; beat 3 shows the venue data anyway.

### 1:00–1:20 Beat 2: trust (Laptop C on screen)

Presenter, as Organiser C (unvouched), types:

> Add this venue: https://lu.ma/XXXXXXXX

(any Luma link.) Should appear: refused: "You can't post yet: a member needs to vouch for you…".

Lead B, on their laptop, types:

> Vouch for Organiser C

Should appear on B's screen: the accountability reminder, then "Organiser C can now post".

Presenter: "B is now on the hook for what C posts."

Fallback: vouch says ambiguous → B types the exact name shown in the candidate list. Bot stalls → Presenter says what happens and moves on; C was blocked on screen, which is the point. (C must be vouched before beat 3's call: if B's vouch didn't land, Operator runs `POST /api/vouch` as B with curl.)

### 1:20–2:35 Beat 3: find, call, request (Laptop C on screen)

Presenter types:

> Free space for 80 next Thursday evening near Old Street?

Should appear: the bot says back "Thu 29 Oct, 18:30–21:30" (after the clocks go back), then 3 venues. First: **Demo Hall, Old Street**: ~150 m, fits 120 (confirmed by Lead B), free for community events, can phone to check. The others are seeded venues with past hosts (e.g. Civo Tech Junction, Encode Hub: "Hosted 6 events: …"). A clash line: "Same evening: Is AI making us less creative? (126 going) at Granola".

Presenter: "Every venue here is a place where a community actually ran an event. Note the clash warning."

Presenter types:

> Call Demo Hall to check

Bot confirms venue, date, headcount and asks "Shall I call them now?". Presenter types:

> Yes

**The phone on stage rings.** Venue answers on speaker:

| AI says (roughly) | Venue says |
|---|---|
| "Hi, I'm an assistant calling on behalf of Organiser C…" | "Hi, Demo Hall, how can I help?" |
| Asks if Thursday 29th, half six to half nine, for 80 is free | "Yes, the main room's free that evening." |
| Asks if it's free or what it costs | "It's free for community groups." |
| Asks about conditions | "You'd need to be out by ten, and someone has to sign guests in at the door." |
| Offers to email details, says goodbye | "Great, send it over. Bye." |

Optional crowd-pleaser if time allows: Venue asks "Are you a real person?" → it says it's an AI assistant.

Should appear in chat (bot polls every 10 s): result card: available, free, conditions "out by 10pm, sign guests in", confirmed on the call, dated today.

Presenter types:

> Send them the request

Bot shows a short draft. Presenter types:

> Send it

Should appear: "Sent to Demo Hall. Replies go to <C's email>, and you're CC'd." Venue holds up the phone showing the email if it arrives in time.

Presenter: "Next organiser who asks about that Thursday gets this answer without another call: max one call per venue per week."

Fallbacks:
- No answer / voicemail / busy / `failed` → bot reports it and offers the email → "Send them the request" → continue as above. Say: "No answer, so it emails instead."
- Phone doesn't ring within 15 s (Twilio, tunnel or xAI down) → Operator plays the backup video of the rehearsal call; Presenter: "here's the call we recorded an hour ago", then "Send them the request".
- Bot says the venue was "called recently" → the reset in step 2 was skipped; show the reused answer ("one call answers every organiser") and move on.
- Demo Hall not in the top 3 → "Show me Demo Hall" or skip to the request on any listed venue.
- Search errors on geocoding → "Free space for 80 next Thursday evening near EC1V 9NR?".
- Email not configured → bot says "kept as a draft"; Presenter: "in production this goes out with you in CC".

### 2:35–2:55 Beat 4: events feed (Laptop C, then the calendar)

Presenter types:

> What's on this week?

Should appear: ranked events with reasons: hackathons first ("Hackathon · Free · 72 going · Run by …"), networking drinks at the bottom, plus the `webcal://` link. Switch to the subscribed calendar.

Presenter: "Same data as a calendar feed. Hackathons above talks above networking; we hand-labelled all 60 events to check it."

Fallback: bot slow → open `<PUBLIC_URL>/api/events?limit=10` or the landing page.

### 2:55–3:00 Close

> 153 venues and 389 hosted events as evidence, plus what leads added tonight. Open source, open data except contacts. Three leads, post your venues tomorrow.

(Replace the numbers with `GET /api/stats` at 22:00, minus 1 venue for Demo Hall; see [judges.md](judges.md).)

## If everything is down

Play the full backup video (recorded at 21:30) and narrate over it. Keep the pitch and close as above.
