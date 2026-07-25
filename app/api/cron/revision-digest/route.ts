/**
 * app/api/cron/revision-digest/route.ts — twice-weekly revision digest.
 *
 * Fires from a DAILY Vercel Cron (Hobby plan can't schedule "Wed and Sun"
 * directly), and no-ops on every day except Wednesday and Sunday (Asia/Tokyo).
 *
 * One shared digest for every user — not personalized. Picks the 10
 * questions with the worst accuracy across all users' attempts since the
 * last digest (or the last 4 days, if there's no prior digest), and stores
 * just the question_ids. No LLM call: every question already has a
 * verified explanation_en and per-option notes from the generation
 * pipeline, so the digest is composed from that verified content at
 * render time (/revision) rather than re-explained — avoids introducing
 * a new fabrication surface for zero benefit.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleSupabase } from '@/lib/supabase';

function jstDow(): number {
  // 0 = Sunday, 3 = Wednesday
  const jstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  return jstNow.getDay();
}

function jstDateString(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const force = request.nextUrl.searchParams.get('force') === '1';
  const dow = jstDow();
  if (!force && dow !== 0 && dow !== 3) {
    return NextResponse.json({ skipped: true, reason: 'not Wed/Sun (JST)' });
  }

  const supabase = createServiceRoleSupabase();
  const today = jstDateString(new Date());

  const { data: lastDigest } = await supabase
    .from('n2_revision_digests')
    .select('run_date, created_at')
    .order('run_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Window starts at the moment the previous digest was actually created —
  // not at midnight of its run_date, which double-counted every attempt
  // made on the previous digest day (they'd already been ranked by that
  // digest). created_at is the precise boundary; run_date only kept for
  // the stored window_start date column.
  const windowStart = lastDigest
    ? lastDigest.run_date
    : jstDateString(new Date(Date.now() - 4 * 24 * 60 * 60 * 1000));
  const windowStartTs = lastDigest?.created_at ?? `${windowStart}T00:00:00+09:00`;

  const { data: attempts, error: attemptsError } = await supabase
    .from('n2_attempts')
    .select('question_id, correct')
    .gt('created_at', windowStartTs)
    .not('question_id', 'is', null);

  if (attemptsError) {
    return NextResponse.json({ error: attemptsError.message }, { status: 500 });
  }

  const stats = new Map<string, { total: number; wrong: number }>();
  for (const a of attempts ?? []) {
    const qid = a.question_id as string;
    // Rows with correct=null (pre-2026-07-24 attempts where the client
    // didn't supply a correct_map) are unknowable — skip them rather than
    // counting them as wrong, which skewed the "hardest questions" ranking.
    if (a.correct !== true && a.correct !== false) continue;
    const entry = stats.get(qid) ?? { total: 0, wrong: 0 };
    entry.total += 1;
    if (a.correct === false) entry.wrong += 1;
    stats.set(qid, entry);
  }

  const hardest = Array.from(stats.entries())
    .map(([question_id, s]) => ({ question_id, ...s, wrongRate: s.wrong / s.total }))
    .sort((a, b) => b.wrongRate - a.wrongRate || b.total - a.total)
    .slice(0, 10)
    .map((s) => s.question_id);

  if (hardest.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'no attempts in window' });
  }

  const { error: upsertError } = await supabase
    .from('n2_revision_digests')
    .upsert(
      {
        run_date: today,
        window_start: windowStart,
        window_end: today,
        question_ids: hardest,
      },
      { onConflict: 'run_date' },
    );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ run_date: today, window_start: windowStart, question_count: hardest.length });
}
