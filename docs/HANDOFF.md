# N2 Daily Mock Exam — Handoff (2026-07-20)

Full operational ownership of this project is moving to **Felix**. This doc
is the single source of truth for what exists, where the keys are, and how
to run/monitor it day to day. Read this before touching anything.

## What this is

A webapp that publishes a fresh 5-question JLPT N2 mock exam every morning,
tracks per-user attempts, and shows a twice-weekly "what tripped people up"
revision digest. Live at **https://japanese-n2.vercel.app**.

- **Vercel project:** `japanese-n2`, org `jaxhemopos-projects`
- **Supabase project:** `ucppuzfyjrtcchdhwxto` (shared ODIS project, not
  dedicated to this app — other ODIS tables live alongside `n2_*` ones)
- **Git repo now exists** (initialized 2026-07-24, remote
  `github.com/jaxhemopo/japanese_n2`). Build artifacts (`node_modules/`,
  `.next/`, `out/`, `.env`, `.lh-*.json`, `*.tsbuildinfo`) are git-ignored;
  a 109 MB Next.js SWC native binary was stripped from history with
  git-filter-repo so the repo pushes within GitHub's 100 MB file-size limit.
  Deploys are still a manual `vercel --prod --yes` from
  `~/projects/japanese-n2` — nothing auto-deploys on push yet.

## Where the keys are

All secrets live in **Vercel → Project → Environment Variables (Production)**,
not in any local `.env` file (local `.env.local` only has the two
`NEXT_PUBLIC_*` ones for local dev). Check with:
```
cd ~/projects/japanese-n2 && vercel env ls production
```
Current vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `CRON_SECRET`.

- `GEMINI_API_KEY` — same pay-per-use key as `~/.openclaw/.env`
  (`GEMINI_API_KEY`). Jackson explicitly approved automated daily use of
  this key for this pipeline (2026-07-20) — capped at ~4 calls/day total
  (2 for the daily mock, 0 for the revision digest since that one doesn't
  call Gemini at all). Do not add more Gemini calls to any part of this
  app without checking that budget still holds.
- `CRON_SECRET` — protects both cron routes. Vercel automatically sends
  `Authorization: Bearer <CRON_SECRET>` when its own Cron Jobs fire; to
  trigger manually, pull the value and pass it yourself:
  ```
  vercel env pull /tmp/env.txt --environment=production --yes
  grep CRON_SECRET /tmp/env.txt   # then rm /tmp/env.txt after
  ```
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS, server-only. Never expose to
  a client component.

## The two live crons

