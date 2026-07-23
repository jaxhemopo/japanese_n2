/**
 * lib/subtype-labels.ts — human-readable labels for n2_questions.tags[0].
 *
 * Covers both the current 10-subtype set (n2-generator pipeline) and the
 * legacy tag names from questions inserted before that pipeline existed —
 * both sets of tags are still live in n2_questions, so both need labels.
 */

export const SUBTYPE_LABELS: Record<string, string> = {
  kanji_reading: 'Kanji Reading',
  contextual_vocab: 'Contextual Vocabulary',
  word_formation_synonym: 'Word Formation / Synonyms',
  grammar_formats: 'Grammar Patterns',
  sentence_order: 'Sentence Order',
  text_grammar: 'Text Grammar',
  short_medium_passage: 'Short/Medium Passage',
  info_retrieval: 'Information Retrieval',
  long_essay: 'Long Essay',
  integrated_comprehension: 'Integrated Comprehension',
  // legacy tags (pre n2-generator questions)
  compound_words: 'Compound Words',
  grammar_fill_in: 'Grammar Fill-in',
  kanji_writing: 'Kanji Writing',
  passage_fill_in: 'Passage Fill-in',
  reading_comprehension: 'Reading Comprehension',
  sentence_ordering: 'Sentence Ordering',
  word_meaning: 'Word Meaning',
  word_usage: 'Word Usage',
};

export function subtypeLabel(tag: string | undefined | null): string {
  if (!tag) return 'Unknown';
  return SUBTYPE_LABELS[tag] ?? tag;
}
