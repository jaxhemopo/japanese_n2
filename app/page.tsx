/**
 * app/page.tsx — Landing page for the N2 Daily Mock Exam webapp.
 *
 * Canonical user flow (goal.md §User-facing flow):
 *   1. Subscriber opens the webapp → lands here.
 *   2. If signed-in: today's mock preview is shown, with a CTA to /today.
 *   3. If not signed-in: a magic-link entry CTA.
 *
 * Server Component — reads auth session server-side (no client flicker).
 *
 * Visual layer (design.md 2026-07-19 rewrite, Felix):
 *   - Dark olive canvas (`--bg`) with a tilted warm off-white card on top.
 *   - Serif display H1, ALL CAPS for English.
 *   - Phone mockup overlapping the bottom-right of the card (decorative,
 *     hidden on mobile).
 *   - Reference: dailydispatch.app.
 */

import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase';
import { computeStreak } from '@/lib/streak';
import { IssueMeta } from '@/components/IssueMeta';
import { TiltedCard } from '@/components/TiltedCard';
import { PhoneMockup } from '@/components/PhoneMockup';
import { NavBar } from '@/components/NavBar';
import { StreakBadge } from '@/components/StreakBadge';

export default async function LandingPage() {
  const supabase = createServerSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // YYYY-MM-DD in JST (sv-SE formats as ISO date) — used for the n2_mocks
  // lookup (DB column is date-typed, keyed by JST day like the rest of the app).
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const { data: todayMock } = await supabase
    .from('n2_mocks')
    .select('date, category_dist, target_tags, created_at')
    .eq('date', today)
    .maybeSingle();

  // Compute issue ordinal from the mock's created_at timestamp.
  // PUBLICATION_START is the first mock date (2026-07-14); every day
  // after that is the next issue. Falls back to today's date string
  // if no mock exists yet (pre-publication or edge case).
  const PUBLICATION_START = new Date('2026-07-14T00:00:00+09:00');
  const todayDate = new Date(`${today}T00:00:00+09:00`);
  const daysSinceStart = Math.round(
    (todayDate.getTime() - PUBLICATION_START.getTime()) / (1000 * 60 * 60 * 24)
  );
  const issueOrdinal = todayMock
    ? String(daysSinceStart + 1)
    : today;

  const straplineText = todayMock
    ? `Issue \u00b7 ${issueOrdinal} \u00b7 The morning paper`
    : `${today} \u00b7 The morning paper`;

  if (session) {
    // Streak badge: design.md §Auth-gated page chrome locks the streak
    // pill at the top-left of the card body, below the IssueMeta strip.
    // The signed-in landing is auth-gated (behind the `if (session)` check)
    // so it follows the same chrome as /today, /progress, /revision, /result.
    // Streak fetch is cheap (single SQL count over n2_attempts) and matches
    // the per-page StreakBadge usage pattern on the other auth-gated pages.
    const streak = await computeStreak(supabase, session.user.id);
    return (
      <TiltedCard>
        <IssueMeta />
        <NavBar current="/" />
        <header className="card-page-header">
          <StreakBadge count={streak} />
        </header>
        <p className="card-tagline card-tagline--above">
          for serious Japanese learners.
        </p>
        <h1 className="card-h1">
          Today&rsquo;s N2
          <br />
          mock
        </h1>
        <p className="card-h1-strapline">{straplineText}</p>
        <p className="card-lede">
          Good morning. Five questions across reading, grammar, and vocabulary.
        </p>
        {todayMock ? (
          <Link href="/today" className="btn-primary">
            Begin today&rsquo;s mock →
          </Link>
        ) : (
          <p className="card-secondary">
            Today&rsquo;s mock isn&rsquo;t published yet — check back at 07:30 JST.
          </p>
        )}
        <nav className="card-footer-nav">
          <Link href="/progress" className="card-secondary">
            Progress
          </Link>
          <Link href="/revision" className="card-secondary">
            Revision
          </Link>
        </nav>
        <PhoneMockup />
      </TiltedCard>
    );
  }

  return (
    <TiltedCard>
      <IssueMeta />
      <p className="card-tagline card-tagline--above">
        for serious Japanese learners.
      </p>
      <div className="card-h1-row">
        <h1 className="card-h1">
          Today&rsquo;s N2
          <br />
          mock
        </h1>
        {/* 2026-07-23 gap-killer: editorial aside in the upper-right of
            the landing card. Balances the left-heavy H1 composition by
            filling the empty right-half space above the phone mockup
            with a subtle italic-serif publication credit. Mirrors the
            reference dailydispatch's masthead-aside rhythm — the
            reference has a small italic line to the right of its
            giant H1 ("Personalized knowledge, curated by you" sits
            below the H1, but the reference's overall composition has
            editorial substance throughout the upper viewport). */}
        <aside className="card-h1-aside">
          est. 2026
          <br />
          tokyo · jp
        </aside>
      </div>
      <p className="card-h1-strapline">{straplineText}</p>
      <p className="card-lede">
        Five questions across reading, grammar, and vocabulary — delivered
        every morning at 07:30 JST.
      </p>
      <Link href="/auth" className="btn-primary">
        Sign in with email →
      </Link>
      {/* 2026-07-23 gap-killer: card-secondary copy updated to match
          the actual password-based auth flow. The previous "No
          password. We'll send you a magic link." wording was a
          holdover from the magic-link era (before the 2026-07-17
          password-auth migration) and misled users about the actual
          sign-in path. New copy: "First time? Pick a password when
          you sign up — takes 12 seconds." — same editorial vocabulary
          (sans 13 / --text-3) so no DNA drift. */}
      <p className="card-secondary">
        First time? Pick a password when you sign up — takes 12 seconds.
      </p>
      <section className="card-section card-section--flush" aria-label="What you&rsquo;ll see">
        {/* 2026-07-22 gap-killer (12:11 JST): editorial section kicker
            above the "What you'll see" H2 — sans-uppercase-tracked
            micro-label that introduces the H2 (mirrors the reference
            dailydispatch's section-break pattern: kicker → serif H2
            → content). Pairs with the .card-section-kicker class
            locked in globals.css. Without the kicker, the section
            break reads as a SaaS card header; with it, the section
            reads as a newspaper section marker. */}
        <div className="card-section-kicker">Daily coverage · Index</div>
        <h2 className="card-section__heading card-h2">What you&rsquo;ll see</h2>
        <ul className="landing-preview-list">
          <li>
            <span className="landing-preview-list__label">Reading</span>
            <span className="landing-preview-list__note">short &amp; medium passages with timed questions</span>
          </li>
          <li>
            <span className="landing-preview-list__label">Grammar</span>
            <span className="landing-preview-list__note">sentence-completion in context</span>
          </li>
          <li>
            <span className="landing-preview-list__label">Vocabulary</span>
            <span className="landing-preview-list__note">context-driven word choices</span>
          </li>
          <li>
            <span className="landing-preview-list__label">Kanji</span>
            <span className="landing-preview-list__note">read &amp; recognize the ~1,000 N2 kanji</span>
          </li>
          <li>
            <span className="landing-preview-list__label">Listening</span>
            <span className="landing-preview-list__note">short audio clips with comprehension questions</span>
          </li>
        </ul>
        <div className="landing-preview-list__meta">
          ~7 minutes · 5 questions · scored instantly
        </div>
        {/* 2026-07-23 gap-killer: editorial section closing note below
            the meta line — italic-serif aside that closes the "What
            you'll see" index with a small publication-time credit.
            Mirrors the reference dailydispatch's section-break rhythm:
            each section ends with a small italic editorial line above
            the next hairline divider. Uses locked DNA tokens only
            (--font-serif, --text-3). */}
        <p className="landing-section-closing-note">
          presented daily at 07:30 JST — by the editors
        </p>
      </section>

      <section className="landing-colophon" aria-label="Publication facts">
        <div className="landing-colophon__col">
          <div className="landing-colophon__label">Published</div>
          <div className="landing-colophon__meta">07:30 JST · 毎日</div>
        </div>
        <div className="landing-colophon__col">
          {/* JLPT N2 — non-redundant with the "~7 minutes · 5 questions · scored
              instantly" meta line directly above (which already covers
              syllabus metadata). The colophon row now carries curriculum
              context (the JLPT level the mock targets), not duplicate
              time/question counts. Editorial-newspaper genre markers:
              publication time + level — like a byline at the foot of a
              column. */}
          <div className="landing-colophon__label">Level</div>
          <div className="landing-colophon__meta">JLPT N2</div>
        </div>
        <div className="landing-colophon__col">
          {/* 2026-07-22 gap-killer (09:11 JST): third colophon cell —
              "Editor" + city. Reference dailydispatch's bottom-of-page
              colophon is a 3-column horizontal strip (Privacy · Twitter
              · Support · Contact) plus an author/city line at the very
              foot. Our 2-cell colophon (PUBLISHED + LEVEL) left the
              bottom-left of the card visibly empty under the phone
              mockup. Adding EDITOR · CITY completes the editorial
              byline to a 3-cell grid — genre-correct magazine colophon
              rhythm. The phone-mockup (position: absolute; right: -64px)
              still covers the right edge of the card, but the auto-auto-
              auto grid packs the cells to the left edge so all three
              labels stay readable. */}
          <div className="landing-colophon__label">Editor</div>
          <div className="landing-colophon__meta">J. Tanaka · Tokyo</div>
        </div>
      </section>

      {/* 2026-07-23 gap-killer: editorial colophon flourish between the
          landing-colophon row and the landing-editorial-closing band.
          A small italic-serif hairline-framed label that closes the
          publication-facts section with a section-break marker (the
          "· COLOPHON ·" centered label between two hairlines is the
          reference dailydispatch's recurring section-end vocabulary).
          Uses locked DNA tokens only (--hairline, --text-3, --font-serif).
          Pairs with .landing-colophon-flourish class in globals.css. */}
      <div className="landing-colophon-flourish" aria-hidden="true">
        <span className="landing-colophon-flourish__rule" />
        <span className="landing-colophon-flourish__label">colophon</span>
        <span className="landing-colophon-flourish__rule" />
      </div>

      {/* 2026-07-22 gap-killer (09:11 JST): editorial closing band —
          italic-serif signature line + small Privacy/Help footer link.
          Fills the visible ~60px empty whitespace at the bottom-LEFT of
          the landing card (between the colophon row and the card's
          bottom edge). Mirrors the reference's bottom-of-page magazine
          colophon (italic-serif attribution line above a small nav row).
          Uses locked DNA tokens only (--hairline, --text-2, --accent).
          No new design patterns; same italic-serif kicker + tracked-
          sans micro-nav vocabulary used by .card-tagline and
          .card-footer-nav on auth-gated pages. */}
      <div className="landing-editorial-closing">
        <p className="landing-editorial-closing__line">
          Presented daily since 2026 — by the editors of N2 Daily Mock, Tokyo.
        </p>
        <nav className="landing-editorial-closing__nav" aria-label="Imprint">
          <Link href="/privacy">Privacy</Link>
          <span aria-hidden="true">·</span>
          <Link href="/today">Today&rsquo;s mock</Link>
          <span aria-hidden="true">·</span>
          <Link href="/revision">Revision</Link>
        </nav>
      </div>

      <PhoneMockup />
    </TiltedCard>
  );
}
