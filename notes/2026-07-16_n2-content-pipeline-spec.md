# N2 Daily Content Pipeline — Spec (v1, 2026-07-16)

## Goal

Fully automated daily pipeline: generate a fresh 5-question N2 mock every
morning (07:30 JST), verify it, publish to `n2_mocks`, webapp serves it at
japanese-n2.vercel.app/today. No manual intervention once running.

## Why this replaces prior attempts

- The existing 61-row `n2_questions` bank is **not trustworthy** — audited
  2026-07-16, found rows mislabeled `source_id: jlpt_official_n2_mondai_sample`
  that are actually fabricated ("Note: the original PDF question 22 may
  differ; this is a representative fill-in-the-blank" — admitted in the
  explanation field), plus at least one structurally broken question (two
  duplicate answer options). Real official sample only has 31 questions
  total, so ~30 of the 61 are not what they claim to be. **This bank needs a
  separate audit/cleanup pass — out of scope for this spec, tracked
  separately.**
- Real official past exams are not published free by JEES beyond one small
  sample (31 questions, this doc's anchor source). Commercial textbooks are
  copyrighted — cannot scrape/republish. The only legal, scalable source is
  **LLM-generated questions with real verification**, anchored to genuine
  official examples for style/difficulty/format.

## Subtype catalog

Each subtype gets its own prompt, own generator call, own verification loop.
Anchors below are pulled directly from the official JEES N2 sample
(`~/ODIS/shared/cache/jlpt-n2/N2-mondai.pdf` + answer key `N2-seikai.pdf`),
not from the unverified DB.

### Language Knowledge

**1. Kanji Reading** — read the underlined kanji correctly.
> Anchor (Q1, N2-mondai.pdf p.34): 戦後、日本は<u>貧しい</u>時代を経験した。
> 1.まずしい 2.きびしい 3.けわしい 4.はげしい — **Answer: 1**

**2. Contextual Vocabulary** — fill blank with correct noun/verb/adjective.
> Anchor (Q7, p.35): 日本人の平均（　）は、男性が79歳、女性が86歳である。
> 1.生命 2.寿命 3.人生 4.一生 — **Answer: 2**

**3. Word Formation & Synonyms** — nearest-meaning synonym, or correct usage
in context.
> Anchor A — synonym (Q9, p.36): 田中さんは単なる友人です。
> 1.大切な 2.一生の 3.ただの 4.唯一の — **Answer: 3**
> Anchor B — usage (Q12, p.36): 率直 — correct sentence: 「このアンケートに
> は、皆様のご意見を率直にお書きください。」— **Answer: 3** (of 4 sentence
> options, this is the one where 率直 is used correctly)

**4. Grammar Formats** — correct grammatical pattern/particle for context.
> Anchor (Q13, p.37): 最終のバスに間に合わなくて困っていた（　）、運よくタクシ
> ーが通りかかり、無事帰宅できた。
> 1.あげくに 2.ために 3.とたんに 4.ところに — **Answer: 4**

**5. Sentence Order (★)** — arrange 4 jumbled phrases; identify what fills
the ★ position. Official worked example included in source (p.38) — use it
verbatim to teach the format, never invent a new worked-example illustration.
> Anchor (Q15, p.38): ふだん感情を表に出さない彼があんなに ___ ___ ★ ___ よ
> ほど良いことがあったのだろう。
> 1.みると 2.ところを 3.いる 4.喜んで — **★ position answer: 2**

**6. Text Grammar** — paragraph with 5 blanks testing vocab/conjunction/flow
across a short passage.
> Anchor (Q17-21, p.39-40, "グッド・トイ" passage) — 5 blanks, answers
> 17=3, 18=2, 19=4, 20=2, 21=1. Use full passage as the structural anchor
> (topic → mechanism → definition → contrarian aside → conclusion shape).

### Reading Comprehension

**7. Short/Medium Passage** — 200-500 char passage, 1-2 questions on author
intent/causal relationships.
> Anchor (Q22, p.41, single-Q passage on "仕事ができる人"): **Answer: 1**
> Anchor (Q23-24, p.42-43, 2-Q passage on corporate leadership): **Answers: 4, 3**

**8. Info Retrieval** — notice/pamphlet/schedule, question asks for a
specific fact.
> Anchor (Q30-31, p.48-49, library usage notice): **Answers: 3, 4**

**9. Long Essay** — opinion/commentary piece, 3 questions (reference
resolution, metaphor meaning, main thesis).
> Anchor (Q27-29, p.46-47, "勝ち組・負け組" essay on self-defined success):
> **Answers: 3, 1, 2**

**10. Integrated Comprehension** (confirmed in scope 2026-07-16) — one short
prompt + two contrasting response texts (A/B), question asks the reader to
compare viewpoints between the two.
> Anchor (Q25-26, p.44-45, boyfriend-gift-taste dilemma + two advice
> responses): **Answers: 2, 4**
> Rotation slot: rotates into reading-day slots (cycle days 1/3/5) alongside
> Long Essay / Info Retrieval / Short-Medium Passage — reading days now pick
> from 4 formats instead of a fixed one per day, same anti-repeat pool logic
> as the language-knowledge filler rotation.

### Listening — explicitly skipped per Jax's instruction (2026-07-16).

## Weekly rotation (6-day cycle, not tied to weekday)

| Cycle day | Focus | Breakdown |
|---|---|---|
| 1 | Long Essay | 3 Qs + 2 filler |
| 2 | Language Knowledge A | 5 subtypes, 1 Q each |
| 3 | Info Retrieval | 2 Qs + 3 filler |
| 4 | Language Knowledge B | 5 subtypes, 1 Q each, different combo |
| 5 | Short/Medium Passage | 3 Qs + 2 filler |
| 6 | Language Knowledge C | 5 subtypes, 1 Q each, third combo |

Text Grammar appears as filler ~3x/week (confirmed OK, no dedicated day).
Filler picks draw from a rotating pool (no repeat within last 2 cycles) —
confirmed in scope, not skipped for complexity.

## Per-subtype pipeline (runs for every subtype needed today)

1. **Recency pull** — last N questions already published in this subtype
   (both for style reference AND explicit instruction to the generator:
   "these were used recently, produce something different").
2. **Generate** — subtype-specific prompt: role + the subtype's official
   anchor example above (verbatim) + recency-avoidance list + fixed JSON
   output schema. Model: Gemini.
3. **Verify** — Gemini also (confirmed 2026-07-16), but as a structurally
   separate call/pass with its own persona ("you are a strict N2 exam
   proofreader, not the author — find what's wrong") rather than a
   generic "check your own work" prompt, to reduce the self-rubber-stamp
   risk of same-model verification. Checks:
   - Structural: exactly one correct option present, no duplicate option
     text, non-empty `explanation` field, correct JLPT instruction phrasing
     present for the subtype.
   - Content: natural/correct Japanese, answer key is actually correct,
     difficulty genuinely N2 (not N3/N1 drift).
   - Fail → regenerate, don't pass through. Same "fail closed" rule as
     Saito's design protocol.
4. **Store** — structured JSON, honest `source_id` (e.g.
   `gemini_generated_verified_v1`, never `jlpt_official_*` unless it
   genuinely is transcribed from an official source).

Only after all of today's subtypes clear verification does the day's set
move to the composer → `n2_mocks` → publish stage.

## Explanation schema addition (2026-07-16, post-first-run)

Added after seeing the first live mock — Jax couldn't tell if he got a
question right/wrong from the Japanese explanation alone. Fixed by folding
into the existing generate call (not a new one — still 2 calls/day):

- New column `n2_questions.explanation_en` — one-sentence English gloss of
  the correct-answer reasoning.
- Each item in the `options` jsonb array now carries its own `note` field
  — why that specific option is right or wrong, not just a single blob
  explanation for the whole question. Exception: `sentence_order`, where
  `note` is always `null` on all 4 (correctness there is about position,
  not option content).
- Verify step checks both fields for quality (not just non-empty — the
  Gemini proofread pass now also checks `note` isn't generic/copy-pasted
  and `explanation_en` actually matches the Japanese reasoning).
- **Not backfilled** onto the 5 questions from the very first live run
  (2026-07-16) — those predate this field. Everything from here on has it.

## UI reference (2026-07-16)

One reference, confirmed sufficient: **dailydispatch.app** — date-anchored,
one-thing-per-day macrostructure, calm off-white/dark-text palette, clean
sans-serif, no vibrant accents, "no feeds, no rabbit holes, just what
matters" positioning. Maps well onto "just today's 5 questions." Feature
ideas to design toward: streak counter, "today's focus" subtype label,
wrong-answer-specific feedback (now backed by the `note` field above),
careful passage typography (line-height/measure for dense Japanese text).
UI build itself not yet started — this is reference-gathering only, per the
same 7-stage design protocol as Saito's Hallmark work.

## Open items before this can be built

- [ ] Confirm generation model = Gemini, verification model = ? (Claude/MiniMax)
- [ ] Decide on Integrated Comprehension (10th subtype) — yes/no
- [ ] Separate task: audit + clean the existing 61-row bank (relabel honest
      provenance, fix/remove the broken and fabricated rows)
- [ ] Wire the daily cron once the above is built (currently zero N2 crons
      registered anywhere)
