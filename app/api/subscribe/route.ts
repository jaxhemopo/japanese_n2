import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createServiceRoleSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * POST /api/subscribe — toggle the user's daily-mock email subscription.
 *
 * Form-encoded (NOT JSON) because the /settings page submits a plain HTML
 * form. The form sends `subscribed=true|false`; we upsert the matching row.
 *
 * Called from /settings. After toggling, redirects back to /settings.
 */

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  // getUser() revalidates the JWT server-side (getSession() only trusts
  // the cookie) — swapped 2026-07-24.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/auth', request.url), 303);
  }
  const userId = user.id;
  const email = user.email ?? '';

  const contentType = request.headers.get('content-type') ?? '';
  let subscribed = false;
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    subscribed = form.get('subscribed') === 'true';
  } else if (contentType.includes('application/json')) {
    const body = (await request.json()) as { subscribed?: boolean };
    subscribed = !!body.subscribed;
  }

  const service = createServiceRoleSupabase();
  const now = new Date().toISOString();

  // NB: these upserts USED to fire-and-forget. That hid a real outage —
  // the n2_subscribers table didn't exist in prod for the feature's first
  // three days (migration never applied), every toggle silently no-oped,
  // and the UI still said "subscribed". Errors now surface to the user
  // via ?subscribe=error (2026-07-24).
  let dbError: string | null = null;
  if (subscribed) {
    // Opt in: upsert with subscribed_at = now, clear unsubscribed_at
    const { error } = await service.from('n2_subscribers').upsert(
      {
        user_id: userId,
        email,
        subscribed_at: now,
        unsubscribed_at: null,
      },
      { onConflict: 'user_id' },
    );
    dbError = error?.message ?? null;
  } else {
    // Opt out: upsert with unsubscribed_at = now. subscribed_at is omitted
    // so an existing row keeps its original value for audit (upsert only
    // updates supplied columns); a brand-new row gets the column DEFAULT.
    const { error } = await service.from('n2_subscribers').upsert(
      {
        user_id: userId,
        email,
        unsubscribed_at: now,
      },
      { onConflict: 'user_id' },
    );
    dbError = error?.message ?? null;
  }

  if (dbError) {
    console.error('[/api/subscribe] upsert failed:', dbError);
    return NextResponse.redirect(new URL('/settings?subscribe=error', request.url), 303);
  }

  return NextResponse.redirect(new URL('/settings', request.url), 303);
}
