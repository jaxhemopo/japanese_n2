/**
 * app/api/dev-signup/route.ts — Auto-confirmed signup, bypassing email verification.
 *
 * Phase 1 has no email delivery pipeline wired up, and the Supabase project
 * requires email confirmation by default (mailer_autoconfirm: false, not
 * configurable without dashboard access). This route uses the service-role
 * key server-side to create the user with email_confirm: true directly via
 * the admin API, so no confirmation email is ever needed.
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  // NOT AVAILABLE IN PRODUCTION — gated in code, not just by env var
  // (2026-07-24, applying the BYPASS_AUTH lesson from docs/HANDOFF.md:
  // privileged dev-only surfaces must be impossible to reach in prod even
  // if someone fat-fingers the env). Account creation in prod happens via
  // Google OAuth at /auth, or manually through the Supabase dashboard.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  // Gated behind DEV_SIGNUP_SECRET (same Bearer pattern as the cron routes).
  // Fail closed: if the env var is missing, nobody gets in — this endpoint
  // creates auto-confirmed accounts via the service-role key.
  const secret = process.env.DEV_SIGNUP_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { email, password } = await request.json();

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
