# Mates Rates in Grok Bot

Grok Bot is the interface. Every organiser gets their own copy of the bot from one public share link; all copies talk to the same Mates Rates API, so the database is the shared brain.

## Set up (owner, once)

1. In the Grok Bot app, create a Bot named **Mates Rates**.
2. Paste [instructions.md](instructions.md) as its description/instructions. Replace `https://nrzgvkrbfn3ptoms2ckm4ni6ly.srv.us` with the public API URL.
3. Add each file in [skills/](skills/) as a skill.
4. Test the demo script below in your own chat.
5. Share → **Create template** → **Public link**. Put that link in the server's `GROK_BOT_SHARE_URL` so the landing page's "Open in Grok Bot" button uses it.

Organisers who open the link get a copy with the same instructions and skills (not your logins or chats). On first use the bot runs the **join** skill and keeps their token on its computer.

## Demo script

1. Lead A: "Add this venue: https://lu.ma/…" → bot adds it, asks capacity, terms, contact + OK to call.
2. Lead B adds a venue, then "Vouch for C".
3. Unvouched account: "Add this venue: …" → refused, explains vouching.
4. C: "Free space for 80 people next Thursday evening near Old Street?" → 3 venues with reasons → "Call the first one?" → yes → result → "Send the request".
5. "What's on this week?" → ranked events + .ics link.
