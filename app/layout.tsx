import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pumpmarket — Crypto Prediction Market",
  description:
    "A paper-trading prediction market for BTC, ETH, and 8 other coins, streamed in real time from Pyth Network.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter+Tight:wght@400;500;600;700&family=Open+Sans:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
