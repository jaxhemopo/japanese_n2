/**
 * lib/types/result.ts — TypeScript types for GET /result/[date].
 *
 * Source of truth:  ~/projects/japanese-n2/openapi/result.yaml
 * Implementation:    ~/projects/japanese-n2/app/result/[date]/page.tsx
 * Last synced:       2026-07-13 12:45 JST (n2-build wakeup 0067)
 *
 * Mirrors the 8 component schemas from openapi/result.yaml 1:1:
 *   ScoreHeader, QuestionBreakdownRow, ResultContentState,
 *   ErrorState, NoMockForDate, NoAttemptYet, Breakdown, MissingQuestion.
 *
 * Note on MissingQuestion: the YAML lists it as a member of the
 * ResultContentState oneOf union, but the YAML description also says it
 * is "NOT a separate HTTP response — it is one possible row shape inside
 * Breakdown.question_rows". This file follows the YAML's structure
 * faithfully (top-level type present in the union). The page treats
 * MissingQuestion as a per-row soft-fail inside Breakdown.question_rows.
 * If the spec is later amended, update both this file and the YAML in
 * lockstep — verify_types_result.sh enforces the mirror.
 */

// =============================================================================
// Discriminator
// =============================================================================

export type ResultContentStateKind =
  | "error"
  | "no_mock"
  | "no_attempt"
  | "breakdown"
  | "missing_question";

export const RESULT_CONTENT_STATES = [
  "error",
  "no_mock",
  "no_attempt",
  "breakdown",
  "missing_question",
] as const satisfies readonly ResultContentStateKind[];

// =============================================================================
// Composite shapes
// =============================================================================

/**
 * Top of the result page: score fraction + pct + formatted total time.
 * pctColor thresholds: ≥80 → green (#16a34a), ≥60 → blue (#2563eb),
 * <60 → red (#dc2626). formatTime outputs "M分SS秒" (e.g., "4分05秒").
 */
export interface ScoreHeader {
  /** Number of correct answers (0–5). */
  score: number;
  /** Total questions in the mock (always 5 per goal.md OQ-2). */
  total: number;
  /** score/total × 100, rounded. Derived from score + total. */
  pct: number;
  /** Sum of per-question time_seconds across all attempts. */
  total_seconds: number;
}

/**
 * Per-question block in the breakdown list (rendered as <li> inside <ol>).
 * Correct/incorrect badge colors: #dcfce7/#fee2e2.
 * User answer is uppercase (e.g., "A"). Correct answer is only surfaced
 * when is_correct is false. Explanation is rendered inside <details>;
 * null when the row is a MissingQuestionRow (orphan question_id).
 */
export interface QuestionBreakdownRow {
  /** 1-based question number. */
  number: number;
  /** Whether the user's answer matched q.correct_answer. */
  is_correct: boolean;
  /** The question prompt text (Japanese ok, markdown ok). */
  prompt: string;
  /** Uppercased a|b|c|d, or null only in the MissingQuestionRow path. */
  user_answer: string | null;
  /** Uppercased a|b|c|d. Always present in the wire type; page hides on correct. */
  correct_answer: string;
  /** Time spent on this question in seconds (e.g., 45). */
  time_seconds: number;
  /** Explanation text inside <details>, or null when MissingQuestionRow. */
  explanation: string | null;
}

// =============================================================================
// Per-content-state interfaces (discriminated by _state)
// =============================================================================

/** Triggered when the date URL param fails the DATE_RE pattern. */
export interface ErrorState {
  _state: "error";
  /** User-facing error message (Japanese ok). */
  message: string;
}

/** Valid date, but no n2_mocks row found for that date. */
export interface NoMockForDate {
  _state: "no_mock";
  /** ISO 8601 date string (YYYY-MM-DD). */
  date: string;
  /** Body text rendered under the H1 ("モックが見つかりません" etc.). */
  body_text: string;
}

/** Mock exists for date, but the user has not submitted answers yet. */
export interface NoAttemptYet {
  _state: "no_attempt";
  /** ISO 8601 date string (YYYY-MM-DD). */
  date: string;
  /** Body text rendered under the H1 ("まだ提出していません…" etc.). */
  body_text: string;
}

/**
 * Full breakdown — mock exists AND the user has submitted ≥1 attempt.
 * Per-question rows are rendered inside <ol>. Footer nav links to "/"
 * (home) and "/today" (today's mock).
 */
export interface Breakdown {
  _state: "breakdown";
  /** ISO 8601 date string (YYYY-MM-DD). */
  date: string;
  score_header: ScoreHeader;
  question_rows: QuestionBreakdownRow[];
  footer_nav: {
    /** Relative path back to home (e.g., "/"). */
    home: string;
    /** Relative path to today's mock (e.g., "/today"). */
    today: string;
  };
}

/**
 * Per-row soft-fail: attempt row exists (question_id in n2_attempts) but
 * the n2_questions JOIN returned null (orphan). The page renders a grey
 * placeholder row per MissingQuestionRow rather than throwing. NOT a
 * separate HTTP response — one possible row shape inside
 * Breakdown.question_rows per the spec description.
 */
export interface MissingQuestion {
  _state: "missing_question";
  /** The orphan question_id from n2_attempts (UUID). */
  question_id: string;
  /** Placeholder text rendered in place of the missing question. */
  placeholder_text: string;
}

// =============================================================================
// Discriminated union
// =============================================================================

/**
 * Union of the 5 possible HTML content states rendered by the page.
 * Note: these are document shapes, not a machine-readable enum — the
 * page returns HTML, not JSON. Narrow with the `_state` discriminator:
 *
 *   const s: ResultContentState = ...;
 *   if (isBreakdown(s)) { s.score_header.score; ... }
 */
export type ResultContentState =
  | ErrorState
  | NoMockForDate
  | NoAttemptYet
  | Breakdown
  | MissingQuestion;

// =============================================================================
// Type guards (exhaustive narrowing helpers)
// =============================================================================

export const isErrorState = (s: ResultContentState): s is ErrorState =>
  s._state === "error";

export const isNoMockForDate = (s: ResultContentState): s is NoMockForDate =>
  s._state === "no_mock";

export const isNoAttemptYet = (s: ResultContentState): s is NoAttemptYet =>
  s._state === "no_attempt";

export const isBreakdown = (s: ResultContentState): s is Breakdown =>
  s._state === "breakdown";

export const isMissingQuestion = (
  s: ResultContentState,
): s is MissingQuestion => s._state === "missing_question";