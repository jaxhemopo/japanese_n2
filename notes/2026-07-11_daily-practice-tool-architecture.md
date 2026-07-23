# N2 Daily Practice Tool — Architecture Brief

**Date:** 2026-07-11
**Subject:** Concrete architecture + build plan for the N2 daily practice web app
**Status:** Draft for sign-off (no code yet)
**Supersedes:** §5/§6 of `2026-07-11_n2-daily-practice-tool-research.md`
**Companion brief:** `2026-07-11_n2-content-pipeline-design.md` (the pipeline that feeds this web app with daily questions)

---

## TL;DR

- **Stack locked:** Next.js 15 (App Router) + Tailwind + shadcn/ui + Supabase (shared ODIS instance, `n2_*` tables) + Resend + OpenAI/ElevenLabs TTS + Vercel.
- **Auth:** Supabase Auth, Google OAuth primary + email magic link fallback.
- **Schema:** 5 tables (`n2_profiles`, `n2_questions`, `n2_challenges`, `n2_attempts`, `n2_email_preferences`) with row-level security.
- **Daily challenge flow:** cron → pick 5 questions (weakness-weighted) → save challenge → push notification + email → user answers in web app → score logged → wrong-answer AI explanations on demand.
- **Audio pipeline:** TTS-generated on demand, cached in Supabase Storage.
- **Build phases:** MVP (text-only) → Audio + AI → Engagement → Monetization. ~2-4 weeks total.

---

## 1. Tech stack (locked)

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js 15** (App Router) + TypeScript | Full-stack React, mature Supabase integration, SSR + RSC |
| UI | **Tailwind CSS v4** + **shadcn/ui** | Fastest path to clean UI; copy-paste components |
| Backend | **Supabase** (Postgres + Auth + Storage) | Shared ODIS instance, `n2_*` table prefix, RLS for isolation |
| ORM | **Supabase JS client** (no Prisma/Drizzle for MVP) | Direct, no extra layer |
| Email | **Resend** | Same stack Forge uses; transactional-only is free tier is fine |
| Audio | **OpenAI TTS** (`tts-1`, Japanese voice) | Cheap (~$15/1M chars), good Japanese; swap to ElevenLabs if quality matters |
| AI explanations | **MiniMax** (me) via Anthropic API | Already have it; good Japanese + English |
| Hosting | **Vercel** (Hobby → Pro when monetizing) | Free tier for solo, instant Next.js deploys |
| Cron | **Vercel Cron** (built-in) | Daily challenge generator trigger |
| Payments (later) | **Stripe** | Industry standard, Supabase has webhook patterns |

### What we're NOT using

- ❌ Prisma / Drizzle — Supabase JS client is enough at MVP scale
- ❌ tRPC / GraphQL — Next.js API routes + Supabase client cover everything
- ❌ React Native — web app is enough, mobile later if needed
- ❌ Custom auth — Supabase handles it

---

## 2. Database schema (`n2_*` prefix)

All tables prefixed `n2_` to coexist cleanly with Autriv + Forge tables in the shared ODIS Supabase.

