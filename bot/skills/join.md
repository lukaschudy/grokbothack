---
name: join
description: Create the organiser's Mates Rates account or log in, and store their token. Use when there is no token yet, or when the API returns 401.
---

1. Ask for: email, a password, their name as other organisers know them, their community, and (optional) a Luma link to an event they've run.
2. New account:
   ```sh
   curl -s -X POST "$URL/api/join" -H 'content-type: application/json' \
     -d '{"email":"…","password":"…","display_name":"…","community":"…","luma_url":"…"}'
   ```
   Existing account: `POST /api/login {"email","password"}`.
3. Save the returned `token`: `mkdir -p ~/.mates-rates && printf %s "$TOKEN" > ~/.mates-rates/token && chmod 600 ~/.mates-rates/token`. Never show the token or password in chat.
4. Call `GET /api/me`. If `can_post` is false, say: "You're in. To add venues, ask a member to vouch for you (they type: vouch for <your name>)."
