# N2 Content Pipeline — Design Brief (Steinberger-grade)

**Date:** 2026-07-11
**Subject:** A daily-running, audit-gated content pipeline that produces N2 practice questions, integrated with the web app via Supabase
**Conforms to:** `~/ODIS/PIPELINE_STANDARD.md` (Part 1: Pipeline + Part 2: Loop)
**Pipeline location:** `~/ODIS/shared/pipelines/n2-content/`
**Status:** Draft for sign-off (no code yet)
**Related brief:** `2026-07-11_daily-practice-tool-architecture.md` (the web app that consumes this pipeline's output)

---

## TL;DR

- **A Steinberger-grade pipeline** that produces 4-5 audit-approved N2 questions per day, written into `n2_questions` (Supabase) where the web app picks them up.
- **7 steps** following PIPELINE_STANDARD.md format: `01-plan → 02-source → 03-generate → 04-audit (loop) → 05-dedupe → 06-select → 07-publish`
- **Step 04 (audit) is a loop** — iterate until ≥5 candidates pass the 7.0/10 quality gate. Builder = MiniMax-M3 (me) generates. Critic = different model (GPT-4 or claude-sonnet) judges. Different sessions. ~5-min iterations.
- **"Conscious state"** = pipeline reads `n2_challenges` + `n2_attempts` to know what's been served + what Jackson got wrong. Dedup uses similarity scoring against existing `n2_questions`.
- **Pipeline writes to Supabase via service_role key.** Web app reads via anon/auth. Clean separation.
- **Runs daily** via local cron on Jackson's Mac mini (mirror nichi-express pattern). ~5-15 min per day.

---

## 1. Pipeline architecture (overview)

```
┌─────────────────────────────────────────────────────────────────────┐
│  N2 CONTENT PIPELINE (daily, ~5-15 min)                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────┐   ┌───────┐   ┌──────────┐   ┌───────┐   ┌──────┐   ┌────────┐   ┌────────┐
│  │ 01  │──▶│  02   │──▶│   03     │──▶│  04   │──▶│ 05   │──▶│  06    │──▶│  07    │
│  │plan │   │source │   │ generate │   │ audit │   │dedupe│   │ select │   │publish │
│  └─────┘   └───────┘   └──────────┘   └───────┘   └──────┘   └────────┘   └────────┘
│   │            │            │             │ LOOP       │         │             │
│   │            │            │             ▼            │         │             │
│   │            │            │       ┌─────────┐        │         │             │
│   │            │            │       │ critic  │        │         │             │
│   │            │            │       │  ≥7.0?  │        │         │             │
│   │            │            │       └─────────┘        │         │             │
│   │            │            │             │            │         │             │
│   │            │            │             └── rebuild ─┘         │             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ writes approved questions to ↓
                              ▼
            ┌─────────────────────────────┐
            │  Supabase: n2_questions    │
            │  (shared ODIS instance)    │
            └─────────────────────────────┘
                              │
                              │ web app reads from ↑
                              ▼
            ┌─────────────────────────────┐
            │  N2 Web App                 │
            │  ~/projects/japanese-n2/    │
            │  /webapp/                   │
            └─────────────────────────────┘
                              │
                              │ user answers + attempts logged
                              ▼
            ┌─────────────────────────────┐
            │  Supabase: n2_challenges,   │
            │  n2_attempts, n2_profiles   │
            └─────────────────────────────┘
                              │
                              │ next day's pipeline reads these
                              │ (closes the feedback loop)
                              ▼
                        back to 01-plan
```

### Why this is Steinberger-grade

- **Each step runs in fresh context.** A worker session gets only the step doc + inputs + state.json. No conversation history needed.
- **Files communicate.** Step 04 doesn't know what step 02 did; it reads `out/sources.json`.
- **State.json owns the truth.** Pipeline runner checks `lint: "pass"` before allowing workers to proceed.
- **Quality gates are objective.** Critic LLM scores 0-10 against a rubric. No "looks good to me."
- **Builder ≠ critic.** Generation model is different from audit model. Same model reviewing its own output grades its own homework.
- **Closed feedback loop.** Pipeline's `01-plan` reads yesterday's attempts to inform today's focus. The system improves itself.

---

## 2. Step-by-step design

Each step follows the Steinberger step format: GOAL → INPUTS → OUTPUTS → DO → DONE WHEN → VERIFY → BUDGET → ON FAILURE.

### Step 01 — `plan`

**GOAL:** Decide what today's 5-question challenge should focus on (categories, difficulty, tags), based on what Jackson got wrong recently.

**INPUTS:**
- `out/.last_published.json` (from step 07) — yesterday's published questions
- `n2_attempts` (Supabase, last 7 days) — Jackson's recent wrong answers
- `n2_profiles.current_level` — current target level
- `out/.state` (cached: question pool size per category)

**OUTPUTS:**
- `out/plan.json`:
  ```json
  {
    "date": "2026-07-12",
    "user_id": "<jackson>",
    "target_categories": ["grammar_form", "vocab_context", "reading_short"],
    "target_tags": ["keigo", "conditionals"],
    "questions_needed": 5,
    "audit_threshold": 7.0,
    "rationale": "Jackson missed 6 keigo questions in last 5 days; conditionals have 40% miss rate."
  }
  ```

**DO:**
1. Query `n2_attempts` where `user_id = jackson AND correct = false AND created_at > now() - 7d`
2. Group by `question.tags` → find weakest tags
3. Cross-reference with `n2_questions` pool size → pick tags that are low-coverage (need more questions) AND high-weakness
4. Decide target categories + target tags for today
5. Write `out/plan.json`

**DONE WHEN:** `out/plan.json` exists, parses, has at least 1 target_category and 1 target_tag.

**VERIFY:**
```bash
test -f out/plan.json && python3 -c "import json; d=json.load(open('out/plan.json')); assert d['questions_needed'] >= 5 and len(d['target_categories']) >= 1"
```

**BUDGET:** ~3 tool calls, ~1 min wall time.

**ON FAILURE:** Write `blockers/01-plan.md`. Likely cause: Supabase connection issue. Verify `SUPABASE_SERVICE_ROLE_KEY` is set.

---

### Step 02 — `source`

**GOAL:** Pull seed content from textbook sources that informs the next step's generation. Don't generate questions from thin air — anchor in real N2 material.

**INPUTS:**
- `out/plan.json` (from step 01)
- `out/.source_corpus/` (cached textbook excerpts, pre-loaded; see "Corpus" section below)

**OUTPUTS:**
- `out/sources.json`:
  ```json
  {
    "plan_date": "2026-07-12",
    "sources": [
      {
        "id": "skm_n2_g_p15",
        "type": "textbook_excerpt",
        "title": "Shin Kanzen Master N2 文法 §3 — Conditionals",
        "content": "〜ばよかった vs 〜たらよかった vs 〜とよかった... [excerpt text]",
        "tags": ["conditionals", "grammar_form"],
        "difficulty": 4
      },
      ...
    ]
  }
  ```

**DO:**
1. Read `out/plan.json` for target_tags
2. From `.source_corpus/` (pre-loaded textbook content), filter excerpts matching target_tags
3. Select 3-5 diverse excerpts per target tag (mix of grammar/vocab/reading)
4. Write `out/sources.json`

**DONE WHEN:** `out/sources.json` has ≥3 sources covering ≥2 target tags.

**VERIFY:**
```bash
python3 -c "import json; d=json.load(open('out/sources.json')); assert len(d['sources']) >= 3"
```

**BUDGET:** ~2 tool calls, ~30 sec wall time. (All corpus is local, no scraping.)

**ON FAILURE:** Write `blockers/02-source.md`. Likely: corpus too thin for target tags → expand corpus (one-time, manual).

---

### Step 03 — `generate`

**GOAL:** Generate ~15 question candidates from the source excerpts, covering today's target categories and tags. Aim for 3x overshoot (we'll kill ~2/3 in audit).