```sql
-- ============================================================
-- 001_profiles.sql
-- ============================================================
CREATE TABLE n2_profiles (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name    TEXT,
  current_level   TEXT DEFAULT 'N3' CHECK (current_level IN ('N5','N4','N3','N2','N1')),
  target_exam_date DATE,
  is_premium      BOOLEAN DEFAULT FALSE,
  premium_until   TIMESTAMPTZ,
  streak_count    INT DEFAULT 0,
  last_challenge_date DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE n2_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own profile" ON n2_profiles
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 002_questions.sql
-- ============================================================
CREATE TABLE n2_questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category        TEXT NOT NULL,    -- 'vocab_kanji_reading', 'grammar_form', 'grammar_reorder', 'reading_short', 'listening_task', etc.
  difficulty      INT DEFAULT 4 CHECK (difficulty BETWEEN 1 AND 5),
  prompt          TEXT NOT NULL,    -- markdown/HTML
  options         JSONB NOT NULL,   -- [{"id":"a","text":"..."}, ...]
  correct_answer  TEXT NOT NULL,    -- option id
  explanation     TEXT,             -- EN+JP explanation (AI-generated or hand-written)
  audio_path      TEXT,             -- path in n2-audio storage bucket
  source          TEXT,             -- 'past_paper_2024_07', 'try_n2_p15', 'manual', 'ai_generated'
  tags            TEXT[],           -- ['conditionals','keigo','business']
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_n2_questions_category ON n2_questions(category);
CREATE INDEX idx_n2_questions_difficulty ON n2_questions(difficulty);
CREATE INDEX idx_n2_questions_tags ON n2_questions USING GIN(tags);

ALTER TABLE n2_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read questions" ON n2_questions
  FOR SELECT TO authenticated USING (true);
-- Write policies restricted to service role (admin-only inserts)

-- ============================================================
-- 003_challenges.sql
-- ============================================================
CREATE TABLE n2_challenges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge_date  DATE NOT NULL,
  question_ids    UUID[] NOT NULL,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  score           INT,
  total_questions INT,
  time_seconds    INT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, challenge_date)
);

CREATE INDEX idx_n2_challenges_user ON n2_challenges(user_id, challenge_date DESC);

ALTER TABLE n2_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own challenges" ON n2_challenges
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 004_attempts.sql
-- ============================================================
CREATE TABLE n2_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge_id    UUID REFERENCES n2_challenges(id) ON DELETE CASCADE,
  question_id     UUID REFERENCES n2_questions(id) ON DELETE SET NULL,
  user_answer     TEXT,
  correct         BOOLEAN,
  time_seconds    INT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_n2_attempts_user ON n2_attempts(user_id, created_at DESC);
CREATE INDEX idx_n2_attempts_question ON n2_attempts(question_id);
CREATE INDEX idx_n2_attempts_user_correct ON n2_attempts(user_id, correct);

ALTER TABLE n2_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own attempts" ON n2_attempts
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 005_email_preferences.sql
-- ============================================================
CREATE TABLE n2_email_preferences (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_reminder  BOOLEAN DEFAULT TRUE,
  reminder_time   TIME DEFAULT '08:00',
  timezone        TEXT DEFAULT 'Asia/Tokyo',
  email           TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE n2_email_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own email prefs" ON n2_email_preferences
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

### Schema decisions

- **`UUID[]` for question_ids** — Postgres native, no join table needed for the "5 questions per challenge" pattern. Could normalize later if we want per-question metadata.
- **`JSONB` for options** — flexible for different question types (4-option MC today, drag-to-reorder tomorrow, audio-clip-with-buttons later).
- **`audio_path` is a Storage path, not URL** — signed URLs generated on demand. Prevents hot-linking, controls access.
- **No `answers` table separate from `attempts`** — `n2_attempts` is the granular record (per-question), `n2_challenges.score` is the aggregated summary. One source of truth.
- **`is_premium` flag in profile, `premium_until` for time-bound** — Stripe webhook will flip these. Free tier = 1 challenge/day, premium = unlimited.

---

## 3. Daily challenge generator

### Trigger

**Vercel Cron** runs daily at 00:00 UTC (= 09:00 JST). Hits `/api/cron/generate-daily-challenges`.

### Algorithm (per user)

```python
def generate_daily_challenge(user_id):
    profile = get_profile(user_id)
    
    # Skip if already generated today
    if profile.last_challenge_date == today():
        return
    
    # Skip if user is at free-tier limit (1/day) and not premium
    if not profile.is_premium and get_today_challenge_count(user_id) >= 1:
        return
    
    # Get weakness profile from last 30 days of attempts
    weak_tags = get_weak_tags(user_id, days=30, limit=3)  # e.g., ['conditionals', 'keigo']
    
    # Get recently-seen question IDs (avoid repetition)
    recent_qs = get_recent_question_ids(user_id, days=7)
    
    # Build 5-question challenge
    selected = []
    
    # 2 questions from user's weakest tags
    for tag in weak_tags[:2]:
        qs = select_questions(
            tag=tag,
            difficulty=4,  # N2-level
            exclude=recent_qs,
            limit=1,
        )
        selected.extend(qs)
    
    # 1 reading question
    qs = select_questions(
        category='reading_short',
        exclude=recent_qs + [q.id for q in selected],
        limit=1,
    )
    selected.extend(qs)
    
    # 1 grammar question (always)
    qs = select_questions(
        category='grammar_form',
        exclude=recent_qs + [q.id for q in selected],
        limit=1,
    )
    selected.extend(qs)
    
    # 1 random question (variety)
    qs = select_questions(
        random=True,
        exclude=recent_qs + [q.id for q in selected],
        limit=1,
    )
    selected.extend(qs)
    
    # Create challenge
    challenge = create_challenge(user_id, today(), [q.id for q in selected])
    
    # Notify
    create_inapp_notification(user_id, "Daily N2 challenge is ready!", link=f"/challenges/{challenge.id}")
    if get_email_pref(user_id).daily_reminder:
        send_daily_challenge_email(user_id, challenge)
    
    # Update profile
    update_profile(user_id, last_challenge_date=today())
    
    return challenge
