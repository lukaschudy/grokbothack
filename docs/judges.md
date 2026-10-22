# Judges' crib sheet

Numbers are from `data/seed/*.json` loaded into a fresh local Postgres with `scripts/seed-pg.ts` on 22 Oct 2026 (the files the live database is seeded from), excluding the demo venue. Refresh at 22:00 against the live database:

```sql
select count(*) from venues where junk_at is null and name <> 'Demo Hall, Old Street';                  -- venues
select count(*) from venue_hosts;                                                                       -- past-event records
select count(*) from venues where created_by is not null and name <> 'Demo Hall, Old Street';          -- venues posted by people (seed has created_by null)
select count(distinct venue_id) from field_log where by_profile is not null and at > now() - interval '12 hours'; -- venues set or confirmed tonight
```

**Real venues and data entered on the night.** 143 London venues, every one seeded from evidence, not a map: 389 records of events that actually happened there (182 Luma, 177 Meetup, 30 Devpost) from 80 communities, up to 22 Oct 2026. 66 venues have hosted 2+ events and 24 have hosted 2+ different communities. 61 are within 2 km of Old Street, 43 of them used in the last 12 months. 84 have a capacity estimate from the biggest turnout seen there. 60 upcoming London events (33 Meetup, 24 Luma, 2 BuilderBase, 1 Devpost), 27 linked to a known venue. Leads add venues by pasting a Luma link: name, address and their event as evidence come from Luma in about a second, then 3 questions cover what only organisers know (capacity and kind, evenings and weekends, terms and contact, OK to call or intro via me). Honest gaps: seeded venues have unconfirmed terms until an organiser fills them in; some are noisy (Adam Smith Institute has 49 records from one think-tank calendar).

**A trust model that stops junk.** Enforced in Postgres with row-level security and security-definer functions, so it holds for any client, not only the web app. 1) Founding (root) organisers can post and vouch. 2) Anyone can sign up and search, but can only post, trigger calls or draft requests once a member in good standing vouches for them, and only such members can vouch. 3) If a venue is reported as junk (one root's report, or two members' reports), it disappears, the poster is banned, and **everyone who vouched for them loses vouching rights**: a vouch costs something. 4) Every field records who set it and when (`field_log`, shown on the venue page). 5) Contacts are in a separate table that anonymous visitors and unvouched accounts can't read. 6) Call answers can't be forged: members can record availability by hand, but only the call pipeline writes `source='call'`. Covered by 13 tests in `tests/trust.test.ts`: unvouched can't post, vouch or call; no vouching on someone else's behalf; contacts hidden from anon and unvouched; one member's report isn't enough and two are; a root's report bans the poster and strips the voucher.

**How fast a venue is found.** One question, "space for 80 next Thursday near Old Street", returns 3 rooms that fit plus a clash warning, shown as "Found in 0.0s" in the app. `search_venues` takes about 18 ms and `event_clashes` about 1 ms on the full data set; the whole local search took about 50 ms. The parser is deterministic, with Grok as an optional upgrade. It resolves "next Thursday" to Thu 29 Oct, 18:30–21:30 (after the clocks go back on 25 Oct) and widens 3 → 6 → 12 km if fewer than 3 rooms fit. Today the same task takes days of DMs and cold emails.

**Whether three leads would post their venues tomorrow.** Posting takes about 30 seconds: paste a Luma link they already have, answer 3 questions, publish. In return their event is credited as evidence, their name is on what they confirmed, contacts stay members-only, they can choose "intro via me" instead of calls, and a venue is called at most once a week however many organisers ask. Name the three leads and their venues here once confirmed: …

**Technical execution.** Next 16 app plus a custom Node server in one process (pages, server actions, `.ics`, Twilio webhooks, the call media WebSocket), Postgres + PostGIS, TypeScript strict. Calls run through one pipeline in three modes: `scripted` (written call, used for the demo), `virtual` (rings an in-browser phone at `/phone`, Grok realtime voice) and `twilio` (real numbers). Tests run against a real local Postgres + PostGIS (`npm test`, 57 passing): trust 13, sources 20, ranking 7 + 3 label checks, ICS 6, time 3, demo setup 5. All times are Europe/London, and the clock change is handled: "next Thursday 18:30" is 18:30 GMT, while tonight's 18:30 was 17:30 UTC.

**Use of community context.** Rooms are found through the events communities ran there, and ranked on that: which communities hosted, how many came, last hosted, and distance, terms and capacity fit. The events feed ranks the way builders choose: hackathons and build days > talks > networking, boosted by turnout and the host's track record, penalising paid events, recurring drinks and recruiter-led events. We labelled all 60 seeded events (`data/labels.json`: good, ok or filler, with a reason each; 30 to tune on, 30 held out) and measure the ranking in `tests/rank-labels.test.ts`. One principled change to `lib/rank.ts`: classify the event type from its title, and penalise paid events instead of boosting free ones (Meetup never marks events as free, so the boost only helped Luma). Results on all 60:

| | Before | After |
|---|---|---|
| "Good" events in the top 10 | 4 | 8 |
| Filler in the top 10 | 4 | 0 |
| Pairs in the right order | 0.51 | 0.86 |
| Pairs in the right order, 30 held-out events | 0.40 | 0.81 |

Caveat: our coding agent made the labels from titles and event pages; two leads haven't reviewed them yet, as the README plans.

**10x over today's tooling.** Today it's a WhatsApp "anyone know a space for 80?", a spreadsheet nobody updates, cold emails that get no reply, and a phone call during work hours. Here one question gets three evidence-backed rooms and a clash check. One click gets an AI assistant to call the venue: it says it's an AI and that the call is recorded, and takes under a minute. The answer is saved as a dated availability record, so the next organiser asking about that evening gets it without another call. One more click drafts the request, mentioning the phone confirmation.

**Real-world usefulness.** Open source (MIT); open data except contacts. Organisers subscribe to the ranked events once (`webcal://…/events.ics`) in Apple or Google Calendar. The calling rules are safe by default: never auto-dial (the organiser clicks), only bookable venues whose poster said OK, at most one call per venue per week, and company offices are reached through intros from past hosts, not cold calls. Limits: London only; tonight's demo uses the scripted call mode (no voice or Twilio keys); a UK Twilio number needs about 48 hours of regulatory approval.

**Demo quality.** Real data, real accounts with the real trust rules, and a call that runs through the same pipeline as a live one. `scripts/demo-setup.ts` resets the start state in one command (C unvouched, no rehearsal calls), and every beat has a fallback; see [demo.md](demo.md).
