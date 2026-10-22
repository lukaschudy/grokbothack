# Demo runbook (3 minutes, 22:20)

Grok Bot is the only interface. On stage: one laptop showing the Grok Bot chat, one phone as the venue (`/phone`, only in virtual-voice mode), and a calendar app subscribed to `/events.ics`. There are no web app beats.

The API calls behind every beat (`/api/venues/from-luma`, `/api/vouch`, `/api/venues/search`, `/api/calls`, `/api/requests`, `/api/events`) were run on 22 Oct against local Postgres with the seed data and `CALL_MODE=scripted` (branch `api-server` + `demo`). The responses quoted below are from that run. The Grok Bot side (how fast it replies, how it words things) was not tested here; rehearse it.

| Who | Does |
|---|---|
| **Presenter** (Lukas) | Mic, pitch, types C's messages, narrates |
| **Lead A** | Types beat 1 in A's chat (same laptop) |
| **Lead B** | Types "Vouch for …" in B's chat |
| **Venue** | Virtual mode only: holds the phone with `/phone` open and answers |
| **Operator** | Back of room: server log, tunnel, backup video, the reset command |

## Before going on (from 21:50)

1. Server up at the public URL (see `DEPLOY.md` on `integration`); `npx tsx scripts/smoke.ts <PUBLIC_URL>` passes.
2. Pick the call mode by 22:00 (switching needs a restart):
   - **virtual**, if `XAI_API_KEY` is set and a rehearsal call worked: the Venue's phone rings in the browser and Grok talks live.
   - **scripted** otherwise: the same pipeline plays a written call (about 55 s) and nothing rings. Without the key, virtual calls fall back to scripted anyway.
3. **Reset the start state after the last rehearsal.** Run it in the deploy sandbox, so it uses the server's `DATABASE_URL` and `SESSION_SECRET`:
   ```sh
   DEMO_VENUE_PHONE=+44… DEMO_VENUE_EMAIL=<inbox you can show> \
   DEMO_A="<A's name>|<community>" DEMO_B="<B's name>|<community>" DEMO_C="<C's name>|<community>" \
   npx tsx --env-file-if-exists=.env.local scripts/demo-setup.ts --tokens
   ```
   Expect `C … BLOCKED (unvouched)` and `venue Demo Hall, Old Street … callable`. Without the reset, the stage call returns the rehearsal's answer ("reused") instead of calling, and C is already vouched. If Lukas already has an account: `DEMO_ROOTS="Lukas||<his email>"`.
4. Three copies of the bot from the share link on the laptop (Mates Rates A, B, C), each with its `MATES_RATES_TOKEN` secret set to the token printed for A, B or C. Open each one in a **fresh chat**, so C's chat isn't already vouched in its memory. Check each with "Who am I?": the bot calls `/api/me`, and C should say it can't post yet.
5. Venue phone (virtual mode): open `<PUBLIC_URL>/phone?key=<PHONE_KEY>` in the phone's browser and tap once, so audio is allowed. Ringer up, screen-lock off.
6. Calendar: Apple Calendar → File → New Calendar Subscription → `webcal://<host>/events.ics`, done before the demo (Google Calendar takes hours to refresh).
7. Lead A has a Luma link to an in-person event **they ran**, at a venue not yet in the database, unused in rehearsal, plus a second link as backup.
8. Search wording: if the question contains "free", the bot filters to venues **confirmed** free, and seeded venues are unconfirmed. Right now "free space for 80…" returns only Demo Hall. Unless 3 or more free venues near Old Street have been confirmed by 22:00, ask without "free" (below).
9. Paste buffer: keep the messages below in a note on the laptop. Paste them, don't type them.
10. Backup video of beat 3 (search → call → result), recorded at the 21:30 rehearsal, paused on the Operator laptop.

## The 3 minutes

### 0:00–0:30 Pitch (Presenter)

> If you run a London tech community, finding a free room for 80 people takes days of DMs, cold emails and "anyone know a space?" in five WhatsApp groups.
> Mates Rates makes it one message to a shared Grok Bot. Ask "space for 80 next Thursday near Old Street?" and you get rooms backed by evidence (events that really happened there), a clash check, and an assistant that rings the venue to check the date, then sends the request.
> It stays clean because of mates: you can only post once an organiser vouches for you, and if someone you vouched for posts junk, you lose your vouching rights.

