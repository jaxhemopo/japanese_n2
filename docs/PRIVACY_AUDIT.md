# Privacy & Intake Audit — N2 Daily Mock Exam

**Date:** 2026-07-21  
**Author:** Felix (OpenClaw)  
**Scope:** Focused audit per Jackson's 2026-07-21 ask — auth flow, database inventory, GDPR gaps. Full audit (server-log forensics, third-party data sharing inventory) deferred to a follow-up pass after email feature ships.

---

## TL;DR — What to fix first

| Severity | Finding | Fix |
|---|---|---|
| 🔴 **HIGH** | `/api/dev-signup` accepts any email/password with no production restrictions — anyone on the public internet can create a Jackson-controlled-attacker account | Gate the route: `NODE_ENV !== 'production'` OR restrict to allowlisted emails, AND add password strength check + rate limit. Wire Resend for real email verification ASAP. |
| 🔴 **HIGH** | No privacy policy page | Add `/privacy` linked from auth + footer. Single page, plain language, lists what we collect + how to delete. |
| 🟡 **MED** | No account-deletion endpoint | Add `/api/account/delete` that removes `auth.users` row + cascade-deletes `n2_attempts` (via FK or manual). Link from profile. |
| 🟡 **MED** | No cookie consent banner | Add a minimal banner on `/` for EU users. Not legally required for Japan, but good hygiene + cheaper now than later. |
| 🟢 **LOW** | Google OAuth pulls name + avatar into `user_metadata` automatically | Cosmetic only — those fields are user-provided via Google. Don't surface anywhere on /today yet. Document so we don't accidentally leak them. |

---

## 1. Auth Flow (`app/auth/page.tsx`, `app/auth/callback/route.ts`, `middleware.ts`)

