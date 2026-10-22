import type { Metadata } from "next";
import Link from "next/link";
import { currentMember } from "@/lib/session";
import { NavLink } from "./components/nav-link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mates Rates — free venues for London communities",
  description: "Ask the shared Grok Bot for a free London venue. Organisers vouch for each other, every field shows its source, and the assistant can ring the venue for you."
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const me = await currentMember();
  return (
    <html lang="en-GB">
      <body>
        <header className="account-header">
          <div className="account-navigation">
            <Link className="account-brand" href="/" aria-label="Mates Rates — home">
              <span className="account-wordmark">Mates Rates</span>
              <span className="account-brand-credit">London venues, sorted by mates</span>
            </Link>
            <nav className="account-navigation-links" aria-label="Main navigation">
              <NavLink href="/#find">Find a room</NavLink>
              <NavLink href="/venues">Venues</NavLink>
              <NavLink href="/events">Events</NavLink>
              <NavLink href="/people">People</NavLink>
              <NavLink href="/add" className="account-session">Add a venue</NavLink>
              {me ? (
                <NavLink href="/account" className="account-session">{me.display_name}</NavLink>
              ) : (
                <NavLink href="/signin" className="account-session">Sign in</NavLink>
              )}
            </nav>
          </div>
        </header>
        {children}
        <footer className="site-foot">
          <span>
            Open data for London&apos;s tech communities. All times Europe/London.{" "}
            <a className="link" href="https://github.com/lukaschudy/grokbothack" rel="noreferrer">Open source (MIT) on GitHub</a>
          </span>
          <span>Built at the Grok Bot Community Engineering Hackathon, 22 Oct 2026.</span>
        </footer>
      </body>
    </html>
  );
}
