import { PhoneLine } from "./phone-line";

export const metadata = { title: "Venue line · Roomline" };

export default async function PhonePage({ searchParams }: { searchParams: Promise<{ line?: string }> }) {
  const { line } = await searchParams;
  return <PhoneLine lineName={line ?? "Bookings line"} />;
}
