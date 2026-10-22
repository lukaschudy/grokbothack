import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mates Rates — free venues for London communities",
  description: "Free venues for London communities, sorted by mates. Ask the shared Grok Bot."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
