// Smoke-test a running deployment from the outside.
//   npx tsx scripts/smoke.ts https://<public-url>
// Exits non-zero if any check fails. Creates one throwaway account (smoke+<time>@example.com).
import WebSocket from "ws";

const base = (process.argv[2] ?? process.env.PUBLIC_URL ?? "http://localhost:8787").replace(/\/$/, "");
const results: { name: string; ok: boolean; detail: string }[] = [];

async function check(name: string, fn: () => Promise<string>) {
  try {
    results.push({ name, ok: true, detail: await fn() });
  } catch (e) {
    results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function get(path: string, init: RequestInit = {}) {
  const res = await fetch(base + path, { ...init, signal: AbortSignal.timeout(20_000) });
  return { res, text: await res.text() };
}

async function json(path: string, init: RequestInit = {}) {
  const { res, text } = await get(path, init);
  assert(res.ok, `${path} → ${res.status} ${text.slice(0, 120)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

/** Minimal RFC 5545 check: balanced blocks, required properties on each event. */
export function checkIcs(body: string): number {
  const lines = body.replace(/\r?\n[ \t]/g, "").split(/\r?\n/).filter(Boolean);
  assert(lines[0] === "BEGIN:VCALENDAR" && lines.at(-1) === "END:VCALENDAR", "not wrapped in VCALENDAR");
  assert(lines.some((l) => l.startsWith("VERSION:2.0")), "missing VERSION:2.0");
  const stack: string[] = [];
  let events = 0, props = new Set<string>();
  for (const l of lines) {
    const [name, value] = [l.slice(0, l.search(/[:;]/)), l.slice(l.indexOf(":") + 1)];
    if (name === "BEGIN") { stack.push(value); if (value === "VEVENT") props = new Set(); continue; }
    if (name === "END") {
      assert(stack.pop() === value, `unbalanced END:${value}`);
      if (value === "VEVENT") {
        for (const p of ["UID", "DTSTART", "SUMMARY"]) assert(props.has(p), `event ${events + 1} missing ${p}`);
        events++;
      }
      continue;
    }
    assert(l.includes(":"), `bad line: ${l.slice(0, 60)}`);
    props.add(name);
  }
  assert(stack.length === 0, "unclosed block");
  return events;
}

const CONTACT_KEY = /^(phone|email|contact|contacts|.*_(phone|email))$/i;
function contactKeys(v: unknown, path = ""): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => contactKeys(x, `${path}[${i}]`));
  if (v && typeof v === "object")
    return Object.entries(v).flatMap(([k, x]) => [...(CONTACT_KEY.test(k) ? [`${path}.${k}`] : []), ...contactKeys(x, `${path}.${k}`)]);
  return [];
}

function wsOpens(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(base.replace(/^http/, "ws") + path);
    const done = (ok: boolean) => { clearTimeout(t); ws.removeAllListeners(); ws.on("error", () => {}); ws.terminate(); resolve(ok); };
    const t = setTimeout(() => done(false), 10_000);
    ws.on("open", () => done(true));
    ws.on("unexpected-response", () => done(false));
    ws.on("error", () => done(false));
  });
}

async function main() {
  await check("GET / renders", async () => {
    const { res, text } = await get("/");
    assert(res.ok && /<html/i.test(text), `status ${res.status}`);
    return text.match(/<title>([^<]*)/)?.[1] ?? "html";
  });
  await check("GET /api/stats", async () => JSON.stringify(await json("/api/stats")).slice(0, 120));
  await check("GET /api/events", async () => {
    const body = await json("/api/events?limit=5");
    const list = (Array.isArray(body) ? body : body.events) as unknown[];
    assert(Array.isArray(list) && list.length > 0, "no events");
    return `${list.length} events`;
  });
  await check("GET /events.ics parses", async () => {
    const { res, text } = await get("/events.ics");
    assert(res.ok, `status ${res.status}`);
    assert(/text\/calendar/.test(res.headers.get("content-type") ?? ""), `content-type ${res.headers.get("content-type")}`);
    return `${checkIcs(text)} VEVENTs`;
  });

  let token = "";
  await check("POST /api/join → token", async () => {
    const body = await json("/api/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `smoke+${Date.now()}@example.com`, password: `smoke-${Date.now()}-pw`, display_name: `Smoke Test ${Date.now()}`, community: "Smoke Tests" })
    });
    token = String(body.token ?? "");
    assert(token, "no token in response");
    return "token received";
  });
  await check("GET /api/me with token", async () => {
    assert(token, "no token");
    const me = await json("/api/me", { headers: { authorization: `Bearer ${token}` } });
    return `can_post=${String(me.can_post ?? (me as { profile?: { can_post?: unknown } }).profile?.can_post)}`;
  });
  await check("search: 80 near Old Street, Thu 29 Oct 18:30–21:30", async () => {
    assert(token, "no token");
    const q = new URLSearchParams({ near: "Old Street", headcount: "80", start: "2026-10-29T18:30:00+00:00", end: "2026-10-29T21:30:00+00:00" });
    const body = await json(`/api/venues/search?${q}`, { headers: { authorization: `Bearer ${token}` } });
    const venues = body.venues as { name: string }[];
    assert(Array.isArray(venues) && venues.length > 0, "no venues");
    const leaked = contactKeys(body);
    assert(leaked.length === 0, `contact fields in response: ${leaked.slice(0, 3).join(", ")}`);
    return `${venues.length} venues, top: ${venues[0]!.name}; no contact fields`;
  });

  await check("/phone hidden without key", async () => {
    const { res } = await get("/phone");
    assert(res.status === 404 || res.status === 403, `status ${res.status} (PHONE_KEY not set?)`);
    return String(res.status);
  });
  await check("/ is one button: Add Mates Rates to Grok Bot", async () => {
    const { text } = await get("/");
    const links = [...text.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1]!);
    assert(links.length === 1, `${links.length} links`);
    assert(/^https:\/\/|^\/setup\.html$/.test(links[0]!), `href ${links[0]}`);
    assert(/Add Mates Rates to Grok Bot/.test(text), "no button text");
    assert(!/<form|type="password"|type="search"/i.test(text), "has a form, search or sign-in");
    return links[0]!;
  });
  // Grok Bot is the only interface: no web dashboard.
  for (const path of ["/events", "/venues", "/venues/00000000-0000-0000-0000-000000000000", "/people", "/add", "/account", "/signin", "/communities"]) {
    await check(`dashboard ${path} → 404`, async () => {
      const { res } = await get(path, { redirect: "manual" });
      assert(res.status === 404, `status ${res.status}`);
      return "404";
    });
  }
  await check("WebSocket /twilio/stream upgrades", async () => {
    assert(await wsOpens("/twilio/stream"), "upgrade failed");
    return "open";
  });

  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  —  ${r.detail}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed against ${base}`);
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