**INPUTS:**
- `out/plan.json` (categories + tags + count)
- `out/sources.json` (excerpts to base questions on)

**OUTPUTS:**
- `out/candidates.jsonl` — one JSON object per line:
  ```json
  {
    "id": "cand_001",
    "category": "grammar_form",
    "tags": ["conditionals"],
    "difficulty": 4,
    "prompt": "〜たらよかった の使い方として最も適切なものはどれか。",
    "options": [
      {"id": "a", "text": "..."},
      {"id": "b", "text": "..."},
      {"id": "c", "text": "..."},
      {"id": "d", "text": "..."}
    ],
    "correct_answer": "b",
    "explanation": "...",
    "source_id": "skm_n2_g_p15"
  }
  ```

**DO:**
1. For each source excerpt + each target tag, generate 3 candidates via MiniMax-M3 (me)
2. Prompt template:
   ```
   You are a JLPT N2 question writer. Generate one multiple-choice question from
   the following source excerpt.
   
   Source: {excerpt.title}
   Excerpt: {excerpt.content}
   Target tags: {target_tags}
   Difficulty: N2 (advanced intermediate)
   
   Requirements:
   - Question tests a specific N2 grammar point or vocabulary pattern
   - 4 options, exactly 1 correct
   - Distractors are plausible but clearly wrong to a native speaker
   - Japanese accuracy is paramount — no kanji errors
   - Explanation: 2-3 sentences in English
   
   Output JSON only.
   ```
