<<<<<<< HEAD
import { notFound } from "next/navigation";
=======
import { callMode } from "@/lib/dialer";
>>>>>>> origin/calling
import { PhoneLine } from "./phone-line";

export const metadata = { title: "Venue line · Mates Rates" };

<<<<<<< HEAD
export default async function PhonePage({ searchParams }: { searchParams: Promise<{ line?: string; key?: string }> }) {
  const { line, key } = await searchParams;
  if (process.env.PHONE_KEY && key !== process.env.PHONE_KEY) notFound();
  return <PhoneLine lineName={line ?? "Bookings line"} />;
=======
export default async function PhonePage({ searchParams }: { searchParams: Promise<{ line?: string }> }) {
  const { line } = await searchParams;
  const mode = callMode();
  const offline = mode === "virtual" ? null
    : mode === "scripted" ? "The voice agent is offline (no XAI_API_KEY or CALL_MODE=scripted), so calls play as scripted rehearsals on the call card and won't ring here."
    : "CALL_MODE=twilio: calls go to the venue's real phone, not this screen.";
  return <PhoneLine lineName={line ?? "Bookings line"} offline={offline} />;
>>>>>>> origin/calling
}
