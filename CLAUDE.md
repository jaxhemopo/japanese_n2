# japanese-n2 — project notes

**Full operational ownership sits with Felix** (since 2026-07-20). Other agents only touch this when Jackson explicitly asks. If you do, read [`docs/HANDOFF.md`](./docs/HANDOFF.md) first — it is the live, human-canonical reference for architecture, credentials, cron schedules, schema, pipeline implementation, and lessons learned.

## TL;DR (after reading HANDOFF.md)

- **Live URL:** https://japanese-n2.vercel.app
- **Cron trigger:** Vercel Cron Jobs declared in `vercel.json` — *not* OpenClaw. Zero ODIS involvement in scheduling; we only observe results in `n2_pipeline_runs`.
- **Authoritative generator:** `app/api/cron/daily-mock/route.ts` + `app/api/cron/revision-digest/route.ts`. Don't edit `~/ODIS/shared/pipelines/n2-generator/` — frozen reference only.
- **Live state:** Supabase tables `n2_mocks`, `n2_pipeline_runs`, `n2_rotation_state`.
- **Credentials:** all in `vercel env ls production` (encrypted, Production-only). Local `.env.local` holds only the 2 `NEXT_PUBLIC_*` (URL + anon key — by-design public).
- **Git repo** (remote `github.com/jaxhemopo/japanese_n2`); build artifacts git-ignored. No auto-deploy — every deploy is still a manual `npx vercel --prod --yes` from this directory.
- **Budget cap:** ~4 Gemini calls/day total. Don't add more LLM calls anywhere in this app without confirming with Jackson.

## Why this file exists

HANDOFF.md is for humans and Felix. This file is for *other agents* who land on the project (gap-killer sweeps, measured-audit scans, shared ODIS scripts) and need a one-screen pointer telling them where the source of truth lives and what's authoritative. Keep it under 30 lines.
