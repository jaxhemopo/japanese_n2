/**
 * lib/n2-rotation.ts — LRU subtype rotation for the daily mock generator.
 *
 * Mirrored from ~/ODIS/shared/pipelines/n2-generator/steps/01-plan-day.md
 * (the agent-run version) — same algorithm, ported to run inside the
 * Vercel Cron serverless route instead of an agent session.
 */

export const LANG = [
  'kanji_reading',
  'contextual_vocab',
  'word_formation_synonym',
  'grammar_formats',
  'sentence_order',
  'text_grammar',
] as const;

export const READING: Record<string, number> = {
  long_essay: 3,
  info_retrieval: 2,
  short_medium_passage: 2,
  integrated_comprehension: 2,
};
const READING_ORDER = ['long_essay', 'info_retrieval', 'short_medium_passage', 'integrated_comprehension'];

export type DayPlan = {
  cycle_number: number;
  cycle_day: number;
  subtypes: { subtype: string; count: number }[];
};

export function planDay(prevCycleNumber: number, subtypeLastUsed: Record<string, number>): DayPlan {
  const cycleNumber = prevCycleNumber + 1;
  const cycleDay = ((cycleNumber - 1) % 6) + 1;

  if (cycleDay === 1 || cycleDay === 3 || cycleDay === 5) {
    // reading day
    const headline = [...READING_ORDER].sort(
      (a, b) => (subtypeLastUsed[a] ?? 0) - (subtypeLastUsed[b] ?? 0),
    )[0];
    const remaining = 5 - READING[headline];
    const filler = [...LANG]
      .sort((a, b) => (subtypeLastUsed[a] ?? 0) - (subtypeLastUsed[b] ?? 0))
      .slice(0, remaining);
    return {
      cycle_number: cycleNumber,
      cycle_day: cycleDay,
      subtypes: [{ subtype: headline, count: READING[headline] }, ...filler.map((s) => ({ subtype: s, count: 1 }))],
    };
  }

  // language-knowledge day
  const picked = [...LANG].sort((a, b) => (subtypeLastUsed[a] ?? 0) - (subtypeLastUsed[b] ?? 0)).slice(0, 5);
  return {
    cycle_number: cycleNumber,
    cycle_day: cycleDay,
    subtypes: picked.map((s) => ({ subtype: s, count: 1 })),
  };
}

export const CATEGORY_MAP: Record<string, string> = {
  kanji_reading: 'vocab_context',
  contextual_vocab: 'vocab_context',
  word_formation_synonym: 'vocab_context',
  grammar_formats: 'grammar_form',
  sentence_order: 'grammar_form',
  text_grammar: 'grammar_form',
  long_essay: 'reading_short',
  info_retrieval: 'reading_short',
  short_medium_passage: 'reading_short',
  integrated_comprehension: 'reading_short',
};

export const READING_SUBTYPES = new Set(['long_essay', 'info_retrieval', 'short_medium_passage', 'integrated_comprehension']);
