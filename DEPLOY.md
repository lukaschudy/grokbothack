# Deploy

**Public URL:** https://nrzgvkrbfn3ptoms2ckm4ni6ly.srv.us

One long-lived Node process (Next + call bridge + WebSockets, `server/index.ts`) on port 8787 in a Cloudroom
cloud sandbox, published through an [srv.us](https://srv.us) SSH tunnel. The URL is derived from the sandbox's
SSH key (`~/.ssh/id_ed25519`), so it survives tunnel and server restarts, but not a new sandbox or key.
No serverless: Twilio media streams and the `/phone` line need WebSockets.

Cloudflare quick tunnels don't work from the sandbox (QUIC and TLS on port 7844 are blocked); serveo.net
forwards expire and change URL.

## Redeploy (in the sandbox)

```sh
git pull --no-rebase
npm ci
CIRCLE_NODE_TOTAL=2 npm run build
kill -- -$(cat /tmp/server.pgid)          # stop the old server (process group)
setsid nohup npm start > /tmp/server.log 2>&1 < /dev/null &
npx tsx scripts/smoke.ts https://nrzgvkrbfn3ptoms2ckm4ni6ly.srv.us
```

Tunnel (only if it isn't running: `pgrep -f /tmp/tunnel.sh`): a loop around
`ssh -o ServerAliveInterval=20 -o ExitOnForwardFailure=yes srv.us -R 1:localhost:8787`, started with
`setsid nohup /tmp/tunnel.sh > /tmp/srvus.log 2>&1 &`. It prints the URL to `/tmp/srvus.log`.

## Database

Currently local Postgres 15 + PostGIS on port 54329 (`roomline` database), loaded with
`npm run db:migrate && npm run db:seed:pg`. To switch to Supabase, set `DATABASE_URL` to the session pooler
URI and restart. Supabase already has migrations 001 + 002 and the data; don't re-run them there.

## Environment (`.env.local`, never committed)

| Name | Notes |
| --- | --- |
| `DATABASE_URL` | Postgres + PostGIS |
| `SESSION_SECRET` | signs session tokens |
| `PORT` | 8787 |
| `PUBLIC_URL` | the public URL above (Twilio webhooks, stream URLs) |
| `CALL_MODE` | `scripted` now; `virtual` needs `XAI_API_KEY`; `twilio` needs the Twilio vars |
| `PHONE_KEY` | `/phone`, `/phone/events`, `/phone/stream` need `?key=` |
| `XAI_API_KEY` | voice agent + query parsing (not set) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | `CALL_MODE=twilio` only (not set) |

## Smoke test

`npx tsx scripts/smoke.ts <base-url>` checks `/`, `/api/stats`, `/api/events`, `/events.ics` (parses),
join → token → `/api/me`, search for 80 near Old Street on Thu 29 Oct (venues, no contact fields), `/phone`
hidden without key, and the `/twilio/stream` WebSocket upgrade. Exits non-zero on any failure.
