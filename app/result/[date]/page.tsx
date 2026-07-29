import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase';
import { computeStreak } from '@/lib/streak';
import { fetchResultForDate, type ResultData, type AttemptRow } from '@/lib/get-result';
import { PromptWithTarget } from '@/components/prompt-with-target';
import { IssueMeta } from '@/components/IssueMeta';
import { TiltedCard } from '@/components/TiltedCard';
import { PullQuote } from '@/components/PullQuote';
import { StreakBadge } from '@/components/StreakBadge';
import { ResultNote } from '@/components/ResultNote';
import { NavBar } from '@/components/NavBar';

/**
 * app/result/[date]/page.tsx — Per-attempt result page.
 * Server Component. Auth-gates, fetches the user's attempt for [date] via
 * fetchResultForDate(), renders the per-question correct/incorrect
 * breakdown + explanations.
 *
 * Visual layer redesigned 2026-07-17 per design.md. New in this pass:
 *   - Streak shown in header (extends after a passing day, per lib/streak.ts).
 *   - Per-option `note` field (added 2026-07-16, backfilled onto all
 *     existing questions) now surfaces as an expandable "why the others
 *     were wrong" panel — not just correct-vs-your-answer, all 4 options.
 *   - explanation_en shown alongside the Japanese explanation.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type QuestionOption = {
  id: string;
  text: string;
  note?: string | null;
};

type QuestionRow = {
  id: string;
  category: string;
  tags: string[];
  difficulty: number;
  prompt: string;
  target_word?: string | null;
  options: QuestionOption[];
  correct_answer: 'a' | 'b' | 'c' | 'd' | string;
  explanation: string;
  explanation_en?: string | null;
  source_id: string;
};

function formatTime(s: number): string {
  return `${Math.floor(s / 60)}分${(s % 60).toString().padStart(2, '0')}秒`;
}

function pctTier(p: number): 'passing' | 'ok' | 'failing' {
  if (p >= 80) return 'passing';
  if (p >= 60) return 'ok';
  return 'failing';
}
function valueScoreClass(p: number): string {
  return `result-score-value--${pctTier(p)}`;
}
function pctScoreClass(p: number): string {
  return `result-score-pct--${pctTier(p)}`;
}

export default async function ResultPage({ params }: { params: { date: string } }) {
  const { date } = params;
  if (!DATE_RE.test(date)) {
    return <ErrorState message="日付の形式が正しくありません (YYYY-MM-DD)。" />;
  }

  const supabase = createServerSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session?.user) {
    redirect('/auth');
  }
  const userId = sessionData.session.user.id;

  const streak = await computeStreak(supabase, userId);

  let data: ResultData;
  try {
    data = await fetchResultForDate(supabase, userId, date);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return <ErrorState message={`結果の取得に失敗しました: ${message}`} />;
  }

  // 2026-07-26 gap-killer: NoMockForDate — passes streak for StreakBadge
  // chrome parity with NoAttemptYet. design.md §Per-page /result
  // mandates StreakBadge at top-left for the populated state; the
  // sub-states were inconsistent — NoAttemptYet had it, NoMockForDate
  // didn't. Streak is already computed above and is the same value
  // the NoAttemptYet branch receives.
  if (!data.mock) return <NoMockForDate date={date} streak={streak} />;
  if (data.attempts.length === 0) return <NoAttemptYet date={date} streak={streak} />;

  const pct = data.total > 0 ? Math.round((data.score / data.total) * 100) : 0;
  const correctCount = data.attempts.filter((a) => a.is_correct).length;
  const incorrectCount = data.attempts.length - correctCount;

  // Compute IssueMeta values from the result date (YYYY-MM-DD) so the
  // masthead shows the date in question, not today.
  const dateObj = new Date(`${date}T00:00:00+09:00`);
  const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  // Format in JST — getUTCDate/getUTCMonth on a +09:00-constructed date
  // reads the previous UTC day.
  const metaDay = Number(dateObj.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'Asia/Tokyo' }));
  const metaMonth = MONTH_ABBR[Number(dateObj.toLocaleDateString('en-US', { month: 'numeric', timeZone: 'Asia/Tokyo' })) - 1];
  // Two-digit chunks per IssueMeta spec — fix mirrored from
  // components/IssueMeta.tsx so /result/[date] doesn't regress to "2 / 6".
  const metaYear = dateObj.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'Asia/Tokyo' });
  const metaYearTop = metaYear.slice(0, 2);
  const metaYearBottom = metaYear.slice(2, 4);

  return (
    <TiltedCard>
      <IssueMeta day={metaDay} month={metaMonth} yearTop={metaYearTop} yearBottom={metaYearBottom} center="N2 Daily Mock" />
      <NavBar current="/result" />
      <header className="card-page-header">
        <div className="result-header-row">
          <StreakBadge count={streak} />
          <span className="result-header-row__label">Result · {date}</span>
        </div>
        <h2 className="card-h2">
          Your N2 mock — {date}
        </h2>
      </header>

      <div className="card-section">
        <div className="score-panel">
          <div className="result-score-label">
            あなたのスコア
          </div>
          <div className={`result-score-value ${valueScoreClass(pct)}`}>
            {correctCount}{' '}
            <span className="result-score-denominator">
              / {data.total}
            </span>
          </div>
          <div className="result-score-accuracy">
            正答率{' '}
            <strong className={`result-score-pct ${pctScoreClass(pct)}`}>
              {pct}%
            </strong>
          </div>
          <div className="result-score-stats">
            <span className="result-score-stats__correct">{correctCount} 正解</span>
            <span className="result-score-stats__wrong">{incorrectCount} 不正解</span>
            <span className="result-score-stats__time">{formatTime(data.total_seconds)}</span>
          </div>
        </div>
      </div>

      <ol className="result-question-list">
        {data.attempts.map((a, i) => (
          <li key={a.question_id} className="result-question-card">
            <div className="result-question-card__header">
              <h3 className="result-question-card__num">問 {i + 1}</h3>
              <span
                className={
                  'result-question-card__verdict ' +
                  (a.is_correct
                    ? 'result-question-card__verdict--correct'
                    : 'result-question-card__verdict--wrong')
                }
              >
                {a.is_correct ? '正解' : '不正解'}
              </span>
            </div>
            {a.question ? <QuestionBreakdown attempt={a} /> : <MissingQuestionRow />}
          </li>
        ))}
      </ol>

      <PullQuote>
        Progress has always belonged to the informed. Not the fastest, but the most astute.
      </PullQuote>

      {/* 2026-07-26 gap-killer: landing-section-closing-note added for
          cross-page editorial consistency with the / landing (signed-in
          + logged-out branches) and /today NoMockToday. /result/[date]
          populated state was missing it. Same class already in
          globals.css. Locked DNA tokens only. */}
      <p className="landing-section-closing-note">
        Recorded for the record — by the editors.
      </p>

      <footer className="card-footer-nav card-footer-nav--between">
        <Link href="/" className="card-meta-link card-secondary">← ホームに戻る</Link>
        <Link href="/today" className="card-meta-link card-secondary">今日のモックへ →</Link>
      </footer>
    </TiltedCard>
  );
}

