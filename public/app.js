// Mates Rates landing page. No build step: plain ES module.
// Pure helpers are exported for tests; the DOM code only runs in a browser.

const TZ = "Europe/London";
const DATE_REASON = /^(today|tomorrow|tonight|this \w+day|next \w+day|(mon|tue|wed|thu|fri|sat|sun) \d{1,2} [a-z]{3,4})$/i;

/** "Thu 29 Oct, 18:30" in London time. */
export function formatLondon(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}

function londonDay(date) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/** "Today" / "Tomorrow" by London calendar day, else "". */
export function relativeDay(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = londonDay(d) - londonDay(now);
  return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : "";
}

export function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Accepts the API's snake_case rows or the seed file's camelCase rows. */
export function normaliseEvent(r) {
  return {
    title: r.title ?? "Untitled event",
    url: safeUrl(r.url),
    startsAt: r.starts_at ?? r.startsAt,
    venueName: r.venue_name ?? r.venueName ?? null,
    area: r.area ?? null,
    address: r.address ?? null,
    reasons: Array.isArray(r.reasons) ? r.reasons.filter((x) => typeof x === "string") : [],
  };
}

export function eventsFrom(json) {
  const list = Array.isArray(json) ? json : json?.events;
  return Array.isArray(list) ? list.map(normaliseEvent) : [];
}

/** Reasons worth showing as chips: the date and venue are shown elsewhere on the card. */
export function chipReasons(reasons) {
  return reasons.filter((r) => !DATE_REASON.test(r.trim()) && !r.startsWith("At ") && r !== "Venue shown after registering");
}

export function postcodeDistrict(address) {
  const m = /\b([A-Z]{1,2}\d[A-Z\d]?) ?\d[A-Z]{2}\b/.exec(address ?? "");
  return m ? m[1] : null;
}

/** "Granola · Shoreditch": the API's area, else the ranker's "At <venue>, <area>" reason, else the postcode district. */
export function whereLine(ev) {
  const at = ev.reasons.find((r) => r.startsWith("At "));
  const area = ev.area ?? (at && at.includes(", ") ? at.slice(at.lastIndexOf(", ") + 2) : postcodeDistrict(ev.address));
  const venue = ev.venueName ?? (at && at.includes(", ") ? at.slice(3, at.lastIndexOf(", ")) : null);
  if (venue && area && venue !== area) return `${venue} · ${area}`;
  if (venue || area) return venue ?? area;
  return ev.reasons.includes("Venue shown after registering") ? "Venue shown after registering" : "Venue to be confirmed";
}

export function feedUrls(icsUrl, pageHref) {
  const https = new URL(icsUrl || "/events.ics", pageHref).href;
  return { https, webcal: https.replace(/^https?:/, "webcal:") };
}

const STAT_KEYS = {
  venues: ["venues"],
  communities: ["communities"],
  events: ["events"],
  past_hosts: ["past_hosts", "pastHosts", "hosts", "venue_hosts"],
};

/** Map /api/stats to the four tiles; missing numbers stay null. */
export function pickStats(json) {
  const src = json?.stats ?? json ?? {};
  const out = {};
  for (const [k, names] of Object.entries(STAT_KEYS)) {
    const v = names.map((n) => src[n]).find((x) => Number.isFinite(Number(x)) && x !== null && x !== "");
    out[k] = v === undefined ? null : Number(v);
  }
  return out;
}

// ---------------------------------------------------------------------------

if (typeof document !== "undefined") main();

