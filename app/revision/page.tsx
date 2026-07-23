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
        <h2 className="card-h2 card-heading-with-lede">
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

  return (
    <TiltedCard>
      <IssueMeta />
      <NavBar current="/revision" />
      <div className="card-page-header">
        <h2 className="card-h2">
          Today&rsquo;s revision
        </h2>
        <div className="revision-meta">
          {questions.length} questions people got wrong most often, {digest.window_start} – {digest.window_end}
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
