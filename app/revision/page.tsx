/**
 * app/revision/page.tsx — twice-weekly revision digest (public, shared).
 *
 * Same content for every visitor — reads the latest n2_revision_digests
 * row and re-joins n2_questions for the actual content. No new LLM call:
 * every question already carries a verified explanation_en and per-option
 * notes from the generation pipeline, so this composes the writeup from
 * that verified data rather than re-explaining anything.
 */

import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase';
import { subtypeLabel } from '@/lib/subtype-labels';
import { IssueMeta } from '@/components/IssueMeta';
import { TiltedCard } from '@/components/TiltedCard';
import { PullQuote } from '@/components/PullQuote';
import { NavBar } from '@/components/NavBar';

// 2026-07-28 gap-killer: format a window_start / window_end date (from
// n2_revision_digests, stored as YYYY-MM-DD or full ISO) as "Jul 20 – Jul 26"
// for the editorial meta line. Falls back to the raw string if parsing fails.
function formatWindow(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    // Try YYYY-MM-DD first; if it has a T, strip the time portion.
    const datePart = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const d = new Date(datePart + 'T12:00:00+09:00');
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'Asia/Tokyo',
    });
  } catch {
    return dateStr;
  }
}

type QuestionRow = {
  id: string;
  prompt: string | null;
  passage: string | null;
  options: { id: string; text: string; note: string | null }[];
  correct_answer: string;
  explanation_en: string | null;
  tags: string[] | null;
};

