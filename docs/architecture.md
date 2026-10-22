# Architecture

Code freeze 21:50. Everything below is sized for ~2 hours.

```
 Organiser ──▶ Grok Bot (own copy via public share link: instructions + skills)
                   │  HTTPS + Bearer token (bot secret MATES_RATES_TOKEN)
                   ▼
 Website ──▶ Mates Rates server (Node/TS, one process)
 (landing,       ├─ /api/*        venue search, add, vouch, calls, requests
  .ics link)     ├─ /events.ics   ranked London events
                 ├─ /twilio/*     call status webhooks
                 └─ /media (ws)   Twilio audio ⇄ Grok realtime voice (Leo, London accent)
                   │
                   ▼
              Supabase (Postgres + PostGIS)      Resend (request emails)
                   ▲
 fetch-sources + seed ┘  Luma, Meetup, Devpost, BuilderBase → venues, hosts, events
```

## Why this shape

- **Grok Bot is the interface.** A public share link gives each organiser their own copy of the bot (instructions and skills, not our logins). All copies call one backend, so the shared brain is the database.
- **Skills call our HTTPS API**, not a custom MCP connector. Skills carry over in a shared bot; connectors may not. An MCP wrapper over the same handlers is a stretch goal.
- **Trust lives in the API.** The backend uses the Supabase service role, so writes go through `can_post()` and RLS. RLS makes contacts, organisers, calls and requests unreadable to the public key.
- **Calling and email run in our backend.** The bot never sees venue contacts.
- **One process** because Twilio media streams need a long-lived WebSocket. Run it on one laptop behind a `cloudflared` quick tunnel for the demo.

## Database

Live schema: `db/migrations/` on the `data-sources` branch, applied to Supabase. Main tables: `profiles`, `vouches`, `venues`, `venue_contacts` (members only), `venue_hosts` (past events as evidence), `field_log` / `venue_field_status` (who set or confirmed each field), `availability`, `calls`, `requests`, `events`. Functions: `search_venues`, `event_clashes`, `can_post`, `can_vouch`, `request_call`, `report_junk`.

Loaded 22 Oct: 153 venues, 389 past-host records, 60 ranked events.

## API

All `/api` routes except `join` and `events` need `Authorization: Bearer <token>`. Writes also need an approved organiser.

| Route | Does |
|---|---|
| `POST /api/join` `{name, community, email, luma_url}` | Create a pending organiser, return token once |
| `POST /api/vouch` `{organiser_name}` | Vouch for someone |
| `POST /api/venues/from-luma` `{url}` | Fetch the Luma event, create or find the venue, return it + 3 questions |
| `PATCH /api/venues/:id` | capacity, av, evenings, weekends, terms, terms_note, kind, callable, contact `{name, email, phone}` |
| `GET /api/venues/search?near=&capacity=&start=` | Geocode `near` (Nominatim, London box) → `search_venues` → top 3 with reasons |
| `POST /api/venues/:id/flag` `{reason}` | Flag junk |
| `POST /api/calls` `{venue_id, start, headcount}` | Dial (callable venues only, reuse a call < 3 days old) |
| `GET /api/calls/:id` | Status + result |
| `POST /api/requests` `{venue_id, start, headcount, message}` | Email the venue, Reply-To + CC the organiser |
| `GET /api/events?limit=` | Ranked events with reasons (public) |
| `GET /events.ics` | Subscribable feed (public) |
| `GET /` | Landing page: pitch, "Open in Grok Bot", .ics link |

## Calling

1. `POST /api/calls` → Twilio REST `Calls.json` with TwiML `<Connect><Stream url="wss://HOST/media?call=ID"/>`.
2. `/media` bridges Twilio's μ-law audio to the xAI realtime API. Session: voice Leo, London accent, the script from the README, one tool `report_result({available, price, conditions, summary})`.
3. On `report_result`: save to `calls`, set `venues.last_confirmed_at`, hang up.
4. No answer or voicemail → status `no_answer`; the bot offers to send the email instead.

Start from the xAI cookbook's Twilio example (inbound); outbound is the one REST call above.

## Ingest

On `data-sources` + `seed-loader`:

1. `npx tsx scripts/fetch-sources.ts`: Luma discover + calendar history, Meetup find + group history, Devpost, BuilderBase → `data/seed/venues.json` (venues seen hosting, with evidence) and `data/seed/events.json` (next 3 weeks, ranked with reasons).
2. `npm run db:seed`: loads both over Supabase REST with the secret key. Re-runnable: existing venues are never overwritten; events are refreshed.

## Grok Bot

`bot/instructions.md` (bot description) and `bot/skills/*.md`: find a venue, add a venue, join and vouch, check availability (call), send a request, events. Each skill documents the API calls with `curl` and reads `MATES_RATES_URL` and `MATES_RATES_TOKEN` from bot secrets. Publish as a template with a public link; put that link on the landing page.

## Config (`.env`, never committed)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `XAI_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `RESEND_API_KEY`, `MAIL_FROM`, `PUBLIC_URL`.

## Dependencies

`hono`, `@hono/node-server`, `ws`, `@supabase/supabase-js`, `ical-generator`; dev: `typescript`, `tsx`, `@types/node`, `@types/ws`. Twilio, Resend, Nominatim and xAI over plain `fetch`.

## Plan to 21:50

| Time | Track A | Track B | Track C | Track D |
|---|---|---|---|---|
| 19:45–20:20 | Supabase project, schema, ingest | API: join, vouch, venues, search | Calling: Twilio + Grok voice | Line up 3 real leads |
| 20:20–21:00 | Ranking, `.ics`, landing page | Bot instructions + skills, share link | Calling end to end on a teammate's phone | Leads add real venues |
| 21:00–21:30 | Requests email | Bot QA on the demo script | Wire calls into the bot | More venues, label 30 events |
| 21:30–21:50 | Freeze, rehearse, record a backup video of a call | | | |

Cut order if late: Luma calendar history → flags → callbacks → calling (fall back to email).
