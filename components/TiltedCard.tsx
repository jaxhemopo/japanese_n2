/**
 * components/TiltedCard.tsx — the editorial-newspaper card composition.
 *
 * Wraps children in the warm off-white newspaper card on the dark olive canvas.
 * This is the genre marker — every page's main content lives inside one.
 *
 * NOTE: the rotation tilt was removed 2026-07-20 (Jackson's call) — the
 * reference's tilt was an editorial-briefing gesture that read as
 * "why is my exam tilted" on a daily-mock exam product. Component name
 * kept as legacy; behavior is now a straight rectangular card.
 *
 * Usage:
 *   <TiltedCard>{...page content...}</TiltedCard>
 *   <TiltedCard tilt={-1.5}>{...}</TiltedCard>     — override (rare; legacy tilt prop still supported)
 *   <TiltedCard shadow={false}>{...}</TiltedCard>   — flat (for printable views?)
 */

import type { ReactNode } from 'react';

export interface TiltedCardProps {
  children: ReactNode;
  tilt?: number; // degrees, negative = counter-clockwise. Default 0 (no rotation).
  shadow?: boolean; // default true
  className?: string;
}

export function TiltedCard({
  children,
  tilt = 0,
  shadow = true,
  className,
}: TiltedCardProps) {
  const cardClass = ['tilted-card', shadow ? '' : 'tilted-card--no-shadow', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="tilted-card-wrapper">
      <div className={cardClass} style={tilt !== 0 ? { transform: `rotate(${tilt}deg)` } : undefined}>
        {children}
      </div>
    </div>
  );
}

export default TiltedCard;
