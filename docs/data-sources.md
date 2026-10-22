# Data sources

All free and keyless. Tested 22 Oct 2026. Cache everything and keep to a few calls a minute.

| Source | London volume | Venue data | Use for |
|---|---|---|---|
| Luma discover | 50 per page, ~3 weeks ahead, paginated | ~60% show venue name, address, lat/lng, Google `place_id`; rest hidden until registration. `guest_count` often 0. All categories, needs a tech filter. | Events, venues seen hosting |
| Luma event/get | 1 call per event | Hosts (LinkedIn, X, website), categories, free/paid ticket | Past hosts, communities |
| Luma calendar .ics | Full past + future history per community | `LOCATION` per event | Which communities hosted where |
| Meetup page | ~27 per page | Venue name and address always shown, RSVP counts | Venues, events |
| Devpost (ended) | 250 hits for "london" | Venue in `displayed_location`, `registrations_count`. Goes back to 2015. | Weekend hackathon venue history |
| Devpost (upcoming) | ~2 | Thin | Events |
| BuilderBase | 29 worldwide, 2 London | City only | Events |
| MLH | 1 London | None | Skip |

## Gotchas

- Don't filter London by name: "London, Ontario" appears in Devpost and MLH. Use lat/lng or country = GB.
- No source has phone numbers. Luma's Google `place_id` → Google Places can supply them (key + billing). For now organisers enter them.
- Devpost hackathon subdomains return 403 to plain bots; send a browser User-Agent.
- Luma calendar `.ics` says refresh every 12h.

## Snippets

```sh
# Luma discover (London)
curl -s 'https://api.lu.ma/discover/get-paginated-events?discover_place_api_id=discplace-QCcNk3HXowOR97j&pagination_limit=50' \
  | jq -r '.entries[].event | [.start_at, .name, .geo_address_info.address] | @tsv'
# next page: &pagination_cursor=<next_cursor>

# Luma single event (hosts, categories, tickets)
curl -s 'https://api.lu.ma/event/get?event_api_id=evt-Yz7RR89Zlv56tya' \
  | jq '{name: .event.name, start: .event.start_at, going: .guest_count}'

# Luma calendar .ics (calendar_api_id from the discover feed)
curl -s 'https://api.lu.ma/ics/get?entity=calendar&id=cal-wUKLVX9VWOdVkpg' | grep -E '^(DTSTART|SUMMARY|LOCATION)'

# Devpost
curl -s -g -A 'Mozilla/5.0' 'https://devpost.com/api/hackathons?status[]=ended&search=london' \
  | jq -r '.hackathons[] | [.title, .submission_period_dates, .displayed_location.location, .registrations_count] | @tsv'

# BuilderBase
curl -s 'https://edge.builderbase.com/super-events/public/discovery?status=active&limit=100' \
  | jq -r '.data.events[] | [.start_at, .name, .location.city, .participant_count] | @tsv'

# MLH
curl -sL 'https://mlh.io/seasons/2027/events' | python3 -c "import sys,re,json;p=json.loads(re.search(r'data-page=\"app\" type=\"application/json\">(.*?)</script>',sys.stdin.read(),re.S)[1])['props'];[print(e['startsAt'][:10],e['name'],e['location']) for e in p['upcomingEvents']]"
```

```python
# Meetup (parse embedded Apollo state)
import re, json, urllib.request as u
h = u.urlopen(u.Request('https://www.meetup.com/find/?location=gb--17--London&source=EVENTS&keywords=tech',
                        headers={'User-Agent': 'Mozilla/5.0'})).read().decode()
a = json.loads(re.search(r'__NEXT_DATA__[^>]*>(.*?)</script>', h, re.S)[1])['props']['pageProps']['__APOLLO_STATE__']
events = [v for k, v in a.items() if k.startswith('Event:')]  # title, dateTime, eventType, rsvps.totalCount, venue{name,address}
```
