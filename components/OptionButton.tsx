/**
 * components/OptionButton.tsx — locked component per design.md §Components.
 *
 * The choice button on /today's interactive mock (and any future question
 * picker UI). Mirrors the StreakBadge / ProgressDots / ResultNote pattern:
 * a typed wrapper around the already-locked CSS class set in
 * app/globals.css (`.option-btn`, `.option-btn--selected`,
 * `.option-btn--correct`, `.option-btn--wrong`).
 *
 * Spec from design.md:
 *   Default:   --surface bg + 1px --border
 *   Selected:  --accent 2px border + --accent-soft background
 *   Correct:   --correct 2px border + --correct-soft background
 *   Wrong:     --wrong 2px border + --wrong-soft background
 *
 * Never solid --accent fill — too loud for the editorial genre.
 *
 * Usage (client-side, on /today via interactive-mock.tsx which is
 * Claude-owned — this component is ready for him to wire in):
 *
 *   <OptionButton
 *     id="a"
 *     label="選択肢Aのテキスト"
 *     state={choice === 'a' ? 'selected' : 'default'}
 *     disabled={!!choice}
 *     onClick={() => setPicked(...)}
 *   />
 */

export type OptionButtonState = 'default' | 'selected' | 'correct' | 'wrong';

export interface OptionButtonProps {
  /** Option letter ('a' / 'b' / 'c' / 'd') — rendered as a bold prefix. */
  id: 'a' | 'b' | 'c' | 'd' | string;
  /** The option body text (Japanese sentence / word). */
  label: string;
  /** Visual state. See OptionButtonState above. */
  state?: OptionButtonState;
  /** Disabled (after a choice is picked). */
  disabled?: boolean;
  /** Click handler. */
  onClick?: () => void;
}

export function OptionButton({
  id,
  label,
  state = 'default',
  disabled = false,
  onClick,
}: OptionButtonProps) {
  const className = [
    'option-btn',
    state === 'selected' && 'option-btn--selected',
    state === 'correct' && 'option-btn--correct',
    state === 'wrong' && 'option-btn--wrong',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={state === 'selected'}
    >
      <strong className="option-btn__id">{id.toUpperCase()}.</strong>
      <span className="option-btn__label">{label}</span>
    </button>
  );
}

export default OptionButton;