At "one message", Lead A sends beat 1, so the bot is already working.

### 0:30–1:00 Beat 1: a lead adds a real venue (A's chat)

> Add this venue: https://lu.ma/XXXXXXXX

API result: the venue name and address from Luma, A's event recorded as a past host, and 3 questions:
- Roughly how many people does it hold, and does it have AV?
- Free, free for communities, or paid? Evenings and weekends OK?
- Who's the contact, and is it OK for our assistant to phone them, or should people go through you for an intro?

Lead A answers in one message, with their real answers, e.g.:

> About 60, screen and two mics. Free for community groups, evenings fine, no weekends. Intro via me, don't call them.

Bot: it's live, and the contact stays private.

Presenter: "Thirty seconds, from a Luma link. Every field records who set it and when."

Fallback: the Luma read fails, or the venue is hidden until you register → second link. Still failing → move on.

### 1:00–1:25 Beat 2: trust (C's chat, then B's)

C's chat:

> Add this venue: https://lu.ma/XXXXXXXX

API: `403 not_trusted`, "You can't post yet: a member needs to vouch for you (they say: vouch for <your name>). Vouchers are accountable for what you post."

B's chat:

> Vouch for Organiser C

(Use C's exact display name.) The bot first reminds B they're accountable. API: "Organiser C can now post venues."

Presenter: "B is now on the hook for what C posts. It's enforced in the database with row-level security, not in the bot."

Fallback: B's bot asks to confirm → "Yes". The bot stalls → Operator runs the vouch with B's token via curl (`POST /api/vouch {"display_name": "…"}`).

### 1:25–2:40 Beat 3: find, call, request (C's chat)

> Space for 80 next Thursday evening near Old Street?

The bot should say back "Thu 29 Oct, 18:30–21:30" (that's after the clocks go back), then:
- **Civo Tech Junction**: fits 180, 100 m, hosted Cloud Native London, DevSecOps London and 4 more, biggest turnout 180, last hosted 16 Sept. Company office: ask a past host for an intro.
- **Demo Hall, Old Street**: fits 120, 150 m, free for community events, capacity confirmed by Lead B. "We can phone them to check availability."
- **Incubeta**: fits 145, 100 m, hosted London.js and others.
- ⚠️ "Same evening: Is AI making us less creative?: An Oxford-style debate (126 going) at Granola, 468 m away."

Presenter: "Every room here hosted real community events, and it warns you about a clash 450 metres away."

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

API: sent, with C in Reply-To and CC, if email is configured. Otherwise: "Email sending isn't configured on the server yet; kept as a draft." Say so plainly: "email goes out once we add the mail key; the draft is stored".

Fallbacks:
- Virtual: no answer in 40 s → `no_answer` → "Send them the request".
- The call fails, or the bot stops polling → "How did the call to Demo Hall go?" (the bot re-polls `/api/calls/<id>`). Still nothing → Operator plays the backup video, then "Send them the request".
- The bot says it was called recently or reused → the reset was skipped; present it as "someone already asked, so no second call".
- Demo Hall missing from the results → "Show me venues near Old Street for 80 that you can call".

### 2:40–2:55 Beat 4: events (C's chat, then the calendar)

> What's on for builders in London this week?

API order: Agent Eval Harness hackathon (Wed 4 Nov, 72 going), tonight's Grok Bot hackathon, Typelevel Open Source Hack, House London Data Hackathon… The reasons come with each ("Hackathon · Free · 72 going · Run by The Friendly Data Meetup London, 3 past events"), plus the `webcal://…/events.ics` link. Switch to the calendar app already subscribed.

Presenter: "Hackathons above talks above networking. We hand-labelled all 60 events to check it: 8 of the top 10 are ones a builder wants, and no networking drinks."

### 2:55–3:00 Close

> 143 venues and 389 hosted events as evidence, plus what leads added tonight. Open source, open data except contacts. Leads: post your venues tomorrow.

(Use the live numbers at 22:00: SQL in [judges.md](judges.md). `/api/stats` counts Demo Hall too.)

## If everything is down

Play the backup video and narrate. Keep the pitch and close.
