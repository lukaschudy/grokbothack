import type { Metadata } from "next";
import Link from "next/link";
import { currentMember } from "@/lib/session";
import { NavLink } from "./components/nav-link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roomline — London venues, vouched for by organisers",
  description: "Find a free or bookable London venue in seconds. Posted and vouched for by the organisers who've hosted there."
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const me = await currentMember();
  return (
    <html lang="en-GB">
      <body>
        <header className="account-header">
          <div className="account-navigation">
            <Link className="account-brand" href="/" aria-label="Roomline — home">
              <span className="account-wordmark">Roomline</span>
              <span className="account-brand-credit">London venues, vouched for</span>
            </Link>
            <nav className="account-navigation-links" aria-label="Main navigation">
              <NavLink href="/">Find a room</NavLink>
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
          <span>Open data for London&apos;s tech communities. All times Europe/London.</span>
          <span>Built at the Grok Bot Community Engineering Hackathon, 22 Oct 2026.</span>
        </footer>
      </body>
    </html>
  );
}
