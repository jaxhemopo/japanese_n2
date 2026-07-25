/**
 * app/layout.tsx — Root layout for the N2 Daily Mock Exam webapp.
 *
 * Responsibilities:
 *   - Renders the HTML shell with lang="ja" (Japanese primary audience)
 *   - Provides the <html> and <body> wrappers that Next.js App Router requires
 *   - Accepts the root `children` prop (each page's content)
 *   - Sets base metadata (title, description, favicon via the Metadata API)
 *
 * Auth is NOT touched here — middleware refreshes the session and each
 * page reads it as needed. (A leftover unused getSession() call was
 * removed 2026-07-23; it cost a Supabase roundtrip on every request.)
 *
 * Visual layer:
 *   - Three font families are loaded via next/font/google:
 *       --font-sans      → Noto Sans JP (UI chrome, body text on the card)
 *       --font-serif     → Noto Serif JP (Latin + CJK display: masthead, H1, H2, italic quotes)
 *       --font-serif-jp  → Noto Serif JP (same family; --font-serif handles both roles)
 *   Note: Source Serif 4 Latin-only was replaced by Noto Serif JP on 2026-07-23
 *   measured-audit (pass 1) to halve the Google Fonts CSS payload (3 families → 2),
 *   directly addressing render-blocking-resources and LCP regressions.
 *   - The page background is dark olive (#3A3D2F) — see globals.css.
 *   - Cards float on the dark canvas as tilted warm off-white panels.
 *     See design.md for the full DNA spec.
 */

import type { Metadata } from 'next';
import {
  Noto_Sans_JP,
  Noto_Serif_JP,
} from 'next/font/google';
import './globals.css';

// Body / UI face — Noto Sans JP. UI chrome, lede, body text.
// Weights 400 + 500 cover all UI usage (body, labels, buttons).
// 2026-07-23 measured-audit: reduced 400/500/700 → 400/500 to cut font CSS size.
const notoSansJP = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-sans',
  display: 'swap',
});

// Display face — Noto Serif JP (Latin + CJK). Handles all serif display
// (masthead, H1, H2, italic quotes, kicker lines) for both Latin and Japanese.
// 2026-07-23 measured-audit: replaced Source Serif 4 (Latin-only) with Noto Serif JP
// to halve Google Fonts CSS payload. Removed Source Serif 4's weight 600/700
// (not used in UI). Kept weight 400/500/600 to cover all display elements.
const notoSerifJP = Noto_Serif_JP({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-serif',
  display: 'swap',
});

// --font-serif-jp is aliased to --font-serif via an inline custom property
// on <html> (see below). 2026-07-24: the previous second Noto_Serif_JP()
// instance was byte-identical to notoSerifJP (same family/subset/weights,
// different CSS variable only) — next/font instantiated and shipped the
// same font twice, undercutting the 2026-07-23 "halve the font payload"
// pass. One instance, two variable names, zero visual change.

export const metadata: Metadata = {
  title: {
    default: 'N2 Daily Mock Exam',
    template: '%s | N2 Daily Mock Exam',
  },
  description:
    'Daily N2-level Japanese mock exam — 5 questions, 3 categories, every morning.',
  icons: {
    icon: '/favicon.ico',
  },
};

/**
 * RootLayout — renders the HTML shell only; no data fetching.
 *
 * The body has no inline font-family; component-level CSS uses the
 * font-family tokens (var(--font-sans) / var(--font-serif)) so each
 * element type picks its own face per design.md.
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const fontClass = [
    notoSansJP.variable,
    notoSerifJP.variable,
  ].join(' ');

  return (
    <html
      lang="ja"
      dir="ltr"
      className={fontClass}
      // Alias the legacy --font-serif-jp token to --font-serif so every
      // component that still references it keeps working without loading
      // the same font a second time.
      style={{ ['--font-serif-jp' as string]: 'var(--font-serif)' } as React.CSSProperties}
    >
      <head>
        {/* Preconnect to Supabase — saves ~200-400ms on every server response by
           establishing the TCP/TLS connection before the auth session request fires.
           Targets document-latency-insight (observed 3592ms server round-trip). */}
        <link rel="preconnect" href="https://ucppuzfyjrtcchdhwxto.supabase.co" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://ucppuzfyjrtcchdhwxto.supabase.co" />
      </head>
      <body>{children}</body>
    </html>
  );
}