3. Write each candidate to `out/candidates.jsonl` (append-only)

**DONE WHEN:** `out/candidates.jsonl` has ≥10 candidates covering all target_categories from plan.

**VERIFY:**
```bash
test -f out/candidates.jsonl && wc -l out/candidates.jsonl | awk '{exit ($1 >= 10) ? 0 : 1}'
```

**BUDGET:** ~5 tool calls (one generation call per 3 candidates), ~3 min wall time.

**ON FAILURE:** Write `blockers/03-generate.md`. Likely: LLM rate limit, malformed JSON output, or category mismatch.

---

### Step 04 — `audit`  ← **THIS IS A LOOP**

**GOAL:** Score each candidate against a quality rubric. Kill any candidate scoring below 7.0. Loop until ≥5 candidates pass (or stall).

**INPUTS:**
- `out/candidates.jsonl` (from step 03)
- `out/.audit_rubric.md` (the quality rubric — see below)

**OUTPUTS:**
- `out/audited.jsonl` — candidates with added fields:
  ```json
  {
    ...candidate fields...,
    "audit": {
      "score": 8.5,
      "scores_by_criterion": {
        "n2_alignment": 9,
        "clarity": 8,
        "distractor_quality": 9,
        "japanese_accuracy": 9,
        "format_compliance": 8
      },
      "critique": "Strong question, distractor A is too obviously wrong. Otherwise excellent.",
      "reviewer_model": "claude-sonnet-4-5",
      "kept": true
    }
  }
  ```

**DO (per iteration):**
1. Read current `out/audited.jsonl` (if exists) — get already-audited candidates
2. Pick the next batch of unaudited candidates (up to 5 per iteration)
3. Send each candidate + rubric to **critic model** (different from generator — see §4)
4. Parse score + critique, append to `out/audited.jsonl`
5. Count `kept: true` so far
6. If `kept >= 5` → exit loop, write `out/audit_summary.json`, proceed
7. If 3 iterations with no `kept` increase → stall → write blocker

**LOOP BUDGET:** max 10 iterations, ~5 min each. Stall = 3 no-delta iterations.

**DONE WHEN:** `out/audit_summary.json` exists with `kept_count >= 5`.

**VERIFY:**
```bash
python3 -c "
import json
d = json.load(open('out/audit_summary.json'))
assert d['kept_count'] >= 5, f'only {d[\"kept_count\"]} kept'
print(f'kept={d[\"kept_count\"]}, killed={d[\"killed_count\"]}')
"
```

**CRITIC MODEL:** `claude-sonnet-4-5` (different from MiniMax-M3 generator). Fresh session per iteration.

**BUDGET:** ~5 tool calls per iteration, ~5 min wall time.

**ON FAILURE:** Write `blockers/04-audit.md`. Common: rubric mismatch (critic too strict or too lenient) → tighten rubric. Or pool exhaustion → go back to step 03 and generate more.