function main() {
  const params = new URLSearchParams(location.search);
  const mock = params.get("mock");
  const MOCK = { "/api/events?limit=12": "dev-fixtures/events.json", "/api/stats": "dev-fixtures/stats.json" };
  const $ = (id) => document.getElementById(id);

  async function getJSON(path) {
    if (mock === "error") throw new Error("mock error");
    const url = mock ? MOCK[path] ?? path : path;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    const json = await res.json();
    if (mock === "empty" && path.startsWith("/api/events")) return [];
    return json;
  }

  async function loadConfig() {
    let file = {};
    try {
      const res = await fetch("/config.json", { cache: "no-store" });
      if (res.ok) file = await res.json();
    } catch { /* no config yet */ }
    window.MATES_RATES = { icsUrl: "/events.ics", ...(window.MATES_RATES ?? {}), ...file };
    return window.MATES_RATES;
  }

  function setupLinks(cfg) {
    const bot = $("open-bot");
    const botUrl = safeUrl(cfg.grokBotUrl);
    if (botUrl) {
      bot.href = botUrl;
      bot.target = "_blank";
      bot.rel = "noopener";
    } else {
      bot.href = "#";
      bot.setAttribute("aria-disabled", "true");
      bot.setAttribute("aria-describedby", "bot-note");
      bot.addEventListener("click", (e) => e.preventDefault());
      $("bot-note").hidden = false;
    }

    const feed = feedUrls(cfg.icsUrl, location.href);
    $("ics-webcal").href = feed.webcal;
    $("ics-https").value = feed.https;
    $("ics-https").addEventListener("focus", (e) => e.target.select());

    const status = $("copy-status");
    let timer;
    $("copy-ics").addEventListener("click", async () => {
      let ok = false;
      try {
        await navigator.clipboard.writeText(feed.https);
        ok = true;
      } catch {
        $("ics-https").select();
        ok = document.execCommand?.("copy") ?? false;
      }
      status.textContent = ok ? "Link copied." : "Select the link and copy it.";
      clearTimeout(timer);
      timer = setTimeout(() => (status.textContent = ""), 3000);
    });
  }

  async function loadStats() {
    const grid = $("stats");
    try {
      const stats = pickStats(await getJSON("/api/stats"));
      if (Object.values(stats).every((v) => v === null)) throw new Error("no numbers");
      for (const [k, v] of Object.entries(stats)) {
        grid.querySelector(`[data-stat="${k}"]`).textContent = v === null ? "—" : v.toLocaleString("en-GB");
      }
      grid.setAttribute("aria-busy", "false");
    } catch {
      grid.hidden = true;
      $("stats-error").hidden = false;
    }
  }

  function renderEvent(ev, i) {
    const li = $("event-tpl").content.firstElementChild.cloneNode(true);
    li.querySelector(".ev__rank").textContent = `#${i + 1}`;
    const time = li.querySelector(".ev__date");
    time.textContent = formatLondon(ev.startsAt);
    time.dateTime = ev.startsAt ?? "";
    li.querySelector(".ev__rel").textContent = relativeDay(ev.startsAt);
    const a = li.querySelector(".ev__title a");
    a.textContent = ev.title;
    if (ev.url) a.href = ev.url;
    else a.replaceWith(document.createTextNode(ev.title));
    li.querySelector(".ev__where").textContent = whereLine(ev);
    const chips = li.querySelector(".ev__chips");
    for (const r of chipReasons(ev.reasons)) {
      const c = document.createElement("li");
      c.textContent = r;
      if (r === "Free") c.className = "is-free";
      if (r === "Hackathon") c.className = "is-hack";
      chips.append(c);
    }
    if (!chips.children.length) chips.remove();
    return li;
  }

  function showState(title, text, action) {
    const box = $("events-state");
    box.replaceChildren();
    const p = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = title;
    p.append(strong, text);
    box.append(p);
    if (action) box.append(action);
  }

  async function loadEvents() {
    const list = $("events-list");
    $("events-state").replaceChildren();
    list.setAttribute("aria-busy", "true");
    list.replaceChildren(...Array.from({ length: 6 }, () => {
      const li = document.createElement("li");
      li.className = "ev ev--skeleton";
      li.setAttribute("aria-hidden", "true");
      li.innerHTML = "<span></span><span></span><span></span>";
      return li;
    }));
    try {
      const events = eventsFrom(await getJSON("/api/events?limit=12")).slice(0, 12);
      list.replaceChildren(...events.map(renderEvent));
      if (!events.length) {
        const a = document.createElement("a");
        a.className = "btn btn--ghost";
        a.href = $("ics-webcal").href;
        a.textContent = "Subscribe for when they land";
        showState("No ranked events yet.", "The feed refreshes from Luma, Meetup, Devpost and BuilderBase.", a);
      }
    } catch {
      list.replaceChildren();
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn btn--ghost";
      retry.textContent = "Try again";
      retry.addEventListener("click", loadEvents);
      showState("Couldn’t load events.", "The events service didn’t answer. The calendar feed may still work.", retry);
    } finally {
      list.setAttribute("aria-busy", "false");
    }
  }

  loadConfig().then(setupLinks);
  loadStats();
  loadEvents();
}