```

### Question selection (`select_questions`)

```python
def select_questions(category=None, tag=None, difficulty=4, exclude=[], limit=1, random=False):
    query = supabase.from_('n2_questions').select('*')
    
    if category:
        query = query.eq('category', category)
    if tag:
        query = query.contains('tags', [tag])
    query = query.eq('difficulty', difficulty)
    if exclude:
        query = query.not_.in_('id', exclude)
    if random:
        # Fetch more, randomize in app
        query = query.limit(limit * 5)
        rows = random.sample(query.execute().data, limit)
    else:
        query = query.order('created_at', desc=True).limit(limit)
        rows = query.execute().data
    
    return rows
```

### Cold-start handling

When the question pool is small (~100 questions), the algorithm falls back to:
1. Lower the difficulty floor (allow N3-level questions for variety)
2. Accept some repeats within 7 days
3. Skip tag-based selection, use pure random

Once pool grows to ~500+, the full algorithm kicks in.

---

## 4. Audio pipeline

### Storage

- **Supabase Storage** bucket `n2-audio`
- Paths: `questions/{question_id}.mp3`
- Public read for non-authenticated preview; signed URLs for in-app playback

### Generation

```python
def ensure_audio(question_id):
    question = get_question(question_id)
    
    if question.audio_path:
        return get_signed_url(question.audio_path)
    
    # Only generate audio for question types that need it
    if question.category not in AUDIO_CATEGORIES:
        return None
    
    # Generate via OpenAI TTS
    text = extract_tts_text(question)  # Strip markdown, kanji stays
    
    response = openai.audio.speech.create(
        model="tts-1",
        voice="alloy",  # Most natural for Japanese
        input=text,
    )
    
    audio_bytes = response.content
    
    # Upload to Supabase Storage
    path = f"questions/{question_id}.mp3"
    supabase.storage.from_("n2-audio").upload(path, audio_bytes)
    
    # Update question record
    update_question(question_id, audio_path=path)
    
    return get_signed_url(path)
```

### Caching strategy

- Generate on first request, never re-generate (deterministic given same text)
- Pre-generate audio for the daily challenge in the cron job (so user gets instant playback)
- Bulk-pre-generate audio for top 100 questions at MVP launch

### Cost estimate

- TTS at $15/1M chars
- Average N2 question: ~200 chars
- 100 questions × 200 chars = 20,000 chars = **$0.30 to generate initial pool audio**
- Daily challenge × 365 days × 5 new questions/year = ~3,650 chars/day = **$0.05/day = $18/year**

Trivial.

---

## 5. AI explanations flow (MiniMax)

When a user gets a question wrong, show an explanation. Generated on demand, cached forever.

```python
def get_explanation(question_id, user_answer, user_id):
    question = get_question(question_id)
    
    # Return cached explanation if exists
    if question.explanation:
        return question.explanation
    
    # Check user attempt count for abuse prevention
    recent_explanations = count_recent_explanations(user_id, hours=1)
    if recent_explanations > 50:
        return "Explanation rate limit hit. Try again in an hour."
    
    # Generate via MiniMax
    prompt = f"""You are a JLPT N2 Japanese tutor. The user answered this question incorrectly.

Question: {question.prompt}

Options:
{chr(10).join(f'{o["id"]}. {o["text"]}' for o in question.options)}

Correct answer: {question.correct_answer} → {next(o["text"] for o in question.options if o["id"] == question.correct_answer)}
User's answer: {user_answer} → {next((o["text"] for o in question.options if o["id"] == user_answer), "blank")}

Provide a concise explanation:
1. Why the correct answer is right (in Japanese + English)
2. Why the user's answer is wrong (in Japanese + English)
3. The grammar point or vocabulary pattern being tested (kanji + reading + meaning)
4. A similar example sentence

Keep it under 300 words total. Be specific to this question.
"""
    
    explanation = call_minimax(
        prompt,
        model="minimax/MiniMax-M3",
        max_tokens=600,
    )
    
    # Cache for future users
    update_question(question_id, explanation=explanation)
    
    return explanation
