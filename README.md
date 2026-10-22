# Mates Rates

Free venues for London communities, sorted by mates.

Open database of London venues, communities and events, kept up to date by approved organisers who vouch for each other. A shared Grok Bot agent finds a free venue in seconds, phones it to check availability, and sends the request.

Track 4 (Venues, communities, events) at the Grok Bot Community Engineering London Hackathon, 22 Oct 2026. London only.

## Track judging

- Real venues and data entered on the night
- A trust model that stops junk
- How fast a venue is found
- Whether three leads would post their venues tomorrow

## Scope

**Build:**

1. **Venue DB**: capacity, AV, evening and weekend use, terms (`free` / `free with conditions` / `paid` + note), contact, past hosts. Supabase + PostGIS.
2. **Trust**: 3–5 root organisers. Posting needs a vouch (1 tonight, 2 after). If someone posts junk, whoever vouched for them loses vouching rights. A join request shows the applicant's Luma hosting history as evidence, but a human vouch is always required. Every field records who added it and when it was last confirmed. The API enforces vouching; RLS keeps contacts, organisers and calls unreadable to the public.
3. **Grok Bot agent** (the interface): "free space for 80 next Thursday near Old Street" → structured PostGIS query → top 3 with reasons, past hosts and clash warnings → calls to check availability → sends the request.
4. **Events feed**: Luma + Meetup + Devpost + BuilderBase → ranked with visible reasons → `.ics` feed.
5. **Calling**: Grok realtime voice over Twilio. Only for bookable venues the poster marked as OK to call. Every call is written back as a dated availability record.
6. **Website**: one landing screen with an "Open in Grok Bot" button and the `.ics` subscribe link. No dashboard: no search, venue, people or sign-in pages. The only other web pages are `/phone` (the venue's end of a virtual call) and the APIs.

**Cut:** LinkedIn/X host scraping, outreach CRM, Notion view, Overture/OSM seeding.

## Product rules

- Grok Bot is the only interface. Everything an organiser does (find, add, vouch, call, request, events) happens in the chat.
- Public and open source: code and all data except contacts.
- Contacts (names, phones, emails) are stored but never displayed or exported. Only the agent reads them, to call and send requests. Enforced by RLS: public reads can't touch the contacts table.
- Tech and builder communities only.
- Seed venues from evidence (events that actually happened there), not from maps.
- Adding a venue = paste a Luma link; the bot fills in the rest and asks 3 questions.
- Hosts: store name, community and Luma profile link. No LinkedIn or X.
- The agent sends venue requests on the organiser's behalf, with the organiser in Reply-To and CC so replies go to them.
- Free evening venues are mostly company offices, which you reach through a person. Call bookable venues; ask past hosts for warm intros to company offices.
- Never auto-dial: the organiser confirms. One call answers every organiser: reuse recent answers, max ~1 call per venue per week.
- All times are in `Europe/London`. Clocks go back on 25 Oct 2026.

## Event ranking

Hackathons and build days > talks > networking. Boost by turnout and the host's track record. Penalise online, paid, recurring drinks and recruiter-led events. Two leads hand-label 30 events to check it.

## Calling script

- Opens: "Hi, I'm an assistant calling on behalf of [organiser], [community]."
- Voice: Grok's British voice (Leo), prompted for a London accent.
- Asks: is the date free, is it free or what does it cost, any conditions. Offers to email details. Under 2 minutes.
- Never claims to be human. If asked, it says it's an AI assistant.
- Callbacks: the same agent answers, takes a message and posts it to the organiser's thread (after the demo).
- Demo uses any Twilio number. A UK number needs Twilio regulatory approval (~48 business hours).

## Demo

1. Lead A pastes a Luma link into Mates Rates (Grok Bot) → venue live in 30s.
2. Lead B adds a venue and vouches for C.
3. An unvouched account tries to post → blocked.
4. C asks the Old Street question → 3 venues → "call them?" → a phone rings on stage → result card → agent sends the request.
5. A calendar subscribed to the `.ics` feed shows the ranked events.

## Build order

Venue DB + trust → Grok Bot search → events + `.ics` → calling. If calling isn't working by the cutoff, the agent just sends the emailed request.

See [docs/architecture.md](docs/architecture.md) for the system design and [docs/data-sources.md](docs/data-sources.md) for what each source actually returns.

## Run

Code lives on the `data-sources` branch (loader on `seed-loader`) until merged.

```sh
npm install
npm run db:migrate                  # DATABASE_URL
npx tsx scripts/fetch-sources.ts    # → data/seed/venues.json, events.json
npm run db:seed                     # SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (sb_secret_)
```

## License

MIT
