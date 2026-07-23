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
