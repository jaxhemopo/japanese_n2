/**
 * Browser-side Supabase client for the N2 Daily Mock Exam webapp.
 *
 * This file is intentionally client-safe: it contains NO imports from
 * 'next/headers' or any other Next.js server-only module. It can be
 * imported by 'use client' components without causing webpack to flag
 * the bundle as incorrectly including server-only code.
 *
 * Exported:
 *   - createBrowserSupabase() — for Client Components ('use client').
 *     Uses @supabase/ssr's browser client, which reads the session from
 *     localStorage and writes it back on auth state changes.
 *
 * Env vars (wired through next.config.mjs):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * Auth model: magic link (goal.md OQ-3). Sign-in flow uses
 * supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } })
 * where emailRedirectTo points at /auth/callback (route handler that
 * exchanges the OTP code for a session cookie).
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

// Next.js only inlines NEXT_PUBLIC_* vars into the client bundle when
// accessed as a literal `process.env.NEXT_PUBLIC_X` — dynamic bracket
// access (`process.env[name]`) is never replaced and silently reads
// undefined in the browser. Both vars must be read literally here.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    '[supabase] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY at build time.',
  );
}

/**
 * Browser-side Supabase client. Use in 'use client' components only.
 *
 * The session is persisted in localStorage by default; @supabase/ssr
 * keeps the storage layer compatible with the server cookie store so
 * the magic-link callback can land and immediately hydrate the UI.
 */
export function createBrowserSupabase(): SupabaseClient {
  return createBrowserClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
}
