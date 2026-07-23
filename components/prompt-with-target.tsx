/**
 * components/prompt-with-target.tsx — highlights the question's target
 * word within its prompt sentence.
 *
 * Real JLPT underlines the target word (kanji_reading, and
 * word_formation_synonym format (a)) so the test-taker knows which word
 * the question is about — we don't render an <u> underline reliably, so
 * the pipeline gives us `target_word` (exact substring of `prompt`) and
 * this highlights it instead. Falls back to plain text if absent/no match.
 *
 * The target word is wrapped in a `<strong class="prompt-target">` so the
 * accent color + underline come from the locked `.prompt-target` CSS
 * class in app/globals.css (no inline styles).
 */

export function PromptWithTarget({ prompt, targetWord }: { prompt: string; targetWord?: string | null }) {
  if (!targetWord) return <>{prompt}</>;
  const idx = prompt.indexOf(targetWord);
  if (idx === -1) return <>{prompt}</>;
  return (
    <>
      {prompt.slice(0, idx)}
      <strong className="prompt-target">{targetWord}</strong>
      {prompt.slice(idx + targetWord.length)}
    </>
  );
}