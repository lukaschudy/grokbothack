export const dynamic = "force-dynamic";

/** The Grok Bot public template link (it adds the agent), read at request time; else the setup guide. */
function botUrl(): string {
  try {
    const u = new URL(process.env["NEXT_PUBLIC_GROK_BOT_URL"] ?? "");
    if (u.protocol === "https:") return u.href;
  } catch {}
  return "/setup.html";
}

export default function Home() {
  return (
    <main className="landing">
      <a className="oval" href={botUrl()} aria-label="Add Mates Rates to Grok Bot: free venues for London communities">
        Add Mates Rates to Grok Bot
      </a>
    </main>
  );
}
