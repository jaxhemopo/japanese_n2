---
title: N2 Daily Mock Exam — End-Product Spec
slug: n2-end-product-spec
date: 2026-07-12
status: LOCKED — Jackson signed off 2026-07-12 18:55 JST. Schema amendments applied 2026-07-12 23:50 JST under agent-autonomy doctrine (see "Schema amendments" section).
target_pass_date: ~July 2027
loop_goal_seed: true
build_loop_cadence: 15min
build_loop_tz: Asia/Tokyo
---

# N2 Daily Mock Exam — End-Product Spec

> The artifact the build-loop will iteratively construct. Every wakeup reads this file (or its copy at `goal.md`) to decide its next small step.

## TL;DR

A daily N2-level Japanese mock exam, delivered via webapp, that Jackson (and eventually other subscribers) take every morning at **07:30 JST**: **5 audit-clean questions** across **reading / grammar / vocab** (listening deferred to post-traction phase), professionally laid out, timed, with results returned and feedback used to bias tomorrow's set. **Magic-link auth** with persistent device sessions.

## User-facing flow (the canonical story)

1. **07:30 JST** — Subscriber opens the webapp (or clicks today's email → lands logged-in). Today's 5-question mock is up: mixed categories, ~10–15 min total.
2. **Take the mock** — Tap a multiple-choice answer, auto-advance (or click-next). Timer shows per-question + total time.
3. **Submit** — Result screen: per-question correct/incorrect + explanation. Attempt is logged.
4. **Tomorrow** — Subscriber gets a new mock biased toward yesterday's weak tags, with **dedupe** preventing repeats.

## Components (the buildable pieces)

### A. Webapp (Next.js + Supabase)

- **Auth:** Magic link via email; persistent sessions on device (long JWT TTL so "kept logged in" works).
- **Pages**
  - `/` — landing (today's mock preview if signed-in)
  - `/today` — render today's mock, take it
  - `/result/[date]` — per-attempt result
  - `/auth` — email-entry for magic link
  - `/account` — email prefs (subscribe toggle)
- **Interactions**
  - Multiple-choice tap → mark + advance
  - Per-question + total timer
  - Submit → POST to `/api/attempts` → redirect to result
  - Toast notifications

### B. Daily Pipeline (1× per day, fires at **07:30 JST**)

Steps the production pipeline runs:

1. `01-plan` — read recent attempts, derive weak-tag target set
2. `02-source` — pull N2-scope sources for **3 categories** (reading / grammar / vocab) at launch; listening added post-traction
3. `03-generate` — generate 5 candidates (LLM primary, template fallback)
4. `04-audit` — LLM critic + rule-based fallback, thresholds from `.audit_rubric.md`
5. `05-dedupe` — vs prior published, embedding cosine ≥ 0.85 + char-trigram Jaccard ≥ 0.7 *(explicitly: prevent repeats)*
6. `06-select` — round-robin across 3 categories, hit `target_tags`, **exactly 5 questions**, assemble the daily mock
7. `07-publish` — write today's mock to `n2_mocks` + questions to `n2_questions`
8. **`08-verify` (NEW)** — schema-validate all 5 questions; render-check today's set in webapp preview
9. **`09-notify` (NEW)** — email subscribers "Today's mock is up"

### C. Schemas (artifact contract — webapp renders strictly from these)

```yaml
Question:
  id: uuid
  category: enum (grammar_form | reading_short | vocab_context)   # listening added later
  tags: [string]
  difficulty: 1..5
  prompt: string                # markdown ok
  options: [{id: a|b|c|d, text: string}]
  correct_answer: a|b|c|d
  explanation: string
  source_id: string            # DB column n2_questions.source_id (renamed via migration 007)
  audit:
    score: float
    scores_by_criterion:
      japanese_accuracy: float
      n2_alignment: float
      clarity: float
      distractor_quality: float
      format_compliance: float
    reviewer_model: string
    reviewed_at: iso8601

DailyChallenge:                   # originally 'DailyMock' in earlier drafts; rows live in n2_challenges per amendment
  date: YYYY-MM-DD
  questions: [Question]             # length 5
  category_dist: {category: count}
  target_tags: [string]
  pipeline_run_id: uuid
```

### D. Data (Supabase)

- `n2_profiles` — user account + email
- `n2_questions` — every published question (full pool); column `source_id` (was `source` in early migrations; renamed via migration 007)
- `n2_challenges` — daily sets (references questions). **Note:** spec originally called this `n2_mocks`; the existing migration 003 uses `n2_challenges` and existing data lives there. Per the agent-autonomy doctrine (locked 2026-07-12 23:48 JST), the agent aligned spec to existing data instead of forcing a rename.
- `n2_attempts` — per-user mock attempts + per-question answers + timing
- `n2_email_preferences` — subscribed flag, last-sent timestamp *(table exists; no send step yet)*
- `n2_pipeline_runs` — per-day audit trail *(table exists)*

### E. Notifications

- Daily "Today's mock is up" email at **07:30 JST** to subscribed profiles
- *(Deferred)* per-attempt result email

## Quality bar (the verifier criteria)

### Per-question (have it — needs hardening)

- Audit score ≥ 7.0 overall:
  - `japanese_accuracy` ≥ 8.0
  - `n2_alignment` ≥ 7.0
  - `clarity` ≥ 7.0
  - `distractor_quality` ≥ 6.0
  - `format_compliance` ≥ 7.0
- LLM critic is *primary*; rule-based fallback only when API times out *(fix the primary path)*

### Set-level / end-to-end (missing — the gap)

- **Exactly 5 questions** per day, **≥ 3 distinct categories** (forced by 3-category palette at launch)
- All `target_tags` hit at least once
- Schema-valid for every question
- Render-check: today's mock renders in webapp preview without errors (programmatic screenshot saved to `out/daily-renders/{date}.png`)
- Published in `n2_mocks` for today's date **before 07:30 JST**
- **Dedupe**: no near-duplicates vs prior 30 days

### User-facing (closed loop — currently open)

- At least one subscriber attempts and completes the daily mock
- Per-question answers + timing logged to `n2_attempts`
- Result page renders correct/incorrect breakdown
- Next-day `01-plan` query reads yesterday's attempt and biases `target_tags`

## Subscriber launch plan

- **Phase 1 (now):** solo — Jackson only, validates end-to-end
- **Phase 2:** invite a few — hand-picked test users
- **Phase 3:** open — public signup

## Out of scope (deferred)

- Audio pipeline for listening questions *(explicit: deferred to post-traction)*
- Spaced repetition beyond weak-tag targeting
- Multi-user public signup (gated by launch phase above)
- Mobile app
- Analytics dashboard
- Per-attempt result emails

## Schema amendments (locked 2026-07-12 23:50 JST via agent-autonomy doctrine)

These amendments were made by the build-loop's offline session (the cron isolated wakeups surfaced the schema/spec conflicts; the agent resolved them per the autonomy doctrine, with documented rationale, instead of paging Jackson for technical-rename questions).

- **`Question.source_id`** is the canonical field name. Migration 007 renames the DB column `n2_questions.source` → `n2_questions.source_id` (file ready, apply pending). Rationale: spec is the source of truth; the rename is small and reversible.
- **Daily sets table is `n2_challenges`** (per existing migration 003 and existing data). Earlier spec drafts used `n2_mocks`. Rationale: existing data + migration history win over docs; migrating live data costs more than amending a spec line. Webapp code reads from `n2_challenges`.

## Decisions (locked 2026-07-12 18:55 JST)

- **OQ-1** Daily-pipeline cadence: **07:30 JST** (22:30 UTC prior day).
- **OQ-2** Daily question count: **exactly 5/day**, spread across the 3 active categories, dedupe prevents repeats.
- **OQ-3** Auth: **magic link + persistent device sessions** (long JWT TTL; email click → logged in; stays logged in).
- **OQ-4** Listening: **deferred**. Text-only at launch (reading/grammar/vocab). Listening becomes an upgrade after user traction.
- **OQ-5** Subscriber pool at launch: **solo (Jackson) → invite a few → open**, phased.
- **OQ-6** Per-wakeup budget: **no hard token cap** (Jackson uses `minimax/MiniMax-M3`, generous servings). Quality > speed. **Maintain narrow context** — each wakeup reads only `goal.md`, `state.json`, and last 3 wakeups entries, no full-doc loads. Stop conditions intact.

## Verifier checkpoints (definitive pass criteria for "done")

The build-loop is **done** when **all** of these pass in one run, end-to-end:

1. ✅ Pipeline produces a 5-question mock for today's date, before 07:30 JST
2. ✅ `08-verify` reports schema-valid + render-check pass
3. ✅ Email sent to ≥ 1 subscriber (Jackson), no bounce
4. ✅ Subscriber opens webapp (or clicks email → already logged in), takes the 5-question mock, completes it
5. ✅ Attempt lands in `n2_attempts` with per-question answers + timing
6. ✅ Result page renders with correct/incorrect breakdown + explanations
7. ✅ Next-day `01-plan` query reads yesterday's attempt and biases `target_tags`
8. ✅ Phase 1 sign-off: Jackson has done ≥ 5 days in a row without failure

---

_Locked by Felix on 2026-07-12 18:55 JST per Jackson's answers. Schema amendments applied 2026-07-12 23:50 JST under agent-autonomy doctrine (see "Schema amendments" section). This file is the canonical seed for the build-loop's `goal.md`. It must NOT be a fixed step-list — the loop reads it to *decide* its next small step each wakeup._
