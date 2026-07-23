/**
 * lib/types/attempts.ts — TypeScript types for the Attempts API surface.
 *
 * Source of truth:  ~/projects/japanese-n2/openapi/attempts.yaml
 * Implementation:    ~/projects/japanese-n2/app/api/attempts/route.ts (POST)
 *                    ~/projects/japanese-n2/app/api/attempts/[date]/route.ts (GET)
 * Last synced:       2026-07-13 13:00 JST (n2-build wakeup 0068)
 *
 * Mirrors the component schemas from openapi/attempts.yaml 1:1:
 *   AnswerValue, AnswerMap, TimingMap, CorrectMap, SubmitAttemptRequest,
 *   SubmitAttemptResponse, Question, Mock, Attempt, GetAttemptResponse,
 *   ErrorResponse, AnswerOption.
 *
 * Category: webapp-types (extends 0067's lib/types/result.ts pattern).
 * Verifier:  tsc --noEmit (npm run type-check) — full-project pass.
 */

// =============================================================================
// Shared primitives
// =============================================================================

/** Multiple-choice option selector. */
export type AnswerValue = 'a' | 'b' | 'c' | 'd';

/** Map from question UUID (n2_questions.id) to chosen answer. */
export type AnswerMap = Record<string, AnswerValue>;

/** Map from question UUID to per-question elapsed time in milliseconds. */
export type TimingMap = Record<string, number>;

/** Optional map from question UUID to correct answer (pre-computed client-side). */
export type CorrectMap = Record<string, AnswerValue>;

// =============================================================================
// POST /api/attempts — submit answers
// =============================================================================

export interface SubmitAttemptRequest {
  /** Daily mock date — must match n2_mocks.date (DATE PK, not UUID). */
  date: string;
  /** Per-question user answers. */
  answers: AnswerMap;
  /** Per-question elapsed time in ms. */
  timings?: TimingMap;
  /** Optional pre-computed correct flags. Handler populates `correct` at insert time. */
  correct_map?: CorrectMap;
  /** Total elapsed ms. If omitted, handler sums timings. */
  total_ms?: number;
}

export interface SubmitAttemptResponse {
  /** One UUID per answered question (one row per question inserted into n2_attempts). */
  attempt_ids: string[];
}

// =============================================================================
// GET /api/attempts/{date} — read attempts
// =============================================================================

/**
 * Single option in a multiple-choice question.
 * option.id is the discriminator ('a'|'b'|'c'|'d'); option.text is the Japanese text.
 */
export interface AnswerOption {
  id: AnswerValue;
  text: string;
}

/**
 * Canonical question row from n2_questions.
 * Mirrors ~/ODIS/shared/pipelines/n2-content/schemas/question.schema.json.
 * M4 note: source_id (post-migration-007 rename); the cp6 result page reads this field.
 */
export interface Question {
  id: string;
  /** Launch-categories only. listening_* enums deferred per goal.md OQ-4. */
  category: 'grammar_form' | 'reading_short' | 'vocab_context';
  tags?: string[];
  difficulty?: number;       // 1–5
  prompt?: string;
  options?: AnswerOption[];
  correct_answer: AnswerValue;
  explanation?: string;
  source_id?: string;
  audit?: AuditScore;
}

/** Audit block stored on each question row (from 04-audit step). */
export interface AuditScore {
  score?: number;
  scores_by_criterion?: {
    japanese_accuracy?: number;
    n2_alignment?: number;
    clarity?: number;
    distractor_quality?: number;
    format_compliance?: number;
  };
  reviewer_model?: string;
  reviewed_at?: string;  // ISO-8601
}

/**
 * Daily mock row from n2_mocks.
 * M4 note: n2_mocks PK is DATE (not UUID); id is always null in GET responses.
 */
export interface Mock {
  /** Always null — n2_mocks has a DATE PK, not a UUID. Reserved for schema evolution. */
  id: null;
  date: string;     // YYYY-MM-DD
  /** Ordered list of question UUIDs from n2_mocks.question_ids. */
  questions: string[];
}

/**
 * Per-question attempt row from n2_attempts, enriched with question metadata.
 * is_correct is recomputed on read from question.correct_answer === user_answer.
 */
export interface Attempt {
  question_id: string;
  user_answer: AnswerValue;
  /** Elapsed seconds for this question. */
  time_seconds: number;
  /** True if user_answer === question.correct_answer. */
  is_correct: boolean;
  /** Full question row (JOIN from n2_questions). */
  question: Question;
}

export interface GetAttemptResponse {
  /** null when no mock has been published for this date yet. */
  mock: Mock | null;
  attempts: Attempt[];
  score: number;        // count of is_correct === true
  total: number;        // always 5 per goal.md OQ-2
  total_seconds: number;
}

// =============================================================================
// Shared error shape
// =============================================================================

export interface ErrorResponse {
  error: string;
  detail?: string;  // only present on 500 errors
}

// =============================================================================
// Type guards (discriminated-union helpers)
// =============================================================================

/** True when the value is a valid non-empty GetAttemptResponse. */
export function isGetAttemptResponse(v: unknown): v is GetAttemptResponse {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    Array.isArray(r.attempts) &&
    typeof r.score === 'number' &&
    typeof r.total === 'number' &&
    typeof r.total_seconds === 'number'
  );
}

/** True when the value is a valid ErrorResponse. */
export function isErrorResponse(v: unknown): v is ErrorResponse {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.error === 'string';
}