Configured in `vercel.json`, both hit API routes, both server-only (no
agent involved — this deliberately sidesteps ODIS's "only Makoto/Felix run
autonomous crons" rule, since it was never an agent heartbeat to begin with):

1. **`/api/cron/daily-mock`** — `0 22 * * *` UTC (07:00 JST). Generates and
   publishes the day's 5-question mock. Idempotent — if today's mock
   already exists, it no-ops without calling Gemini again.
2. **`/api/cron/revision-digest`** — `0 23 * * *` UTC (08:00 JST) daily,
   but internally no-ops on every day except Wednesday/Sunday (JST). Picks
   the 10 questions with the worst wrong-rate since the last digest, no
   LLM call at all — composes the writeup from each question's
   already-verified `explanation_en`/option notes.

Both check `Authorization: Bearer $CRON_SECRET` and return 401 without it.

## ⚠️ Two generator implementations exist — know which is live

- **`~/ODIS/shared/pipelines/n2-generator/`** — the original agent-run
  version (PIPELINE_STANDARD format: step docs, `state.json`, manual
  triggering by an agent in a session). This is how the pipeline was
  designed and validated, but it is **no longer what runs in production.**
  Its `state.json` rotation state is now stale/frozen — nothing updates it
  anymore.
- **`app/api/cron/daily-mock/route.ts`** (in this repo) — the real,
  currently-running production path. Ports the same 6-step logic into one
  serverless function. Rotation state lives in the `n2_rotation_state` DB
  table instead of a local file (serverless has no persistent disk).

**The Vercel Cron route is authoritative.** If you need to change the
generation logic (prompts, rotation algorithm, verification rules), edit
`lib/n2-prompts.ts` and `lib/n2-rotation.ts` in this repo — editing the
`~/ODIS/shared/pipelines/n2-generator/` files will have **zero effect** on
what actually publishes. That directory is now reference documentation of
the original design, not a thing that runs. Worth eventually deleting or
clearly marking archived to stop this from confusing someone later.

Model note: the cron route uses `gemini-2.5-flash`, not `gemini-2.5-pro` —
`pro` was tried first and blew past Vercel's 60-second function timeout
(Hobby plan max) with two sequential calls; `flash` completes the whole
generate+verify round trip in ~40s and is more than capable for this
schema-constrained JSON task.

## Monitoring / debugging

- `n2_pipeline_runs` table — one row per day, `status` = `success` |
  `failed`. `error_message` has details (including the specific
  subtype/issue breakdown on a verification shortfall). New fields as of
  daily-mock-cron-v2 (2026-07-23):
  - `pipeline_version` — which route version ran. `'n2-daily-mock-cron-v2'`
    means the 4-attempt retry loop was active. Anything earlier (v1) is
    a pre-2026-07-23 row.
  - `attempts` (JSONB) — array summarizing each attempt that ran:
    `[{attempt: 1, type: 'initial', passing_subtypes: [...], failing_subtypes: [...]}, ...]`.
  - `alerted_at` — set by the post-cron check cron when it has sent the
    critical-failure Telegram alert for this row. Avoids double-alerts.
  - If `error_message` starts with `{"critical":true...` it's a
    structured critical-failure payload: all 4 attempts, all verifier
    issues, transport errors, recommendation. This format is the contract
    the post-cron check cron reads; do not change it without updating
    that cron too.
- `n2_mocks` table — `date` is the primary key; a missing row for today
  means either the cron hasn't fired yet or it failed closed after all 4
  attempts (see Retry Loop below). The pipeline **never publishes an
  incomplete mock** — a missing mock is the correct, honest failure
  state, not a bug to route around by padding with old questions.
- **Retry loop (v2, 2026-07-23):**
  | Attempt | Type                  | What it does |
  |---------|----------------------|--------------|
  | 1       | `initial`            | full plan, no feedback |
  | 2       | `same_subtype`       | failing subtypes only, with verifier feedback |
  | 3       | `same_subtype`       | same, with feedback if any still failing |
  | 4       | `pool_substitute`    | each persistently-failing subtype swapped for a fresh one from the unused pool |
  After 4 attempts still failing → `critical_failure` marker on
  `n2_pipeline_runs`, no publish, post-cron check cron pings Jackson.
  Worst-case time: ~50-65s, fits in Vercel Hobby's 60s ceiling.
  Worst-case Gemini calls: 8/day on a totally-bad day (vs. 2 on a clean day).
- **Post-cron check cron** (`n2-post-cron-check`, OpenClaw cron, runs
  07:15 JST = 22:15 UTC daily, silent on success): wakes Felix to verify
  the daily-mock landed. On `success`: NO_REPLY. On `failed` with
  `critical_failure` marker: send Jackson a Telegram alert with the
  per-attempt breakdown, set `alerted_at`. On `failed` without the
  marker: shorter alert. On no row: distinct "cron did not fire" alert.
  Replaces the one-shot `n2-email-fanout-check-0723` that burned once on
  2026-07-23.
- Manual re-trigger (safe — idempotent):
  ```
  curl "https://japanese-n2.vercel.app/api/cron/daily-mock" \
    -H "Authorization: Bearer $CRON_SECRET"
  ```
  Use this if the cron times out mid-loop or you want to force a fresh
  retry after a transient transport error. The cron itself is
  self-recovering — no manual touch needed in the common case.

## Auth — real, not a bypass

Users sign in with email/password or Google OAuth at `/auth`. A previous
`BYPASS_AUTH` dev flag (meant to skip login for pre-launch testing) was
accidentally left set in **Production for 5 days** and let anyone view/
submit as a fixed test account with zero authentication — found and fully
removed 2026-07-19 (env var unset, all bypass code paths deleted from
4 files, `lib/test-mode.ts` deleted). **Never reintroduce an auth bypass
gated only by an env var in a shared production environment** — if test
mode is ever needed again, gate it by something that can't accidentally
ship (e.g. `NODE_ENV !== 'production'` checked in code, not just an
unset-by-hand Vercel var).

## Schema quick reference

`n2_questions` (bank), `n2_mocks` (one row/day, published), `n2_attempts`
(per-question per-user results, RLS `auth.uid() = user_id`), `n2_profiles`,
`n2_email_preferences`, `n2_pipeline_runs` (generator run log),
`n2_rotation_state` (singleton — LRU rotation, the live one), `n2_revision_digests`
(twice-weekly shared digest). `n2_challenges` exists but is dead (0 rows,
nothing writes to it — a legacy table from before `n2_attempts` became the
source of truth).

## What's still open

- No auto-deploy on push yet — Vercel Git integration isn't wired, so
  deploys stay manual (`vercel --prod --yes`). The repo itself now exists
  (see above).
- Cross-user "what most people struggle with" aggregation is architecturally
  ready (RLS forces it server-side via service-role, which is already how
  the revision digest works) but not very meaningful yet with one real user.
- Google OAuth works but relies on Supabase's default provider config —
  no custom consent-screen branding done.
- The 25-pass UI-convergence incident (2026-07-19, documented in Felix's
  own memory) is unrelated to any of the above — that was a visual-design
  loop issue against `dailydispatch.app`, not a functional bug. Worth
  revisiting once whoever owns UI polish next has bandwidth, using an
  actual browser screenshot to verify against the reference, not curl.

## Email transport — Gmail SMTP, no domain (2026-07-22)

`lib/email.ts` ships transactional mail via **Nodemailer → smtp.gmail.com:587
+ STARTTLS**, authenticated with a Google App Password. **No custom domain
is involved and nothing is verified in Resend** — Gmail handles
deliverability and the App Password authenticates the SMTP session.

**Env vars (Production):**
- `GMAIL_USER` — full Gmail address (current value: `kaji.hemopo@gmail.com`)
- `GMAIL_APP_PASSWORD` — 16-char Google App Password
- `EMAIL_FROM` — display-name + address (current:
  `N2 Daily Mock <kaji.hemopo@gmail.com>`)
- `UNSUBSCRIBE_SECRET` — HMAC key for one-click unsub tokens (unchanged)

`RESEND_API_KEY` is still in Production env vars but **is no longer read by
any code path**. Leave it (cosmetic) or `vercel env rm RESEND_API_KEY
production` to remove it. Resend's free tier was the previous transport
and blocks sending to any non-account-owner address without a verified
custom domain — that's why we swapped. The `From` address still resolves
to a `@gmail.com` user, so future "looks pro / your own domain" work is
purely an `EMAIL_FROM` env swap + (if returning to Resend) domain
verification; no transport code change needed either way.

**Gmail rate limits (informational, not currently a concern):** ~500/day
for personal accounts, ~2000/day for Workspace. The daily mock sends
1 email per active subscriber per day; comfortably under either limit
at today's user count.

**Security — App Password hygiene:** the Gmail App Password was pasted
in a chat transcript as part of the swap. After deploy was verified
green, recommend rotating it once (https://myaccount.google.com/apppasswords
→ revoke + create new → update Vercel env). Not urgent, but worth doing
the next time the project is being touched.

**Smoke-testing SMTP-from-Vercel:** the daily-mock cron is idempotent —
if today's mock already exists, it returns early before reaching the
email fan-out. To verify SMTP without waiting for next cron, add a
transient `app/api/smoke-email-test/route.ts` (gated by `CRON_SECRET`),
deploy, hit it, then `rm -rf app/api/smoke-email-test && vercel --prod
--yes` again. Don't ship the test route — it's pure debug surface and
ships an obvious attack target.

**Schema note:** `n2_email_send_log.resend_id` now stores the Gmail
SMTP envelope id (`<...@gmail.com>` format). Field name preserved for
caller compatibility; rename to `provider_message_id` next time the
email schema is touched.
