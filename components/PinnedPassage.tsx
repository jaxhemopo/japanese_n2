/**
 * components/PinnedPassage.tsx — locked component per design.md §Components.
 *
 * surface-2 background, position: sticky; top: 16px; while the question
 * it belongs to is being answered. Sans 15px body, line-height 1.9 (dense
 * Japanese reading).
 *
 * Usage:
 *   <PinnedPassage passage={current.passage} />
 *
 * Companion CSS classes live in app/globals.css under
 * `──── pinned passage (locked) ────`. This component is the
 * locked typed wrapper; the classes handle all layout, color, and
 * typography.
 */

export interface PinnedPassageProps {
  passage: string;
}

export function PinnedPassage({ passage }: PinnedPassageProps) {
  return (
    <aside className="pinned-passage" aria-label="本文">
      <div className="pinned-passage__label">本文</div>
      <div className="passage-text pinned-passage__body">{passage}</div>
    </aside>
  );
}

export default PinnedPassage;