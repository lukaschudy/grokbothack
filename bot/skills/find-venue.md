---
name: find-venue
description: Find free or cheap event space in London for a headcount, date and area. Use for questions like "free space for 80 next Thursday near Old Street?"
---

1. Extract: area (`near`), headcount, start and end (Europe/London; default 18:30–21:30 for "evening"), free only if they say free. Say the resolved date back in one line.
2. Search:
   ```sh
   curl -s -G "$URL/api/venues/search" -H "Authorization: Bearer $TOKEN" \
     --data-urlencode "near=Old Street" --data-urlencode "headcount=80" \
     --data-urlencode "start=2026-10-29T18:30:00+00:00" --data-urlencode "end=2026-10-29T21:30:00+00:00"
   ```
3. Reply with the top 3, one block each:
   **Name** · area · distance
   Why: the API's reasons (past hosts, biggest turnout seen, last hosted, terms).
   ⚠️ clash, if any. Mark unconfirmed facts as unconfirmed.
4. Offer next steps: "Call the first one to check?" (check-availability, only for venues with `ok_to_call`), "Send a request?" (send-request), or "Ask a past host for an intro?" for company offices.
5. Nothing found: widen the radius once (2 km → 4 km), then say so plainly.
