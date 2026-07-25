/**
 * app/api/cron/daily-mock/route.ts — daily N2 mock generator.
 *
 * v4 (2026-07-25): ONE generate+verify attempt per cron invocation.
 *
 * Why the rewrite: Vercel Hobby kills functions at 60s. A single
 * generate+verify round-trip against Gemini is ~30-45s, so TWO attempts
 * in one invocation (the v3 "phase" design) could hit ~80-100s and die as
 * FUNCTION_INVOCATION_TIMEOUT — which is exactly what happened on
 * 2026-07-25 (no mock published, manual trigger timed out). v4 does at
 * most ONE attempt per invocation (comfortably <55s) and chains attempts
 * across MULTIPLE morning cron fires using n2_pipeline_runs as the
 * hand-off state.
 *
 * vercel.json fires this route several times across the morning
 * (05:30-07:30 JST, ±59min Hobby jitter). The route decides what to do
 * from n2_pipeline_runs state:
 *
 *   - No row for today            → claim lock (in_progress) → run attempt 1 (initial)
 *   - status='success'            → noop (mock already published)
 *   - status='in_progress' fresh  → noop (another fire is mid-attempt)
 *   - status='in_progress' stale  → take over a crashed/timed-out run
 *     (>3 min old)
 *   - status='failed' + error_message.rotation_pending
 *                                 → claim → run the NEXT attempt, resuming
 *                                   the carried-over passing candidates
 *   - status='failed' otherwise   → noop (terminal: critical or pre-v4)
 *
 * Attempt escalation (by counted attempt number, transport errors don't
 * count so a hung Gemini call just gets retried on the next fire):
 *   1        → initial (full day plan)
 *   2, 3     → same_subtype retry of the still-incomplete subtypes, with
 *              the verifier's rejection notes fed back
 *   4        → pool_substitute: replace still-failing subtypes with fresh
 *              pool picks, INHERITING the failing subtype's planned count
 *              (so the 5-question invariant holds) and preferring the same
 *              category. Attempts beyond 4 → critical failure (alerted).
 *
 * The run_date UNIQUE constraint makes the in_progress lock atomic, so
 * overlapping fires (jitter bunching, or a manual re-trigger) can't
 * double-generate. Fail-closed contract holds: no mock publishes unless
 * all 5 required questions pass structural + verifier checks. A missing
 * mock is the correct, honest failure state.
 *
 * Gemini budget: 2 calls per attempt. Clean day = 1 attempt = 2 calls;
 * worst case = 4 counted attempts = 8 calls/day. No-op fires call Gemini
 * zero times.
 *
 * Rotation state lives in n2_rotation_state (serverless has no disk).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleSupabase } from '@/lib/supabase';
import { planDay, CATEGORY_MAP, READING_SUBTYPES } from '@/lib/n2-rotation';
import { N2_PROMPTS } from '@/lib/n2-prompts';
import { renderEmail, sendEmailWithRetry } from '@/lib/email';

export const maxDuration = 60;

type Candidate = {
  subtype: string;
  prompt: string | null;
  passage?: string | null;
  target_word?: string | null;
  options: { id: string; text: string; note: string | null }[];
  correct_answer: string;
  explanation: string;
  explanation_en: string;
  verify?: { passed: boolean; issues: string[] };
};

type AttemptResult = {
  passing: Candidate[];
  failing: Map<string, string[]>;
  transport_error?: string;
};

type AttemptTrace = {
  attempt: number;
  type: 'initial' | 'same_subtype' | 'pool_substitute';
  passing_subtypes: string[];
  failing_subtypes: string[];
  failing_issues: Record<string, string[]>;
  transport_error?: string;
};

const ALL_SUBTYPES: readonly string[] = [
  'kanji_reading',
  'contextual_vocab',
  'word_formation_synonym',
  'grammar_formats',
  'sentence_order',
  'text_grammar',
  'long_essay',
  'info_retrieval',
  'short_medium_passage',
  'integrated_comprehension',
];

// Bumped to v4 for the one-attempt-per-invocation rewrite. Keep in lockstep
// with docs/HANDOFF.md and the post-cron check crons (they parse this).
const PIPELINE_VERSION = 'n2-daily-mock-cron-v4';
const MAX_ATTEMPTS = 4;
// A single attempt is <55s; anything holding the lock longer than this
// crashed or hit the wall, so a later fire may take it over.
const STALE_LOCK_MS = 3 * 60_000;

// Per-call hard timeout. One attempt = generate + verify = 2 calls. At 22s
// each that's ≤44s, leaving headroom under the 60s wall for the DB reads,
// publish writes, and email fan-out. An AbortController is the only thing
// that can interrupt an in-flight fetch (there is no between-call guard to
// lean on any more — each invocation makes just these two calls).
const GEMINI_CALL_TIMEOUT_MS = 22_000;

function jstDateString(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Gemini call timed out after ${GEMINI_CALL_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || text.length === 0) {
    const finishReason = data?.candidates?.[0]?.finishReason ?? 'unknown';
    const blockReason = data?.promptFeedback?.blockReason ?? 'none';
    throw new Error(`Gemini returned no text (finishReason=${finishReason}, blockReason=${blockReason})`);
  }
  return text;
}

function structuralCheck(c: Candidate): string[] {
  const issues: string[] = [];
  if (!c.options || c.options.length !== 4) {
    issues.push('does not have exactly 4 options');
    return issues;
  }
  const texts = c.options.map((o) => o.text);
  if (new Set(texts).size !== 4) issues.push('duplicate option text');
  const ids = c.options.map((o) => o.id);
  if (!ids.includes(c.correct_answer)) issues.push('correct_answer does not match any option id');

  if (c.subtype === 'sentence_order') {
    if (!c.options.every((o) => o.note === null)) issues.push('sentence_order options should all have note=null');
  } else {
    if (!c.options.every((o) => o.note)) issues.push('missing option note');
  }

  if (!c.explanation) issues.push('missing explanation');
  if (!c.explanation_en) issues.push('missing explanation_en');
  if (READING_SUBTYPES.has(c.subtype) && !c.passage) issues.push('missing passage for reading subtype');

  if (c.subtype === 'kanji_reading') {
    if (!c.target_word || !c.prompt || !c.prompt.includes(c.target_word)) {
      issues.push('missing or non-matching target_word for kanji_reading');
    }
  }
  if (c.subtype === 'word_formation_synonym' && c.target_word && c.prompt && !c.prompt.includes(c.target_word)) {
    issues.push('target_word does not match prompt for word_formation_synonym');
  }

  return issues;
}

function buildGenerateSections(
  plan: { subtype: string; count: number }[],
  recency: Record<string, { prompt: string; correct_answer: string }[]>,
  feedback: Record<string, string[]> | null,
): string {
  return plan
    .map(({ subtype, count }) => {
      const avoid = recency[subtype] ?? [];
      let section = `\n### SUBTYPE: ${subtype} (generate ${count})\n${N2_PROMPTS[subtype]}\n`;
      if (avoid.length > 0) {
        section += `Avoid repeating (already in the bank): ${JSON.stringify(avoid)}\n`;
      }
      if (feedback && feedback[subtype]) {
        section += `\nYour previous attempt for this subtype was rejected because: ${feedback[subtype].join('; ')}\nGenerate a NEW question that fixes these specific issues.\n`;
      }
      return section;
    })
    .join('\n');
}

async function runAttempt(
  plan: { subtype: string; count: number }[],
  recency: Record<string, { prompt: string; correct_answer: string }[]>,
  feedback: Record<string, string[]> | null,
): Promise<AttemptResult> {
  const sections = buildGenerateSections(plan, recency, feedback);
  const generatePrompt =
    'Generate JSON for the following JLPT N2 subtypes. Return a single JSON ' +
    "object keyed by subtype name, each value a JSON array of that subtype's " +
    'questions in the schema its section specifies.\n' +
    sections +
    '\nOutput ONLY the combined JSON object, no prose, no markdown fences.';

  let raw: string;
  try {
    raw = await callGemini(generatePrompt);
  } catch (err) {
    return { passing: [], failing: new Map(), transport_error: err instanceof Error ? err.message : String(err) };
  }

  let candidates: Candidate[];
  try {
    const parsed = JSON.parse(raw) as Record<string, Omit<Candidate, 'subtype'>[]>;
    candidates = Object.entries(parsed).flatMap(([subtype, items]) => items.map((item) => ({ ...item, subtype })));
  } catch (err) {
    return { passing: [], failing: new Map(), transport_error: `parse: ${err instanceof Error ? err.message : String(err)}` };
  }

  const structurallyValid: Candidate[] = [];
  const structurallyFailed: { subtype: string; issues: string[] }[] = [];
  for (const c of candidates) {
    const issues = structuralCheck(c);
    if (issues.length > 0) structurallyFailed.push({ subtype: c.subtype, issues });
    else structurallyValid.push(c);
  }

  if (structurallyValid.length > 0) {
    const indexed = structurallyValid.map((c, i) => ({ index: i, ...c }));
    const verifyPrompt =
      'You are a strict N2 exam proofreader — not the author. For each of the ' +
      "following candidates (indexed), find what's wrong, if anything. Check: " +
      '(a) the Japanese is natural and correct, (b) the stated correct_answer is ' +
      'actually correct, (c) the difficulty is genuinely JLPT N2 (not N3, not N1), ' +
      "(d) each option's `note` correctly explains why that specific option is " +
      'right or wrong, not a generic/copy-pasted line, (e) `explanation_en` ' +
      "actually matches the Japanese `explanation`'s reasoning, not a different " +
      `or vaguer point. Candidates: ${JSON.stringify(indexed)}\n\n` +
      'Respond with JSON only: a single array, one ' +
      '{"index": N, "passed": bool, "issues": [string]} ' +
      'object per candidate, same order as input.';

    try {
      const rawVerify = await callGemini(verifyPrompt);
      const verdicts = JSON.parse(rawVerify) as { index: number; passed: boolean; issues: string[] }[];
      const byIndex = new Map(verdicts.map((v) => [v.index, v]));
      structurallyValid.forEach((c, i) => {
        const v = byIndex.get(i);
        c.verify = v ? { passed: v.passed, issues: v.issues } : { passed: false, issues: ['missing from proofreader response'] };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      structurallyValid.forEach((c) => {
        c.verify = { passed: false, issues: [`verify_transport_error: ${msg}`] };
      });
    }
  }

  const passing: Candidate[] = [];
  const failing = new Map<string, string[]>();
  for (const sf of structurallyFailed) {
    failing.set(sf.subtype, [...(failing.get(sf.subtype) ?? []), ...sf.issues]);
  }
  for (const c of structurallyValid) {
    if (c.verify?.passed) passing.push(c);
    else failing.set(c.subtype, [...(failing.get(c.subtype) ?? []), ...(c.verify?.issues ?? ['unknown verify failure'])]);
  }

  return { passing, failing };
}

type CarryOver = {
  passing: Candidate[];
  passing_by_subtype: Record<string, number>;
  failing_issues: Record<string, string[]>;
  attempts: AttemptTrace[];
};

function parseCarryOver(errorMessage: string | null): CarryOver | null {
  try {
    const parsed = JSON.parse(errorMessage ?? 'null');
    if (parsed && parsed.rotation_pending === true) {
      return {
        passing: (parsed.passing ?? []) as Candidate[],
        passing_by_subtype: parsed.passing_by_subtype ?? {},
        failing_issues: parsed.failing_issues ?? {},
        attempts: parsed.attempts ?? [],
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleSupabase();
  const today = jstDateString(new Date());
  const ROUTE_START_MS = Date.now();

  // Idempotency guard.
  const { data: existingMock } = await supabase.from('n2_mocks').select('date').eq('date', today).maybeSingle();
  if (existingMock) {
    return NextResponse.json({ skipped: true, reason: 'already published for today' });
  }

  // --- Decide whether to run, and claim the lock atomically ---
  let carry: CarryOver = { passing: [], passing_by_subtype: {}, failing_issues: {}, attempts: [] };
  let willRun = false;
  let noopReason = 'no_phase_to_run';

  const { data: todayRun } = await supabase
    .from('n2_pipeline_runs')
    .select('run_date,status,started_at,error_message')
    .eq('run_date', today)
    .maybeSingle();

  if (!todayRun) {
    const { error: lockErr } = await supabase.from('n2_pipeline_runs').insert({
      run_date: today,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      pipeline_version: PIPELINE_VERSION,
    });
    if (lockErr) noopReason = `lock_not_acquired: ${lockErr.message}`;
    else willRun = true;
  } else if (todayRun.status === 'success') {
    noopReason = 'already published for today';
  } else if (todayRun.status === 'in_progress') {
    const ageMs = Date.now() - new Date(todayRun.started_at).getTime();
    if (ageMs < STALE_LOCK_MS) {
      noopReason = 'another fire is mid-attempt';
    } else {
      const { data: takeover } = await supabase
        .from('n2_pipeline_runs')
        .update({ started_at: new Date().toISOString(), pipeline_version: PIPELINE_VERSION })
        .eq('run_date', today)
        .eq('status', 'in_progress')
        .eq('started_at', todayRun.started_at)
        .select('error_message');
      if (takeover && takeover.length > 0) {
        carry = parseCarryOver(takeover[0].error_message) ?? carry;
        willRun = true;
      } else {
        noopReason = 'lost stale-lock takeover race';
      }
    }
  } else {
    // status === 'failed'
    const resumable = parseCarryOver(todayRun.error_message);
    if (resumable) {
      const { data: claimed } = await supabase
        .from('n2_pipeline_runs')
        .update({ status: 'in_progress', started_at: new Date().toISOString() })
        .eq('run_date', today)
        .eq('status', 'failed')
        .select('run_date');
      if (claimed && claimed.length > 0) {
        carry = resumable;
        willRun = true;
      } else {
        noopReason = 'next attempt already claimed by another fire';
      }
    } else {
      noopReason = 'terminal failure (already alerted or pre-v4)';
    }
  }

  if (!willRun) {
    return NextResponse.json({ skipped: true, reason: noopReason });
  }

  // --- Plan the day (deterministic; rotation only advances on publish) ---
  const { data: rotation } = await supabase.from('n2_rotation_state').select('*').eq('id', 1).single();
  if (!rotation) {
    await logFailedRun(supabase, today, 'rotation state missing (n2_rotation_state id=1)');
    return NextResponse.json({ error: 'rotation state missing', published: false }, { status: 500 });
  }
  const dayPlan = planDay(rotation.cycle_number, rotation.subtype_last_used);
  const plannedTotal = dayPlan.subtypes.reduce((acc, s) => acc + s.count, 0);

  // subtypePlannedCount tracks the target per subtype, mutated by
  // pool-substitution (a failing subtype is removed and its count moved to
  // the substitute) so the totals always sum to plannedTotal.
  const subtypePlannedCount: Record<string, number> = Object.fromEntries(dayPlan.subtypes.map((s) => [s.subtype, s.count]));

  // Restore carry-over state from the previous fire.
  const passing: Candidate[] = carry.passing;
  const passingBySubtype: Record<string, number> = carry.passing_by_subtype;
  let failing = new Map<string, string[]>(Object.entries(carry.failing_issues));
  const trace: AttemptTrace[] = carry.attempts;
  // Any subtype that ended up as a substitute in a prior fire must be in
  // subtypePlannedCount too (so deficit math and the publish invariant hold).
  for (const s of Object.keys(passingBySubtype)) {
    if (!(s in subtypePlannedCount)) subtypePlannedCount[s] = passingBySubtype[s];
  }

  function addPassing(c: Candidate) {
    const cap = subtypePlannedCount[c.subtype] ?? 1;
    const have = passingBySubtype[c.subtype] ?? 0;
    if (have < cap) {
      passing.push(c);
      passingBySubtype[c.subtype] = have + 1;
    }
  }
  const deficitSubtypes = () =>
    Object.keys(subtypePlannedCount).filter((s) => (passingBySubtype[s] ?? 0) < subtypePlannedCount[s]);

  // Counted attempts so far (transport errors don't consume the budget —
  // a hung Gemini call just gets retried on the next fire).
  const countedSoFar = trace.filter((t) => !t.transport_error).length;
  const nextAttempt = countedSoFar + 1;

  if (nextAttempt > MAX_ATTEMPTS) {
    await logCritical(supabase, today, trace, passing, failing, 'attempts_exhausted');
    return NextResponse.json({ error: 'critical_failure', reason: 'attempts_exhausted', published: false }, { status: 200 });
  }

  // Recency ("avoid repeats") for all 10 subtypes, fetched in parallel.
  const recencyEntries = await Promise.all(
    ALL_SUBTYPES.map(async (subtype) => {
      const { data } = await supabase
        .from('n2_questions')
        .select('prompt, correct_answer')
        .contains('tags', [subtype])
        .order('created_at', { ascending: false })
        .limit(8);
      return [subtype, (data as { prompt: string; correct_answer: string }[] | null) ?? []] as const;
    }),
  );
  const recency: Record<string, { prompt: string; correct_answer: string }[]> = Object.fromEntries(recencyEntries);

  // --- Build THIS attempt's plan ---
  let plan: { subtype: string; count: number }[];
  let attemptType: AttemptTrace['type'];
  let feedback: Record<string, string[]> | null = null;

  if (nextAttempt === 1) {
    plan = dayPlan.subtypes;
    attemptType = 'initial';
  } else if (nextAttempt <= 3) {
    // same_subtype retry: regenerate only the still-deficient subtypes,
    // feeding back the verifier's rejection notes.
    const deficit = deficitSubtypes();
    plan = deficit.map((s) => ({ subtype: s, count: subtypePlannedCount[s] - (passingBySubtype[s] ?? 0) }));
    attemptType = 'same_subtype';
    feedback = Object.fromEntries(deficit.map((s) => [s, failing.get(s) ?? ['previously incomplete']]));
  } else {
    // nextAttempt === 4: pool_substitute the still-deficient subtypes.
    const deficit = deficitSubtypes();
    const taken = new Set<string>(Object.keys(subtypePlannedCount).concat(Object.keys(passingBySubtype)));
    const substitutes: { subtype: string; count: number }[] = [];
    const newFeedback: Record<string, string[]> = {};
    for (const dropping of deficit) {
      const pool = ALL_SUBTYPES.filter((s) => !taken.has(s));
      const pick = pool.find((s) => CATEGORY_MAP[s] === CATEGORY_MAP[dropping]) ?? pool[0];
      if (!pick) {
        await logCritical(supabase, today, trace, passing, failing, 'pool_exhausted');
        return NextResponse.json({ error: 'critical_failure', reason: 'pool_exhausted', published: false }, { status: 200 });
      }
      const inherited = subtypePlannedCount[dropping];
      substitutes.push({ subtype: pick, count: inherited });
      newFeedback[pick] = [
        ...(failing.get(dropping) ?? ['unspecified']),
        `(Substituting for ${dropping}, which failed verification repeatedly today)`,
      ];
      taken.add(pick);
      // Wipe the failing subtype's partial passing — start the substitute fresh.
      for (let i = passing.length - 1; i >= 0; i--) if (passing[i].subtype === dropping) passing.splice(i, 1);
      delete passingBySubtype[dropping];
      delete subtypePlannedCount[dropping];
      subtypePlannedCount[pick] = inherited;
    }
    plan = substitutes;
    attemptType = 'pool_substitute';
    feedback = newFeedback;
  }

  // --- Run exactly one attempt ---
  const result = await runAttempt(plan, recency, feedback);

  if (result.transport_error && result.passing.length === 0) {
    // Wasted fire — record it (won't count toward the budget) and hand
    // back to the next cron fire to retry the same attempt.
    trace.push({
      attempt: nextAttempt,
      type: attemptType,
      passing_subtypes: [],
      failing_subtypes: deficitSubtypes(),
      failing_issues: Object.fromEntries(failing),
      transport_error: result.transport_error,
    });
    await persistPending(supabase, today, passing, passingBySubtype, failing, trace);
    return NextResponse.json({
      attempt: nextAttempt,
      transport_error: result.transport_error,
      published: false,
      rotation_pending: true,
    });
  }

  for (const c of result.passing) addPassing(c);
  failing = result.failing;
  trace.push({
    attempt: nextAttempt,
    type: attemptType,
    passing_subtypes: result.passing.map((c) => c.subtype),
    failing_subtypes: [...failing.keys()],
    failing_issues: Object.fromEntries(failing),
  });

  const stillIncomplete = passing.length < plannedTotal;
  if (stillIncomplete) {
    if (nextAttempt >= MAX_ATTEMPTS) {
      await logCritical(supabase, today, trace, passing, failing, 'insufficient_passing');
      return NextResponse.json({
        error: 'critical_failure',
        reason: 'insufficient_passing',
        passing_count: passing.length,
        planned_total: plannedTotal,
        published: false,
      }, { status: 200 });
    }
    await persistPending(supabase, today, passing, passingBySubtype, failing, trace);
    return NextResponse.json({
      attempt: nextAttempt,
      rotation_pending: true,
      passing_count: passing.length,
      planned_total: plannedTotal,
      failing_subtypes: [...failing.keys()],
      elapsed_ms: Date.now() - ROUTE_START_MS,
      published: false,
    });
  }

  // --- Publish (all 5 passed) ---
  const rows = passing.map((c) => ({
    category: CATEGORY_MAP[c.subtype],
    prompt: c.prompt,
    target_word: c.target_word ?? null,
    options: c.options,
    correct_answer: c.correct_answer,
    explanation: c.explanation,
    explanation_en: c.explanation_en,
    passage: c.passage ?? null,
    source_id: `gemini_generated_verified_v4`,
    tags: [c.subtype],
  }));
  const { data: stored, error: storeError } = await supabase.from('n2_questions').insert(rows).select('id, tags');
  if (storeError || !stored) {
    await logFailedRun(supabase, today, `store step failed: ${storeError?.message}`);
    return NextResponse.json({ error: 'store failed', published: false }, { status: 500 });
  }

  const attemptsSummary = trace.map((t) => ({
    attempt: t.attempt,
    type: t.type,
    passing_subtypes: t.passing_subtypes,
    failing_subtypes: t.failing_subtypes,
  }));
  const baseRunRow = {
    run_date: today,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    status: 'success' as const,
    error_message: null,
    questions_published: stored.length,
    target_categories: [...new Set(stored.map((s) => CATEGORY_MAP[s.tags[0]]))],
    target_tags: dayPlan.subtypes.map((s) => s.subtype),
    pipeline_version: PIPELINE_VERSION,
  };

  let runRowId: string | null = null;
  const { data: runRowPrimary, error: runErrorPrimary } = await supabase
    .from('n2_pipeline_runs')
    .upsert({ ...baseRunRow, attempts: attemptsSummary }, { onConflict: 'run_date' })
    .select('id')
    .single();
  if (runErrorPrimary || !runRowPrimary) {
    const { data: fallbackRow, error: fallbackError } = await supabase
      .from('n2_pipeline_runs')
      .upsert(baseRunRow, { onConflict: 'run_date' })
      .select('id')
      .single();
    if (fallbackError || !fallbackRow) {
      return NextResponse.json({ error: 'pipeline_runs insert failed', published: false }, { status: 500 });
    }
    runRowId = fallbackRow.id;
  } else {
    runRowId = runRowPrimary.id;
  }

  const categoryDist: Record<string, number> = {};
  for (const s of Object.keys(passingBySubtype)) categoryDist[s] = passingBySubtype[s];

  const { error: mockError } = await supabase.from('n2_mocks').insert({
    date: today,
    question_ids: stored.map((s) => s.id),
    category_dist: categoryDist,
    target_tags: dayPlan.subtypes.map((s) => s.subtype),
    pipeline_run_id: runRowId,
  });
  if (mockError) {
    await logFailedRun(supabase, today, `n2_mocks insert failed: ${mockError.message}`);
    return NextResponse.json({ error: 'n2_mocks insert failed', detail: mockError.message, published: false }, { status: 500 });
  }

  // Advance rotation from what ACTUALLY published (not the day plan), so a
  // substituted-away subtype keeps its old last_used and gets retried soon.
  const updatedSubtypeLastUsed = { ...rotation.subtype_last_used };
  for (const subtype of Object.keys(passingBySubtype)) {
    updatedSubtypeLastUsed[subtype] = dayPlan.cycle_number;
  }
  await supabase
    .from('n2_rotation_state')
    .update({ cycle_number: dayPlan.cycle_number, subtype_last_used: updatedSubtypeLastUsed, updated_at: new Date().toISOString() })
    .eq('id', 1);

  // Email fan-out (never blocks publish).
  try {
    await fanOutDailyMockEmails(supabase, today, dayPlan, ROUTE_START_MS);
  } catch (err) {
    console.error('[daily-mock] email fan-out threw:', err instanceof Error ? err.message : String(err));
  }

  return NextResponse.json({
    published: true,
    date: today,
    cycle_day: dayPlan.cycle_day,
    subtypes: Object.keys(passingBySubtype),
    question_count: stored.length,
    attempts_used: trace.length,
    elapsed_ms: Date.now() - ROUTE_START_MS,
  });
}

async function persistPending(
  supabase: ReturnType<typeof createServiceRoleSupabase>,
  today: string,
  passing: Candidate[],
  passingBySubtype: Record<string, number>,
  failing: Map<string, string[]>,
  trace: AttemptTrace[],
) {
  // status='failed' + rotation_pending marker = resumable by the next
  // cron fire. Format matches the post-cron check crons' parser.
  const carryOver = {
    rotation_pending: true,
    date: today,
    passing,
    passing_by_subtype: passingBySubtype,
    failing_subtypes: [...failing.keys()],
    failing_issues: Object.fromEntries(failing),
    attempts: trace,
  };
  const errorMessage = JSON.stringify(carryOver);
  const { error } = await supabase.from('n2_pipeline_runs').upsert(
    {
      run_date: today,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: 'failed' as const,
      error_message: errorMessage,
      pipeline_version: PIPELINE_VERSION,
      attempts: trace,
    },
    { onConflict: 'run_date' },
  );
  if (error) {
    // The attempts column may not exist on very old schemas — retry without it.
    await supabase.from('n2_pipeline_runs').upsert(
      {
        run_date: today,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        status: 'failed' as const,
        error_message: errorMessage,
        pipeline_version: PIPELINE_VERSION,
      },
      { onConflict: 'run_date' },
    );
  }
}

async function fanOutDailyMockEmails(
  supabase: ReturnType<typeof createServiceRoleSupabase>,
  date: string,
  dayPlan: { subtypes: { subtype: string; count: number }[] },
  routeStartMs: number,
): Promise<void> {
  const focus =
    dayPlan.subtypes.length === 1
      ? dayPlan.subtypes[0].subtype
      : dayPlan.subtypes.map((s) => `${s.subtype} (×${s.count})`).join(', ');

  const { data: subscribers, error: subErr } = await supabase
    .from('n2_subscribers')
    .select('user_id, email')
    .is('unsubscribed_at', null);

  if (subErr) {
    console.error('[daily-mock] subscriber query failed:', subErr.message);
    return;
  }
  if (!subscribers || subscribers.length === 0) {
    console.log('[daily-mock] no active subscribers — skipping email fan-out');
    return;
  }

  const FANOUT_DEADLINE_MS = 55_000;
  const logRows: Array<Record<string, unknown>> = [];
  for (const sub of subscribers) {
    if (!sub.email || !sub.user_id) continue;
    if (Date.now() - routeStartMs > FANOUT_DEADLINE_MS) {
      console.warn('[daily-mock] fan-out stopped at time budget — remaining subscribers skipped');
      logRows.push({
        user_id: sub.user_id,
        mock_date: date,
        resend_id: null,
        status: 'failed',
        error_message: 'skipped: function time budget exhausted',
        attempt_count: 1,
      });
      continue;
    }
    const template = renderEmail({ userId: sub.user_id, date, focus });
    const result = await sendEmailWithRetry(sub.email, template);
    logRows.push({
      user_id: sub.user_id,
      mock_date: date,
      resend_id: result.resendId ?? null,
      status: result.ok ? 'sent' : 'failed_after_retry',
      error_message: result.error ? result.error.slice(0, 500) : null,
      attempt_count: result.attempts,
    });
  }

  if (logRows.length > 0) {
    const { error: logErr } = await supabase.from('n2_email_send_log').insert(logRows);
    if (logErr) console.error('[daily-mock] email_send_log insert failed:', logErr.message);
  }

  const sentIds = logRows.filter((r) => r.status === 'sent').map((r) => r.user_id as string);
  if (sentIds.length > 0) {
    const { error: rpcErr } = await supabase.rpc('n2_mark_email_sent', { p_user_ids: sentIds });
    if (rpcErr) {
      console.warn('[daily-mock] n2_mark_email_sent rpc failed, falling back:', rpcErr.message);
      await supabase.from('n2_subscribers').update({ last_sent_at: new Date().toISOString() }).in('user_id', sentIds);
    }
  }

  const sent = sentIds.length;
  console.log(`[daily-mock] fan-out done for ${date}: ${sent} sent, ${logRows.length - sent} failed`);
}

async function logFailedRun(
  supabase: ReturnType<typeof createServiceRoleSupabase>,
  date: string,
  message: string,
) {
  const { error } = await supabase.from('n2_pipeline_runs').upsert(
    {
      run_date: date,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: 'failed',
      error_message: message,
      pipeline_version: PIPELINE_VERSION,
    },
    { onConflict: 'run_date' },
  );
  if (error) console.error('[daily-mock] logFailedRun upsert itself failed:', error.message);
}

async function logCritical(
  supabase: ReturnType<typeof createServiceRoleSupabase>,
  date: string,
  trace: AttemptTrace[],
  passing: Candidate[],
  failing: Map<string, string[]>,
  reason: string,
) {
  const criticalPayload = {
    critical: true,
    reason,
    date,
    attempts: trace.map((t) => ({
      attempt: t.attempt,
      type: t.type,
      passing: t.passing_subtypes,
      failing: t.failing_subtypes,
      issues: t.failing_issues,
      transport_error: t.transport_error,
    })),
    passing_count: passing.length,
    failing_subtypes: [...failing.keys()],
    failing_issues: Object.fromEntries(failing),
  };
  const errorMessage = JSON.stringify(criticalPayload);
  const { error } = await supabase.from('n2_pipeline_runs').upsert(
    {
      run_date: date,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: 'failed' as const,
      error_message: errorMessage,
      pipeline_version: PIPELINE_VERSION,
      attempts: criticalPayload.attempts,
    },
    { onConflict: 'run_date' },
  );
  if (error) await logFailedRun(supabase, date, errorMessage);
  console.error(`[daily-mock] CRITICAL_FAILURE ${date} reason=${reason} passing=${passing.length} failing=${[...failing.keys()].join(',')}`);
}
