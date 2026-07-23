# Japanese — JLPT N2 Path

**Status:** Planning phase (daily-practice tool design)
**Started:** 2026-07-11
**Target:** Pass JLPT N2 by ~July 2027

## Phases
1. ✅ **Research** — N2 path research (borderline N3 → N2 in 1 year)
2. ✅ **Planning** — daily N2 practice tool + content pipeline design
3. ⏸ **Build** — implement web app + pipeline (TBD)
4. ⏸ **Run** — daily practice + iterate

## System architecture (two coupled systems)

```
┌──────────────────────────┐         ┌──────────────────────────┐
│ Content Pipeline         │         │ Web App                 │
│ (Steinberger-grade)      │  ───►   │ (Next.js + Supabase)    │
│ ~/ODIS/shared/pipelines/ │         │ ~/projects/japanese-n2/  │
│        n2-content/       │         │        webapp/          │
└──────────────────────────┘         └──────────────────────────┘
           │                                       │
           │ writes to ↓                           │ reads from ↑
           ▼                                       │
   ┌─────────────────────────────────────┐         │
   │  Supabase: n2_questions (shared)    │  ◄──────┘
   └─────────────────────────────────────┘
```

The pipeline produces questions; the web app serves them. Decoupled via shared Supabase.

## Context

- Took JLPT N3 in July 2026 (results pending — typically late August)
- Self-assessment: borderline N3
  - Likely passed: vocab + listening
  - Likely failed: grammar
- Goal: pass N2 in 1 year from a borderline N3 baseline

## Layout

```
japanese-n2/
├── README.md          ← this file
├── research/          ← research findings only (no plan yet)
│   └── 2026-07-11_n2-path-research.md
└── notes/             ← reserved for later raw notes / attempt logs
```

## Next step

1. ✅ Read `research/2026-07-11_n2-path-research.md` (done).
2. ✅ Decide on curriculum arc framework (done — standard arc accepted; community pulse added).
3. ✅ Design daily N2 practice tool + content pipeline:
   - ✅ N2 question categories + layouts research → `research/2026-07-11_n2-daily-practice-tool-research.md`
   - ✅ Web app architecture → `notes/2026-07-11_daily-practice-tool-architecture.md`
   - ✅ Content pipeline design → `notes/2026-07-11_n2-content-pipeline-design.md`
   - ▶ Sign-off on both briefs
4. ⏸ Build web app Phase 1 + pipeline skeleton in parallel.
5. ⏸ Run it daily + iterate.