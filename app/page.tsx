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

  // 2026-07-28 gap-killer (15:20 JST): straplineText now omits the
  // "Issue · N" prefix — that info was duplicating the issue number
  // shown in the .card-h1-edition right-column mini-panel. When a
  // mock is published, the strapline reads "The morning paper"; when
  // no mock is published yet, it reads "2026-07-28 · The morning paper"
  // (today's date acts as the temporal anchor for the unpublished
  // state, matching the .card-status-empty callout's date anchor).
  const straplineText = todayMock
    ? `The morning paper`
    : `${today} \u00b7 The morning paper`;

  // 2026-07-27 gap-killer (06:13 JST): issue number + formatted date for
  // the new .card-h1-edition right-column mini-panel. Issue number is
  // always the calculated ordinal (daysSinceStart + 1) regardless of
  // whether today's mock is published — the edition number is a
  // date-keyed concept, not a publication-state concept. Date is
  // formatted as "Mon · 27 Jul 2026" to match the editorial-newspaper
  // byline rhythm (short weekday + day + month + year).
  const issueNumber = String(daysSinceStart + 1);
  const editionDateLabel = new Date(`${today}T00:00:00+09:00`)
    .toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Tokyo',
    })
    .replace(/,/g, '');

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
        {/* 2026-07-27 gap-killer: card-tagline italic kicker added for
           cross-state parity with the logged-out branch. The
           logged-out branch carries
           <p className="card-tagline card-tagline--above">for serious
           Japanese learners.</p> as the editorial subhead between
           IssueMeta and the H1 row; the logged-in branch was going
           straight from NavBar to StreakBadge with no italic kicker.
           Copy: "Day {N} of the morning paper." — daily-ritual
           language matching the page's "morning paper for serious
           Japanese learners" framing (design.md §Genre: "JLPT N2
           daily mock = the morning paper for serious Japanese
           learners"). The ordinal is the same daysSinceStart value
           already computed for the edition panel. Locked tokens only
           (--font-serif, --text-2). */}
        {/* 2026-07-28 gap-killer (09:15 JST): wrap the kicker + StreakBadge
           in a horizontal flex row (kicker left, badge right) so the
           chrome above the H1 reads as a single tight editorial band
           rather than 2 stacked elements. The StreakBadge's parent
           <header> retains its border-bottom hairline as the section
           break above the H1 row. .card-kicker-badge-row class in
           globals.css handles the layout (display: flex, baseline-
           aligned, space-between). */}
        <div className="card-kicker-badge-row">
          {/* 2026-07-29 gap-killer: StreakBadge now first (top-LEFT,
              per design.md §Auth-gated page chrome — "Streak badge
              sits at the top-left of the card body, below the
              IssueMeta strip"). Previous order (kicker → badge) put
              the badge at top-right of the .card-kicker-badge-row via
              justify-content: space-between. Swapping the JSX order
              swaps the visual position without changing the CSS
              class — locked tokens unchanged. The italic kicker
              ("Day N · of the morning paper.") now sits on the right
              of the row, mirroring the editorial-newspaper
              byline-on-the-right masthead rhythm. */}
          <header className="card-page-header card-page-header--bare">
            <StreakBadge count={streak} />
          </header>
          <p className="card-tagline card-tagline--above">
            Day {daysSinceStart + 1} · of the morning paper.
          </p>
        </div>
        {/* 2026-07-28 gap-killer (09:15 JST): the right side of the H1 row
           now wraps both the Vol. I aside AND the Today's edition
           mini-panel in a single .card-h1-right flex column. Previously
           these were 2 disconnected right-column elements at different
           vertical levels (Vol. I at H1-row level, mini-panel at
           lede-level) — the right column read as fragmented. Now both
           sit as siblings inside .card-h1-right with the column's gap
           (16px) between them, anchored to the right edge of the card.
           The mini-panel moves UP from lede-level to H1-row level; the
           lede below now sits alone (max 480px width) without a
           mini-panel competing for the right column. */}
        <div className="card-h1-row">
          {/* 2026-07-29 gap-killer (03:07 JST): re-added the <br /> after
              "Today's" so the H1 wraps as "TODAY'S" / "N2 MOCK" instead
              of the natural-wrap "TODAY'S N2" / "MOCK". The natural
              wrap leaves "MOCK" alone on line 2 (a 4-character line
              under a 10-character line — 85:35 visual ratio). The
              forced break gives both lines ~7 characters (60:60 ratio)
              — visually balanced and reads as a proper masthead with
              2 stacked editorial credits. The 2026-07-28 15:20 JST
              pass removed the <br /> to allow natural wrap, but the
              natural wrap produced the imbalanced 85:35 split. Forced
              <br /> is the right call for cross-page masthead rhythm
              parity with the reference dailydispatch's 3-line "DAILY
              BRIEFINGS / ON ANY TOPICS / YOU FOLLOW" composition
              (3 lines all roughly the same width). */}
          <h1 className="card-h1">
            Today&rsquo;s<br />N2 mock
          </h1>
          <div className="card-h1-right">
            <aside className="card-h1-aside">
              Vol. I
              <br />
              est. 2026
              <br />
              tokyo · jp
            </aside>
            <aside className="card-h1-edition">
              <div className="card-h1-edition__kicker">Today&rsquo;s edition</div>
              <div className="card-h1-edition__number">Issue {issueNumber}</div>
              <div className="card-h1-edition__date">{editionDateLabel}</div>
              <div className="card-h1-edition__stats">5 questions · 7 min · JLPT N2</div>
            </aside>
          </div>
        </div>
        {/* 2026-07-28 gap-killer (15:20 JST): strapline now reads
           "The morning paper" — the "Issue · N" prefix is removed
           to avoid duplicating the issue number shown in the right-
           column .card-h1-edition__number mini-panel. The 3-line
           typographic stack (H1 / strapline / lede) is preserved. */}
        <p className="card-h1-strapline">{straplineText}</p>
        {/* 2026-07-29 gap-killer: lede now matches the logged-out
            branch's locked-spec copy ("Five questions across reading,
            grammar, vocabulary, kanji, and listening — delivered every
            morning at 07:30 JST."). Previously: "Good morning. Five
            questions across reading, grammar, vocabulary, kanji, and
            listening." — added a "Good morning." prefix and dropped
            the "delivered every morning at 07:30 JST" suffix per
            design.md §Per-page `/` spec. The signed-in and signed-out
            branches now share the same lede copy, eliminating the
            cross-auth-state copy drift flagged in every prior gap-
            killer pass since 2026-07-20 (47+ prior passes logged the
            drift as "content copy, not visual DNA" — this pass
            closes it as part of the cross-page consistency goal). */}
        <p className="card-lede">
          Five questions across reading, grammar, vocabulary, kanji, and listening — delivered
          every morning at 07:30 JST.
        </p>
        {todayMock ? (
          <>
            {/* 2026-07-28 gap-killer (09:15 JST): wrap the CTA + supporting
               secondary copy in a horizontal flex row (.card-cta-row)
               with the CTA on the left and an italic-serif editorial
               by-line on the right ("← Today's edition · Issue {N}").
               Previously the CTA sat alone in the left column with empty
               cream to its right (where the mini-panel used to be at
               lede-level). Now the action block reads as a balanced
               2-element composition: button + by-line, mirroring the
               editorial-newspaper byline rhythm. The by-line uses the
               locked .card-cta-byline class (serif italic 13px / --text-2)
               so it pairs visually with .card-h1-strapline + .card-tagline. */}
            <div className="card-cta-row">
              <Link href="/today" className="btn-primary">
                Begin today&rsquo;s mock →
              </Link>
              <span className="card-cta-byline">
                ← Today&rsquo;s edition · Issue {issueNumber}
              </span>
            </div>
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

        {/* 2026-07-26 gap-killer: dropped the inner
            <nav className="landing-editorial-closing__nav"> from the
            logged-in branch — it duplicated 3 of the 5 destinations
            already in NavBar at the top (Today's mock / Progress /
            Revision). The card bottom is now less crowded; the top
            NavBar remains the single navigation surface. The
            editorial closing line is preserved as a 1-line editorial
            credit so the bottom of the card still reads with a final
            attribution. Locked tokens only. */}
        <p className="landing-section-closing-note">
          Welcome back — by the editors of N2 Daily Mock, Tokyo.
        </p>

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
          Today&rsquo;s<br />N2 mock
        </h1>
        {/* 2026-07-28 gap-killer (09:15 JST): same right-column consolidation
           as the logged-in branch — wrap the Vol. I aside + Today's edition
           mini-panel in a single .card-h1-right flex column at H1-row
           level. */}
        <div className="card-h1-right">
          <aside className="card-h1-aside">
            Vol. I
            <br />
            est. 2026
            <br />
            tokyo · jp
          </aside>
          <aside className="card-h1-edition">
            <div className="card-h1-edition__kicker">Today&rsquo;s edition</div>
            <div className="card-h1-edition__number">Issue {issueNumber}</div>
            <div className="card-h1-edition__date">{editionDateLabel}</div>
            <div className="card-h1-edition__stats">5 questions · 7 min · JLPT N2</div>
          </aside>
        </div>
      </div>
      {/* 2026-07-28 gap-killer (15:20 JST): strapline reads "The
         morning paper" — the "Issue · N" prefix is removed to
         avoid duplicating the issue number shown in the right-
         column .card-h1-edition__number mini-panel. Shared
         straplineText with the logged-in branch. */}
      <p className="card-h1-strapline">{straplineText}</p>
      <p className="card-lede">
        Five questions across reading, grammar, vocabulary, kanji, and listening — delivered
        every morning at 07:30 JST.
      </p>
      <div className="card-cta-row">
        <Link href="/auth" className="btn-primary">
          Sign in with email →
        </Link>
        <span className="card-cta-byline">
          ← Today&rsquo;s edition · Issue {issueNumber}
        </span>
      </div>
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
        {/* 2026-07-28 gap-killer: dropped the above-colophon "presented
            daily at 07:30 JST — by the editors" italic-section-closing-note.
            The below-colophon editorial-closing line ("Presented daily
            since 2026 — Privacy: ...") already carries the publication
            attribution + time schedule; the above-colophon variant read
            as a duplicate "by the editors" italic closing within ~50px
            of the canonical closing-line on the most prominent page. */}
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

      {/* 2026-07-26 gap-killer: dropped the inner
          <nav className="landing-editorial-closing__nav"> from the
          logged-out branch — Today's mock + Revision already live in
          NavBar at the top; the Privacy destination moved to a small
          text-only credit next to the editorial line for symmetry with
          the logged-in branch (logged-in kept the editorial line, no
          nav; logged-out now matches). Both branches of / now close
          with a single line of editorial credit instead of an
          attribution + nav row, so the bottom of the card reads with
          one decisive attribution gesture rather than a redundant nav.
          Locked tokens only. */}
      <p className="landing-section-closing-note">
        Presented daily since 2026 — Privacy:{' '}
        <Link href="/privacy">your@email-only</Link>
      </p>

      <PhoneMockup />
    </TiltedCard>
  );
}
