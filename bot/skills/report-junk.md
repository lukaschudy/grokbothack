---
name: report-junk
description: Flag a venue that is fake, closed or wrong. Use when an organiser says a listing is junk.
---

1. Ask for one line on what's wrong.
2. `curl -s -X POST "$URL/api/venues/<id>/report" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"reason":"…"}'`
3. Tell them it's recorded. Enough reports hide the venue, and whoever vouched for the poster is held accountable.