function QuestionBreakdown({ attempt }: { attempt: AttemptRow }) {
  const q = attempt.question as unknown as QuestionRow | null;
  if (!q) return <MissingQuestionRow />;
  const passage = (attempt.question as { passage?: string | null } | null)?.passage ?? null;

  const userAnswerId = attempt.user_answer?.toLowerCase() ?? '';
  const correctId = q.correct_answer?.toLowerCase() ?? '';
  const userOption = q.options?.find((o) => o.id.toLowerCase() === userAnswerId);
  const correctOption = q.options?.find((o) => o.id.toLowerCase() === correctId);

  return (
    <>
      {passage && (
        <details className="result-passage-toggle">
          <summary className="result-passage-toggle__summary">本文を表示</summary>
          <div className="passage-text passage-text--in-toggle">{passage}</div>
        </details>
      )}

      <div className="result-question-card__prompt">
        <PromptWithTarget prompt={q.prompt} targetWord={q.target_word} />
      </div>

      {attempt.is_correct ? (
        <div className="result-answer-compare__cell result-answer-compare__cell--correct result-answer-compare__cell--solo">
          <div className="result-answer-compare__label result-answer-compare__label--correct">✓ 正解</div>
          <div className="result-answer-compare__text">
            <strong>{correctId.toUpperCase()}.</strong>
            {correctOption?.text ?? '—'}
          </div>
        </div>
      ) : (
        <div className="result-answer-compare">
          <div className="result-answer-compare__cell result-answer-compare__cell--wrong">
            <div className="result-answer-compare__label result-answer-compare__label--wrong">✗ あなたの回答</div>
            <div className="result-answer-compare__text">
              <strong>{userAnswerId.toUpperCase() || '—'}.</strong>
              {userOption?.text ?? '（無回答）'}
            </div>
          </div>
          <div className="result-answer-compare__cell result-answer-compare__cell--correct">
            <div className="result-answer-compare__label result-answer-compare__label--correct">✓ 正解</div>
            <div className="result-answer-compare__text">
              <strong>{correctId.toUpperCase()}.</strong>
              {correctOption?.text ?? '—'}
            </div>
          </div>
        </div>
      )}

      {(q.explanation || q.explanation_en) && (
        <div className="result-explanation">
          {q.explanation && <div>{q.explanation}</div>}
          {q.explanation_en && (
            <div className="result-explanation__en">{q.explanation_en}</div>
          )}
        </div>
      )}

      {q.options?.some((o) => o.note) && (
        <ResultNote options={q.options} correctId={correctId} />
      )}

      <div className="result-question-card__time">
        所要時間: {typeof attempt.time_seconds === 'number' ? `${attempt.time_seconds}秒` : '—'}
      </div>
    </>
  );
}

