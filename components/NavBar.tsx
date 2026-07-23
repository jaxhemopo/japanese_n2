import Link from 'next/link';

const ITEMS = [
  { href: '/', label: 'ホーム' },
  { href: '/today', label: '今日のモック' },
  { href: '/progress', label: '進捗' },
  { href: '/revision', label: '復習' },
  { href: '/settings', label: '設定' },
];

/**
 * components/NavBar.tsx — Persistent section nav below the IssueMeta masthead.
 *
 * Server component — receives `current` as a prop (no client hook needed,
 * keeps the JS bundle small). Placed inside every TiltedCard except / and
 * /auth (the home page is the entry point; /auth is a focused form per
 * design.md — Phone mockup NOT rendered there).
 *
 * Current page highlighted in --accent. Sans 13px / 500 / --text-3 in the
 * default state, --accent + 600 weight when current. Matches design.md
 * §Typography meta-label row, kept consistent across all four routes.
 *
 * Added 2026-07-21: replaces per-page ad-hoc nav links that were
 * inconsistently labelled in mixed JP/EN (← ホームに戻る on some pages,
 * ← Back to today's mock on others). Source of truth for the persistent
 * nav surface — ad-hoc .card-footer-nav blocks below page content stay
 * where they are (they're "where to go next" affordances, not section
 * nav).
 */
export function NavBar({ current }: { current: string }) {
  return (
    <nav className="nav-bar" aria-label="メインナビゲーション">
      {ITEMS.map((item) => {
        const isCurrent = item.href === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              'nav-bar__item' + (isCurrent ? ' nav-bar__item--current' : '')
            }
            aria-current={isCurrent ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