export default async function RevisionPage() {
  const supabase = createServerSupabase();

  const { data: digest } = await supabase
    .from('n2_revision_digests')
    .select('run_date, window_start, window_end, question_ids')
    .order('run_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!digest) {
    return (
      <TiltedCard>
        <IssueMeta />
        <NavBar current="/revision" />
        <h2 className="card-h2">
          No revision digest yet
        </h2>
        <p className="card-lede">
          The revision digest hasn&rsquo;t been published yet — check back Wednesday or Sunday.
        </p>
        <PullQuote>
          Small daily gains compound.
        </PullQuote>
        <p className="card-back-link">
          <Link href="/today">← Back to today&rsquo;s mock</Link>
        </p>
      </TiltedCard>
    );
  }

  const { data: questionsRaw } = await supabase
    .from('n2_questions')
    .select('id, prompt, passage, options, correct_answer, explanation_en, tags')
    .in('id', digest.question_ids);

  const byId = new Map((questionsRaw as QuestionRow[] | null ?? []).map((q) => [q.id, q]));
  // preserve the hardest-first order from the digest, not the DB's return order
  const questions = digest.question_ids.map((id: string) => byId.get(id)).filter(Boolean) as QuestionRow[];

  const todayJST = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  });

  // 2026-07-28 gap-killer: compute IssueMeta values from digest.run_date
  // so the masthead reads the digest's publication date (not today).
  // /result/[date] already follows this pattern (sets metaDay/metaMonth
  // from the date in question). For /revision, the latest digest's
  // run_date is typically "yesterday" relative to a Mon-morning visit
  // (digests publish Sun + Wed), and the window_start..window_end
  // covers the prior Wed..Sun or Sun..Wed. The masthead should anchor
  // to the run_date — same convention used by IssueMeta's default
  // (today's date). Locks the masthead → page content coherence.
  const dateObj = new Date(`${digest.run_date}T00:00:00+09:00`);
  const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const metaDay = Number(dateObj.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'Asia/Tokyo' }));
  const metaMonth = MONTH_ABBR[Number(dateObj.toLocaleDateString('en-US', { month: 'numeric', timeZone: 'Asia/Tokyo' })) - 1];
  const metaYear = dateObj.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'Asia/Tokyo' });
  const metaYearTop = metaYear.slice(0, 2);
  const metaYearBottom = metaYear.slice(2, 4);

  return (
    <TiltedCard>
      <IssueMeta day={metaDay} month={metaMonth} yearTop={metaYearTop} yearBottom={metaYearBottom} center="N2 Daily Mock" />
      <NavBar current="/revision" />
      {/* 2026-07-28 gap-killer: card-section-kicker added above H2 for
          cross-page editorial rhythm parity with /progress (kicker above
          "Your progress") and /result/[date] sub-states (kicker above
          the H2). /revision was jumping from NavBar straight to H2
          with no kicker — the only auth-gated page missing one.
          Sunday · Revision digest framing matches the §Per-page /revision
          spec ("Sunday or Wednesday publication" cadence). Sans 11px / 500 /
          tracked / uppercase / --text-3 — same DNA as NoMockToday
          kicker. Locked tokens only. */}
      <p className="card-section-kicker">
        Sunday &middot; Revision digest
      </p>
      <div className="card-page-header">
        <h2 className="card-h2">
          Today&rsquo;s revision
        </h2>
        {/* 2026-07-28 gap-killer: format window_start / window_end with
            formatWindow() — previously rendered as raw ISO strings
            ("2026-07-20T00:00:00+09:00") instead of editorial date
            format ("Jul 20 – Jul 26"). */}
        <div className="revision-meta">
          {questions.length} questions people got wrong most often, {formatWindow(digest.window_start)} – {formatWindow(digest.window_end)}
        </div>
      </div>

      {/* 2026-07-23 gap-killer: card-section--flush wrapper around the
          article list. Each &lt;article className="card-section"&gt; carries
          border-bottom: 1px solid var(--hairline); without a flush wrapper,
          the last article's bottom hairline sits ~24px above the PullQuote's
          top hairline — a visible double-rule gap. Wrapping in
          card-section--flush removes the article-list's bottom border
          (via :last-child in globals.css), collapsing to a single hairline
          before the PullQuote. Matches the /progress pattern:
          activity-calendar section uses card-section--flush before PullQuote.
          No DNA values shifted; uses locked .card-section--flush class. */}
      <div className="revision-article-list card-section--flush">
        {questions.map((q, i) => {
          const correctOpt = q.options.find((o) => o.id === q.correct_answer);
          return (
            <article key={q.id} className="card-section">
              <div className="revision-type-label">
                #{i + 1} · {subtypeLabel(q.tags?.[0])}
              </div>
              {q.passage && (
                <div className="passage-quote">
                  {q.passage}
                </div>
              )}
              {q.prompt && <h3 className="revision-prompt">{q.prompt}</h3>}
              <div className="revision-answer">
                <strong>Correct answer:</strong>{' '}
                {correctOpt?.text}
              </div>
              {q.explanation_en && (
                <div className="result-explanation">{q.explanation_en}</div>
              )}
            </article>
          );
        })}
      </div>

      <PullQuote>
        Small daily gains compound.
      </PullQuote>

      {/* 2026-07-26 gap-killer: landing-section-closing-note added for
          cross-page editorial consistency with the / landing (signed-in
          + logged-out branches) and /today NoMockToday. All three of
          those surfaces carry a small italic-serif closing line between
          their main content and the footer nav; /revision's populated
          state was missing it, leaving the PullQuote → footer nav gap
          visually thin. Same class already in globals.css — no new CSS.
          Locked DNA tokens only (--font-serif, --text-3). */}
      <p className="landing-section-closing-note">
        Composed from your hardest questions — by the editors.
      </p>

      {/* 2026-07-23 gap-killer: card-footer-nav added for structural
          parity with /result/[date] and /progress. The closing
          "where to go next" affordance was missing on /revision —
          other auth-gated pages carry the same footer pair. PullQuote
          alone left visible whitespace at the card's bottom edge.
          card-meta-link + card-secondary reuse locked link styling
          tokens (no new patterns). */}
      <footer className="card-footer-nav card-footer-nav--between">
        <Link href="/" className="card-meta-link card-secondary">← ホームに戻る</Link>
        <Link href="/today" className="card-meta-link card-secondary">今日のモックへ →</Link>
      </footer>
    </TiltedCard>
  );
}
