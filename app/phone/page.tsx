import { notFound } from "next/navigation";
import { PhoneLine } from "./phone-line";

export const metadata = { title: "Venue line · Mates Rates" };

export default async function PhonePage({ searchParams }: { searchParams: Promise<{ line?: string; key?: string }> }) {
  const { line, key } = await searchParams;
  if (process.env.PHONE_KEY && key !== process.env.PHONE_KEY) notFound();
  return <PhoneLine lineName={line ?? "Bookings line"} />;
}