```

### Rate limiting

- 50 explanations per user per hour (generous but caps abuse)
- Free-tier users: unlimited explanations (it's a hook, not a paywall)
- Premium users: priority queue + longer explanations on request

### Cost estimate

- ~600 tokens per explanation × 5 wrong answers/day = 3,000 tokens/day
- At ~$3/1M output tokens (rough MiniMax pricing): **~$0.01/day per active user**

Trivial again.

---

## 6. Auth + tiers

### Auth (Supabase Auth)

```typescript
// app/auth/callback/route.ts
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  
  if (code) {
    const supabase = createRouteHandlerClient({ cookies })
    await supabase.auth.exchangeCodeForSession(code)
    
    // Create n2_profiles row if first sign-in
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('n2_profiles').upsert({ user_id: user.id }).select()
    
    return NextResponse.redirect(`${origin}/challenges/today`)
  }
  
  return NextResponse.redirect(`${origin}/auth/error`)
}
```

### Sign-in page

- "Continue with Google" button (OAuth)
- "Continue with email" → magic link
- Both routes share the same `/auth/callback` handler

### Tiers (architecture-ready, payment-implemented later)

| Tier | Daily challenges | Audio | AI explanations | Reviews |
|---|---|---|---|---|
| **Free** | 1/day | Yes | Yes (rate-limited) | Last 7 days |
| **Premium** (later) | Unlimited | Yes + speed control | Yes (priority, longer) | Unlimited |

`is_premium` column in `n2_profiles` is the gate. Stripe webhook flips it on subscription.

---

## 7. File structure

```
~/projects/japanese-n2/
├── README.md
├── research/
│   ├── 2026-07-11_n2-path-research.md
│   └── 2026-07-11_n2-daily-practice-tool-research.md
├── notes/
│   └── 2026-07-11_daily-practice-tool-architecture.md   ← this file
└── webapp/                                                ← created when we start building
    ├── package.json
    ├── next.config.mjs
    ├── tailwind.config.ts
    ├── tsconfig.json
    ├── .env.local
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx                       # landing
    │   ├── auth/
    │   │   ├── login/page.tsx
    │   │   └── callback/route.ts
    │   ├── challenges/
    │   │   ├── today/page.tsx             # today's challenge
    │   │   └── [id]/page.tsx              # specific challenge replay
    │   ├── review/page.tsx                # wrong-answer review mode
    │   ├── profile/page.tsx               # streak, stats, settings
    │   └── api/
    │       ├── cron/
    │       │   └── generate-daily-challenges/route.ts
    │       ├── audio/[questionId]/route.ts
    │       ├── explanation/route.ts
    │       └── challenge/[id]/submit/route.ts
    ├── components/
    │   ├── ui/                            # shadcn/ui
    │   ├── ChallengeQuestion.tsx
    │   ├── ScoreCard.tsx
    │   ├── ExplanationPanel.tsx
    │   └── AudioPlayer.tsx
    ├── lib/
    │   ├── supabase.ts
    │   ├── questions.ts
    │   ├── audio.ts
    │   ├── minimax.ts
    │   ├── email.ts
    │   └── auth.ts
    ├── supabase/
    │   └── migrations/
    │       ├── 001_profiles.sql
    │       ├── 002_questions.sql
    │       ├── 003_challenges.sql
    │       ├── 004_attempts.sql
    │       └── 005_email_preferences.sql
    └── public/
        └── favicon.ico
