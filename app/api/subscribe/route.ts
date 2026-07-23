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
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session?.user) {
    return NextResponse.redirect(new URL('/auth', request.url));
  }
  const userId = sessionData.session.user.id;
  const email = sessionData.session.user.email ?? '';

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

  if (subscribed) {
    // Opt in: upsert with subscribed_at = now, clear unsubscribed_at
    await service.from('n2_subscribers').upsert(
      {
        user_id: userId,
        email,
        subscribed_at: now,
        unsubscribed_at: null,
      },
      { onConflict: 'user_id' },
    );
  } else {
    // Opt out: upsert with unsubscribed_at = now (keep subscribed_at for audit)
    await service.from('n2_subscribers').upsert(
      {
        user_id: userId,
        email,
        subscribed_at: now,
        unsubscribed_at: now,
      },
      { onConflict: 'user_id' },
    );
  }

  return NextResponse.redirect(new URL('/settings', request.url));
}
