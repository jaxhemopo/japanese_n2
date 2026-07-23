# N2 Daily Practice Tool — Research & Architecture Brief

**Date:** 2026-07-11
**Subject:** Research and architecture options for a daily N2 practice challenge (questions + delivery + state)
**Scope:** Research only. No code, no commitments yet.

---

## TL;DR

1. **N2 has ~74 questions total across 3 sections.** Question *types* matter more than count: each section has 4-6 distinct formats that the daily tool must support.
2. **Grammar questions have specific layouts worth knowing.** e.g., 並べ替え = "given 4 jumbled words, pick which goes in ☆". You can't fake this with a generic multiple-choice form.
3. **Listening has 5 distinct question types**, only some of which translate to a text-only daily challenge.
4. **Two scope questions drive everything else.** Solo (you only) vs shareable, and MVP (~200-line bot) vs full LMS. Lean path = solo MVP, Telegram inline, SQLite.
5. **The "URL + challenge" framing has 3 reasonable interpretations** — see §3 below.

---

## 1. WHAT to send — N2 question structure

### Section layout (recap from §1 of path research)

| Section | Time | Points | Approx questions |
|---|---|---|---|
| Language Knowledge (Vocab/Grammar) + Reading | 105 min | 60 | ~50 |
| Listening | 50 min | 60 | ~24 |
| **Total** | **155 min** | **180** | **~74** |

### Question categories by section

#### A. Language Knowledge — Vocab/Grammar (combined 60 pts)

JLPT doesn't publish an official question taxonomy, but the consensus community breakdown:

**Vocabulary** (~20-25 questions):
- 漢字読み (kanji reading) — given kanji, pick the reading
- 表記 (orthography) — given a word, pick the correct written form (often similar kanji)
- 文脈規定 (contextual definition) — pick the word that fits the blank in a sentence
- 言い換え (paraphrase) — pick a synonym/equivalent for a phrase
- 用法 (usage) — pick the sentence that uses the word correctly
- 語彙整序 (vocab reordering) — given 4 words, pick which goes in ☆

**Grammar** (~20-25 questions):
- 文法用法 (grammar form selection) — given sentence with ☆, pick grammar point
- 文の組み立て (sentence composition / reordering) — given 4 jumbled chunks, pick which goes in ☆ to make grammatical sentence
- 敬語 (keigo) — honorific / humble / polite selection
- 文脈判断 (contextual grammar choice) — given full sentence, pick the best connector/particle

#### B. Reading (~15-20 questions)

- 短文 (short passages, ~150 chars) — comprehension
- 中文 (medium passages, ~400 chars) — comprehension
- 長文 (long passages, ~800-1200 chars) — inference-heavy
- 統合理解 (integrated comprehension) — compare two passages
- 情報検索 (information retrieval) — scan-and-find questions

#### C. Listening (~24 questions across 5 types)