```

---

## 8. Implementation milestones

### Phase 1 — MVP (1-2 weeks, solo use first)

**Goal:** Jackson can sign in, get a daily challenge, see his score, see history.

- [ ] Next.js 15 scaffold + Tailwind + shadcn/ui
- [ ] Supabase project connection (use shared ODIS instance)
- [ ] Run migrations 001-005
- [ ] Supabase Auth (Google OAuth + email magic link)
- [ ] Manual seed of ~50 vocab + 50 grammar questions (from Try! N2, Sou Matome, past papers)
- [ ] Daily challenge page (5 multiple-choice questions, text-only)
- [ ] Submit + score logging
- [ ] History page (last 30 days)
- [ ] Deploy to Vercel

### Phase 2 — Audio + AI (1 week)

- [ ] OpenAI TTS pipeline for listening questions
- [ ] AI explanation panel (wrong answers trigger MiniMax call)
- [ ] Question pool expansion to ~200 questions, add listening + reading types
- [ ] Difficulty adjustment (track wrong-answer patterns, surface more of those)

### Phase 3 — Engagement (1 week)

- [ ] Email delivery (Resend integration, daily reminder at user's preferred time)
- [ ] In-app notification system
- [ ] Streak tracking + display
- [ ] Review mode (categorized wrong answers, "spaced repetition lite")
- [ ] Question-pool expansion to ~500 questions

### Phase 4 — Monetization-ready (1 week)

- [ ] Stripe integration (subscription model)
- [ ] Free vs premium tier enforcement
- [ ] Pricing page
- [ ] Marketing landing page
- [ ] Waitlist / signup form
- [ ] Analytics (PostHog or Plausible)

### Phase 5 — Polish (ongoing)

- [ ] Mobile-optimized UI
- [ ] Multi-language UI (English + Japanese)
- [ ] Question quality feedback (thumbs up/down per question)
- [ ] Daily leaderboard (opt-in)

---

## 9. Open questions for sign-off

1. **Domain:** custom domain (e.g., `n2daily.app`) or subpath of an existing ODIS site? Need before Phase 1 deploy.
2. **Initial question pool:** how do we source 100+ quality questions? (i) hand-curate from Try! N2 + Sou Matome + SKM (slow but high quality), (ii) AI-generate with MiniMax + manual review (faster), (iii) hybrid: AI-generate first pass, hand-review second pass. **My rec: hybrid, ~3 days of focused work.**
3. **Cron timing:** 00:00 UTC = 09:00 JST. Want different timing per user's timezone, or fixed UTC?
4. **Multi-language UI:** English-only at MVP, or bilingual EN+JP from day 1? **My rec: English-only at MVP, add JP in Phase 5.**
5. **AI explanation tone:** strict tutor, friendly coach, or meme-laden? **My rec: friendly coach, brief, 300 words max.**
6. **Cold-start question pool size:** MVP with 50 questions (boring fast) or wait to 200+ before launch? **My rec: 100 at launch, hard cap.**
7. **Pricing model (later):** $5/mo flat, $30/yr flat, freemium with 1/day limit, or one-time purchase? **My rec: freemium, $5/mo or $30/yr premium.**
8. **Resend setup:** need to verify a sending domain. Use `n2daily.app` (after #1), or reuse `odis.dev` if available?

---

## 10. Sources

- Forge project: `~/projects/forge/` — `001_contact_submissions.sql` migration pattern, shared ODIS Supabase
- ODIS shared Supabase: `https://ucppuzfyjrtcchdhwxto.supabase.co` (linked-project.json shows `Autriv-Prod` namespace)
- Forge's tech stack reference: `~/projects/forge/template/` (Next.js 15 + Tailwind v4 + Keystatic + Resend + Supabase)
- Daily tool research: `2026-07-11_n2-daily-practice-tool-research.md`

---

## Next step

Sign off on:
- §1 tech stack (push back if any layer is wrong)
- §2 schema (5 tables, RLS patterns)
- §3 daily challenge algorithm (weakness-weighted selection)
- §4 audio pipeline (TTS on demand)
- §5 AI explanations (MiniMax on demand, cached)
- §6 auth model (Google OAuth + email magic link)
- §8 milestones (approve the build order)
- §9 open questions (especially #1 domain, #2 question sourcing)

Once signed off, I'll start Phase 1 (Next.js scaffold + Supabase migrations + manual seed of 50 questions) and we'll have a working MVP in 1-2 weeks.

---

## §11. Cross-reference: content pipeline

This web app **consumes** the question pool. It does not generate questions itself. Generation is handled by the companion pipeline at:

**`~/projects/japanese-n2/notes/2026-07-11_n2-content-pipeline-design.md`**

The pipeline runs daily, audits quality, dedupes, and inserts approved questions into `n2_questions`. The web app reads from the same table. They're decoupled via shared artifact (Supabase) — no direct coupling between systems.

**Build order implication:** build the web app first with manual-seeded questions (Phase 1-2 here), then add the pipeline as the question-source-of-truth (Phase 3+). The web app doesn't care where questions come from.