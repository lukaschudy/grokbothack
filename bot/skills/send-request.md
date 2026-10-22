---
name: send-request
description: Email a venue a booking request on the organiser's behalf. Replies go straight to the organiser.
---

1. Draft a short request in the organiser's voice: who they are, community, date and time (Europe/London), headcount, what the event is, what they need (AV, chairs), and a thank-you. Show the draft and ask "Send it?"
2. On yes: `curl -s -X POST "$URL/api/requests" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"venue_id":"…","start":"…","end":"…","headcount":80,"message":"…"}'`
3. Confirm it was sent (or kept as a draft if email isn't configured). Replies come to their own inbox; you never see the venue's address.
