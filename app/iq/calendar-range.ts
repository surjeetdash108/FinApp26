/**
 * Shared calendar-range helpers for the dividend, earnings, macro and IPO
 * calendars.
 *
 * All four screens previously hardcoded their date filters — e.g.
 * `exMonth === 6 && exDay === 25` and `e.month === 6 && e.day === 25` — which
 * froze every "Today / Yesterday / This Week" tab to 2026-06-25 permanently.
 * Everything here derives from a Date passed in by the caller, so the tabs track
 * the real clock and the logic is verified in one place instead of four.
 */

export type RangeTabKey =
  | 'today' | 'yest' | 'tom'
  | 'week' | 'prev' | 'next'
  | 'lmonth' | 'month';

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (d: Date, n: number) => {
  const c = new Date(d);
  c.setUTCDate(c.getUTCDate() + n);
  return c;
};

/** Monday of the week containing d (UTC, Monday-start). */
export const mondayOf = (d: Date) => addDays(d, -((d.getUTCDay() + 6) % 7));

const MON_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** "2026-08-14" -> "Aug 14". Returns "—" for null so callers never print "null". */
export function fmtMonthDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [, m, d] = iso.split('-').map(Number);
  if (!m || !d) return '—';
  return `${MON_ABBR[m - 1]} ${d}`;
}

/**
 * Inclusive [from,to] ISO range for a tab, relative to `now`.
 *
 * Week tabs are Mon–Fri (trading week). Month tabs use the 0th-day trick to get
 * the last day of a month, which handles leap years and year boundaries without
 * special cases — verified across 2027-01-01.
 */
export function rangeFor(tab: RangeTabKey, now: Date): { from: string; to: string } {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const mon = mondayOf(today);
  switch (tab) {
    case 'today':  return { from: isoDay(today), to: isoDay(today) };
    case 'yest':   return { from: isoDay(addDays(today, -1)), to: isoDay(addDays(today, -1)) };
    case 'tom':    return { from: isoDay(addDays(today, 1)),  to: isoDay(addDays(today, 1)) };
    case 'week':   return { from: isoDay(mon), to: isoDay(addDays(mon, 4)) };
    case 'prev':   return { from: isoDay(addDays(mon, -7)), to: isoDay(addDays(mon, -3)) };
    case 'next':   return { from: isoDay(addDays(mon, 7)),  to: isoDay(addDays(mon, 11)) };
    case 'lmonth': {
      const f = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      return { from: isoDay(f), to: isoDay(t) };
    }
    default: { // 'month'
      const f = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
      return { from: isoDay(f), to: isoDay(t) };
    }
  }
}

export const inRange = (iso: string, r: { from: string; to: string }) =>
  iso >= r.from && iso <= r.to;
