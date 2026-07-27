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
 *       --font-serif     → Noto Serif JP Latin subset (masthead, Latin
 *                          H1/H2, IssueMeta digits, pull-quotes Latin)
 *   - The Japanese subset of Noto Serif JP is loaded via a plain
 *     <link rel="stylesheet"> to fonts.googleapis.com — Next.js 14.2's
 *     next/font/google type def only allows 'latin' subset for
 *     Noto_Serif_JP (verified in node_modules/.../@next/font/dist/google/
 *     index.d.ts), so we layer the Japanese glyphs on top via the
 *     plain Google Fonts CSS route. Google Fonts returns multiple
 *     @font-face blocks with unicode-range, so the browser only
 *     downloads a Japanese subset when Japanese characters are rendered
 *     on the page — pages with no Japanese display text (none currently)
 *     pay only the CSS overhead (~1KB), not the font file bytes.
 *
 *     2026-07-27 gap-killer: prior to this pass, --font-serif only
 *     loaded the Latin subset, so Japanese display text (e.g.,
 *     /today NoMockToday's "今日のモックはまだありません" H2, italic
 *     closing notes, /revision question prompts) was rendering in
 *     Noto Sans JP via font-fallback cascade (system serif → no
 *     Japanese glyphs → inherited sans). Now 'Noto Serif JP' is added
 *     to the font-family stack on every serif CSS rule (31 rules),
 *     so hiragana/katakana/kanji display text renders in true mincho
 *     serif. The duplicate --font-serif-jp variable was removed (no
 *     CSS rule referenced it).
 *
 *   Source Serif 4 (Latin-only) was already replaced by Noto Serif JP
 *   on 2026-07-23 measured-audit to halve the Google Fonts payload.
 *
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

// Display face — Noto Serif JP (Latin subset). Handles serif display
// for Latin text (masthead, Latin H2 on /progress / /revision / /result,
// IssueMeta digits, Latin pull-quotes). The Japanese subset is loaded
// separately via the <link> below.
//
// 2026-07-23 measured-audit: replaced Source Serif 4 (Latin-only) with
// Noto Serif JP to halve Google Fonts CSS payload (3 families → 2).
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
  const fontClass = [
    notoSansJP.variable,
    notoSerifJP.variable,
  ].join(' ');

  return (
    <html lang="ja" dir="ltr" className={fontClass}>
      <head>
        {/* 2026-07-27 gap-killer: load the Japanese subset of Noto Serif JP
            via plain Google Fonts CSS. Next.js 14.2 next/font/google only
            accepts subsets: ['latin'] for Noto_Serif_JP (type def restriction
            in node_modules/@next/font/dist/google/index.d.ts), so we layer
            the Japanese glyphs on top via this <link>. Google Fonts CSS
            returns multiple @font-face blocks with unicode-range declarations,
            so the browser only downloads a subset when a character in its
            range is rendered — pages without Japanese display text pay only
            the CSS overhead, not the font file bytes. display=swap prevents
            render blocking. weights match the next/font instance (400/500/600)
            so visual weight is consistent between Latin (next/font) and
            Japanese (Google Fonts <link>) glyphs. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;500;600&display=swap"
        />
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
