import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { fetchResultForDate } from '@/lib/get-result';

/**
 * app/api/attempts/[date]/route.ts — GET /api/attempts/[date]
 *
 * Returns the authenticated user's attempt for a given date (YYYY-MM-DD).
 * Data-shape lives in lib/get-result.ts so the page can call it directly
 * (avoiding the self-fetch that broke on Vercel).
 *
 * Response 200:
 *   { mock, attempts, score, total, total_seconds }
 *   mock is null if no mock for date.
 *
 * Errors:
 *   400 — invalid date format
 *   401 — no Supabase session
 *   500 — DB query failure
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  _request: NextRequest,
  { params }: { params: { date: string } },
) {
  const { date } = params;
  if (!DATE_RE.test(date)) {
    return NextResponse.json(
      { error: 'invalid date (expected YYYY-MM-DD)' },
      { status: 400 },
    );
  }

  const supabase = createServerSupabase();
  // getUser() revalidates the JWT server-side (getSession() only trusts
  // the cookie) — swapped 2026-07-24.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = user.id;

  try {
    const data = await fetchResultForDate(supabase, userId, date);
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/attempts/[date]] error:', message);
    return NextResponse.json(
      { error: 'query failed', detail: message },
      { status: 500 },
    );
  }
}