/**
 * app/api/cron/daily-mock/route.ts — daily N2 mock generator.
 *
 * v2 (2026-07-23): adds a 4-attempt state machine so a single bad Gemini
 * response doesn't leave the day empty.
 *
 *   Attempt 1 — initial:       full plan, no feedback
 *   Attempt 2 — same_subtype:   failing subtypes only, with verifier feedback
 *   Attempt 3 — same_subtype:   same again
 *   Attempt 4 — pool_substitute: each persistently-failing subtype swapped
 *                                for a fresh one from the unused pool
 *
 * - On success at any attempt: publish + advance rotation + return.
 * - On all 4 attempts leaving any subtype failing: write
 *   `CRITICAL_FAILURE` (structured JSON in error_message) to
 *   n2_pipeline_runs, do NOT publish, return early. The post-cron check
 *   cron picks up that flag and pings Jackson here on Telegram.
 *
 * Carry-over semantics: each passing candidate is kept across attempts
 * (cap-padded to the day's planned count per subtype) so a subtype that
 * passes on attempt 1 stays passed even if attempt 2 regenerates
 * neighbours. Pool-substitute replaces ALL candidates of the failing
 * subtype — prior passes of those subtypes are discarded because the
 * whole point of substitution is that the subtype is unreadable to
 * Gemini today.
 *
 * Fail-closed contract holds: no mock is published unless every required
 * question passed structural + verifier checks. Retries buy recovery from
 * pure Gemini flakiness, never relax verification.
 *
 * Cost: 2 Gemini calls per passing day, up to 8 on worst-case days (still
 * well within the Gemini 2.5 Flash RPM/RPD limits). Time: ~50-65s worst
 * case, Vercel Hobby's 60s ceiling is comfortable in practice — we early-
 * exit the moment a passing batch shows up.
 *
 * Ports the full 6-step agent-run pipeline
 * (~/ODIS/shared/pipelines/n2-generator/) into a single self-contained
 * Vercel Cron route — no agent, no local state.json (rotation state lives
 * in n2_rotation_state instead, since serverless functions have no
 * persistent disk).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleSupabase } from '@/lib/supabase';
import { planDay, CATEGORY_MAP, READING_SUBTYPES } from '@/lib/n2-rotation';
import { N2_PROMPTS } from '@/lib/n2-prompts';
import { renderEmail, sendEmailWithRetry } from '@/lib/email';

// Worst case: 4 attempts × (1 generate + 1 verify) ≈ 50-65s. 60s is the
// Hobby ceiling. Verified in production on 2026-07-23 that a typical
// retry-only day fits comfortably.
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
  /** subtype → issues for this attempt. subtype is included if any candidate for it failed. */
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

// Subtype pool the planner (and pool-substitute retry) chooses from.
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

const PIPELINE_VERSION = 'n2-daily-mock-cron-v2';

