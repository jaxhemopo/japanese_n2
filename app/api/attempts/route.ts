import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';

/**
 * app/api/attempts/route.ts — POST /api/attempts
 *
 * Inserts per-question attempt rows into n2_attempts.
 * Request body (JSON):
 *   {
 *     "date":       "YYYY-MM-DD — M4: n2_mocks PK is DATE (not UUID)",
 *     "answers":    { "<question_id>": "a"|"b"|"c"|"d", ... },
 *     "timings":    { "<question_id>": 12000, ... }   (ms per question)
 *     "total_ms":   600000  (optional — computed from timings if omitted)
 *   }
 *
 * Correctness is computed SERVER-SIDE (2026-07-24): the route looks up
 * correct_answer from n2_questions for the submitted question ids. The
 * old contract accepted a client-built `correct_map` and stored whatever
 * the browser claimed — spoofable, and it poisoned the shared revision
 * digest (which ranks questions by the stored `correct` column across
 * all users). `correct_map` is still accepted in the body for old
 * clients but is IGNORED.
 *
 * Validation (2026-07-24): answers must be a|b|c|d and every question_id
 * must belong to the given date's published mock — arbitrary rows can no
 * longer be inserted to inflate /progress or skew the digest.
 *
 * Per-question INSERT (one row per answered question) maps to the actual
 * n2_attempts schema which is question-granularity (not one-row-per-mock).
 * challenge_id stays null (migration 004) — n2_mocks PK is DATE, and
 * question_id is the join key for result-page reads.
 *
 * Response 200:
 *   { "attempt_ids": ["uuid", ...] }   one per question inserted
 *
 * Errors:
 *   400 — missing/invalid fields, unknown question ids for that date
 *   401 — no authenticated Supabase user
 *   404 — no mock published for that date
 *   500 — DB failure
 */

type AnswerMap = Record<string, string>;
type TimingMap = Record<string, number>;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_ANSWERS = new Set(['a', 'b', 'c', 'd']);

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  // getUser() revalidates the JWT against the auth server — getSession()
  // in server code trusts the cookie without verification (swapped
  // 2026-07-24 per Supabase's own server-side guidance).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = user.id;

  let body: {
    date: string;
    answers: AnswerMap;
    timings?: TimingMap;
    correct_map?: Record<string, string>; // legacy — accepted, ignored
    total_ms?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { date, answers, timings } = body;
  if (!date || !DATE_RE.test(date) || !answers || typeof answers !== 'object') {
    return NextResponse.json({ error: 'missing required fields' }, { status: 400 });
  }

  const questionIds = Object.keys(answers);
  if (questionIds.length === 0) {
    return NextResponse.json({ error: 'no answers provided' }, { status: 400 });
  }
  for (const qid of questionIds) {
    const a = answers[qid];
    if (typeof a !== 'string' || !VALID_ANSWERS.has(a.toLowerCase())) {
      return NextResponse.json(
        { error: `invalid answer for question ${qid} (expected a|b|c|d)` },
        { status: 400 },
      );
    }
  }

  // The submitted questions must belong to the date's published mock.
  const { data: mock, error: mockErr } = await supabase
    .from('n2_mocks')
    .select('question_ids')
    .eq('date', date)
    .maybeSingle();
  if (mockErr) {
    return NextResponse.json({ error: 'mock lookup failed', detail: mockErr.message }, { status: 500 });
  }
  if (!mock) {
    return NextResponse.json({ error: `no mock published for ${date}` }, { status: 404 });
  }
  const mockQuestionIds = new Set<string>(
    Array.isArray(mock.question_ids) ? (mock.question_ids as string[]) : [],
  );
  const foreign = questionIds.filter((qid) => !mockQuestionIds.has(qid));
  if (foreign.length > 0) {
    return NextResponse.json(
      { error: `question ids not part of the ${date} mock`, ids: foreign },
      { status: 400 },
    );
  }

  // Server-side answer key (n2_questions is public-read under RLS).
  const { data: questions, error: qErr } = await supabase
    .from('n2_questions')
    .select('id, correct_answer')
    .in('id', questionIds);
  if (qErr || !questions) {
    return NextResponse.json(
      { error: 'answer key lookup failed', detail: qErr?.message },
      { status: 500 },
    );
  }
  const answerKey = new Map<string, string>(
    questions.map((q) => [q.id as string, String(q.correct_answer ?? '').toLowerCase()]),
  );

  const rows = questionIds.map((qid) => {
    const userAnswer = answers[qid].toLowerCase();
    const correctAnswer = answerKey.get(qid);
    const rawTiming = timings?.[qid];
    const timeMs =
      typeof rawTiming === 'number' && Number.isFinite(rawTiming) && rawTiming > 0
        ? rawTiming
        : 0;
    return {
      user_id: userId,
      challenge_id: null as string | null,
      question_id: qid,
      user_answer: userAnswer,
      // Computed here, never trusted from the client. Null only if the
      // question row vanished between mock lookup and now (FK is SET NULL).
      correct: correctAnswer !== undefined ? correctAnswer === userAnswer : null,
      time_seconds: Math.round(timeMs / 1000),
    };
  });

  const { data, error } = await supabase.from('n2_attempts').insert(rows).select('id');

  if (error || !data) {
    console.error('[/api/attempts] insert error:', error);
    return NextResponse.json({ error: 'insert failed', detail: error?.message }, { status: 500 });
  }

  return NextResponse.json({ attempt_ids: data.map((r) => r.id) }, { status: 200 });
}
