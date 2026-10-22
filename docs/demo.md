# Demo runbook (3 minutes, 22:20)

Roomline web app, run with `CALL_MODE=scripted` unless an xAI key turns up (then `virtual`, see the end). Everything below was clicked through on local Postgres with the seed data and `CALL_MODE=scripted` on 22 Oct; timings are from that run.

| Who | Does |
|---|---|
| **Presenter** (Lukas) | Mic, pitch, drives the presenter laptop (projected) |
| **Lead A** | Stands at the laptop for beat 1 and types their own venue |
| **Lead B** | Clicks "Vouch" in beat 2 (same laptop, B's window) |
| **Venue** | Only in `virtual` mode: holds the phone with `/phone` open |
| **Operator** | Back of room: server logs, tunnel, backup video |

## Before going on (from 21:50)

1. Server up: `CALL_MODE=scripted npm run dev` (or the Deploy agent's production server), public URL loads.
2. Reset the start state **after the last rehearsal**. Otherwise the stage call is "reused" from the rehearsal and the call card shows the old answer instead of a new call:
   ```sh
   DATABASE_URL=… DEMO_PASSWORD=… DEMO_VENUE_PHONE=+44… DEMO_VENUE_EMAIL=<inbox you can show> \
   DEMO_A="<Lead A's name>|<community>" DEMO_B="<Lead B's name>|<community>" DEMO_C="<C's name>|<community>" \
   npx tsx --env-file-if-exists=.env.local scripts/demo-setup.ts
   ```
   Expect `C … BLOCKED (unvouched)` and `venue Demo Hall, Old Street … callable`. If Lukas already has an account: `DEMO_ROOTS="Lukas||<his email>"`. Default names are Lead A, Lead B, Organiser C; all accounts use `DEMO_PASSWORD`.
3. Presenter laptop: three Chrome profiles (not incognito windows, which share cookies), each signed in at `/signin`:
   - **A**: on `/add`.
   - **B**: on `/people`.
   - **C**: on `/` (Find a room). Also open tabs for `/events` and the calendar app.
4. Lead A has a Luma link to an in-person event **they ran** at a venue **not yet in Roomline**, unused in rehearsal, plus a second one as backup.
5. Search wording: "free" in the question means "only venues confirmed free". Seeded venues have unconfirmed terms, so "free space for 80…" currently returns only Demo Hall. Check right before:
   ```sql
   select count(*) from venues where terms in ('free','free_for_community') and junk_at is null
     and st_dwithin(location, st_setsrid(st_makepoint(-0.0875, 51.5257), 4326)::geography, 3000);
   ```
   3 or more → ask the "free space" question. Fewer → ask "Space for 80 next Thursday near Old Street" (3 rooms; Demo Hall is #2).
6. Calendar: subscribe Apple Calendar to `webcal://<host>/events.ics` beforehand (Google Calendar refreshes subscriptions only every few hours).
7. Backup video of beats 2–3 recorded at the 21:30 rehearsal, paused on the Operator laptop.

## The 3 minutes

### 0:00–0:30 Pitch (Presenter)

> If you run a London tech community, finding a free room for 80 people takes days of DMs, cold emails and "anyone know a space?" in five WhatsApp groups.
> Roomline makes it one question. Ask "space for 80 next Thursday near Old Street" and you get rooms backed by evidence (events that really happened there), a clash check, and an AI assistant that rings the venue to check the date and writes down the answer for everyone.
> It stays clean because of mates: you can only post once an organiser vouches for you, and if someone you vouched for posts junk, you lose your vouching rights.

### 0:30–1:05 Beat 1: a lead adds a real venue (A's window, `/add`)

Lead A pastes their Luma link → **Fill it in** (about 1 s). It should show the venue name and address from Luma and "Hosted <community>: <event>, <date>, N went". If the venue is already in Roomline, it says "Already in Roomline: we'll add this event as evidence".

Lead A answers the 3 questions: people standing, kind, weekday evenings or weekends, terms, contact (members only), and either "OK to call" + phone or "Intro via me". Then **Publish venue** → **Open venue**.

Presenter: "Thirty seconds from a Luma link. Every field carries Lead A's name and today's date."

Fallback: "Couldn't read that Luma event" or "hides its venue" → second link. Still failing → move on; the home page counter shows "N added tonight".

### 1:05–1:25 Beat 2: trust (C's window, then B's)

C's window, `/add`: paste any Luma link → Fill it in → **Publish venue**. Shows: **"Posting needs a vouch from a member. Ask an organiser who knows you to vouch for you."**

B's window, `/people`: next to C, click **Vouch for <C>**. C's pill changes to "Vouched by <B>" and B's button to "You vouched".

Presenter (pointing at the "How trust works" panel): "B is now on the hook for what C posts. This is enforced in the database with row-level security, not just in the app."

Fallback: none needed; this beat doesn't depend on the network.

### 1:25–2:40 Beat 3: find, call, request (C's window, `/`)

Type (wording per pre-check 5) and press **Find a room**:

> Space for 80 next Thursday near Old Street

Should appear instantly ("Found in 0.0s"): **3 rooms that fit · 80 people · Thu 29 Oct, 18:30–21:30 · near Old Street**, and a clash banner: "Is AI making us less creative?: An Oxford-style debate (The Founder-writer Collective), 126 going, runs the same evening at Granola." Rooms: Civo Tech Junction (fits 180, hosted Cloud Native London, DevSecOps London and 4 more, company office → "Ask for an intro"), **Demo Hall, Old Street** (fits 120, free for community events, **Call to check**), Incubeta (hosted London.js and others).

Presenter: "Every room here hosted real community events. Note the date: next Thursday is after the clocks go back, and it's handled."

Click **Call to check** on Demo Hall. The live call card runs Dialling → Ringing → Talking (about 5 s), then the transcript streams: "Hi there, this is Roomline, an AI assistant calling on behalf of <C>… this call is recorded…", with the venue ("Sam") answering. Narrate over it: it says it's an AI, asks date, headcount, price, conditions. At about 0:55 it shows **CALL RECORDED** and the availability record: **Free · Thu 29 Oct, 18:30–21:30**, fits 120, free for community tech events, "Guest list 48 hours before; everyone out by 21:30", confirmed by Sam by phone, with the time.

Presenter: "Saved to the venue: the next organiser who asks about this evening gets this answer without a new call. One call per venue per week, max."

Click **Draft request** → a draft "Venue request: 80 people, Thu 29 Oct, 18:30–21:30", which mentions the phone confirmation → **Send** opens the mail app addressed to the venue's email (`DEMO_VENUE_EMAIL`).

Fallbacks:
- The call card shows an old answer: the reset (step 2) was skipped. Say "someone already asked, so no second call" and move on.
- "Couldn't start the call" or the card stalls → Operator plays the backup video; continue with **Draft request**.
- Search error → retype with a station name ("near Old Street"); the parser falls back to Old Street anyway.
- Running long → skip Draft request.

### 2:40–2:55 Beat 4: events (C's window, `/events`, then the calendar)

`/events` shows "London tech events, ranked", with the reasons as pills: hackathons on top (Agent Eval Harness, tonight's hackathon, Typelevel Open Source Hack, House London Data Hackathon), networking drinks at the bottom. Show **Subscribe in your calendar**, then the calendar app already subscribed.

Presenter: "Hackathons above talks above networking. We hand-labelled all 60 events to check the ranking: 8 of the top 10 are ones a builder would want, and no filler."

### 2:55–3:00 Close

> 143 venues and 389 hosted events as evidence, plus what leads added tonight. Open source; open data except contacts. Leads: post your venues tomorrow.

(Replace with the live counts at 22:00 from the SQL in [judges.md](judges.md). Don't read "added tonight" off the home page: it counts every venue created in the last 12 hours, seeded ones included.)

## Call modes

- **scripted** (default for the demo): a written call through the same pipeline and UI. No phone, no voice model. Be upfront if asked: "this is the scripted mode; the live voice mode uses Grok's realtime voice".
- **virtual** (only if `XAI_API_KEY` appears and works in rehearsal): run with `CALL_MODE=virtual` and open `https://<tunnel>/phone?key=<PHONE_KEY>` on the Venue's phone (needs HTTPS). On **Call to check**, that phone rings in the browser; the Venue answers and says: "Yes, the main room's free that evening. It's free for community groups. You'd need to be out by ten and send a guest list." If nobody answers within 40 s, the call becomes "No answer" → use **Draft request**. Switching modes needs a server restart, so pick one before 22:00.
- **twilio**: needs Twilio keys and a number. Not available tonight.

## Grok Bot

The Grok Bot instructions and skills (branch `grok-bot`, `bot/`) call `/api/*` routes (join, vouch, venues/search, calls, requests, events). The roomline server doesn't serve `/api/*`, so the bot only works if those routes are deployed. Don't show or claim the bot on stage unless it was tested end to end against the deployed URL. If it was, swap beat 3's typing for the bot message "Space for 80 next Thursday near Old Street?" and keep the web app as the fallback.

## If everything is down

Play the backup video and narrate. Keep the pitch and close.
