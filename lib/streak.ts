/**
 * lib/streak.ts — day-streak calculation.
 *
 * Counts consecutive days (Asia/Tokyo) with at least one attempt, walking
 * backward from today. A gap of even one day breaks the streak. If today
 * has no attempt yet, the streak still counts through yesterday (so taking
 * today's mock later still extends it — the streak isn't broken just
 * because it's still morning).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

function toJSTDateString(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

export async function computeStreak(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('n2_attempts')
    .select('created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error || !data || data.length === 0) return 0;

  const attemptDates = new Set(
    data.map((row) => toJSTDateString(new Date(row.created_at as string))),
  );

  let streak = 0;
  const cursor = new Date();
  // If today has no attempt yet, start counting from yesterday instead —
  // don't break the streak just because it's morning and today isn't done.
  if (!attemptDates.has(toJSTDateString(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (attemptDates.has(toJSTDateString(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}
