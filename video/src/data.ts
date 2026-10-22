// Everything the video shows. Swap BRAND to rename the product in one place.
export const BRAND = "Roomline";
export const TAGLINE = "London venues, vouched for";
export const SITE = "roomline.london";
export const REPO = "github.com/lukaschudy/grokbothack";

export const FPS = 30;

// Fictional organisers.
export const ADA = { name: "Ada Okafor", first: "Ada", community: "Agents & Coffee" };
export const BEN = { name: "Ben Hart", first: "Ben", community: "Rust Hoxton" };
export const CARA = { name: "Cara Lin", first: "Cara", community: "Data Dumplings" };

export const QUERY = "free space for 80 next Thursday near Old Street";
export const WINDOW = "Thu 29 Oct, 18:30–21:30";

// The venue that gets called is fictional, so the call never puts words in a real venue's mouth.
export const CALLED = {
  name: "Kiln Lane Studios",
  area: "Hoxton",
  address: "14 Kiln Lane, N1",
  luma: "lu.ma/agents-coffee-oct",
  lumaEvent: "Agents & Coffee #12: Evals in prod",
  lumaDate: "2026-10-08",
  went: 94,
  phone: "020 7946 0182"
};

// Real venues from the seed data (evidence: events that happened there).
export type VenueRow = { name: string; kind: string; area: string; reasons: string[]; callable: boolean; address: string; distance: number; bearing: number };
export const RESULTS: VenueRow[] = [
  {
    name: CALLED.name, kind: "Bookable", area: CALLED.area, address: CALLED.address, callable: true, distance: 650, bearing: 20,
    reasons: ["Fits 120 — you need 80", "650 m from Old Street", "Hosted Agents & Coffee, Rust Hoxton", "Free for community events", "OK to call: we can check the date now"]
  },
  {
    name: "Civo Tech Junction", kind: "Company office", area: "Old Street", address: "32-37 Cowper St, EC2A 4AW", callable: false, distance: 117, bearing: 100,
    reasons: ["Seen hosting 180", "120 m from Old Street", "Hosted Cloud Native London, DevSecOps London Gathering and 1 more", "Company office — ask a past host for an intro"]
  },
  {
    name: "Code Node", kind: "Venue", area: "Moorgate", address: "10 South Pl, EC2M 7EB", callable: false, distance: 710, bearing: 179,
    reasons: ["Seen hosting 147", "700 m from Old Street", "Hosted Redis London, Cerebral Valley and 1 more", "Terms not confirmed yet"]
  }
];

// Real event on the same evening (Luma).
export const CLASH = "Is AI making us less creative?: An Oxford-style debate (The Founder-writer Collective), 126 going, runs the same evening at Granola, Shoreditch.";

// Real upcoming events and their ranking reasons (data/seed/events.json, 22 Oct).
export const EVENTS: { when: string; source: string; title: string; reasons: string[]; score: string }[] = [
  { when: "Thu 22 Oct, 17:00", source: "Luma", title: "Agentic AI in Financial Services and Insurance: Pilot to Production", reasons: ["Today", "Free", "139 going", "Run by Future Forward, 4 past events", "At IFX Payments, St Paul's"], score: "9.2" },
  { when: "Wed 4 Nov, 17:30", source: "Luma", title: "HACKATHON - Agent Eval Harness", reasons: ["Wed 4 Nov", "Hackathon", "Free", "72 going", "Run by The Friendly Data Meetup London, 3 past events"], score: "8.6" },
  { when: "Thu 22 Oct, 18:00", source: "Luma", title: "Grok Bot Community Engineering London Hackathon", reasons: ["Today", "Hackathon", "Free", "Run by SpaceXAI for London, England, 18 past events"], score: "8.5" },
  { when: "Thu 29 Oct, 18:30", source: "Luma", title: "Is AI making us less creative?: An Oxford-style debate", reasons: ["Next Thursday", "Free", "126 going", "Run by The Founder-writer Collective, 7 past events", "At Granola, Shoreditch"], score: "8.5" },
  { when: "Wed 28 Oct, 18:00", source: "Luma", title: "Lychee's Startup Games Night", reasons: ["Next Wednesday", "Free", "115 going", "Run by Lychee, 13 past events"], score: "8.5" }
];

export type Line = { who: "agent" | "venue"; text: string };
export const CALL_SCRIPT: Line[] = [
  { who: "agent", text: `Hi, this is ${BRAND}, an AI assistant calling for Ada from Agents & Coffee. This call is recorded. Is now a good time to check a date?` },
  { who: "venue", text: "Sure, Sam here, I run events. Go ahead." },
  { who: "agent", text: "Is your main room free next Thursday, the 29th, from 6:30 to 9:30, for about 80 people?" },
  { who: "venue", text: "Yes, that evening's free. It takes 120 standing, so 80's fine." },
  { who: "agent", text: "Great. Is there a charge for community events?" },
  { who: "venue", text: "No, it's free for tech meetups. We need the guest list 48 hours before, and everyone out by half nine." },
  { who: "agent", text: "Perfect, I've noted that. Ada will email you today. Thanks Sam, bye!" },
  { who: "venue", text: "Cheers, bye." }
];

export const RESULT = {
  heading: `Free · ${WINDOW}`,
  rows: [
    ["Fits", "120 people"],
    ["Price", "Free for tech meetups"],
    ["Conditions", "Guest list 48 hours before; out by 21:30"],
    ["To book", "Email the events inbox with date and headcount"],
    ["Confirmed by", "Sam, events · 19:42 by phone"]
  ] as [string, string][]
};

export const STATS = [
  ["143", "London venues, seeded from events that actually happened there"],
  ["389", "past events as evidence of who hosted where"],
  ["1 call", "answers every organiser who asks about that evening"]
] as const;
