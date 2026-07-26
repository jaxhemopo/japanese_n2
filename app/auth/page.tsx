'use client';

/**
 * app/auth/page.tsx — Email + password sign-in.
 *
 * Replaced the magic-link flow 2026-07-17: emails weren't arriving (zero
 * requests in Supabase auth logs over the prior 24h — likely never reached
 * Supabase at all) and the callback route had a real bug (was calling
 * `setSession({ access_token: token, refresh_token: token })` with an OTP
 * token, which isn't how the exchange actually works). Password auth has
 * no email dependency for login at all, which sidesteps that whole failure
 * class rather than debugging it further.
 *
 * Signup toggle removed 2026-07-24: it POSTed to /api/dev-signup with no
 * Authorization header, and that route requires a Bearer secret — every
 * UI signup attempt 401'd, guaranteed. dev-signup is now blocked in prod
 * entirely; new accounts come in via "Continue with Google" (Supabase
 * creates the user on first OAuth sign-in) or are provisioned manually.
 *
 * Visual layer (design.md 2026-07-19): wrapped in TiltedCard + IssueMeta
 * composition on the dark olive canvas. NO PhoneMockup (keeps the form
 * focused). Gap-killer pass 2026-07-19.
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@/lib/supabase-client';
import Link from 'next/link';
import { IssueMeta } from '@/components/IssueMeta';
import { TiltedCard } from '@/components/TiltedCard';

export default function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleGoogleSignIn() {
    setStatus('loading');
    setErrorMessage('');
    try {
      const supabase = createBrowserSupabase();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setStatus('error');
        setErrorMessage(error.message);
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong — please try again.');
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setStatus('loading');
    setErrorMessage('');

    try {
      const supabase = createBrowserSupabase();

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setStatus('error');
        setErrorMessage(error.message);
        return;
      }
      router.push('/today');
      router.refresh();
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong — please try again.');
    } finally {
      setStatus((s) => (s === 'loading' ? 'idle' : s));
    }
  }

  return (
    <TiltedCard>
      <IssueMeta />
      {/* 2026-07-22 gap-killer (12:11 JST): editorial section kicker
          above the auth-title H1 — sans-uppercase-tracked micro-label
          that introduces the H1 (same pattern as the landing page's
          "What you'll see" section kicker added in this pass). The
          reference dailydispatch uses this kicker-above-H2 pattern
          for every section break; the /auth page was going straight
          from IssueMeta to H1 with no kicker. Adds editorial rhythm
          to the auth surface without changing any locked DNA values
          — uses the existing .card-section-kicker class from
          globals.css. */}
      <div className="card-section-kicker card-section-kicker--page-eyebrow">Established 2026 · Subscriber access</div>
      <h1 className="auth-title">
        N2 Daily Mock Exam
      </h1>
      <p className="auth-subhead">
        Sign in to continue.
      </p>

      {/* 2026-07-23 gap-killer: italic-serif editorial sub-pitch between
          the auth-subhead and the Google button. Bridges the
          subhead → form gap with the same italic-serif kicker
          vocabulary used by .card-tagline on /. Reads as a newspaper
          subhead: "Free account · Password · 12 seconds." Locked DNA
          tokens only (--text-2, --font-serif). No new patterns.
          "Magic link" wording removed 2026-07-23 — auth flow is
          password-based since the 2026-07-17 migration; the previous
          "Magic link" copy misled users about the actual login path. */}
      <p className="auth-sub-pitch">
        Free account · Password · 12 seconds
      </p>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={status === 'loading'}
        className="auth-google-btn"
      >
        <svg width="18" height="18" viewBox="0 0 18 18">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 009 18z" />
          <path fill="#FBBC05" d="M3.96 10.71A5.4 5.4 0 013.68 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.04l3-2.33z" />
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" />
        </svg>
        Continue with Google
      </button>

      <div className="editorial-divider" aria-hidden="true">
        <span className="editorial-divider__rule" />
        <span className="editorial-divider__label">or</span>
        <span className="editorial-divider__rule" />
      </div>

      <form onSubmit={handleSubmit} className="auth-form">
        <label className="auth-field">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
            disabled={status === 'loading'}
            className="auth-field__input"
          />
        </label>

        <label className="auth-field">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            minLength={6}
            disabled={status === 'loading'}
            className="auth-field__input"
          />
        </label>

        {status === 'error' && (
          <p className="auth-error">{errorMessage}</p>
        )}

        <button
          type="submit"
          disabled={status === 'loading'}
          className="btn-primary btn-primary--block"
        >
          {status === 'loading' ? '...' : 'Sign In →'}
        </button>

        {/* Signup toggle removed 2026-07-24 — it hit /api/dev-signup
            without the required Bearer secret and 401'd every time.
            New accounts: Continue with Google above. */}
        <p className="auth-toggle auth-toggle--info">
          New here? Continue with Google above to create an account.
        </p>
      </form>

      <footer className="auth-footer-link">
        <Link href="/" className="card-secondary">← ホームに戻る</Link>
        <span aria-hidden="true">·</span>
        <Link href="/privacy" className="card-secondary">Privacy</Link>
      </footer>

      {/* 2026-07-23 gap-killer: italic-serif editorial closing
          credit + tracked-sans colophon print fills the visible
          empty cream-space at the bottom of /auth. Mirrors the
          /.landing-editorial-closing pattern. Uses the new
          .auth-closing-credit / .auth-closing-credit__line /
          .auth-closing-credit__print classes added to globals.css
          this pass. */}
      <div className="auth-closing-credit">
        <p className="auth-closing-credit__line">
          For N2 candidates · by the editors of N2 Daily Mock, Tokyo.
        </p>
        <div className="auth-closing-credit__print">
          sub · editorial · 2026
        </div>
      </div>
    </TiltedCard>
  );
}