**What we collect:**
- **Email** — required for both password and Google flows
- **Password** — required for password flow; passed to Supabase auth (Supabase hashes + stores)
- **Google profile data** (only via Google OAuth, opt-in via the user's Google consent screen):
  - `full_name`, `avatar_url`, `picture`, `iss`, `sub`, `provider_id`, `email_verified`
  - Stored in `auth.users.user_metadata` automatically by Supabase

**Auth providers supported:**
1. **Google OAuth** (`signInWithOAuth({ provider: 'google' })`) — standard PKCE flow
2. **Email + password** (`signInWithPassword`)

**Magic link is NOT supported** — was removed 2026-07-17 because emails weren't arriving. The current password flow has no email dependency for login. New account creation goes through `/api/dev-signup` (see HIGH finding above).

**Cookie behavior** (per `middleware.ts`):
- Supabase-managed cookies under the `sb-*-auth-token` name (subject to Supabase SSR versioning)
- HttpOnly + Secure + SameSite=Lax defaults
- Refreshed on every request via `supabase.auth.getSession()` call in middleware
- Tokens persisted in Supabase's localStorage on the client (browser-side, JS-readable) for cross-tab session sharing

**Risk surface:**
- Password sent to Supabase over HTTPS (TLS in transit) — Supabase hashes with bcrypt server-side
- No client-side password validation beyond `minLength={6}` (Supabase server-side enforces stronger defaults for production projects: 6+ chars, can't be all-numeric, can't be a common password)
- No rate limiting on sign-in or sign-up attempts (Supabase has built-in protection but it's not configured; a brute-forcer could keep trying)
- No account lockout after N failed attempts (Supabase Pro feature)

---

## 2. Database Inventory (per Supabase schema)

**Tables with user PII (joined on `user_id = auth.users.id`):**

| Table | Per-user rows currently | Stored fields | Notes |
|---|---|---|---|
| `n2_attempts` | 75 rows total (across all test users) | `id`, `user_id`, `challenge_id` (null), `question_id`, `user_answer`, `correct`, `time_seconds`, `created_at` | Learning history. No PII beyond user_id join. **No deletion cascade** — orphaned rows if user is deleted. |
| `auth.users` (managed by Supabase) | (suppressed — 9 test users + 1 Jackson = ~10) | `id`, `email`, `encrypted_password`, `email_confirmed_at`, `last_sign_in_at`, `app_metadata`, `user_metadata`, `identities`, `created_at`, `updated_at` | Most PII lives here. Google OAuth data lives in `user_metadata`. |

**Tables WITHOUT user PII (no user_id join):**
- `n2_mocks` — daily content (date + question_ids + category_dist), per-date not per-user
- `n2_questions` — master question bank, no user attribution
- `n2_pipeline_runs` — cron run history, system-level
- `n2_revision_digests` — twice-weekly digest, shared across all visitors
- `n2_rotation_state` — pipeline internal state
- `n2_challenges`, `n2_alignment` — pipeline internal tables

**PII summary:**
- We collect: email + (optional, Google-only) name + avatar
- We store: same data + per-user attempt history (which is the product)
- We log: errors to Vercel stdout (no PII in error strings observed; auth user IDs only)
- We send to third parties:
  - **Google** (Gemini API): mock question prompts, NO user data (cron route only sends the focus areas, no user_id)
  - **Vercel**: deployment logs, no user data
  - **Supabase**: everything (hosted DB)

---

## 3. Server Logs

**Where logs go:**
- Vercel captures `console.log`, `console.error`, `console.warn` from route handlers + middleware
- Supabase captures auth events + DB queries via its built-in dashboard (separate surfacing)

**What we currently log:**
- Route handlers log errors with `error.message` only — no request body, no auth header, no user email
  - Example from `app/api/attempts/route.ts`: `console.error('[/api/attempts] insert error:', error);`
  - Example from `app/api/cron/revision-digest/route.ts`: `console.error('[/api/cron/revision-digest] error:', message);`
- Middleware logs nothing

**Risk:**
- Low. Vercel logs are scoped to the org/team, accessible only to Jackson + invited collaborators. No request bodies or PII visible in code paths reviewed.

---

## 4. GDPR / Privacy Compliance Gap

| Requirement | Status | Where to fix |
|---|---|---|
| **Privacy policy** | ❌ MISSING | New page at `/privacy`. Plain language: what's collected, why, how to delete, who to contact. |
| **Right to access** (data export) | ❌ MISSING | New endpoint at `/api/account/export` returning `n2_attempts` + auth profile as JSON. |
| **Right to erasure** (account deletion) | ❌ MISSING | New endpoint at `/api/account/delete` that removes the `auth.users` row + cascades `n2_attempts`. Link from `/settings`. |
| **Right to rectification** | ✅ N/A | Email is immutable; user can change password via standard flow. |
| **Cookie consent** | ❌ MISSING (EU only) | Minimal banner on first visit. Defer if not targeting EU. |
| **Data Processing Agreement (DPA)** with vendors | ✅ IMPLIED | Supabase + Vercel both have DPAs available; signed at org level. |
| **Age verification** (under-13) | ⚠️ UNCLEAR | Japan COPPA equivalent — should add "must be 13+" to sign-up ToS. |

---

## 5. Email-feature-specific findings (block these before adding subscribers)

When we add a `n2_subscribers` table, we'll be collecting email addresses + the association between auth users and their subscription preferences. This adds one more schema column to be aware of:

| New surface | Data | Retention recommendation |
|---|---|---|
| `n2_subscribers` | `user_id`, `subscribed_at`, `unsubscribed_at` | Keep `unsubscribed_at` forever so we have an audit trail of "we don't email this user." Delete the row only after 30 days of inactivity. |
| Email send log (`n2_email_send_log`) | `user_id`, `sent_at`, `resend_id`, `status`, `error_message` | Retain 90 days for debugging. Anonymous aggregate stats only after. |
| Resend (third party) | `to`, `from`, `subject`, `body`, `send status` | Covered by Resend's privacy policy + DPA. Resend stores email content for delivery + 30-day abuse review. |

**Per-Japan APPI (Act on the Protection of Personal Information) considerations:**
- We must disclose to users that we're sending emails and that we share their address with Resend (in privacy policy)
- Opt-out mechanism (the unsubscribe link) must work cleanly
- No special consent for *transactional* emails (e.g., daily-mock notification could be considered either transactional or marketing — leaning marketing for now since it's not strictly account-required)

---

## 6. Recommendations — prioritized

**Must-fix before opening signup to anyone besides Jackson:**

1. **Gate `/api/dev-signup`** to `NODE_ENV !== 'production'` OR require an invite-code env var. Optional: add Supabase rate limiting. (30 min work.)
2. **Add `/privacy` page** with plain-language disclosure. (1-2 hr work.)
3. **Add Supabase Auth rate-limit** (or use Cloudflare in front, but simpler: Supabase dashboard setting). (15 min config change.)

**Should-fix as part of email feature:**

4. **Add `n2_subscribers` table** with `user_id` (FK to auth.users), `subscribed_at`, `unsubscribed_at`, `email_send_count`.
5. **Build `/settings` page** with email-subscription toggle (gated to authenticated users).
6. **Add `/api/account/delete` + `/api/account/export`** endpoints. Without these, anyone signing up is stuck — major friction for future users.
7. **Update privacy policy** to mention email subscriptions + Resend as a subprocessor.

**Defer (until you have paying EU users):**

8. **Cookie consent banner.** Japan doesn't require it; California doesn't require it for our data set; EU does.
9. **Age verification.** Add "must be 13+" text to sign-up flow.
10. **DPA ack flows** for enterprise customers (not relevant at ¥200/mo consumer pricing).

---

## Audit metadata

- Files reviewed: 7 (`app/auth/page.tsx`, `app/auth/callback/route.ts`, `middleware.ts`, `app/api/dev-signup/route.ts`, `app/api/attempts/route.ts`, `app/api/cron/revision-digest/route.ts`, `lib/supabase.ts`)
- DB tables reviewed: 8 (via PostgREST introspection + schema head queries)
- PII surface verified: auth flow + RLS-protected user tables + Vercel log surface + cookies
- Audit duration: ~25 min focused pass
- Re-audit recommended: after each major feature (paywall would warrant a fresh one)
