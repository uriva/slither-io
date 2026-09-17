import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Slither.io — Cyber Serpent Arena | Deno Next.js",
  description: "Next-generation Slither.io remake by @urivalev. Slither, boost, eat glowing orbs, outmaneuver rivals, and dominate the arena leaderboard!",
  keywords: ["slither.io", "next.js", "deno", "game", "canvas", "serpent", "snake"],
  authors: [{ name: "Uri Valevski", url: "https://x.com/urivalev" }],
  creator: "@urivalev",
  openGraph: {
    title: "Slither.io — Cyber Serpent Arena",
    description: "Next-generation Slither.io remake by @urivalev",
    url: "https://slither-io-cyber-serpent-arena.mindblown.ai/",
    siteName: "Slither.io Arena",
    images: [
      {
        url: "./icon.svg",
        width: 512,
        height: 512,
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Slither.io — Cyber Serpent Arena",
    description: "Next-generation Slither.io remake by @urivalev",
    creator: "@urivalev",
    site: "@urivalev",
  },
  icons: {
    icon: [
      { url: "./icon.svg", type: "image/svg+xml" },
    ],
    apple: "./icon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-[#06070c] text-white overflow-hidden select-none">
        {children}
      </body>
    </html>
  );
}
