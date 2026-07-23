/**
 * Server-side Supabase client for the N2 Daily Mock Exam webapp.
 *
 * This file imports 'next/headers' (server-only) and must NOT be imported
 * by 'use client' components. Server Components and Route Handlers that
 * need Supabase session access should import from here.
 *
 * Exported:
 *   - createServerSupabase() — for Server Components / Route Handlers /
 *     Server Actions. Reads/writes the session via Next.js cookies() so
 *     the same JWT is shared across SSR and the browser.
 *   - createServiceRoleSupabase() — for admin/server-side code paths
 *     that must bypass RLS (e.g. migration apply, admin inserts,
 *     cross-user cleanup). Server-only; do NOT import from 'use
 *     client' components — the service role key bypasses row-level
 *     security and leaking it client-side is a critical security
 *     failure. See verify_supabase_role_split.sh.
 *
 * Env vars (wired through next.config.mjs):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY   (server-only, NOT NEXT_PUBLIC_)
 */

import { cookies } from 'next/headers';
import {
  createServerClient,
  type CookieOptions,
} from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[supabase] Missing required env var ${name}. ` +
        'Set it in .env.local before starting the dev server.',
    );
  }
  return value;
}

/**
 * Server-side Supabase client. Use in Server Components, Route
 * Handlers, and Server Actions. Reads/writes the auth cookies via
 * next/headers so SSR and the browser share the same session.
 *
 * The set/remove try/catch is the recommended @supabase/ssr pattern:
 * Server Components cannot mutate cookies (the request is already
 * streaming). Middleware handles the cookie refresh in that case.
 */
export function createServerSupabase(): SupabaseClient {
  const cookieStore = cookies();

  return createServerClient(
    readEnv('NEXT_PUBLIC_SUPABASE_URL'),
    readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Server Component path — middleware will refresh cookies.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // Server Component path — middleware will refresh cookies.
          }
        },
      },
    },
  );
}

/**
 * Server-side Supabase client with service-role authority. Bypasses
 * RLS. Use ONLY in server-side code paths (Server Actions, Route
 * Handlers, scripts, migration runners). Do NOT import from 'use
 * client' components.
 *
 * Suppresses autoRefreshToken + persistSession — service-role clients
 * are short-lived per-request and do not need a session layer.
 */
export function createServiceRoleSupabase(): SupabaseClient {
  return createClient(
    readEnv('NEXT_PUBLIC_SUPABASE_URL'),
    readEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
