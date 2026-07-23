import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase';
import { computeStreak } from '@/lib/streak';
import { IssueMeta } from '@/components/IssueMeta';
import { TiltedCard } from '@/components/TiltedCard';
import { StreakBadge } from '@/components/StreakBadge';
import { NavBar } from '@/components/NavBar';
import InteractiveMock from './interactive-mock';

/**
 * app/today/page.tsx — Take today's 5-question mock.
 *
 * Server Component. Responsibilities (single component boundary):
 *   1. Auth gate — redirect to /auth if no Supabase session.
 *   2. Fetch today's published mock from public.n2_mocks
 *      (goal.md §C DailyMock shape — date, questions, category_dist, target_tags,
 *      pipeline_run_id). n2_challenges is the per-USER attempt log (migration 003,
 *      ≈ n2_attempts) and is not read here.
 *   3. Pass the mock to <InteractiveMock/> for the interactive client-side
 *      state machine (timer, answer selection, submit).
 *
 * The client component owns: current-question index, per-question answers,
 * per-question timing, submit handler that POSTs to /api/attempts.
 * That route handler is the next wakeup (cp5 + cp7 enabler).
 */

const MOCKS_TABLE = 'n2_mocks';

type MockRow = {
  date: string;
  question_ids: string[];
};

export type Question = {
  id: string;
  category: 'grammar_form' | 'reading_short' | 'vocab_context' | string;
  tags: string[];
  difficulty: number;
  prompt: string;
  target_word?: string | null;
  options: { id: string; text: string; note?: string | null }[];
  correct_answer: string;
  explanation: string;
  explanation_en?: string | null;
  source_id: string;
  passage?: string | null;
};

/**
 * Today's "focus" label — whichever subtype in category_dist has the
 * highest question count. Falls back to "Mixed practice" when it's an
 * even split (language-knowledge days: 5 subtypes, 1 question each).
 */
function focusLabel(categoryDist: Record<string, number> | null): string {
  if (!categoryDist) return 'Mixed practice';
  const entries = Object.entries(categoryDist);
  if (entries.length === 0) return 'Mixed practice';
  const [topTag, topCount] = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  if (topCount <= 1) return 'Mixed practice';
  const LABELS: Record<string, string> = {
    long_essay: 'Long Essay',
    info_retrieval: 'Info Retrieval',
    short_medium_passage: 'Reading Passage',
    integrated_comprehension: 'Integrated Comprehension',
  };
  return LABELS[topTag] ?? topTag;
}

function todayJST(): string {
  // YYYY-MM-DD in Asia/Tokyo. sv-SE locale formats as ISO date.
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

export default async function TodayPage() {
  const supabase = createServerSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session?.user) {
    redirect('/auth');
  }
  const userId = sessionData.session.user.id;

  const today = todayJST();
  const streak = await computeStreak(supabase, userId);

  const { data: mock, error } = await supabase
    .from(MOCKS_TABLE)
    .select('date, question_ids, category_dist')
    .eq('date', today)
    .single();

  if (error || !mock) {
    return <NoMockToday date={today} streak={streak} />;
  }

  // mock.questions is uuid[] (per migration 008). Hydrate full Question objects
  // from n2_questions so InteractiveMock receives the data shape it expects
  // (prompt, options, category, correct_answer, explanation — not bare UUIDs).
  const questionIds: string[] = Array.isArray(mock.question_ids)
    ? (mock.question_ids as string[])
    : [];

  let hydratedQuestions: Question[] = [];
  if (questionIds.length > 0) {
    const { data: questions } = await supabase
      .from('n2_questions')
      .select('id, category, tags, difficulty, prompt, target_word, options, correct_answer, explanation, explanation_en, source_id, passage')
      .in('id', questionIds);

    // questionIds are in canonical presentation order; preserve that order after hydration.
    const questionMap = new Map((questions ?? []).map(q => [q.id, q as Question]));
    hydratedQuestions = questionIds
      .map(id => questionMap.get(id))
      .filter((q): q is Question => q !== undefined);
  }

  const focus = focusLabel(mock.category_dist as Record<string, number> | null);
  const hydratedMock = { id: null, date: mock.date, questions: hydratedQuestions };
  return (
    <TiltedCard>
      <IssueMeta />
      <NavBar current="/today" />
      <InteractiveMock mock={hydratedMock} streak={streak} focus={focus} />
    </TiltedCard>
  );
}

function NoMockToday({ date, streak }: { date: string; streak: number }) {
  return (
    <TiltedCard>
      <IssueMeta />
      <NavBar current="/today" />
      <header className="card-page-header">
        <StreakBadge count={streak} />
      </header>
      <h1 className="card-h1 card-h1--jp card-heading-with-lede">
        今日のモックはまだありません
      </h1>
      <p className="card-lede">
        {date} の N2 モックはまだ公開されていません。
        07:30 JST 以降にもう一度ご確認ください。
      </p>
      {/* 2026-07-23 gap-killer: card-footer-nav added for structural
          parity with /progress and /revision. NoMockToday previously
          had no footer affordance — other auth-gated empty-state pages
          all carry a card-footer-nav. Added after the NoMockToday
          lede so users can navigate away from the empty state. Uses
          card-footer-nav--end (single link, right-aligned) since
          there's no "next" destination when today's mock isn't
          published. card-meta-link + card-secondary reuse locked
          link styling tokens. */}
      <footer className="card-footer-nav card-footer-nav--end">
        <Link href="/" className="card-meta-link card-secondary">← ホームに戻る</Link>
      </footer>
    </TiltedCard>
  );
}