#### Audit rubric (`out/.audit_rubric.md`)

Each criterion scored 1-10:

| Criterion | What it measures | Pass threshold |
|---|---|---|
| **N2 alignment** | Does this test N2-level material (not N3 or N1)? | ≥7 |
| **Clarity** | Is the question unambiguous? Only one defensible answer? | ≥7 |
| **Distractor quality** | Are wrong answers plausible (not obviously wrong)? | ≥6 |
| **Japanese accuracy** | No kanji/grammar errors in any text? | ≥8 (strict) |
| **Format compliance** | Matches schema (4 options, 1 correct, valid JSON)? | ≥7 |

**Overall = average of criteria, weighted equally.** Keep if overall ≥7.0 AND no criterion below its pass threshold.

---

### Step 05 — `dedupe`

**GOAL:** Remove candidates that are too similar to existing `n2_questions` or to each other.

**INPUTS:**
- `out/audited.jsonl` (kept candidates from step 04)
- `n2_questions` (Supabase, all existing questions — fetch prompt + tags only for speed)

**OUTPUTS:**
- `out/deduped.jsonl` — same format as audited, with `duplicate_of` field if removed

**DO:**
1. Fetch all existing `n2_questions` (just `id`, `prompt`, `tags` columns)
2. For each kept candidate:
   - Compute embedding via OpenAI `text-embedding-3-small` (or similar)
   - Compute cosine similarity vs each existing question's embedding
   - If max similarity > 0.85 → mark as duplicate, do not pass through
3. Also check candidate-vs-candidate similarity (within this batch)
4. Write survivors to `out/deduped.jsonl`

**DONE WHEN:** `out/deduped.jsonl` has ≥5 candidates (or fewer if duplicates removed; if <5, return to step 03 with feedback).

**VERIFY:**
```bash
test -f out/deduped.jsonl && wc -l out/deduped.jsonl | awk '{exit ($1 >= 5) ? 0 : 1}'
```

**BUDGET:** ~3 tool calls, ~2 min wall time (embedding API + DB query).

**ON FAILURE:** Write `blockers/05-dedupe.md`. Likely: too many duplicates → corpus too narrow, expand sources in step 02.

---

### Step 06 — `select`

**GOAL:** Pick the best 5 from the deduped candidates, ensuring diversity across categories and difficulty.

**INPUTS:**
- `out/deduped.jsonl`

**OUTPUTS:**
- `out/selected.json`:
  ```json
  {
    "date": "2026-07-12",
    "questions": [
      { "candidate": {...}, "selection_reason": "Highest audit score in grammar_form" },
      ...
    ]
  }
  ```

**DO:**
1. Group candidates by category
2. Pick the highest-audit-score candidate per category (up to 5 categories)
3. If <5 categories available, fill with next-best diverse candidates
4. Verify difficulty distribution (mostly N2, some N3 for warm-up)
5. Verify no two questions test the same exact grammar pattern
6. Write `out/selected.json`

**DONE WHEN:** `out/selected.json` has exactly 5 questions, each from a unique category OR with explicit diversity justification.

**VERIFY:**
```bash
python3 -c "
import json
d = json.load(open('out/selected.json'))
assert len(d['questions']) == 5
cats = [q['candidate']['category'] for q in d['questions']]
assert len(set(cats)) >= 3, 'need ≥3 distinct categories'
"
```

**BUDGET:** ~2 tool calls, ~30 sec wall time.

**ON FAILURE:** Write `blockers/06-select.md`. Likely: insufficient diversity after dedupe → go back to step 03 with broader category list.

---

### Step 07 — `publish`

**GOAL:** Insert the 5 selected questions into `n2_questions` (Supabase), update pool stats, signal to web app that today's challenge can be generated.

**INPUTS:**
- `out/selected.json`
- Supabase service_role credentials

