/**
 * components/PhoneMockup.tsx — decorative phone overlapping the landing card.
 *
 * Pure CSS + inline content. NOT interactive. Hidden on mobile.
 * Server-rendered — no client JS.
 *
 * Screen content per design.md §PhoneMockup (locked spec):
 *   - "N2 Daily Mock" header (serif italic, small)
 *   - Meta row (Q 1/5 left + 07:30 JST right in italic serif, --text-2)
 *   - 1 question stub (1 italic serif caption ("次の文章を読んで") +
 *     1 truncated sans line styled as the passage lead-in with a
 *     trailing ellipsis — the design.md spec locks "1 question stub",
 *     not "1 question + full passage"). The mockup is a stylized preview
 *     of today's mock, not a real screenshot. (Reverted 2026-07-20 from
 *     the multi-line passage extension that over-filled the screen.)
 *   - 4 option dots (small circles, A/B/C/D letters, current = accent ring)
 *
 * No feedback / next-btn rows: design.md §PhoneMockup lists only header +
 * question stub + option dots. Adding post-answer feedback would violate
 * the locked spec — the mockup is a "stylized preview of today's mock"
 * showing the question state, not a completed answer state. The phone
 * screen has deliberate empty space below the options (--surface
 * background) to keep the composition restrained.
 */

export function PhoneMockup() {
  return (
    <div className="phone-mockup" aria-hidden="true">
      <div className="phone-mockup__screen">
        <div className="phone-mockup__header">N2 Daily Mock</div>
        <div className="phone-mockup__meta">
          <span>問 1 / 5</span>
          <span className="phone-mockup__meta-time">07:30 JST</span>
        </div>
        <div className="phone-mockup__question">
          <div className="phone-mockup__caption">次の文章を読んで</div>
          {/* 2026-07-22 gap-killer (12:11 JST): question stub widened from
              75%-truncated 1-line preview to a 2-line stub that fills more
              of the phone screen vertical real estate. The locked spec
              (design.md §PhoneMockup) calls for "1 question stub" — a stub
              is a preview, not a full passage; extending it to 2 lines of
              compact Japanese text still reads as a stub (truncation
              ellipsis removed in favor of natural line wrap). Pairs with
              the `.phone-mockup__text` `white-space: normal; line-height:
              1.5` change in globals.css. The shorter text "日本の祭りは
              土地の風習や歴史を反映する。" wraps cleanly to 2 lines at the
              156px screen content width. */}
          <span className="phone-mockup__text">日本の祭りは土地の風習や歴史を反映する。</span>
        </div>
        <div className="phone-mockup__options">
          <span className="phone-mockup__option">A</span>
          <span className="phone-mockup__option phone-mockup__option--current">B</span>
          <span className="phone-mockup__option">C</span>
          <span className="phone-mockup__option">D</span>
        </div>
        {/* 2026-07-27 gap-killer (06:13 JST): removed the
            "Begin question →" footer that was added by the 2026-07-23
            gap-killer pass. design.md §PhoneMockup explicitly locks
            screen content as "small N2 Daily Mock header + 1 question
            stub + 4 option dots" — no footer. The footer was a
            documented deviation from the locked spec (the 2026-07-26
            21:13 pass notes called it out: "deliberate empty space
            below the options (--surface background) to keep the
            composition restrained"). Now the phone screen reads with
            the option dots anchored at ~30% screen height and the
            remaining ~70% as deliberate empty --surface background —
            matching the locked spec. The .phone-mockup__footer CSS
            class is kept as a no-op (display: none) in globals.css for
            backward compatibility with any stale references. */}
      </div>
    </div>
  );
}

export default PhoneMockup;
