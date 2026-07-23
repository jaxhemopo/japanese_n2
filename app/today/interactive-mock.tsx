'use client';

/**
 * app/today/interactive-mock.tsx — Interactive mock-taker with submit + timing.
 *
 * Visual layer redesigned 2026-07-17 per design.md (studied from
 * dailydispatch.app) — data flow and submit logic unchanged from the
 * original implementation, only the rendering changed.
 *
 * Visual layer re-converged 2026-07-19: outer <main> + its outer
 * maxWidth/margin/padding removed so this component renders inside the
 * parent's <TiltedCard> + <IssueMeta> composition. Internal layout (sticky
 * passage, options, submit button) unchanged.
 *
 * UX flow:
 *   - Next button advances until last question.
 *   - On last question, button changes to "提出する" (Submit).
 *   - Disabled until an answer is picked.
 *   - Shows "提出中..." during POST, then redirects.
 *   - Passage stays visible (sticky) while its questions are being worked
 *     through — multiple consecutive questions can share one passage.
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PromptWithTarget } from '@/components/prompt-with-target';
import { StreakBadge } from '@/components/StreakBadge';
import { PinnedPassage } from '@/components/PinnedPassage';
import { OptionButton } from '@/components/OptionButton';
import { ProgressDots } from '@/components/ProgressDots';
import type { Question } from './page';

type Mock = { id: string | null; date: string; questions: Question[] };

type Answered = { answer: 'a' | 'b' | 'c' | 'd'; answeredAtMs: number };

// The real JLPT assumes test-takers already know each section's task from
// the paper exam's printed instructions — this app has no such context, so
// without this label users can only guess the task from the question's shape.
const SUBTYPE_INSTRUCTIONS: Record<string, string> = {
  kanji_reading: '＿＿＿の言葉の読み方として最もよいものを、1・2・3・4から一つ選びなさい。',
  contextual_vocab: '（　　）に入れるのに最もよいものを、1・2・3・4から一つ選びなさい。',
  word_formation_synonym: '＿＿＿の言葉に意味が最も近いものを、1・2・3・4から一つ選びなさい。',
  grammar_formats: '（　　）に入れるのに最もよいものを、1・2・3・4から一つ選びなさい。',
  sentence_order: '★ に入る最もよいものを、1・2・3・4から一つ選びなさい。',
  text_grammar: '文章全体の内容を考えて、（　　）に入る最もよいものを、1・2・3・4から一つ選びなさい。',
  short_medium_passage: '次の文章を読んで、質問に対する答えとして最もよいものを、1・2・3・4から一つ選びなさい。',
  info_retrieval: '次の文章を読んで、質問に対する答えとして最もよいものを、1・2・3・4から一つ選びなさい。',
  long_essay: '次の文章を読んで、質問に対する答えとして最もよいものを、1・2・3・4から一つ選びなさい。',
  integrated_comprehension: '次のAとBのどちらの意見にも触れながら、質問に対する答えとして最もよいものを、1・2・3・4から一つ選びなさい。',
};

// Per-question start timestamps (wall-clock ms when question renders).
// Map: questionId → Date.now() at the moment the question became current.
function useQuestionTimings(questionIds: string[], currentIndex: number) {
  const [timings, setTimings] = useState<Record<string, number>>({});

  useEffect(() => {
    const id = questionIds[currentIndex];
    if (id && !(id in timings)) {
      setTimings((prev) => ({ ...prev, [id]: Date.now() }));
    }
  }, [currentIndex, questionIds, timings]);

  return timings;
}

export default function InteractiveMock({
  mock,
  streak,
  focus,
}: {
  mock: Mock;
  streak: number;
  focus: string;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const questionIds = mock.questions.map((q) => q.id);
  const questionTimings = useQuestionTimings(questionIds, index);

  const [picked, setPicked] = useState<Record<string, Answered>>({});
  const [submitting, setSubmitting] = useState(false);
  // After a successful POST, swap the button for an inline success
  // banner ("✓ 提出済み" + 結果を見る link). Added 2026-07-21 per
  // Jackson: the previous redirect-during-server-render felt slow and
  // triggered his spam-click instinct. Now the submit gets instant
  // visual confirmation, and the user picks when to view the result.
  const [submitted, setSubmitted] = useState(false);
  // Guard against rapid double-clicks submitting the same payload 3×.
  // `setSubmitting(true)` is async (queued re-render), so the disabled
  // prop on the button doesn't take effect until the next paint — a
  // second click during the network roundtrip fires the handler again.
  // This ref is checked synchronously at handler entry.
  const submittingRef = useRef(false);

  const total = mock.questions.length;
  const current = mock.questions[index];
  const isLast = index === total - 1;
  const choice = current ? picked[current.id]?.answer : undefined;

  if (!current) {
    return (
      <p style={{ color: 'var(--text-2)', fontSize: 15, lineHeight: 1.55, fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
        このモックには問題が含まれていません。
      </p>
    );
  }

  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const now = new Date();
  const month = MONTHS[now.getMonth()];
  const day = String(now.getDate()).padStart(2, '0');

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div className="mock-date-label">
          {month} {day}
        </div>
        {/* Exit hatch (added 2026-07-21): lets the user leave the mock
            without committing an attempt. Sits inline with the date label
            in the top-right corner — small enough not to compete with the
            primary "提出する" CTA below. */}
        <Link href="/" className="mock-exit-link" aria-label="モックを閉じる">
          × 閉じる
        </Link>
      </div>
      <header className="mock-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <StreakBadge count={streak} />
          <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            {['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][parseInt(mock.date.slice(5,7))-1]} {mock.date.slice(8)}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>今日の N2 モック</div>
            <div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 500, marginTop: 2 }}>
              Today: {focus}
            </div>
          </div>
          <ProgressDots
            total={total}
            current={index}
            answered={mock.questions
              .map((q, i) => (picked[q.id] ? i : -1))
              .filter((i) => i >= 0)}
          />
        </div>
      </header>

      {current.passage && (
        <PinnedPassage passage={current.passage} />
      )}

      <article className="question-card">
        {SUBTYPE_INSTRUCTIONS[current.tags?.[0]] && (
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 }}>
            {SUBTYPE_INSTRUCTIONS[current.tags[0]]}
          </div>
        )}
        <div style={{ fontSize: 16, lineHeight: 1.7, marginBottom: 20, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>
          <PromptWithTarget prompt={current.prompt} targetWord={current.target_word} />
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {current.options.map((opt) => {
            const isPicked = choice === opt.id;
            const correctId = current.correct_answer?.toLowerCase();
            const optId = opt.id.toLowerCase();
            // After submit: show correct/wrong state for all options.
            // During picking: show selected for the picked option only.
            const isCorrect = optId === correctId;
            let state: 'default' | 'selected' | 'correct' | 'wrong' = 'default';
            if (!submitting && isPicked) state = 'selected';
            if (submitting && isCorrect) state = 'correct';
            if (submitting && isPicked && !isCorrect) state = 'wrong';
            return (
              <li key={opt.id}>
                <OptionButton
                  id={opt.id}
                  label={opt.text}
                  state={state}
                  // Allow re-picking — user can change their mind before
                  // advancing to the next question. (Added 2026-07-21 per
                  // Jackson: previous behavior locked the answer on first
                  // pick.) Timing still reflects "time on this question"
                    // (latest pick − question start), so a re-pick inflates
                    // timing by the indecision window — acceptable trade-off.
                  disabled={submitting}
                  onClick={() =>
                    setPicked((p) => ({
                      ...p,
                      [current.id]: { answer: opt.id as Answered['answer'], answeredAtMs: Date.now() },
                    }))
                  }
                />
              </li>
            );
          })}
        </ul>
      </article>

      {submitted ? (
        <div className="mock-submitted-banner" role="status" aria-live="polite">
          <span className="mock-submitted-banner__text">✓ 提出済み</span>
          <Link
            href={`/result/${mock.date}`}
            className="mock-submitted-banner__link"
          >
            結果を見る →
          </Link>
        </div>
      ) : (
        <footer style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
            {choice ? '回答済み' : '選択肢をタップしてください'}
          </span>
          <button
            type="button"
            onClick={async () => {
            if (isLast) {
              // Synchronous re-entry guard — second click during the
              // network roundtrip (before React re-renders with
              // submitting=true) bails immediately instead of POSTing
              // again. Confirmed reproducing today (2026-07-21) with
              // Jackson: 3 inserts at 12:47:12 / 12:47:14 / 12:47:16 JST.
              if (submittingRef.current) return;
              submittingRef.current = true;

              const timings: Record<string, number> = {};
              for (const q of mock.questions) {
                const start = questionTimings[q.id] ?? 0;
                const answered = picked[q.id]?.answeredAtMs ?? Date.now();
                timings[q.id] = Math.round(answered - start);
              }

              const correct_map: Record<string, string> = {};
              for (const q of mock.questions) {
                correct_map[q.id] = q.correct_answer;
              }

              const payload = {
                date: mock.date,
                answers: Object.fromEntries(Object.entries(picked).map(([qid, v]) => [qid, v.answer])),
                correct_map,
                timings,
              };

              setSubmitting(true);
              try {
                const res = await fetch('/api/attempts', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload),
                });
                if (res.ok) {
                  // Inline success state (replaces the previous redirect
                  // to /result/[date]). The success banner stays visible
                  // until the user clicks 結果を見る → to navigate.
                  setSubmitted(true);
                }
              } finally {
                setSubmitting(false);
                submittingRef.current = false;
              }
            } else {
              setIndex(index + 1);
            }
          }}
          disabled={!choice}
          style={{
            padding: '10px 22px',
            background: !choice ? 'var(--border)' : 'var(--accent)',
            color: !choice ? 'var(--text-3)' : '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 500,
            cursor: !choice ? 'not-allowed' : 'pointer',
          }}
        >
          {isLast ? (submitting ? '提出中...' : '提出する') : '次へ →'}
        </button>
      </footer>
      )}
    </>
  );
}


