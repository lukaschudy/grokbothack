---
name: add-venue
description: Add a venue from a Luma event link (or by name and address), then fill in what only organisers know. Use when someone pastes a Luma link or says they know a venue.
---

1. `curl -s -X POST "$URL/api/venues/from-luma" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"url":"https://lu.ma/…"}'`
   - 403 → they can't post yet; explain vouching.
   - The response has the venue (name, address, past hosts) and the questions to ask.
2. Confirm the venue in one line, then ask these 3 questions together:
   - Roughly how many people does it hold, and does it have AV (screen, mics)?
   - Terms: free, free for communities, or paid (and roughly what)? Evenings/weekends OK?
   - Who's the contact (name, role, email, phone), and is it OK for our assistant to phone the bookings line?
3. Save: `PATCH /api/venues/<id>` with `capacity, av, terms, price_note, evening_ok, weekend_ok, ok_to_call, contact{contact_name, contact_role, email, phone}`. Phone in E.164 (+44…).
4. Tell them it's live and that the contact stays private: only the assistant uses it.
