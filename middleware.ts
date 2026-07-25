/**
 * middleware.ts — Supabase session refresh.
 *
 * This was documented as a dependency in app/layout.tsx's comments
 * ("Middleware intercepts auth callbacks and writes the session cookie")
 * but never actually existed in the codebase — added 2026-07-17 while
 * fixing the auth flow. Standard @supabase/ssr pattern: refresh the
 * session token on every request so Server Components always see a
 * current session instead of a stale/expired one.
 */

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    },
  );

  // Touching getSession() is what actually triggers the refresh-if-expired
  // logic and writes the renewed cookie via the set() handler above.
  await supabase.auth.getSession();

  return response;
}

export const config = {
  // api/cron/* and api/unsubscribe are excluded (2026-07-24): they are
  // Bearer-token / HMAC-token authenticated and never carry a user
  // session, so the getSession() refresh here was a pure wasted Supabase
  // round-trip on every cron fire and unsubscribe click. Other /api
  // routes keep the middleware so an expired session is refreshed before
  // the route handler runs.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/cron|api/unsubscribe).*)'],
};
