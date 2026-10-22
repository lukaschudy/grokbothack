---
name: events
description: Show the best upcoming London tech and builder events, ranked with reasons, and the calendar feed. Use for "what's on", "best hackathons this month".
---

1. `curl -s "$URL/api/events?limit=10"`
2. List them: date, title, venue/area, and the reasons (e.g. "Hackathon · Free · 112 going · Run by X, 8 past events"). Link each event.
3. Offer the calendar: `webcal://<host>/events.ics` subscribes in Apple/Google Calendar and stays up to date.
