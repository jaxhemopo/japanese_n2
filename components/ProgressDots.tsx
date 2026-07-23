/**
 * components/ProgressDots.tsx — locked component per design.md §Components.
 *
 * 5 small circles (configurable `total`). Filled = --text-3, hollow = --border,
 * current = --accent ring (2px). Used on /today to show mock-question progress.
 *
 * Note: ProgressDots is the locked spec for /today's mock-exam progress strip.
 * interactive-mock.tsx (Claude-owned) currently inlines the equivalent CSS
 * classes. This component is provided so that future pages or refactors can
 * reach for the locked wrapper instead of re-implementing.
 *
 * Usage:
 *   <ProgressDots total={5} current={2} answered={[0, 1]} />
 *   <ProgressDots total={5} current={2} />  // answered = range(0, current)
 */

export interface ProgressDotsProps {
  total: number;
  current: number; // 0-indexed; the dot that gets the --accent ring
  answered?: number[]; // indices treated as answered (filled). Defaults to [0..current-1].
  className?: string;
}

export function ProgressDots({ total, current, answered, className }: ProgressDotsProps) {
  const answeredSet = new Set(answered ?? Array.from({ length: current }, (_, i) => i));

  return (
    <div className={'progress-dots ' + (className ?? '')}>
      {Array.from({ length: total }, (_, i) => {
        let state: 'current' | 'answered' | 'hollow' = 'hollow';
        if (i === current) state = 'current';
        else if (answeredSet.has(i)) state = 'answered';

        const dotClass =
          'progress-dot ' +
          (state === 'current'
            ? 'progress-dot--current'
            : state === 'hollow'
            ? 'progress-dot--hollow'
            : '');

        return <span key={i} className={dotClass} aria-current={state === 'current' ? 'step' : undefined} />;
      })}
    </div>
  );
}

export default ProgressDots;
