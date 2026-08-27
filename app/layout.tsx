import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cooldown Caller - an agent that phones you when a cooldown clears",
  description:
    "An autonomous CALL-E agent that watches rate-limited recurring actions on a cron schedule and places a real outbound phone call when it discovers one has become actionable, instead of waiting for you to check a dashboard.",
  openGraph: {
    title: "Cooldown Caller",
    description:
      "Watches recurring-action cooldowns on a cron schedule and calls you when it discovers one has cleared - built on CALL-E.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
