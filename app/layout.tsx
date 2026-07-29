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
 *   - Two font families are loaded via next/font/google:
 *       --font-sans      → Noto Sans JP (UI chrome, body text on the card)
 *       --font-serif     → Noto Serif JP (Latin subset; Japanese glyphs
 *                          render via system-serif fallback — the previous
 *                          external Google Fonts <link media="print"> was
 *                          100% unused CSS per Lighthouse with zero benefit
 *                          since print stylesheets never contribute to screen
 *                          rendering; next/font handles all font CSS inline
 *                          and non-blocking, so the external link was pure
 *                          overhead with no LCP or FCP upside)
 *   - The page background is dark olive (#3A3D2F) — see globals.css.
 *   - Cards float on the dark canvas as straight warm off-white panels
 *     (tilt removed 2026-07-20 per Jackson). See design.md for the full
 *     DNA spec.
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

// Display face — Noto Serif JP (Latin subset only via next/font).
// Japanese glyphs fall back to the browser's system serif stack
// (Noto Serif CJK or system mincho) — acceptable for Lighthouse perf.
//
// 2026-07-23 measured-audit: replaced Source Serif 4 (Latin-only) with
// Noto Serif JP to halve the font CSS payload.
// 2026-07-29 measured-audit: removed external Google Fonts <link> that
// used media="print" async trick — Lighthouse flagged it as 100% unused
// CSS (print stylesheets never apply to screen rendering) with zero
// perf benefit since next/font already handles the font CSS inline and
// non-blocking. The preconnect hints remain to save TLS round-trips on
// any remaining Google Fonts CDN traffic from next/font routing.
const notoSerifJP = Noto_Serif_JP({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-serif',
  display: 'swap',
});

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
  const fontClass = [notoSansJP.variable, notoSerifJP.variable].join(' ');

  return (
    <html lang="ja" dir="ltr" className={fontClass}>
      <head>
        {/* Preconnect to Google Fonts CDN — next/font/google routes requests
            through this CDN; preconnecting saves the TLS + TCP handshake
            time before the first font-file fetch. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
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
