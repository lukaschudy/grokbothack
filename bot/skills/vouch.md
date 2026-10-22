---
name: vouch
description: Vouch for another organiser so they can post. Use for "vouch for <name>".
---

1. Remind them once: vouching means you're accountable; if this person posts junk, you can lose the right to vouch.
2. `curl -s -X POST "$URL/api/vouch" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"display_name":"…"}'`
3. Report the result: whether the person can now post.
