# grokbothack

Open database of London venues, communities and events, kept up to date by approved organisers who vouch for each other. A shared agent finds a free venue in seconds and can phone it to check availability.

Track 4 (Venues, communities, events) at the Grok Bot Community Engineering London Hackathon, 22 Oct 2026. London only.

## Track judging

- Real venues and data entered on the night
- A trust model that stops junk
- How fast a venue is found
- Whether three leads would post their venues tomorrow

## Scope

**Build:**

1. **Venue DB**: capacity, AV, evening and weekend use, free or paid terms, contact, past hosts. Supabase + PostGIS.
2. **Trust**: root organisers; posting needs vouches; vouchers lose vouching rights if the person they vouched for posts junk. Every field records who added it and when it was last confirmed. Enforced with RLS.
3. **Chat agent**: "free space for 80 next Thursday near Old Street" → structured PostGIS query → top 3 with reasons, past hosts, clash warning, drafted request.
4. **Events feed**: Luma + Meetup + Devpost + BuilderBase → ranked with visible reasons → `.ics` feed.
5. **Calling**: Grok realtime voice over Twilio checks availability. Only for bookable venues the poster marked as OK to call. Every call is written back as a dated availability record.

**Cut:** LinkedIn/X host scraping, outreach CRM, Notion view, Overture/OSM seeding.

## Product rules

- Seed venues from evidence (events that actually happened there), not from maps.
- Adding a venue = paste a Luma link; the bot fills in the rest and asks 3 questions.
- Free venues are a scarce shared resource: contacts are members-only, and posters can choose "intro via me".
- Free evening venues are mostly company offices, which you reach through a person. Call bookable venues; ask past hosts for warm intros to company offices.
- Never auto-dial. One call answers every organiser: reuse recent answers, max ~1 call per venue per week.
- All times are in `Europe/London`. Clocks go back on 25 Oct 2026.

## Demo

1. Lead A pastes a Luma link → venue live in 30s.
2. Lead B adds a venue and vouches for C.
3. An unvouched account tries to post → blocked.
4. C asks the Old Street question → 3 venues → "call them?" → a phone rings on stage → result card → send request.
5. A calendar subscribed to the `.ics` feed shows the ranked events.

## Build order

Venue DB + trust → chat search → events + `.ics` → calling. If calling isn't working by the cutoff, fall back to an emailed request.

See [docs/data-sources.md](docs/data-sources.md) for what each source actually returns.

## Run it

```sh
npm install
cp .env.example .env.local   # fill in DATABASE_URL, SESSION_SECRET, XAI_API_KEY
npm run dev                  # http://localhost:3000 (Next + call bridge in one process)
```

- **Schema:** `db/migrations/*.sql`. Local Postgres: `npm run db:migrate`. Supabase: `npx tsx --env-file=.env.local scripts/supabase-sql.ts db/migrations/<file>.sql`.
- **Data:** `npx tsx scripts/fetch-sources.ts` writes `data/seed/*.json`; `npm run db:seed:pg` loads them over `DATABASE_URL`.
- **Calls:** `CALL_MODE=virtual` rings `/phone` (open it on a teammate's phone; it needs HTTPS, e.g. `cloudflared tunnel --url http://localhost:3000`) and Grok voice talks live. `scripted` plays a written call with no voice model. `twilio` dials real numbers.
- **Tests:** `npm test` (needs a local Postgres + PostGIS; see `tests/helpers.ts`).

## License

MIT