The five official listening question types (per [Unseen Japan](https://unseen-japan.com/pass-the-jlpt-how-to-study-for-the-jlpt-listening-section/) and [Natha no Tabi](https://nathanotabi.substack.com/p/tips-to-crush-the-jlpt-listening)):

1. **課題理解 (Task-Based Comprehension)** — listen to a scenario, then answer what the speaker should do next
2. **ポイント理解 (Point Comprehension)** — listen to a short talk, identify the key point
3. **概要理解 (Summary Comprehension)** — listen to a longer talk, identify its main theme
4. **統合理解 (Integrated Comprehension)** — compare two viewpoints/perspectives from a longer passage
5. **即時応答 (Utterance Response)** — listen to a one-line utterance, pick the most natural response

### What this means for the daily tool

- **Easy to implement:** all vocab + grammar question types (multiple-choice text)
- **Medium to implement:** short/medium reading passages (text-only, multiple-choice)
- **Hard / out-of-scope for inline tools:** listening (requires audio playback + sync), long reading (multi-paragraph)
- **MVP focus:** start with vocab + grammar only, add reading later, listening last (or skip listening in the daily tool entirely — do that via separate podcast/Satori Reader habit)

### Daily challenge shape (suggested)

A minimal-but-realistic daily challenge:

- **5 questions, ~10-15 min target time**
- Mix: 2 vocab + 2 grammar + 1 short reading (or all-grammar if Jackson wants to drill weak spot)
- All multiple-choice (4 options)
- Scored 0-5, logged with timestamps
- Bot returns score + which questions you got wrong + correct answer + brief explanation

### Sources for §1

- jlpt.jp official: [Test Sections](https://www.jlpt.jp/sp/e/guideline/testsections.html)
- Migaku: [JLPT N2 Overview](https://migaku.com/blog/japanese/jlpt-n2-overview)
- Unseen Japan: [Listening section types](https://unseen-japan.com/pass-the-jlpt-how-to-study-for-the-jlpt-listening-section/)
- Natha no Tabi Substack: [5 listening exercise types](https://nathanotabi.substack.com/p/tips-to-crush-the-jlpt-listening)
- Pass Japan Test: [JLPT Format](https://passjapanesetest.com/jlpt-format/)
- Reddit r/LearnJapanese: [Time optimization](https://www.reddit.com/r/LearnJapanese/comments/k6ckxs/a_super_important_technique_to_optimize_your/)
- Gyanmirai: [N2 question count ~74](https://www.gyanmirai.com/jlpt/jlpt-n2)
- 日本語の森 YouTube: [N2 grammar 並び替え series](https://www.youtube.com/watch?v=lJgdPfTJyis)

---

## 2. WHERE questions come from

Three sources for the question pool:

| Source | Pros | Cons |
|---|---|---|
| **Manually written / curated** | Quality, exact format match | Time to build pool; doesn't scale |
| **Past JLPT sample questions** (official jlpt.jp PDFs) | Real exam format | Limited pool (~50 questions/year × N years) |
| **Generated from textbook exercises** (SKM, Try!, Sou Matome) | Large pool, matches test | Need to OCR or transcribe; copyright caveat |

**Leanest:** Start with ~100 curated past questions + textbook-sourced. Grow organically.

**Future:** Once pool is established, can swap question sources without changing tool architecture.

---

## 3. HOW to deliver — 6 architecture options

Ordered from leanest to richest.

| # | Option | LOC | Infra | Pros | Cons |
|---|---|---|---|---|---|
| 1 | **Telegram inline** — bot sends Q's as a chat message, you reply with numbers (e.g., `2 1 4 3 1`), bot scores + replies | ~150 | Telegram Bot API only | Zero new apps; instant; you already use Telegram; cron on your Mac | Limited formatting; regex answer parsing; no native timing UI; reading passages get unwieldy in chat |
| 2 | **Telegram bot + inline keyboard** — bot sends Q's with clickable answer buttons | ~250 | Telegram Bot API | One-tap answering; no parsing | Same chat-length limits; kanji/formatting still constrained |
| 3 | **Telegram bot + web app link** — message has a button → mini-app with rich UI | ~500 | Telegram + static web page (Vercel/Netlify) | Rich UI; timing client-side; clean answer capture; works on mobile | More moving parts; needs hosting; longer to build |
| 4 | **Email digest** — full Q's in email, reply with answers | ~300 | SMTP (Gmail/SES) + bot | "Daily mail" framing; works offline; any device | No interaction UI; hard to capture answers cleanly; slow feedback loop |
| 5 | **Email ping + web app** — email is reminder, link goes to web app challenge | ~500 | SMTP + web app | Rich challenge + daily nudge | Two systems; need auth if multi-user |
| 6 | **Web app + push notifications** — full web app, no Telegram/email needed | ~800+ | Web app + notification system | Richest UX | Most maintenance; overkill for solo |

### Sub-question: where does the bot/app run?

| Host | Pros | Cons |
|---|---|---|
| **Your Mac mini** (cron job) | Zero infra cost; full local file access | Mac must be awake at send time; no remote access |
| **Vercel / Netlify + cron** | Free tier; always on; good for web app | Limited local file access; SQLite doesn't work natively |
| **A small VM** (DigitalOcean, Fly.io) | Full control; SQLite works | Costs money; ops overhead |

**Leanest host for solo:** Mac mini with cron. Bot can read/write SQLite at `~/projects/japanese-n2/state.db`.

---

## 4. WHERE state lives

What we need to capture:
- Per question: text, options, correct answer, category, difficulty, source
- Per attempt: timestamp, question IDs, user answers, score, time taken
- Per session: total score, weak categories, streak
- Refer-back: history of wrong answers, category-level performance trends, review mode

### Storage options

| Option | Best for | Trade-offs |
|---|---|---|
| **Local JSON file** | Trivially simple | No concurrent access; O(n) query; grows unbounded |
| **SQLite** | Solo, structured queries | One file, no server, robust; perfect for this scale |
| **Airtable** | Solo + visual dashboard | Cloud, easy to inspect, manual setup; costs at scale |
| **Notion DB** | Solo + no-code dashboard | Cloud, query API, slower writes |
| **Postgres** | Multi-user | Need hosting; overkill for solo |

**Leanest for solo:** SQLite at `~/projects/japanese-n2/state.db`. One file, fast queries, easy backup (just copy the file), Git-able.

**Leanest for "I want to see my progress visually":** Airtable or Notion DB. The bot writes to it; you see history in the UI.

---

## 5. Scope questions (decide before building)

These determine complexity by 10×:

1. **Solo or shareable?**
   - Solo (just you): lean bot + local SQLite. ~200 LOC, 1 day to build.
   - Shareable (friends or future users): add auth, multi-user state, hosted infra. ~800+ LOC, 1-2 weeks.

2. **MVP or full LMS?**
   - MVP: 5 questions, scored, logged. One Telegram message a day.
   - Full LMS: progress charts, spaced repetition, error review mode, multiple daily challenges.

3. **Listening in scope?**
   - No (text-only daily): simpler, can use Telegram inline cleanly.
   - Yes (audio playback): need web app or Telegram mini-app for audio sync.

4. **Auto-generate or manually curate?**
   - Manually curate: ~100 hand-picked questions to start. Higher quality, no OCR.
   - Auto-generate: scrape/OCR textbooks. Larger pool, copyright/quality risks.

**My read based on your lean-first preference:** Solo + MVP + text-only (no listening) + manually curate first 100 questions. Telegram inline bot + local SQLite. ~200 LOC. You can extend later (shareable, listening, auto-gen) once the MVP proves out.

---

## 6. Open questions for Jackson

1. **Scope commitment:** Solo MVP or something richer?
2. **Delivery:** Telegram inline, Telegram buttons, email, or web app?
3. **State storage:** SQLite (file) or Airtable/Notion (visual)?
4. **Question source:** Hand-curate, official past papers, or textbook-extracted?
5. **Listening:** Daily tool handles it (requires web app) or separate habit (podcast/Satori Reader)?
6. **Schedule:** When does the daily message send? (Morning? Lunch? After work?)
7. **Persistence:** Do you want to keep wrong-answer history for review mode, or just recent scores?
8. **N3 confirmation:** Wait for N3 results before starting, or start building now and plug N3 results in later?

---

## 7. What changed from the path-research brief

- §1 here deepens the structure breakdown to question-type level (vs. just section-level in path research).
- Adds architecture brainstorm (not in path research).
- Adds state/storage brainstorm (not in path research).
- Does NOT modify the curriculum arc or time commitment from path research — that holds.

---

## 8. Sources

Community pulse (added in path research §9) confirmed textbook consensus; this brief adds:

- JLPT official: [Test Sections](https://www.jlpt.jp/sp/e/guideline/testsections.html)
- Wikipedia: [JLPT structure](https://en.wikipedia.org/wiki/Japanese-Language_Proficiency_Test) — section timing + scoring
- Migaku blog: [JLPT N2 Overview](https://migaku.com/blog/japanese/jlpt-n2-overview) — section breakdown
- Unseen Japan: [JLPT Listening types](https://unseen-japan.com/pass-the-jlpt-how-to-study-for-the-jlpt-listening-section/) — 5 listening question types
- Natha no Tabi Substack: [JLPT Listening tips](https://nathanotabi.substack.com/p/tips-to-crush-the-jlpt-listening) — confirms 5 types
- Pass Japan Test: [JLPT Format](https://passjapanesetest.com/jlpt-format/) — question type taxonomy
- Gyanmirai: [N2 question count ~74](https://www.gyanmirai.com/jlpt/jlpt-n2)
- 日本語の森 YouTube: [N2 grammar 並び替え](https://www.youtube.com/watch?v=lJgdPfTJyis) — confirms sentence-reordering question format
- Reddit r/LearnJapanese: [Time optimization thread](https://www.reddit.com/r/LearnJapanese/comments/k6ckxs/a_super_important_technique_to_optimize_your/) — reading section pacing
- Reddit r/Japaneselanguage: ["100/180 and 180/180 is the same result"](https://reddit.com/r/Japaneselanguage/comments/1uo92xv/comment/ovqesng/) — passing is passing, don't over-optimize
- ebifried YouTube: [JLPT test-taking hacks](https://www.youtube.com/watch?v=HOCgOTbCzFI) — 2x speed listening practice

---

## Next step

Read §5 scope questions + §6 open questions. Answer the 4 most important ones, and we can move to a build plan with concrete tech choices. The lean path (Solo + MVP + Telegram inline + SQLite) is my guess based on your preferences — confirm or pivot.