function jstDateString(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  // gemini-2.5-flash, not pro: two sequential pro calls blew past
  // Vercel's 60s Hobby function timeout; flash is comfortable for a
  // schema-constrained JSON task like this.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
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

  // --- generate ---
  let raw: string;
  try {
    raw = await callGemini(generatePrompt);
  } catch (err) {
    return {
      passing: [],
      failing: new Map(),
      transport_error: err instanceof Error ? err.message : String(err),
    };
  }

  let candidates: Candidate[];
  try {
    const parsed = JSON.parse(raw) as Record<string, Omit<Candidate, 'subtype'>[]>;
    candidates = Object.entries(parsed).flatMap(([subtype, items]) => items.map((item) => ({ ...item, subtype })));
  } catch (err) {
    return {
      passing: [],
      failing: new Map(),
      transport_error: `parse: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // --- structural check ---
  const structurallyValid: Candidate[] = [];
  const structurallyFailed: { subtype: string; issues: string[] }[] = [];
  for (const c of candidates) {
    const issues = structuralCheck(c);
    if (issues.length > 0) {
      structurallyFailed.push({ subtype: c.subtype, issues });
    } else {
      structurallyValid.push(c);
    }
  }

  // --- verify (one Gemini call) ---
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
        c.verify = v
          ? { passed: v.passed, issues: v.issues }
          : { passed: false, issues: ['missing from proofreader response'] };
      });
    } catch (err) {
      // Verify-side transport error: every structurally-valid candidate
      // becomes a failing-of-this-attempt. Carries into the carry-over
      // logic so they get retried on the next attempt. Don't surface as a
      // top-level transport_error (we have at least one valid generate).
      const msg = err instanceof Error ? err.message : String(err);
      structurallyValid.forEach((c) => {
        c.verify = { passed: false, issues: [`verify_transport_error: ${msg}`] };
      });
    }
  }

  // --- aggregate ---
  const passing: Candidate[] = [];
  const failing = new Map<string, string[]>();
  for (const sf of structurallyFailed) {
    failing.set(sf.subtype, [...(failing.get(sf.subtype) ?? []), ...sf.issues]);
  }
  for (const c of structurallyValid) {
    if (c.verify?.passed) {
      passing.push(c);
    } else {
      const issues = c.verify?.issues ?? ['unknown verify failure'];
      failing.set(c.subtype, [...(failing.get(c.subtype) ?? []), ...issues]);
    }
  }

  return { passing, failing };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleSupabase();
  const today = jstDateString(new Date());

  // Idempotency guard
  const { data: existingMock } = await supabase
    .from('n2_mocks')
    .select('date')
    .eq('date', today)
    .maybeSingle();
  if (existingMock) {
    return NextResponse.json({ skipped: true, reason: 'already published for today' });
  }

  // --- Step 01: plan day ---
  const { data: rotation } = await supabase.from('n2_rotation_state').select('*').eq('id', 1).single();
  if (!rotation) {
    return NextResponse.json({ error: 'rotation state missing' }, { status: 500 });
  }
  const dayPlan = planDay(rotation.cycle_number, rotation.subtype_last_used);

  // --- Pre-fetch recency for ALL 10 subtypes once (used by every attempt) ---
  const recency: Record<string, { prompt: string; correct_answer: string }[]> = {};
  for (const subtype of ALL_SUBTYPES) {
    const { data } = await supabase
      .from('n2_questions')
      .select('prompt, correct_answer')
      .contains('tags', [subtype])
      .order('created_at', { ascending: false })
      .limit(8);
    recency[subtype] = (data as { prompt: string; correct_answer: string }[] | null) ?? [];
  }

  // --- Retry state ---
  // Carry-over keeps passing candidates from one attempt into the next
  // (cap-padded to dayPlan counts per subtype). pool_substitute wipes the
  // failing subtypes' prior passing — that subtype is unreadable to
  // Gemini today, so we replace it wholesale.
  let passing: Candidate[] = [];
  let passingBySubtype: Record<string, number> = {};
  const subtypePlannedCount: Record<string, number> = Object.fromEntries(
    dayPlan.subtypes.map((s) => [s.subtype, s.count]),
  );

  function addPassing(c: Candidate) {
    const plan = subtypePlannedCount[c.subtype] ?? 1;
    const have = passingBySubtype[c.subtype] ?? 0;
    if (have < plan) {
      passing.push(c);
      passingBySubtype[c.subtype] = have + 1;
    }
    // else silently drop — we've already met this subtype's plan count.
  }

  let failing = new Map<string, string[]>();
  const trace: AttemptTrace[] = [];

  // Time-budget guard: with up to 4 attempts (each generating + verifying
  // via Gemini), worst-case wall time is ~90-150s. Vercel Hobby caps
  // functions at 60s. Skip remaining retries once we're past this budget
  // — fall through to the critical_failure path with reason='time_budget'
  // so the post-cron check cron can alert. Leave ~12s for the final
  // store/publish/email steps so we don't time out mid-publish.
  const ROUTE_START_MS = Date.now();
  const TIME_BUDGET_MS = 48_000;
  const timeOverBudget = () => Date.now() - ROUTE_START_MS > TIME_BUDGET_MS;

  for (let attemptNum = 1; attemptNum <= 4; attemptNum++) {
    if (failing.size === 0 && attemptNum > 1) break; // already clean
    if (timeOverBudget()) break;

    let plan: { subtype: string; count: number }[];
    let attemptType: AttemptTrace['type'];
    let feedback: Record<string, string[]> | null = null;

    if (attemptNum === 1) {
      plan = dayPlan.subtypes;
      attemptType = 'initial';
    } else if (attemptNum <= 3) {
      // Same-subtype retry: regenerate just the failing subtypes.
      plan = [...failing.keys()].map((subtype) => ({
        subtype,
        count: subtypePlannedCount[subtype] ?? 1,
      }));
      attemptType = 'same_subtype';
      feedback = Object.fromEntries(failing);
    } else {
      // Attempt 4 — pool_substitute
      if (failing.size === 0) break;
      const failingList = [...failing.keys()];
      // Pool = types NOT in the day's plan AND not already used as a substitute today
      const substitutedSoFar = new Set<string>(
        passing
          .map((c) => c.subtype)
          .filter((s) => !dayPlan.subtypes.some((d) => d.subtype === s)),
      );
      const plannedOrSubstituted = new Set<string>([
        ...dayPlan.subtypes.map((s) => s.subtype),
        ...substitutedSoFar,
      ]);
      const pool = ALL_SUBTYPES.filter((s) => !plannedOrSubstituted.has(s));
      if (pool.length < failingList.length) {
        // Pool exhausted — alert rather than silently ship a partial mock.
        await logCritical(supabase, today, trace, passing, failing, 'pool_exhausted');
        return NextResponse.json(
          {
            error: 'critical_failure',
            reason: 'pool_exhausted',
            attempts: trace,
            published: false,
          },
          { status: 200 },
        );
      }
      const substitutes = pool.slice(0, failingList.length);
      const newFeedback: Record<string, string[]> = {};
      for (let i = 0; i < failingList.length; i++) {
        newFeedback[substitutes[i]] = [
          ...(failing.get(failingList[i]) ?? ['unspecified']),
          `(Substituting for ${failingList[i]} which failed verification 3+ times today)`,
        ];
        // Pool-substitute WIPES prior passing of the failing subtype —
        // that subtype is unreadable to Gemini today, start fresh with
        // the substitute.
        const dropping = failingList[i];
        passing = passing.filter((c) => c.subtype !== dropping);
        delete passingBySubtype[dropping];
        delete subtypePlannedCount[dropping];
      }
      for (const s of substitutes) {
        subtypePlannedCount[s] = 1;
      }
      plan = substitutes.map((s) => ({ subtype: s, count: 1 }));
      attemptType = 'pool_substitute';
      feedback = newFeedback;
    }

    const result = await runAttempt(plan, recency, feedback);

    // If generate crashed AND no prior attempt passing — skip this
    // attempt's contribution entirely and try again next attempt.
    if (result.transport_error && result.passing.length === 0) {
      trace.push({
        attempt: attemptNum,
        type: attemptType,
        passing_subtypes: [],
        failing_subtypes: [...failing.keys()],
        failing_issues: Object.fromEntries(failing),
        transport_error: result.transport_error,
      });
      console.warn(`[daily-mock] attempt ${attemptNum} ${attemptType} transport_error: ${result.transport_error}`);
      continue;
    }

    for (const c of result.passing) addPassing(c);
    failing = result.failing;

    trace.push({
      attempt: attemptNum,
      type: attemptType,
      passing_subtypes: result.passing.map((c) => c.subtype),
      failing_subtypes: [...failing.keys()],
      failing_issues: Object.fromEntries(failing),
      transport_error: result.transport_error,
    });

    if (failing.size === 0) break;
  }

  // --- Final check ---
  // If the loop exited because we burned through the time budget before
  // cleaning up, surface that explicitly (otherwise the diagnostic would
  // look like 'insufficient_passing' even though the cause was timeout).
  let finalReason: string | null = null;
  if (passing.length < dayPlan.subtypes.reduce((acc, s) => acc + s.count, 0)) {
    finalReason =
      failing.size === 0
        ? 'incomplete_collected'
        : timeOverBudget()
          ? 'time_budget'
          : 'insufficient_passing';
  }
  if (finalReason) {
    await logCritical(supabase, today, trace, passing, failing, finalReason);
    return NextResponse.json(
      {
        error: 'critical_failure',
        reason: finalReason,
        passing_count: passing.length,
        passing_by_subtype: passingBySubtype,
        planned_total: dayPlan.subtypes.reduce((acc, s) => acc + s.count, 0),
        elapsed_ms: Date.now() - ROUTE_START_MS,
        attempts: trace,
        published: false,
      },
      { status: 200 },
    );
  }

  // --- Step 05: store ---
  const rows = passing.map((c) => ({
    category: CATEGORY_MAP[c.subtype],
    prompt: c.prompt,
    target_word: c.target_word ?? null,
    options: c.options,
    correct_answer: c.correct_answer,
    explanation: c.explanation,
    explanation_en: c.explanation_en,
    passage: c.passage ?? null,
    source_id: `gemini_generated_verified_v2`,
    tags: [c.subtype],
  }));
  const { data: stored, error: storeError } = await supabase
    .from('n2_questions')
    .insert(rows)
    .select('id, tags');
  if (storeError || !stored) {
    await logFailedRun(supabase, today, `store step failed: ${storeError?.message}`);
    return NextResponse.json({ error: 'store failed', published: false }, { status: 500 });
  }

  // --- Step 06: compose + publish, advance rotation ---
  const attemptsSummary = trace.map((t) => ({
    attempt: t.attempt,
    type: t.type,
    passing_subtypes: t.passing_subtypes,
    failing_subtypes: t.failing_subtypes,
  }));
  // Try the full write (including v2-only fields `attempts`). If the
  // 2026-07-21+ migration hasn't been applied yet, `attempts` column
  // doesn't exist and PostgREST returns a 400 — fall back to the
  // pre-migration columns only. Best-effort, not a fail-closed gate.
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
  let attemptsLogged = false;
  const { data: runRowPrimary, error: runErrorPrimary } = await supabase
    .from('n2_pipeline_runs')
    .upsert({ ...baseRunRow, attempts: attemptsSummary }, { onConflict: 'run_date' })
    .select('id')
    .single();
  if (runErrorPrimary || !runRowPrimary) {
    // Pre-migration shape: retry without `attempts` field. Either the
    // migration is pending, or the `attempts` column name doesn't yet
    // exist in PostgREST's cache (rare). Either way, the loop succeeded
    // and we MUST record success — fall back to the pre-migration shape.
    console.warn(
      '[daily-mock] pipeline_runs upsert with attempts column failed — falling back to pre-migration shape:',
      runErrorPrimary?.message,
    );
    const { data: fallbackRow, error: fallbackError } = await supabase
      .from('n2_pipeline_runs')
      .upsert(baseRunRow, { onConflict: 'run_date' })
      .select('id')
      .single();
    if (fallbackError || !fallbackRow) {
      return NextResponse.json(
        { error: 'pipeline_runs insert failed', published: false },
        { status: 500 },
      );
    }
    runRowId = fallbackRow.id;
  } else {
    runRowId = runRowPrimary.id;
    attemptsLogged = true;
  }
  const runRow = { id: runRowId! };

  const categoryDist: Record<string, number> = {};
  for (const s of dayPlan.subtypes) categoryDist[s.subtype] = s.count;
  // Reflect any substitutes that ended up in `passing`.
  for (const s of Object.keys(passingBySubtype)) {
    if (!(s in categoryDist)) categoryDist[s] = passingBySubtype[s];
  }

  const { error: mockError } = await supabase.from('n2_mocks').insert({
    date: today,
    question_ids: stored.map((s) => s.id),
    category_dist: categoryDist,
    target_tags: dayPlan.subtypes.map((s) => s.subtype),
    pipeline_run_id: runRow.id,
  });
  if (mockError) {
    return NextResponse.json(
      { error: 'n2_mocks insert failed', detail: mockError.message, published: false },
      { status: 500 },
    );
  }

  const updatedSubtypeLastUsed = { ...rotation.subtype_last_used };
  for (const { subtype } of dayPlan.subtypes) {
    updatedSubtypeLastUsed[subtype] = dayPlan.cycle_number;
  }
  await supabase
    .from('n2_rotation_state')
    .update({
      cycle_number: dayPlan.cycle_number,
      subtype_last_used: updatedSubtypeLastUsed,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);

  // --- Step 07: email fan-out (try/catch — never blocks publish) ---
  try {
    await fanOutDailyMockEmails(supabase, today, dayPlan);
  } catch (err) {
    console.error(
      '[daily-mock] email fan-out threw:',
      err instanceof Error ? err.message : String(err),
    );
  }

  return NextResponse.json({
    published: true,
    date: today,
    cycle_day: dayPlan.cycle_day,
    subtypes: dayPlan.subtypes.map((s) => s.subtype),
    question_count: stored.length,
    attempts_used: trace.length,
  });
}

async function fanOutDailyMockEmails(
  supabase: ReturnType<typeof createServiceRoleSupabase>,
  date: string,
  dayPlan: { subtypes: { subtype: string; count: number }[] },
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

  console.log(`[daily-mock] emailing ${subscribers.length} subscribers for ${date}...`);

  const logRows: Array<Record<string, unknown>> = [];
  for (const sub of subscribers) {
    if (!sub.email || !sub.user_id) continue;
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
    if (logErr) {
      console.error('[daily-mock] email_send_log insert failed:', logErr.message);
    }
  }

  const nowISO = new Date().toISOString();
  for (const r of logRows.filter((row) => row.status === 'sent')) {
    await supabase
      .from('n2_subscribers')
      .update({ last_sent_at: nowISO })
      .eq('user_id', r.user_id as string);
  }

  const sent = logRows.filter((r) => r.status === 'sent').length;
  const failed = logRows.length - sent;
  console.log(`[daily-mock] fan-out done for ${date}: ${sent} sent, ${failed} failed`);
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
  if (error) {
    console.error('[daily-mock] logFailedRun upsert itself failed:', error.message);
  }
}

async function logCritical(
  supabase: ReturnType<typeof createServiceRoleSupabase>,
  date: string,
  trace: AttemptTrace[],
  passing: Candidate[],
  failing: Map<string, string[]>,
  reason: string,
) {
  // Structured error message: the post-cron check cron parses `critical:
  // true` to send Jackson a richer Telegram alert than the default
  // "failed" state.
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

  // Try writing with the v2 `attempts` JSONB column for live
  // observability, fall back to error_message-only if migration pending.
  const { error: withAttemptsErr } = await supabase.from('n2_pipeline_runs').upsert(
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
  if (withAttemptsErr) {
    console.warn(
      '[daily-mock] critical upsert with attempts column failed — falling back:',
      withAttemptsErr.message,
    );
    await logFailedRun(supabase, date, errorMessage);
  }
  console.error(
    `[daily-mock] CRITICAL_FAILURE ${date} reason=${reason} passing=${passing.length} ` +
      `failing=${[...failing.keys()].join(',')} attempts=${trace.length}`,
  );
}
