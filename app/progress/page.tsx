/**
 * app/progress/page.tsx — personal progress: overall stats, per-subtype
 * accuracy (weakest first, so it doubles as "what to review"), and a
 * 90-day activity calendar.
 *
 * Server Component — reads n2_attempts under RLS (auth.uid() = user_id),
 * so this only ever returns the signed-in user's own data.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase';
import { computeStreak } from '@/lib/streak';
import { subtypeLabel } from '@/lib/subtype-labels';
import { IssueMeta } from '@/components/IssueMeta';
import { TiltedCard } from '@/components/TiltedCard';
import { PullQuote } from '@/components/PullQuote';
import { StreakBadge } from '@/components/StreakBadge';
import { NavBar } from '@/components/NavBar';

function toJSTDateString(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

type AttemptRow = {
  question_id: string;
  correct: boolean | null;
  time_seconds: number | null;
  created_at: string;
  n2_questions: { tags: string[] | null } | null;
};

export default async function ProgressPage() {
  const supabase = createServerSupabase();
  // getUser() revalidates the JWT server-side (getSession() only trusts
  // the cookie) — swapped 2026-07-24.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth');
  }

  const { data, error } = await supabase
    .from('n2_attempts')
    .select('question_id, correct, time_seconds, created_at, n2_questions(tags)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(2000);

  const rawAttempts = (error ? [] : (data as unknown as AttemptRow[])) ?? [];

  // Dedupe by question_id, keeping the latest attempt per question. The
  // /today submit handler is client-guarded with a useRef against
  // double-click races (added 2026-07-21 after observing 3 identical
  // inserts in 4s on Jackson's session), but defense-in-depth: if a
  // duplicate ever slips through, this page should still report correct
  // totals. Mirrors the dedup logic in lib/get-result.ts.
  const latestByQuestion = new Map<string, AttemptRow>();
  for (const a of rawAttempts) {
    if (a.question_id && !latestByQuestion.has(a.question_id)) {
      latestByQuestion.set(a.question_id, a);
    }
  }
  const attempts = Array.from(latestByQuestion.values());

  const total = attempts.length;
  const correctCount = attempts.filter((a) => a.correct === true).length;
  const overallAccuracy = total > 0 ? Math.round((correctCount / total) * 100) : null;

  // Per-subtype breakdown, weakest accuracy first — doubles as a review list.
  const bySubtype = new Map<string, { total: number; correct: number }>();
  for (const a of attempts) {
    const tag = a.n2_questions?.tags?.[0] ?? 'unknown';
    const entry = bySubtype.get(tag) ?? { total: 0, correct: 0 };
    entry.total += 1;
    if (a.correct === true) entry.correct += 1;
    bySubtype.set(tag, entry);
  }
  const subtypeRows = Array.from(bySubtype.entries())
    .map(([tag, s]) => ({ tag, ...s, accuracy: Math.round((s.correct / s.total) * 100) }))
    .sort((a, b) => a.accuracy - b.accuracy);

  // 90-day activity calendar (Asia/Tokyo), most recent day last.
  const attemptCountByDay = new Map<string, number>();
  for (const a of attempts) {
    const day = toJSTDateString(new Date(a.created_at));
    attemptCountByDay.set(day, (attemptCountByDay.get(day) ?? 0) + 1);
  }
  const days: { date: string; count: number }[] = [];
  const cursor = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(cursor);
    d.setDate(cursor.getDate() - i);
    const key = toJSTDateString(d);
    days.push({ date: key, count: attemptCountByDay.get(key) ?? 0 });
  }
  const activeDays = days.filter((d) => d.count > 0).length;

  // 2026-07-29 gap-killer: StreakBadge fetch — design.md
  // §Auth-gated page chrome locks the streak pill at the top-left of
  // the card body, below the IssueMeta strip, on EVERY auth-gated
  // page (/today, /progress, /revision, /result/[date]). /progress
  // was the only auth-gated page missing the StreakBadge — the page
  // renders the user's all-time stats but had no daily-ritual
  // reinforcement at the top. computeStreak is the same SQL-count
  // over n2_attempts call used by /today and /result/[date].
  const streak = await computeStreak(supabase, user.id);

  function activityClass(count: number): string {
    if (count === 0) return 'activity-cell--none';
    if (count <= 2) return 'activity-cell--low';
    if (count <= 4) return 'activity-cell--med';
    return 'activity-cell--high';
  }

  return (
    <TiltedCard>
      <IssueMeta />
      <NavBar current="/progress" />
      {/* 2026-07-29 gap-killer: StreakBadge now appears at the top-
          left of the card body per design.md §Auth-gated page chrome
          spec — uses the same .result-header-row + .result-header-row
          __label pair pattern as /result/[date] (StreakBadge on the
          left, sans-uppercase-tracked label "All-time streak" on the
          right). The H2 + .progress-meta below the row are unchanged
          from the prior pass. Locked tokens only. */}
      <header className="card-page-header">
        <div className="result-header-row">
          <StreakBadge count={streak} />
          <span className="result-header-row__label">All-time streak</span>
        </div>
        <h2 className="card-h2">Your progress</h2>
        {/* 2026-07-23 gap-killer: structural-parity meta line below
            "Your progress" H2. Sibling auth-gated pages (/revision,
            /result/[date]) both carry a sans-uppercase-tracked meta
            line directly below the page H2 — /progress previously
            shipped just an H2 inside card-page-header, breaking the
            rhythm. Uses the .progress-meta class added to globals.css
            this pass (same DNA as .revision-meta). */}
        <div className="progress-meta">
          Across all attempts · Weighted by recency
        </div>
      </header>

      <section className="stat-card-grid">
        <StatCard label="Total answered" value={String(total)} />
        <StatCard label="Overall accuracy" value={overallAccuracy !== null ? `${overallAccuracy}%` : '—'} />
        <StatCard label="Active days (90d)" value={`${activeDays} of 90`} />
      </section>

      <div className="card-section">
        <h3 className="card-section__heading card-h3">
          By question type {subtypeRows.length > 0 && <span className="card-h3__suffix">(weakest first)</span>}
        </h3>
        {subtypeRows.length === 0 ? (
          <p className="card-empty">No attempts yet — <Link href="/today">take today&rsquo;s mock</Link> to start building stats.</p>
        ) : (
          <div className="subtype-list">
            {subtypeRows.map((row) => (
              <div
                key={row.tag}
                className="subtype-row"
              >
                <div className="subtype-row__label">{subtypeLabel(row.tag)}</div>
                <div className="subtype-row__score">
                  {row.correct}/{row.total} ·{' '}
                  <strong
                    className={
                      row.accuracy >= 80
                        ? 'subtype-row__pct--high'
                        : row.accuracy >= 60
                          ? 'subtype-row__pct--mid'
                          : 'subtype-row__pct--low'
                    }
                  >
                    {row.accuracy}%
                  </strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card-section card-section--flush">
        <h3 className="card-section__heading card-h3">
          Last 90 days
        </h3>
        <div className="activity-calendar">
          {days.map((d) => (
            <div
              key={d.date}
              title={`${d.date}: ${d.count} question${d.count === 1 ? '' : 's'}`}
              className={`activity-cell ${activityClass(d.count)}`}
            />
          ))}
        </div>
        <div className="activity-calendar-legend" aria-label="Activity calendar legend">
          <div className="activity-calendar-legend__item">
            <span className="activity-calendar-legend__swatch activity-calendar-legend__swatch--none" />
            0
          </div>
          <div className="activity-calendar-legend__item">
            <span className="activity-calendar-legend__swatch activity-calendar-legend__swatch--low" />
            1-2
          </div>
          <div className="activity-calendar-legend__item">
            <span className="activity-calendar-legend__swatch activity-calendar-legend__swatch--med" />
            3-4
          </div>
          <div className="activity-calendar-legend__item">
            <span className="activity-calendar-legend__swatch activity-calendar-legend__swatch--high" />
            5+
          </div>
          <span className="activity-calendar-legend__caption">
            questions per day
          </span>
        </div>
      </div>

      <PullQuote>
        Progress has always belonged to the informed. Not the fastest, but the most astute.
      </PullQuote>

      {/* 2026-07-26 gap-killer: landing-section-closing-note added for
          cross-page editorial consistency with /revision, /result/[date],
          /today NoMockToday, and the / landing (both branches). All four
          sibling surfaces carry a small italic-serif closing line between
          PullQuote and footer-nav; /progress was the only auth-gated
          page missing it, leaving visible whitespace between the
          PullQuote's bottom hairline and the footer nav. Same class
          already in globals.css — no new CSS. Locked DNA tokens only
          (--font-serif, --text-3). */}
      <p className="landing-section-closing-note">
        Logged for the record — by the editors.
      </p>

      {/* 2026-07-23 gap-killer: card-footer-nav added for structural
          parity with /result/[date]. The closing "where to go next"
          affordance was missing on /progress — other auth-gated pages
          (/result/[date]) carry the same footer pair (← ホームに戻る
          + 今日のモックへ →). PullQuote alone left visible whitespace
          at the card's bottom edge. Same card-footer-nav--between
          class + locked .card-secondary link styling as /result/[date]. */}
      <footer className="card-footer-nav card-footer-nav--between">
        <Link href="/" className="card-meta-link card-secondary">← ホームに戻る</Link>
        <Link href="/today" className="card-meta-link card-secondary">今日のモックへ →</Link>
      </footer>
    </TiltedCard>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
    </div>
  );
}
