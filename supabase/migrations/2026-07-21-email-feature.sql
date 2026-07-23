-- Migration: n2_subscribers + n2_email_send_log
-- Date: 2026-07-21
-- Purpose: Daily-mock email notification feature
--
-- Run this in Supabase Studio SQL editor (Database → SQL Editor → New query).
-- Idempotent (uses IF NOT EXISTS). Safe to re-run.

-- 1. n2_subscribers — one row per opted-in user
--    email column is denormalized for efficient cron fan-out (avoids N+1
--    auth.users lookups) at the cost of a sync concern if a user changes
--    their auth email — we accept this trade-off for v1; trigger-based
--    sync can be added later if needed.
CREATE TABLE IF NOT EXISTS public.n2_subscribers (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unsubscribed_at TIMESTAMPTZ,
  email_send_count INT NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ,
  CONSTRAINT n2_subscribers_subscribed_check CHECK (
    (subscribed_at IS NOT NULL AND unsubscribed_at IS NULL)
    OR unsubscribed_at IS NOT NULL
  )
);

ALTER TABLE public.n2_subscribers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own subscription" ON public.n2_subscribers
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own subscription" ON public.n2_subscribers
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert their own subscription (own row only)" ON public.n2_subscribers
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access on n2_subscribers" ON public.n2_subscribers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_n2_subscribers_active
  ON public.n2_subscribers (user_id)
  WHERE unsubscribed_at IS NULL;

-- 2. n2_email_send_log — audit trail per send attempt
CREATE TABLE IF NOT EXISTS public.n2_email_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mock_date DATE NOT NULL,
  resend_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'failed_after_retry')),
  error_message TEXT,
  attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count > 0),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_n2_email_send_log_sent_at ON public.n2_email_send_log (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_n2_email_send_log_user_date ON public.n2_email_send_log (user_id, mock_date);

ALTER TABLE public.n2_email_send_log ENABLE ROW LEVEL SECURITY;
-- No user-facing direct access (logs are operational data, accessible via
-- service role only — can be exposed via a /api/account/email-history
-- endpoint later if users want to see their own send history)

CREATE POLICY "Service role full access on n2_email_send_log" ON public.n2_email_send_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Cleanup: 90-day auto-purge on email log (operational hygiene)
-- Cron-style: schedule via the daily-mock cron or a separate Vercel cron to
-- DELETE WHERE sent_at < now() - interval '90 days'. For now, just leave
-- the data; if storage becomes a concern, add the cleanup as a Postgres
-- job or a separate cron endpoint.

-- 4. n2_pipeline_runs.alerted_at (2026-07-23, daily-mock v2 retry loop)
--    Set by the post-cron check cron when it actually sends a critical-
--    failure Telegram alert. Idempotent. Used to avoid spamming Jackson
--    if the post-cron cron wakes me multiple times for the same day.
ALTER TABLE public.n2_pipeline_runs
  ADD COLUMN IF NOT EXISTS alerted_at TIMESTAMPTZ;

-- 5. n2_pipeline_runs.attempts (2026-07-23, daily-mock v2 retry loop)
--    JSONB array summarizing each attempt's outcome
--    ([{attempt, type, passing_subtypes, failing_subtypes}]). Lets the
--    post-cron check cron (and humans in Supabase Studio) see at a
--    glance which attempts passed/failed without parsing the full
--    error_message blob. Idempotent.
ALTER TABLE public.n2_pipeline_runs
  ADD COLUMN IF NOT EXISTS attempts JSONB;
