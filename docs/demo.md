# Demo runbook (3 minutes, 22:20)

Live: https://nrzgvkrbfn3ptoms2ckm4ni6ly.srv.us. Grok Bot is the only interface. On stage:
- one laptop showing the Grok Bot chat;
- one phone as the venue (`/phone?key=…`, rings only in virtual-voice mode);
- a calendar app subscribed to `/events.ics`.

There are no web app beats.

The API calls behind every beat (`/api/venues/from-luma`, `/api/vouch`, `/api/venues/search`, `/api/calls`, `/api/requests`, `/api/events`) were run on 22 Oct against local Postgres with the seed data and `CALL_MODE=scripted`, on `integration`'s code plus `demo`'s `scripts/demo-setup.ts`. The responses quoted below are from that run. The Grok Bot side (how fast it replies, how it words things) was not tested here; rehearse it.

| Who | Does |
|---|---|
| **Presenter** (Lukas) | Mic, pitch, types the Newcomer's messages, narrates |
| **Lead** | Types beats 1–2 in the Lead chat (same laptop) |
| **Venue** | Virtual mode only: holds the phone with `/phone` open and answers |
| **Operator** | Back of room: server log, tunnel, backup video, the reset command |

## Stage setup: two bot copies, not one

Use **two copies** of the bot from the share link, side by side or one tab each:
- **Lead**: logged in as account B. Adds the venue, vouches.
- **Newcomer**: logged in as account C. Gets blocked, then searches, calls, requests and checks events.

Account A is a spare vouched account; use it if the Lead copy breaks.

Two copies are clearly more reliable than one copy switching accounts with the login skill:
- **No password on the projector.** Logging in means typing email and password into the chat.
- **No extra turns.** Each switch is another bot round trip, about 10–15 s, and a 3-minute demo needs at least two switches.
- **No mixed identities.** One chat holding both people's turns invites the bot to mix them up ("you can post now").

If only one copy works: run beats 1–2 with the Lead account. Then switch once, before beat 3, with "Log me in as <C's email>". Type the password with the projector frozen or mirrored off.

## Before going on (from 21:50)

1. **Server.** It's up (see `DEPLOY.md` on `integration`) and `npx tsx scripts/smoke.ts https://nrzgvkrbfn3ptoms2ckm4ni6ly.srv.us` passes. Checked 20:2x: `/api/stats`, `/api/events` (hackathons first) and `/events.ics` answer, and `/phone` without the key is a 404.
2. **Call mode.** Pick it by 22:00; switching needs a restart.
   - **virtual**, if `XAI_API_KEY` is set and a rehearsal call worked: the Venue's phone rings in the browser and Grok talks live.
   - **scripted** otherwise: the same pipeline plays a written call (about 55 s) and nothing rings. Without the key, virtual calls fall back to scripted anyway.
3. **Reset the start state after the last rehearsal.** Run it in the deploy sandbox, so it uses the server's `DATABASE_URL` and `SESSION_SECRET`. It needs `demo`'s current `scripts/demo-setup.ts` (the 20:20 fix that clears rehearsal confirmations).
   ```sh
   DEMO_VENUE_PHONE=+44… DEMO_VENUE_EMAIL=<inbox you can show> \
   DEMO_B="<Lead's name>|<community>" DEMO_C="<Newcomer's name>|<community>" \
   npx tsx --env-file-if-exists=.env.local scripts/demo-setup.ts --tokens
   ```
   - Expect `C … BLOCKED (unvouched)` and `venue Demo Hall, Old Street … callable`.
   - Without the reset, the stage call returns the rehearsal's answer ("reused") instead of calling, C is already vouched, and search may say "capacity confirmed by <C>".
   - If Lukas already has an account: `DEMO_ROOTS="Lukas||<his email>"`.
4. **Tokens.** Set `MATES_RATES_TOKEN` in the Lead copy to B's token and in the Newcomer copy to C's token, then open a **fresh chat** in each. Check with "Who am I?": the Newcomer should say it can't post yet.
5. **Venue phone** (virtual mode). Open `https://nrzgvkrbfn3ptoms2ckm4ni6ly.srv.us/phone?key=<PHONE_KEY>` in the phone's browser and tap once, so audio is allowed. Ringer up, screen-lock off.
6. **Calendar.** Apple Calendar → File → New Calendar Subscription → `webcal://nrzgvkrbfn3ptoms2ckm4ni6ly.srv.us/events.ics`, done before the demo (Google Calendar takes hours to refresh).
7. **Luma links.** The Lead has a link to an in-person event **they ran**, at a venue not yet in the database and unused in rehearsal, plus a second link as backup.
8. **Paste buffer.** Keep the messages below in a note on the laptop; paste them, don't type them.
9. **Backup video** of beat 3 (search → call → result), recorded at the 21:30 rehearsal, paused on the Operator laptop.

## The 3 minutes

### 0:00–0:30 Pitch (Presenter)

> If you run a London tech community, finding a free room for 80 people takes days of DMs, cold emails and "anyone know a space?" in five WhatsApp groups.
> Mates Rates makes it one message to a shared Grok Bot. Ask "free space for 80 next Thursday near Old Street" and you get rooms backed by evidence (events that really happened there), a clash check, and an assistant that rings the venue to check the date, then sends the request.
> It stays clean because of mates: you can only post once an organiser vouches for you, and if someone you vouched for posts junk, you lose your vouching rights.

At "one message", the Lead sends beat 1, so the bot is already working.

### 0:30–1:00 Beat 1: a lead adds a real venue (Lead chat)