function MissingQuestionRow() {
  return <div className="result-missing-note">問題データを取得できませんでした。</div>;
}

function NoMockForDate({ date, streak }: { date: string; streak: number }) {
  return (
    <TiltedCard>
      <IssueMeta />
      <NavBar current="/result" />
      {/* 2026-07-26 gap-killer: StreakBadge added for chrome parity
          with NoAttemptYet. design.md §Per-page /result locks the
          StreakBadge at the top-left of the card body; the sub-states
          should be consistent (NoAttemptYet already had it; NoMockForDate
          didn't). Streak prop is passed from the parent — no extra
          computeStreak call needed. */}
      {/* 2026-07-28 gap-killer: card-page-header--bare (not card-page-header)
          — NoMockForDate's header wraps ONLY a StreakBadge with no H2
          inside, so --bare is correct per the 2026-07-26 gap-killer
          notes which define --bare as "for when the header wraps ONLY a
          StreakBadge (no H2 inside)". Using the full card-page-header
          would add 45px of dead space (margin-bottom 24 + padding-bottom 20 +
          hairline) before the kicker, orphaning the badge. */}
      <header className="card-page-header--bare">
        <StreakBadge count={streak} />
      </header>
      {/* 2026-07-27 gap-killer: card-section-kicker meta line above the
         H2 for cross-page parity with /today NoMockToday ("Today ·
         {date} · Not yet published") and /progress / /revision which
         both carry a sans-uppercase-tracked meta line directly below
         the page-level H2. /result/[date]'s sub-states previously
         jumped from StreakBadge → H2 with no editorial subhead,
         breaking the rhythm across auth-gated pages. Sans 11px / 500 /
         tracked / uppercase / --text-3 — same vocabulary as the other
         auth-gated kickers, slightly tighter since this is a state
         callout. Locked tokens only. */}
      <p className="card-section-kicker">
        {date} · No mock published
      </p>
      <h2 className="card-h2">モックが見つかりません</h2>
      <p className="card-lede">{date} の N2 モックはまだ公開されていません。</p>
      {/* 2026-07-25 gap-killer: primary CTA + footer nav. The sub-state
          previously had no navigation — users hitting this dead-end
          had no way to recover. Primary CTA points to /today (where
          the user can take today's mock or check the publication
          status), and the footer nav provides a return path. */}
      <Link href="/today" className="btn-primary">
        今日のモックを確認 →
      </Link>
      <footer className="card-footer-nav card-footer-nav--end">
        <Link href="/" className="card-meta-link card-secondary">← ホームに戻る</Link>
      </footer>
    </TiltedCard>
  );
}

function NoAttemptYet({ date, streak }: { date: string; streak: number }) {
  return (
    <TiltedCard>
      <IssueMeta />
      <NavBar current="/result" />
      {/* 2026-07-25 gap-killer: StreakBadge + primary CTA + footer nav.
          StreakBadge added for /result/[date] parity with the design.md
          §Auth-gated page chrome spec ("Streak badge sits at the top-left
          of the card body"). The primary CTA closes the previous
          dead-end — the body copy literally said "下のボタンから受験して
          ください" (use the button below) but no button was rendered.
          Users now have a one-click path to take today's mock. */}
      <header className="card-page-header">
        <StreakBadge count={streak} />
      </header>
      {/* 2026-07-27 gap-killer: card-section-kicker meta line — same
         cross-page parity fix as NoMockForDate above. Sans 11px /
         tracked / uppercase / --text-3. Locked tokens only. */}
      <p className="card-section-kicker">
        {date} · Not yet attempted
      </p>
      <h2 className="card-h2">{date} のモック</h2>
      <p className="card-lede">まだ提出していません。下のボタンから受験してください。</p>
      <Link href="/today" className="btn-primary">
        受験を始める →
      </Link>
      <footer className="card-footer-nav card-footer-nav--end">
        <Link href="/" className="card-meta-link card-secondary">← ホームに戻る</Link>
      </footer>
    </TiltedCard>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <TiltedCard>
      <IssueMeta />
      <NavBar current="/result" />
      <h2 className="card-h2">エラー</h2>
      <p className="card-lede">{message}</p>
      {/* 2026-07-25 gap-killer: card-back-link (locked class) — the
          sub-state previously had no recovery path. Same hairline-
          divider + accent-link pattern used by /revision's empty-state
          and /auth's footer link. No DNA drift; uses locked tokens. */}
      <p className="card-back-link">
        <Link href="/">← ホームに戻る</Link>
      </p>
    </TiltedCard>
  );
}
