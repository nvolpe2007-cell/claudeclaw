import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nudge",
  description: "A little dare to break a small social norm — then share the proof.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            <span className="brand-mark">✨</span> Nudge
          </Link>
          <nav className="site-nav">
            <Link href="/">Today's nudge</Link>
            <Link href="/feed">Feed</Link>
          </nav>
        </header>
        <main className="site-main">{children}</main>
        <footer className="site-footer">
          Be kind out there — nudges are meant to be harmless and fun.
        </footer>
      </body>
    </html>
  );
}
