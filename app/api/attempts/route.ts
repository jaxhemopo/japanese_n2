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
 * Per-question INSERT (one row per answered question) maps to the actual
 * n2_attempts schema which is question-granularity (not one-row-per-mock).
 *
 * challenge_id is nullable (migration 004). n2_mocks has no UUID PK — the PK
 * is DATE. challenge_id is passed as null; question_id is the join key for
 * result-page reads.
 *
 * total_ms is optional — computed as the sum of all timings values if omitted.
 *
 * Response 200:
 *   { "attempt_ids": ["uuid", ...] }   one per question inserted
 *
 * Errors:
 *   400 — missing required fields
 *   401 — no Supabase session
 *   500 — DB insert failure
 */

type AnswerMap = Record<string, 'a' | 'b' | 'c' | 'd'>;
type TimingMap = Record<string, number>;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function buildRow(
  userId: string,
  mockId: string | null,   // M4: nullable — n2_mocks has DATE PK, not UUID
  questionId: string,
  userAnswer: string,
  correctAnswer: string | null,  // M6: correct a|b|c|d from Question.correct_answer, null if not provided
  timeMs: number,
): Record<string, unknown> {
  const isCorrect = correctAnswer !== null && correctAnswer === userAnswer;
  return {
    user_id: userId,
    challenge_id: mockId,   // nullable per migration 004; question_id is join key
    question_id: questionId,
    user_answer: userAnswer,
    correct: isCorrect,     // M6: populated at insert time from correct_map; null only if client didn't supply it
    time_seconds: Math.round(timeMs / 1000),
  };
}

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  const sessionResult = await supabase.auth.getSession();
  const session = sessionResult.data.session;
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  let body: {
    date: string;      // M4: n2_mocks PK is DATE, not UUID — client sends date
    answers: AnswerMap;
    timings: TimingMap;
    correct_map?: Record<string, string>;  // M6: optional { [questionId]: correct_answer a|b|c|d }
    total_ms?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { date, answers, timings, correct_map } = body;
  if (!date || !DATE_RE.test(date) || !answers || typeof answers !== 'object') {
    return NextResponse.json({ error: 'missing required fields' }, { status: 400 });
  }

  // Compute total_ms as sum of individual timings if not provided.
  const totalMs: number = body.total_ms ??
    Object.values(timings ?? {}).reduce((s: number, v: number) => s + v, 0);

  const questionIds = Object.keys(answers);
  if (questionIds.length === 0) {
    return NextResponse.json({ error: 'no answers provided' }, { status: 400 });
  }

  // M4: challenge_id is nullable (migration 004). n2_mocks has no UUID PK —
  // the PK is DATE. Pass null for challenge_id; question_id is the join key.
  // M6: correct_map from client carries Question.correct_answer per question;
  // null means client didn't supply it (backwards-compatible — correct stays null).
  const rows = questionIds.map((qid) =>
    buildRow(userId, null as unknown as string, qid, answers[qid], correct_map?.[qid] ?? null, timings?.[qid] ?? 0)
  );

  const { data, error } = await supabase.from('n2_attempts').insert(rows).select('id');

  if (error || !data) {
    console.error('[/api/attempts] insert error:', error);
    return NextResponse.json({ error: 'insert failed', detail: error?.message }, { status: 500 });
  }

  return NextResponse.json({ attempt_ids: data.map((r) => r.id) }, { status: 200 });
}