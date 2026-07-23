/**
 * components/ResultNote.tsx — locked component per design.md §Components.
 *
 * `<details>` collapsed by default; summary reads "why the others were wrong".
 * Expands to show all 4 options' notes; correct option in --correct-soft,
 * wrong options in --wrong-soft.
 *
 * Lives on the warm card surface; per-option pills use the soft feedback
 * backgrounds already defined in app/globals.css (--correct-soft, --wrong-soft).
 *
 * Usage:
 *   <ResultNote options={q.options} correctId={q.correct_answer} />
 */

export interface ResultNoteOption {
  id: string;
  text: string;
  note?: string | null;
}

export interface ResultNoteProps {
  options: ResultNoteOption[];
  correctId: string;
  summary?: string;
}

export function ResultNote({ options, correctId, summary }: ResultNoteProps) {
  const normCorrect = correctId?.toLowerCase() ?? '';
  const heading = summary ?? 'why the others were wrong';

  return (
    <details className="result-note">
      <summary className="result-note__summary">▾ {heading}</summary>
      <div className="result-note__body">
        {options.map((o) => {
          const isCorrect = o.id.toLowerCase() === normCorrect;
          return (
            <div
              key={o.id}
              className={
                'result-note__option ' +
                (isCorrect ? 'result-note__option--correct' : 'result-note__option--wrong')
              }
            >
              <strong>{o.id.toUpperCase()}.</strong> {o.text}
              {o.note && <div className="result-note__note">{o.note}</div>}
            </div>
          );
        })}
      </div>
    </details>
  );
}

export default ResultNote;