> Add this venue: https://lu.ma/XXXXXXXX

API result: the venue name and address from Luma, the Lead's event recorded as a past host, and 3 questions:
- Roughly how many people does it hold, and does it have AV?
- Free, free for communities, or paid? Evenings and weekends OK?
- Who's the contact, and is it OK for our assistant to phone them, or should people go through you for an intro?

The Lead answers in one message, with real answers, e.g.:

> About 60, screen and two mics. Free for community groups, evenings fine, no weekends. Intro via me, don't call them.

Bot: it's live, and the contact stays private.

Presenter: "Thirty seconds, from a Luma link. Every field records who set it and when."

Fallback: the Luma read fails, or the venue is hidden until you register → second link. Still failing → move on.

### 1:00–1:25 Beat 2: trust (Newcomer chat, then Lead chat)

Newcomer chat:

> Add this venue: https://lu.ma/XXXXXXXX

API: `403 not_trusted`, "You can't post yet: a member needs to vouch for you (they say: vouch for <your name>). Vouchers are accountable for what you post."

Lead chat (C's exact display name):

> Vouch for Organiser C

The bot first reminds the Lead they're accountable. API: "Organiser C can now post venues."

Presenter: "The Lead is now on the hook for what C posts. It's enforced in the database with row-level security, not in the bot."

Fallback: the bot asks to confirm → "Yes". The bot stalls → Operator runs the vouch with B's token via curl (`POST /api/vouch {"display_name": "…"}`).

### 1:25–2:40 Beat 3: find, call, request (Newcomer chat)

> free space for 80 next Thursday near Old Street

The bot should say back "Thu 29 Oct, 18:30–21:30" (that's after the clocks go back), then (API result, `free_only=true`):
- **Demo Hall, Old Street**: fits 120, 150 m, free for community events, capacity confirmed by Lead B. "We can phone them to check availability."
- **Civo Tech Junction**: fits 180, 100 m, hosted Cloud Native London, DevSecOps London and 4 more, biggest turnout 180, last hosted 16 Sept. "Terms unconfirmed: ask." Company office: ask a past host for an intro.
- **Incubeta**: fits 145, 100 m, hosted London.js and others, last hosted 30 Jul. "Terms unconfirmed: ask."
- The note "Some of these haven't confirmed their terms yet: ask before you book."
- ⚠️ "Same evening: Is AI making us less creative?: An Oxford-style debate (126 going) at Granola, 468 m away."

Presenter: "Confirmed-free first; the others hosted real community events but haven't confirmed terms, and it says so. Plus a clash 450 metres away."

Fallback: fewer than 3 rooms, or an error → "Space for 80 next Thursday evening near Old Street?" (same 3 rooms, Civo first).

> Call Demo Hall to check

The bot confirms the venue, date and headcount, and asks "Shall I call them now?"

> Yes

API: "Calling now, usually under 2 minutes." The bot polls every 10 s.
- **Virtual:** the Venue's phone rings on stage. The Venue answers on speaker. The assistant opens by saying it's an AI calling for C, and that the call is recorded. Venue says: "Yes, the main room's free that evening. It's free for community groups. You'd need to be out by half nine, and send a guest list 48 hours before." Optional: ask it "Are you a real person?"
- **Scripted:** nothing rings; about 55 s later the result arrives. Narrate while it runs: "it says it's an AI, asks the date, headcount, price and conditions."

Result (the API's summary, scripted run): "Demo Hall, Old Street is free Thu 29 Oct, 18:30–21:30: up to 120 people. Free for community tech events. Conditions: Guest list 48 hours before; everyone out by 21:30. Confirmed by Sam, events."

Presenter: "That answer is saved against the venue. The next organiser who asks about that evening gets it without another call: max one call per venue per week."

> Send them the request

The bot shows a short draft and asks "Send it?"

> Send it

API: sent, with C in Reply-To and CC, if email is configured. Otherwise: "Email sending isn't configured on the server yet; kept as a draft." Say so plainly: "the draft is stored; email goes out once the mail key is set."

Fallbacks:
- Virtual: no answer in 40 s → `no_answer` → "Send them the request".
- The call fails, or the bot stops polling → "How did the call to Demo Hall go?" (the bot re-polls `/api/calls/<id>`). Still nothing → Operator plays the backup video, then "Send them the request".
- The bot says it was called recently or reused → the reset was skipped; present it as "someone already asked, so no second call".
- Demo Hall missing → "Show me venues near Old Street for 80 that you can call".

### 2:40–2:55 Beat 4: events (Newcomer chat, then the calendar)

> What's on for builders in London this week?

API order (live, 20:2x):
1. HACKATHON - Agent Eval Harness (Wed 4 Nov, 72 going)
2. Grok Bot Community Engineering London Hackathon (tonight)
3. Typelevel Open Source Hack
4. House London Data Hackathon

Each comes with its reasons ("Hackathon · Free · 72 going · Run by The Friendly Data Meetup London, 3 past events"), plus the `webcal://…/events.ics` link. Switch to the calendar app already subscribed.

Presenter: "Hackathons above talks above networking. We hand-labelled all 60 events to check it: 8 of the top 10 are ones a builder wants, and no networking drinks."

### 2:55–3:00 Close

> 143 venues and 389 hosted events as evidence, plus what leads added tonight. Open source, open data except contacts. Leads: post your venues tomorrow.

(Use the live numbers at 22:00: SQL in [judges.md](judges.md). `/api/stats` counts Demo Hall too.)

## If everything is down

Play the backup video and narrate. Keep the pitch and close.
