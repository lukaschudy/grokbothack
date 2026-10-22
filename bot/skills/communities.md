---
name: communities
description: Look up London communities: who runs what, how big, where they've hosted, how to reach them. Use for "which communities run AI events?", "who hosted at Civo?", "find a co-host".
---

1. `curl -s -G "$URL/api/communities" -H "Authorization: Bearer $TOKEN" --data-urlencode "q=<topic, name or venue>"`
2. For each match: name, what they run (recent event titles), how often, typical turnout, venues they've used, link (Luma/Meetup page).
3. To reach a lead, point to the community's public page. Don't guess personal contact details.
4. Suggest collaboration when it fits, e.g. two communities that use the same venue or run similar events.
