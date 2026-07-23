/**
 * components/PullQuote.tsx — italic serif quote between hairline rules.
 *
 * Use sparingly — at most one per page, usually on result/progress pages.
 */

import type { ReactNode } from 'react';

export interface PullQuoteProps {
  children: ReactNode;
  attribution?: string;
}

export function PullQuote({ children, attribution }: PullQuoteProps) {
  return (
    <blockquote className="pull-quote">
      {children}
      {attribution && <cite className="pull-quote__attribution">— {attribution}</cite>}
    </blockquote>
  );
}

export default PullQuote;
