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

  // 2026-07-25 gap-killer (12:17 JST): fetch the most recent mock before
  // today — feeds the "Last published: {date}" sub-line in the
  // .card-status-empty callout when today's mock isn't published. Single
  // indexed lookup on n2_mocks.date (date-typed, primary key) — cheap.
  // null when no mock has ever been published (early-access window).
  const { data: lastMockRow } = await supabase
    .from('n2_mocks')
    .select('date')
    .lt('date', today)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastPublishedDate = lastMockRow?.date ?? null;

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
        {/* 2026-07-25 gap-killer (06:39 JST): added card-h1-row + card-h1-aside
            to the logged-in branch for H1 row balance. The logged-out branch
            already wraps its H1 in <div className="card-h1-row"> with a
            <aside className="card-h1-aside">est. 2026 / tokyo · jp</aside>
            on the right side. The logged-in branch was missing both —
            rendering the H1 as a left-aligned block with empty right-half
            space above the phone mockup. Now uses the same idiom so the
            H1 row reads as a balanced editorial composition across both
            auth states. The aside content is locked (same line as the
            logged-out branch) — the design.md §Landing per-page spec
            doesn't mandate it but the cross-state parity is a visible
            DNA miss. */}
        <div className="card-h1-row">
          <h1 className="card-h1">
            Today&rsquo;s N2
            <br />
            mock
          </h1>
          <aside className="card-h1-aside">
            Vol. I
            <br />
            est. 2026
            <br />
            tokyo · jp
          </aside>
        </div>
        <p className="card-h1-strapline">{straplineText}</p>
        <p className="card-lede">
          Good morning. Five questions across reading, grammar, and vocabulary.
        </p>
        {todayMock ? (
          <>
            <Link href="/today" className="btn-primary">
              Begin today&rsquo;s mock →
            </Link>
            {/* 2026-07-25 gap-killer (09:16 JST): added card-secondary
                supporting sub-line to the logged-in branch for cross-state
                structural parity with the logged-out branch (which has
                "First time? Pick a password when you sign up — takes 12
                seconds." under its CTA). The logged-in branch had no
                supporting copy under its "Begin today's mock →" button —
                logged-out users got an editorial aside about what to expect,
                logged-in users got nothing. Copy: "Welcome back. Today's
                mock is ready when you are." — same .card-secondary class
                (sans 13 / #6F6D63) so no visual treatment change, just
                cross-state structural parity. */}
            <p className="card-secondary">
              Welcome back. Today&rsquo;s mock is ready when you are.
            </p>
          </>
        ) : (
          /* 2026-07-25 gap-killer (12:17 JST): promoted the NoMockToday
             status from .card-secondary (sans 13 / muted footnote) to
             .card-status-empty (editorial-grade callout). The previous
             .card-secondary treatment was a footnote for what is
             actually the page's primary content in this state —
             users saw a muted line under the H1 + lede and read it
             as "this site is broken" rather than "today's mock is
             in production". New callout carries a sans-uppercase
             "Awaiting publication" kicker (in accent), serif italic
             16px body explaining when to check back, and (when
             available) a "Last published: {date}" sub-line for
             context — same vocabulary as the .result-explanation /
             .passage-quote / .editorial-hairline patterns already on
             the card. Uses locked DNA tokens only (--surface-2,
             --border, --accent, --text, --text-3, --font-sans,
             --font-serif). */
          <div className="card-status-empty">
            <div className="card-status-empty__kicker">Awaiting publication</div>
            <p className="card-status-empty__body">
              Today&rsquo;s mock is in production — check back at 07:30 JST.
            </p>
            {lastPublishedDate && (
              <div className="card-status-empty__sub">
                Last published: {lastPublishedDate}
              </div>
            )}
          </div>
        )}
        {/* 2026-07-25 gap-killer (06:39 JST): added the dense editorial
            composition (preview list + colophon + colophon-flourish +
            editorial-closing band) to the logged-in branch. The
            logged-out branch already carries all four sections; the
            logged-in branch was shipping only a thin 5-line card
            (H1 / strapline / lede / CTA / footer nav), which made the
            phone mockup dominate the right edge of the card and left
            the right half visibly empty above the mockup. The four
            editorial sections bring the logged-in card to the same
            editorial depth as the logged-out card — the phone mockup
            now overlaps the bottom-right of a dense card composition
            rather than a thin placeholder card. The editorial-closing
            nav row carries the Progress / Revision / Today's mock links
            (replacing the previous minimal card-footer-nav that lacked
            the editorial framing). Compose-copy: a small "Welcome back"
            greeting in the editorial-closing line for the logged-in
            state. Uses locked DNA tokens only — palette, type, and
            component-class spec unchanged. */}
        <section className="card-section card-section--flush" aria-label="What you&rsquo;ll see">
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
            <div className="landing-colophon__label">Level</div>
            <div className="landing-colophon__meta">JLPT N2</div>
          </div>
          <div className="landing-colophon__col">
            <div className="landing-colophon__label">Editor</div>
            <div className="landing-colophon__meta">J. Tanaka · Tokyo</div>
          </div>
        </section>

        <div className="landing-colophon-flourish" aria-hidden="true">
          <span className="landing-colophon-flourish__rule" />
          <span className="landing-colophon-flourish__label">colophon</span>
          <span className="landing-colophon-flourish__rule" />
        </div>

        <div className="landing-editorial-closing">
          <p className="landing-editorial-closing__line">
            Welcome back — by the editors of N2 Daily Mock, Tokyo.
          </p>
          <nav className="landing-editorial-closing__nav" aria-label="Imprint">
            <Link href="/progress">Progress</Link>
            <span aria-hidden="true">·</span>
            <Link href="/revision">Revision</Link>
            <span aria-hidden="true">·</span>
            <Link href="/today">Today&rsquo;s mock</Link>
          </nav>
        </div>

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
          Vol. I
          <br />
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
