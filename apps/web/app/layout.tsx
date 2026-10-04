import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Attest — control centre",
  description:
    "A read-only view of an Attest Project World: what an autonomous agent understood, planned, changed, broke, repaired, and verified.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-[--color-ink-800] bg-[--color-ink-900]/80 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto max-w-6xl px-6 py-3 flex items-center gap-6">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="mono text-[--color-accent] font-semibold tracking-tight text-lg">attest</span>
              <span className="text-xs text-[--color-ink-400]">control centre</span>
            </Link>
            <nav className="ml-auto flex items-center gap-5 text-sm text-[--color-ink-300]">
              <Link href="/" className="hover:text-[--color-ink-100]">
                Dashboard
              </Link>
              <Link href="/audit" className="hover:text-[--color-ink-100]">
                Audit
              </Link>
              <Link href="/tools" className="hover:text-[--color-ink-100]">
                Tools
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-6 py-10 text-xs text-[--color-ink-400]">
          Read-only. The verdicts shown here are computed by executing the project&apos;s own checks — never
          by asking a model whether it succeeded.
        </footer>
      </body>
    </html>
  );
}