**OUTPUTS:**
- New rows in `n2_questions` (5 rows, with `source = "pipeline_2026-07-12"`)
- `out/.last_published.json` (cached for next day's `01-plan` step)

**DO:**
1. For each selected question, insert into `n2_questions` with `source = "pipeline_YYYY-MM-DD"`
2. Capture inserted IDs
3. Write `out/.last_published.json` with the IDs + dates
4. Trigger web app's daily challenge generator (set a flag in Supabase: `n2_pipeline_runs.last_run_at = now()`)
5. Update `state.json` to mark pipeline complete

**DONE WHEN:** 5 new rows in `n2_questions` AND `out/.last_published.json` exists.

**VERIFY:**
```bash
python3 -c "
from supabase import create_client
sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])
res = sb.table('n2_questions').select('id').eq('source', 'pipeline_2026-07-12').execute()
assert len(res.data) == 5
"
```

**BUDGET:** ~3 tool calls, ~30 sec wall time.

**ON FAILURE:** Write `blockers/07-publish.md`. Likely: Supabase permissions issue (service_role key missing or wrong).

---

## 3. Quality gates as loops (deep dive on step 04)

Step 04 is the only loop. Everything else is one-shot. Per PIPELINE_STANDARD Part 2:

```
ORIENT   read state.json + out/audited.jsonl + audit rubric
PLAN     pick next batch of unaudited candidates (up to 5)
ACT      send each to critic model, parse scores, append to audited.jsonl
VERIFY   count kept candidates; if >= 5, write audit_summary.json, exit
RECORD   append to progress.md (iteration #, scores, kept count delta)
EXIT?    if kept >= 5 → exit success
         if iterations == 10 → exit budget
         if 3 no-delta iterations → exit stall (blocker)
         else → next iteration, fresh context
```

### Why builder ≠ critic

If MiniMax-M3 generated the candidates AND audited them, the audit would grade its own work. Known failure mode: LLM tends to rate its own output favorably. Per Steinberger standard:

> **Builder ≠ critic.** A fresh session (ideally a different model) reads ONLY the artifact + the spec and writes a numbered critique file. The next builder iteration consumes the critique.

So:
- **Builder:** MiniMax-M3 (me) generates candidates in step 03
- **Critic:** Claude Sonnet 4.5 (or GPT-4o) audits in step 04

Different models = different biases = real quality gate.

### Stall detection

`progress.md` tracks each iteration's kept count:
```
iter 1: kept=3
iter 2: kept=4 (delta +1)
iter 3: kept=4 (delta 0) ← stall counter 1
iter 4: kept=4 (delta 0) ← stall counter 2
iter 5: kept=4 (delta 0) ← stall counter 3 → BLOCKEr
```

Stall after 3 no-delta iterations. Common cause: rubric too strict for current generator's quality. Fix: relax rubric OR regenerate with better prompt.

---

## 4. Dedup strategy (step 05 details)

### Why dedup matters

If we generate questions daily without dedup, the pool fills with near-duplicates ("when do you use たら" with slightly different wording). Jackson sees the same pattern tested twice. Quality tanks.

### Embedding-based dedup

```python
from openai import OpenAI
from supabase import create_client

client = OpenAI()
sb = create_client(url, service_role_key)

def get_embedding(text):
    resp = client.embeddings.create(
        model="text-embedding-3-small",
        input=text,
    )
    return resp.data[0].embedding

def find_duplicates(candidate_prompt, threshold=0.85):
    # Get all existing questions (just prompt + embedding if pre-computed)
    existing = sb.table('n2_questions').select('id, prompt').execute()
    
    candidate_emb = get_embedding(candidate_prompt)
    duplicates = []
    for q in existing.data:
        existing_emb = get_embedding(q['prompt'])
        sim = cosine_similarity(candidate_emb, existing_emb)
        if sim > threshold:
            duplicates.append((q['id'], sim))
    
    return duplicates
```

### Pre-computing embeddings (optimization)

To avoid recomputing embeddings for every candidate:
- Add a `prompt_embedding vector(1536)` column to `n2_questions` (via Supabase pgvector extension)
- Compute once on insert, store in DB
- Dedup step uses `pgvector <=>` operator for fast similarity search

This is a Phase 2 optimization. For MVP, recompute embeddings on each run (small pool, fine).

---

## 5. Source corpus (the long-term asset)

For step 02 (`source`) to work, we need a curated corpus of N2-level textbook excerpts. Build once, reuse forever.

```
out/.source_corpus/
├── skm_n2_g/           # Shin Kanzen Master N2 Grammar — page-by-page excerpts
├── skm_n2_v/           # Vocabulary
├── try_n2/             # Try! N2 — chapter summaries + practice items
├── sou_matome_n2/      # Sou Matome N2 — weekly review pages
├── past_papers/        # Official JLPT N2 past papers (2020-2024)
└── manual_seed/        # Hand-curated by Jackson — grammar points he wants drilled
```

**MVP corpus size:** ~500 textbook excerpts covering all N2 categories + tags. ~2-3 days of focused OCR + manual curation work.

**Format:** JSON files, one per source, with `{id, type, title, content, tags, difficulty}`.

---

## 6. Integration with the web app

### Data flow

```
Pipeline step 07 → writes 5 rows → n2_questions table
                                            ↓
Web app cron (00:00 UTC) → reads n2_questions → picks 5 for today's challenge
                                            ↓
Web app → user answers → n2_attempts updated
                                            ↓
Pipeline step 01 → reads n2_attempts → informs tomorrow's focus
```

### Trigger

- **Web app daily cron** fires at 00:00 UTC (09:00 JST)
- **Pipeline** runs at 23:00 UTC (08:00 JST) — an hour earlier, so the pool has fresh questions
- Both scheduled via cron on Jackson's Mac mini (Vercel cron for web app; local cron for pipeline)

### State synchronization

The pipeline writes to Supabase; the web app reads from Supabase. They're decoupled. The web app doesn't know the pipeline exists. The pipeline doesn't know who's using the pool.

This is the Steinberger ideal: **systems compose via shared artifacts, not direct coupling.**

---

## 7. File layout

```
~/ODIS/shared/pipelines/n2-content/
├── PIPELINE.md
├── state.json
├── _bin/
│   └── lint_pipeline.sh           # symlink to shared linter
├── steps/
│   ├── 01-plan.md
│   ├── 02-source.md
│   ├── 03-generate.md
│   ├── 04-audit.md                # the LOOP
│   ├── 05-dedupe.md
│   ├── 06-select.md
│   └── 07-publish.md
├── out/
│   ├── plan.json
│   ├── sources.json
│   ├── candidates.jsonl
│   ├── audited.jsonl
│   ├── audit_summary.json
│   ├── deduped.jsonl
│   ├── selected.json
│   ├── .last_published.json
│   └── .audit_rubric.md
├── progress.md                    # loop iteration log
├── blockers/                      # failure reports
└── README.md

~/ODIS/shared/pipelines/n2-content/out/.source_corpus/   # the long-term asset
├── skm_n2_g/
├── try_n2/
├── ...
```

State.json initial shape:

```json
{
  "pipeline": "n2-content",
  "updated_at": null,
  "lint": "pending",
  "steps": {
    "01-plan":     { "status": "pending" },
    "02-source":   { "status": "pending" },
    "03-generate": { "status": "pending" },
    "04-audit":    { "status": "pending" },
    "05-dedupe":   { "status": "pending" },
    "06-select":   { "status": "pending" },
    "07-publish":  { "status": "pending" }
  }
}
```

After `lint_pipeline.sh` validates format: `"lint": "pass"`.

---

## 8. Implementation plan

### Phase A — Pipeline skeleton (1 week)

- [ ] Create folder structure under `~/ODIS/shared/pipelines/n2-content/`
- [ ] Write PIPELINE.md + state.json + 7 step docs following Steinberger format
- [ ] Run `lint_pipeline.sh` until `lint: pass`
- [ ] Smoke test: hand-run step 01 with mock inputs

### Phase B — Source corpus (1 week, parallel with A)

- [ ] OCR + curate ~500 textbook excerpts into `.source_corpus/`
- [ ] Tag each excerpt with grammar/vocab/reading categories
- [ ] Verify corpus covers all target_tags in n2-path research §1

### Phase C — Steps wired up (1 week)

- [ ] Implement step 01 (Supabase query for plan)
- [ ] Implement step 03 (MiniMax generation)
- [ ] Implement step 04 loop (claude-sonnet-4-5 audit, fresh sessions)
- [ ] Implement step 05 (embedding dedup)
- [ ] Implement step 06 (selection logic)
- [ ] Implement step 07 (Supabase insert)

### Phase D — Cron + monitoring (3 days)

- [ ] Add to local cron: `0 23 * * * cd ~/ODIS/shared/pipelines/n2-content && python3 -m pipeline.run`
- [ ] Telegram notification on completion or blocker
- [ ] Slack-style alert to Jackson if any blocker persists >24h

### Phase E — Iterate (ongoing)

- [ ] First week: daily manual review of generated questions. Catch rubric bugs.
- [ ] After 2 weeks: refine audit rubric, lower false-kill rate
- [ ] After 1 month: enable embedding pre-computation (pgvector)
- [ ] After 3 months: corpus expansion to 2000+ excerpts

---

## 9. Open questions for sign-off

1. **Critic model choice:** claude-sonnet-4-5 (proposed) vs GPT-4o vs other. Which is best for Japanese quality grading? **My rec: claude-sonnet-4-5, strongest Japanese + structured output.**
2. **Audit threshold:** 7.0/10 (proposed). Tighter = higher quality but more regeneration. Looser = faster but lower quality. **My rec: start 7.0, tune after 2 weeks of data.**
3. **Generation model:** MiniMax-M3 (me) for candidates. Use a different model for variety? **My rec: me for primary, occasional GPT-4o for "second opinion" on borderline categories.**
4. **Corpus curation effort:** 500 excerpts ≈ 2-3 days focused. Want me to OCR + tag from SKM/TRY/Sou Matome, or do you curate by hand? **My rec: hybrid — I OCR, you review tags + quality.**
5. **Pipeline cadence:** daily (proposed). Want it to run more often (e.g., 2x daily)? **My rec: daily at 23:00 UTC; more often feels wasteful until pool is large.**
6. **Failure mode handling:** if step 04 stalls 3 iterations, do we (a) write blocker and stop, or (b) accept whatever passed in earlier iterations and ship a smaller batch? **My rec: (a) — never ship a sub-quality batch.**
7. **Pipeline location:** `~/ODIS/shared/pipelines/n2-content/` (proposed, mirrors nichi-express) or `~/projects/japanese-n2/pipeline/`? **My rec: shared, so any agent can run it.**
8. **Embedding model:** OpenAI text-embedding-3-small (proposed) vs free alternative? **My rec: OpenAI, $0.02/1M tokens, negligible cost.**

---

## 10. Sources

- `~/ODIS/PIPELINE_STANDARD.md` — Part 1 (Pipeline) + Part 2 (Loop) — the framework this brief conforms to
- `~/ODIS/shared/pipelines/nichi-express/PIPELINE.md` — reference pipeline (10 steps, scoring + kill loops)
- `~/ODIS/shared/pipelines/market-research/PIPELINE.md` — simpler reference (4 steps)
- `~/ODIS/shared/outputs/research_briefs/2026-07-07_peter-steinberger-agentic-coding-ai-principles-workflow.md` — Steinberger's published philosophy
- `~/projects/japanese-n2/notes/2026-07-11_daily-practice-tool-architecture.md` — the web app that consumes this pipeline's output

---

## Next step

Sign off on:
- §1 architecture (7 steps + loop on step 04)
- §2 step design (especially audit rubric in §2 step 04)
- §3 loop mechanics (builder ≠ critic, stall=3)
- §4 dedup strategy (embedding-based)
- §5 source corpus plan
- §6 web app integration (decoupled via Supabase)
- §7 file layout
- §8 implementation phases
- §9 open questions (especially #1 critic model, #2 threshold, #4 corpus effort)

Once signed off, I'll:
1. Create `~/ODIS/shared/pipelines/n2-content/` skeleton
2. Write the 7 step docs + PIPELINE.md + state.json
3. Run lint until pass
4. Hand back to you for the corpus curation pass (Phase B)

Then we can run the pipeline locally for the first time within 1 week.