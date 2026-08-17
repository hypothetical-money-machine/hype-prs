import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";
import { resolveSiteOrigin } from "../lib/server/site-origin";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const origin = resolveSiteOrigin(await headers());

  return {
    applicationName: "Hype PRs",
    description:
      "An action-first GitHub pull request inbox with explainable views, a changed-file tree, and in-app review.",
    icons: {
      apple: "/favicon-v5.png",
      icon: "/favicon-v5.png",
      shortcut: "/favicon-v5.png",
    },
    metadataBase: new URL(origin),
    openGraph: {
      description:
        "See what needs you now. Review pull requests across repositories from one action-first queue.",
      images: [
        {
          alt: "Hype PRs triage queue and code diff",
          height: 909,
          url: new URL("/og.png", origin).toString(),
          width: 1731,
        },
      ],
      siteName: "Hype PRs",
      title: "Hype PRs — the pull request pulse",
      type: "website",
    },
    title: "Hype PRs — the pull request pulse",
    twitter: {
      card: "summary_large_image",
      description:
        "See what needs you now. Review pull requests across repositories from one action-first queue.",
      images: [new URL("/og.png", origin).toString()],
      title: "Hype PRs — the pull request pulse",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <Script src="/theme-init.js" strategy="beforeInteractive" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
