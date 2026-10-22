---
name: check-availability
description: Have the assistant phone a venue's bookings line to check a date, price and conditions. Only after the organiser says yes.
---

1. Confirm in one line: venue, exact date and time (Europe/London), headcount. Ask "Shall I call them now?" Only continue on a clear yes.
2. `curl -s -X POST "$URL/api/calls" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"venue_id":"…","start":"…","end":"…","headcount":80,"event_title":"…"}'`
   - `not_ok_to_call` → this venue can't be called; offer send-request or an intro via a past host.
   - cooldown error → someone checked recently; show that answer instead.
3. Say "Calling now, usually under 2 minutes." Poll `GET /api/calls/<id>` every 10 s, up to 4 minutes.
4. Report: available / not / partial, price, conditions, who confirmed, one-line summary. On no answer, offer send-request.
