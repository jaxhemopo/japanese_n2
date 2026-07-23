/**
 * lib/get-result.ts — Shared result-fetch helper.
 *
 * Used by both /app/result/[date]/page.tsx (server component) and the
 * /api/attempts/[date] route handler so the breakdown data shape stays
 * in lockstep.
 *
 * Why direct fetch() instead of supabase-js:
 *   Jackson, 2026-07-14 — debug session. supabase-js's PostgrestQueryBuilder
 *   chained `.eq('user_id', x).in('question_id', [5 uuids])` returned ZERO
 *   rows, but each filter worked in isolation, AND the equivalent raw REST
 *   GET returned all 5 rows. Same query, different chain builder. Suspected
 *   URL-builder bug in @supabase/postgrest-js.
 *   Workaround: hand-build the PostgREST URL.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type AttemptRow = {
  question_id: string;
  user_answer: string;
  time_seconds: number;
  is_correct: boolean;
  question: Record<string, unknown> | null;
};

export type ResultData = {
  mock: { id: string | null; date: string; questions: string[] } | null;
  attempts: AttemptRow[];
  score: number;
  total: number;
  total_seconds: number;
};

/**
 * Internal: build a PostgREST URL for an `n2_attempts` filter by user_id
 * and an IN-list of question_ids. Bypasses supabase-js PostgrestQueryBuilder
 * due to a chain-builder bug (see file header).
 */
async function fetchAttemptsRaw(
  url: string,
  serviceRoleKey: string,
  userId: string,
  questionIds: string[],
): Promise<Array<Record<string, unknown>>> {
  const inList = `(${questionIds.join(',')})`;
  // Order by created_at DESC so the newest attempt per question is first;
  // caller dedupes by keeping the first entry per question_id.
  const restUrl = `${url}/rest/v1/n2_attempts?user_id=eq.${userId}&question_id=in.${inList}&select=question_id,user_answer,time_seconds,created_at&order=created_at.desc`;
  const res = await fetch(restUrl, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`attempts fetch failed: HTTP ${res.status} ${text}`);
  }
  return (await res.json()) as Array<Record<string, unknown>>;
}

export async function fetchResultForDate(
  supabase: SupabaseClient,
  userId: string,
  date: string,
): Promise<ResultData> {
  // 1. Locate the published mock for [date] in public.n2_mocks.
  const { data: mockRows, error: mockErr } = await supabase
    .from('n2_mocks')
    .select('date, question_ids')
    .eq('date', date)
    .limit(1);
  if (mockErr) {
    throw new Error(`mock query failed: ${mockErr.message}`);
  }
  const mock = mockRows?.[0] ?? null;
  if (!mock) {
    return { mock: null, attempts: [], score: 0, total: 0, total_seconds: 0 };
  }

  const questionIds: string[] = Array.isArray(mock.question_ids)
    ? (mock.question_ids as string[])
    : [];

  // 2. Fetch the user's attempts via raw REST (supabase-js chain bug bypass).
  //    supabase-js gives us the URL + service-role key; we construct the
  //    PostgREST URL ourselves for this one query.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const attemptsRaw = await fetchAttemptsRaw(
    supabaseUrl,
    serviceRoleKey,
    userId,
    questionIds,
  );

  // 3. Join the question metadata (single-chain works fine here, no .eq().in() issue).
  let questionMap: Record<string, Record<string, unknown>> = {};
  if (questionIds.length > 0) {
    const { data: questions, error: qErr } = await supabase
      .from('n2_questions')
      .select('id, category, tags, difficulty, prompt, target_word, options, correct_answer, explanation, explanation_en, source_id, passage')
      .in('id', questionIds);
    if (qErr) {
      throw new Error(`questions query failed: ${qErr.message}`);
    }
    for (const q of questions ?? []) {
      questionMap[q.id] = q as Record<string, unknown>;
    }
  }

  // 4. Dedupe: keep the newest attempt per question_id only.
  //    (Rows come ordered by created_at DESC from the query above.)
  const latestByQuestion: Record<string, Record<string, unknown>> = {};
  for (const a of attemptsRaw) {
    const qid = String(a.question_id);
    if (!(qid in latestByQuestion)) {
      latestByQuestion[qid] = a;
    }
  }
  const dedupedAttempts = Object.values(latestByQuestion);

  // 5. Enrich each (latest) attempt.
  const enriched = dedupedAttempts.map((a) => {
    const qid = String(a.question_id);
    const q = questionMap[qid];
    const correctAnswer = q?.correct_answer as string | undefined;
    return {
      question_id: qid,
      user_answer: String(a.user_answer ?? ''),
      time_seconds: typeof a.time_seconds === 'number' ? a.time_seconds : 0,
      is_correct: correctAnswer !== undefined && correctAnswer === a.user_answer,
      question: q ?? null,
    };
  });

  const score = enriched.filter((a) => a.is_correct).length;
  const totalSeconds = enriched.reduce(
    (sum, a) => sum + a.time_seconds,
    0,
  );

  return {
    mock: { id: null, date: mock.date, questions: questionIds },
    attempts: enriched,
    score,
    total: enriched.length,
    total_seconds: totalSeconds,
  };
}