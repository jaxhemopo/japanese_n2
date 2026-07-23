import Link from 'next/link';
import { IssueMeta } from '@/components/IssueMeta';
import { TiltedCard } from '@/components/TiltedCard';

/**
 * app/privacy/page.tsx — Plain-language privacy policy (added 2026-07-21).
 *
 * Source of truth for what data N2 Daily Mock Exam collects, why, where
 * it's stored, and what users can do about it. Public (no auth required) so
 * anyone can read it without signing up first — required by GDPR right-to-
 * information.
 *
 * Styled with locked design tokens from design.md (TiltedCard + IssueMeta
 * + .card-section + .card-h2) so it's visually consistent with the rest
 * of the app while staying focused on plain-language readability.
 */

export default function PrivacyPage() {
  return (
    <TiltedCard>
      <IssueMeta />
      <header className="card-page-header">
        <h1 className="card-h1">Privacy Policy</h1>
        <p className="card-lede">
          Effective 2026-07-21 · Plain-language summary of what we collect and why.
        </p>
      </header>

      <article>
        <section className="card-section">
          <h2 className="card-h2">Who we are</h2>
          <p>
            N2 Daily Mock Exam (<a href="https://japanese-n2.vercel.app">japanese-n2.vercel.app</a>)
            is a personal JLPT N2 study app operated by Jackson Hemopo. Contact:
            jacksonhemopo [at] gmail [dot] com.
          </p>
        </section>

        <section className="card-section">
          <h2 className="card-h2">What we collect</h2>
          <ul>
            <li>Your email address (required to create your account)</li>
            <li>
              Your password (hashed by Supabase using bcrypt; we never see plaintext)
            </li>
            <li>
              If you sign in with Google: your Google profile (name, avatar) per
              Google&rsquo;s consent screen — opt-in by clicking the Google button
            </li>
            <li>
              Your study activity: which questions you answered, whether you got
              them right, how long you took, and your streak/last-active date
            </li>
          </ul>
        </section>

        <section className="card-section">
          <h2 className="card-h2">Why we collect it</h2>
          <ul>
            <li>Email + password: so you can sign in</li>
            <li>Google profile: convenience when signing in with Google</li>
            <li>Study activity: to show your progress and tailor future questions</li>
          </ul>
        </section>

        <section className="card-section">
          <h2 className="card-h2">Where it's stored</h2>
          <ul>
            <li>All data lives in Supabase Postgres (database + auth) on their managed infrastructure</li>
            <li>The webapp itself is hosted on Vercel</li>
            <li>We don&rsquo;t run any of our own servers</li>
          </ul>
        </section>

        <section className="card-section">
          <h2 className="card-h2">How long we keep it</h2>
          <p>
            We keep your account and study history until you delete them. After
            you delete your account, we delete everything within 30 days.
          </p>
        </section>

        <section className="card-section">
          <h2 className="card-h2">Your rights</h2>
          <p>You can:</p>
          <ul>
            <li>See your data (download your attempts as JSON)</li>
            <li>Delete your account and all associated data</li>
            <li>Opt out of any optional emails (toggle in settings — coming soon)</li>
          </ul>
          <p>
            Email jacksonhemopo [at] gmail [dot] com to exercise any of these.
            We&rsquo;ll respond within 14 days.
          </p>
        </section>

        <section className="card-section">
          <h2 className="card-h2">What we don&rsquo;t do</h2>
          <ul>
            <li>We don&rsquo;t sell your data. Ever.</li>
            <li>We don&rsquo;t show ads. Ever.</li>
            <li>
              We don&rsquo;t share your data with anyone except the subprocessors listed below
            </li>
          </ul>
        </section>

        <section className="card-section">
          <h2 className="card-h2">Subprocessors</h2>
          <p>
            These third parties process data on our behalf. Each has its own
            privacy policy and data handling practices.
          </p>
          <ul>
            <li>
              <strong>Supabase</strong> — auth + database (
              <a href="https://supabase.com/privacy">supabase.com/privacy</a>)
            </li>
            <li>
              <strong>Vercel</strong> — webapp hosting (
              <a href="https://vercel.com/legal/privacy-policy">vercel.com/legal/privacy-policy</a>)
            </li>
            <li>
              <strong>Google Gemini API</strong> — mock question generation.
              Your user data is <em>never</em> sent to Google; only the
              question-focus labels (e.g. &ldquo;vocab&rdquo;, &ldquo;grammar&rdquo;)
              go in.
            </li>
            <li>
              <strong>Resend</strong> — when we add optional email notifications
              for &ldquo;today&rsquo;s mock is ready&rdquo; alerts. Not active yet.
            </li>
          </ul>
        </section>

        <section className="card-section">
          <h2 className="card-h2">Changes</h2>
          <p>
            We&rsquo;ll update this page if our practices change. Most recent
            update: 2026-07-21. We don&rsquo;t email users about privacy changes;
            check this page if you want to know.
          </p>
        </section>
      </article>

      <footer className="card-footer-nav card-footer-nav--end">
        <Link href="/" className="card-meta-link card-secondary">← ホームに戻る</Link>
      </footer>
    </TiltedCard>
  );
}
