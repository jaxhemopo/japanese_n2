/**
 * components/StreakBadge.tsx — locked component per design.md §Components.
 *
 * Small pill, top-left of the card body. Fire emoji + count + " day streak".
 * Sans 12px, color --text-3, on the warm card surface (--surface-2 background
 * with --border hairline for the editorial-newspaper pill shape).
 *
 * The CSS class `.streak-badge` (defined in app/globals.css) provides the
 * visual treatment; this component is the typed, lockable wrapper that pages
 * should use instead of inlining `<span className="streak-badge">`.
 *
 * Usage:
 *   <StreakBadge count={5} />
 */

export interface StreakBadgeProps {
  count: number;
  className?: string;
}

export function StreakBadge({ count, className }: StreakBadgeProps) {
  const cls = ['streak-badge', className].filter(Boolean).join(' ');
  return (
    <span className={cls}>
      🔥 {count} day streak
    </span>
  );
}

export default StreakBadge;
