import { redirect } from 'next/navigation';
import { createServerSupabase, createServiceRoleSupabase } from '@/lib/supabase';
import { IssueMeta } from '@/components/IssueMeta';
import { TiltedCard } from '@/components/TiltedCard';
import { NavBar } from '@/components/NavBar';

/**
 * app/settings/page.tsx — Account + daily-mock subscription toggle.
 *
 * Server component. Auth-gated. Reads current subscription state via the
 * service-role client (RLS would also work but service role is simpler for
 * the read path). The form POSTs to /api/subscribe which toggles the row.
 *
 * Added 2026-07-21 as part of the email-notification feature. Subscriber
 * model B: opt-in toggle, default off — users see this page after sign-in
 * (linked from /auth footer) and can opt in to daily-mock notifications.
 */

type SubRow = {
  subscribed_at: string | null;
  unsubscribed_at: string | null;
  email_send_count: number | null;
  last_sent_at: string | null;
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: { subscribe?: string };
}) {
  const supabase = createServerSupabase();
  // getUser() revalidates the JWT server-side (getSession() only trusts
  // the cookie) — swapped 2026-07-24.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/auth');
  }
  const userId = user.id;
  const email = user.email ?? '(no email on file)';

  // Read subscription status via service role (bypasses RLS for read, fine for own-data)
  const service = createServiceRoleSupabase();
  const { data: subRow, error: subReadErr } = await service
    .from('n2_subscribers')
    .select('subscribed_at, unsubscribed_at, email_send_count, last_sent_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (subReadErr) {
    // Surface instead of silently rendering "not subscribed" — this state
    // hid a 3-day outage where the n2_subscribers table didn't exist.
    console.error('[/settings] subscription read failed:', subReadErr.message);
  }
  const sub = subRow as SubRow | null;
  const toggleFailed = searchParams?.subscribe === 'error' || !!subReadErr;

  const isSubscribed = !!sub && !sub.unsubscribed_at;
  const toggleValue = isSubscribed ? 'false' : 'true';

  // Format helpers
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Tokyo' }) : '—';

  return (
    <TiltedCard>
      <IssueMeta />
      <NavBar current="/settings" />
      <header className="card-page-header">
        <h2 className="card-h2">Settings</h2>
        <p className="card-lede">
          通知設定 &middot; アカウント情報
        </p>
      </header>

      <section className="card-section">
        <h3 className="card-h3">Account</h3>
        <dl className="settings-list">
          <div className="settings-list__row">
            <dt className="settings-list__label">Email</dt>
            <dd className="settings-list__value">{email}</dd>
          </div>
          <div className="settings-list__row">
            <dt className="settings-list__label">User ID</dt>
            <dd className="settings-list__value">
              <code style={{ fontSize: 12 }}>{userId}</code>
            </dd>
          </div>
          <div className="settings-list__row">
            <dt className="settings-list__label">Signed in</dt>
            <dd className="settings-list__value">
              {new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
            </dd>
          </div>
        </dl>
      </section>

      <section className="card-section">
        <h3 className="card-h3">Daily mock notifications</h3>
        {toggleFailed && (
          <p role="alert" style={{ fontSize: 13, lineHeight: 1.6, color: '#8a3b2e', marginBottom: 12 }}>
            設定の保存に失敗しました。時間をおいてもう一度お試しください。
            (The last change could not be saved — please try again.)
          </p>
        )}
        <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-2)', marginBottom: 16 }}>
          Get an email each morning when today&rsquo;s 5-question mock is published.
          Sent at ~07:00 JST by the daily cron &mdash; one email per subscriber per day,
          no marketing, no upsells. You can unsubscribe any time from the link in the email.
        </p>

        <form
          method="post"
          action="/api/subscribe"
          className="settings-toggle-form"
          style={{ marginBottom: 16 }}
        >
          <input type="hidden" name="subscribed" value={toggleValue} />
          <button
            type="submit"
            className={isSubscribed ? 'btn-secondary' : 'btn-primary'}
          >
            {isSubscribed ? 'Disable notifications' : 'Enable notifications'}
          </button>
        </form>

        {sub && (
          <dl className="settings-list" style={{ marginTop: 16 }}>
            {sub.subscribed_at && (
              <div className="settings-list__row">
                <dt className="settings-list__label">Subscribed</dt>
                <dd className="settings-list__value">{fmtDate(sub.subscribed_at)}</dd>
              </div>
            )}
            {sub.unsubscribed_at && (
              <div className="settings-list__row">
                <dt className="settings-list__label">Unsubscribed</dt>
                <dd className="settings-list__value">{fmtDate(sub.unsubscribed_at)}</dd>
              </div>
            )}
            {sub.email_send_count !== null && sub.email_send_count > 0 && (
              <div className="settings-list__row">
                <dt className="settings-list__label">Emails sent</dt>
                <dd className="settings-list__value">{sub.email_send_count}</dd>
              </div>
            )}
            {sub.last_sent_at && (
              <div className="settings-list__row">
                <dt className="settings-list__label">Last email</dt>
                <dd className="settings-list__value">{fmtDate(sub.last_sent_at)}</dd>
              </div>
            )}
          </dl>
        )}
      </section>
    </TiltedCard>
  );
}
