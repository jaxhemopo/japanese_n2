/**
 * components/IssueMeta.tsx — top-of-card meta strip.
 *
 * Three-column row: [day / month] · [publication name in serif italic] · [year digits stacked].
 * All in serif. Tight letter-spacing. Server-rendered with today's JST date
 * as the default, but accepts overrides for static contexts (e.g., /result/[date]).
 *
 * Usage:
 *   <IssueMeta />                        — uses today's JST date
 *   <IssueMeta day={19} month="JUL" yearTop="20" yearBottom="26" center="N2 Daily Mock" />
 */

const MONTH_ABBR = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

function todayJst() {
  // Format YYYY-MM-DD in JST regardless of server TZ.
  const now = new Date();
  const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  return {
    day: jst.getDate(),
    month: MONTH_ABBR[jst.getMonth()],
    // design.md §Issue-meta strip: year split into two stacked 2-digit
    // chunks ("20" / "26"), not single digits. Earlier `slice(2, 3)` and
    // `slice(3, 4)` returned single chars ("2" / "6"), which rendered the
    // masthead right column as "2 / 6" instead of "20 / 26" on every page.
    yearTop: String(jst.getFullYear()).slice(0, 2),    // "20"
    yearBottom: String(jst.getFullYear()).slice(2, 4), // "26"
  };
}

export interface IssueMetaProps {
  day?: number;
  month?: string;
  yearTop?: string;
  yearBottom?: string;
  center?: string;
}

export function IssueMeta(props: IssueMetaProps) {
  const today = todayJst();
  const day = props.day ?? today.day;
  const month = props.month ?? today.month;
  const yearTop = props.yearTop ?? today.yearTop;
  const yearBottom = props.yearBottom ?? today.yearBottom;
  const center = props.center ?? 'N2 Daily Mock';

  return (
    <div className="issue-meta">
      <div className="issue-meta__day">
        <div className="issue-meta__day-num">{day}</div>
        <div className="issue-meta__day-month">{month}</div>
      </div>
      <div className="issue-meta__center">{center}</div>
      <div className="issue-meta__year">
        <div className="issue-meta__year-top">{yearTop}</div>
        <div className="issue-meta__year-bottom">{yearBottom}</div>
      </div>
    </div>
  );
}

export default IssueMeta;
