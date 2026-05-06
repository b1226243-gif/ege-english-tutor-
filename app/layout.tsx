import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { SessionProvider } from "next-auth/react";

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
  title: "EGE English Tutor",
  description:
    "AI tutor for the Russian Unified State Exam (EGE) in English — strict FIPI 2024/25 scoring, Socratic feedback.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
        <SessionProvider>
          <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur">
            <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
              <Link href="/" className="font-semibold tracking-tight">
                EGE English Tutor
              </Link>
              <nav className="flex items-center gap-4 text-sm">
                <Link
                  href="/dashboard/writing"
                  className="hover:underline underline-offset-4"
                >
                  Writing
                </Link>
                <Link
                  href="/dashboard/speaking"
                  className="hover:underline underline-offset-4"
                >
                  Speaking
                </Link>
                <Link
                  href="/sign-in"
                  className="hover:underline underline-offset-4"
                >
                  Sign in
                </Link>
              </nav>
            </div>
          </header>
          <main className="flex-1 flex flex-col">{children}</main>
          <footer className="border-t border-zinc-200 dark:border-zinc-800 py-4 text-center text-xs text-zinc-500">
            Built with Next.js · Vercel AI SDK · Drizzle · Auth.js
          </footer>
        </SessionProvider>
      </body>
    </html>
  );
}
