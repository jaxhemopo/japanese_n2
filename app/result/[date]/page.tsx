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

  if (!data.mock) return <NoMockForDate date={date} />;
  if (data.attempts.length === 0) return <NoAttemptYet date={date} />;

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
              <span className="result-question-card__num">問 {i + 1}</span>
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

function NoMockForDate({ date }: { date: string }) {
  return (
    <TiltedCard>
      <IssueMeta />
      <NavBar current="/result" />
      <h2 className="card-h2">モックが見つかりません</h2>
      <p className="card-lede">{date} の N2 モックはまだ公開されていません。</p>
    </TiltedCard>
  );
}

function NoAttemptYet({ date }: { date: string }) {
  return (
    <TiltedCard>
      <IssueMeta />
      <NavBar current="/result" />
      <h2 className="card-h2">{date} のモック</h2>
      <p className="card-lede">まだ提出していません。下のボタンから受験してください。</p>
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
    </TiltedCard>
  );
}
