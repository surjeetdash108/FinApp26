import type { FinancialsDoc, LiveEarningsDoc } from "./types";

/** One reported quarter, positioned on the chart by its reporting date. */
export interface ChartEarnings {
  /** ISO reporting date — matched to the nearest bar at or before it. */
  date: string;
  epsActual: number | null;
  epsEstimate: number | null;
  revenueActual?: number | null;
  revenueEstimate?: number | null;
  session?: "BMO" | "AMC" | null;
}

/**
 * THE derivation of a ticker's chart earnings dots. Every chart in the app must
 * call this — stock details, its expanded view, and the watchlist / portfolio /
 * screener / movers / IPO panels — so a report shows in the same place with the
 * same numbers wherever it is drawn. It lived inline in stock.tsx, which is why
 * the panel charts had an Earnings toggle that drew nothing at all.
 *
 * Reports come from `epsHistory`, the deep FMP reported series, NOT from the
 * market-wide earnings calendar. The calendar spans ~10 months and holds 2-3
 * rows per ticker (measured: 13,236 rows over 5,516 tickers), so a chart built
 * on it showed the same one or two dots at 1Y as at 5Y and the timeframe
 * dropdown looked broken. epsHistory goes back years — CSCO carries 39 reported
 * quarters to 2017-02-15.
 *
 * Revenue exists only on `quarters` and session only on the calendar, so each is
 * joined back on where present; neither is required to draw a dot. Rows with no
 * actual are upcoming quarters carrying only an estimate, and are dropped —
 * this panel is about what was reported.
 */
export function buildChartEarnings(
  doc: FinancialsDoc | null | undefined,
  calendarEvents: ReadonlyArray<LiveEarningsDoc>,
  todayIso: string,
): ChartEarnings[] {
  const revByFiscalQuarter = new Map<string, number | null>(
    (doc?.quarters ?? []).map(q => [`${q.fiscalYear}-${q.fiscalPeriod}`, q.revenue]),
  );
  const sessionByDate = new Map<string, "BMO" | "AMC" | null>(
    calendarEvents.map(e => [e.date, e.session ?? null]),
  );

  const fromHistory: ChartEarnings[] = (doc?.epsHistory ?? [])
    .filter(h => h.epsActual != null && h.date && h.date <= todayIso)
    .map(h => ({
      date: h.date,
      epsActual: h.epsActual,
      epsEstimate: h.epsEstimate,
      revenueActual: revByFiscalQuarter.get(`${h.fiscalYear}-${h.fiscalPeriod}`) ?? null,
      revenueEstimate: null,
      session: sessionByDate.get(h.date) ?? null,
    }));
  if (fromHistory.length > 0) return fromHistory;

  // Docs synced before epsHistory existed still get dots from the calendar.
  return calendarEvents
    .filter(e => e.date <= todayIso && e.epsActual != null)
    .map(e => ({
      date: e.date,
      epsActual: e.epsActual,
      epsEstimate: e.epsEstimate,
      revenueActual: e.revenueActual ?? null,
      revenueEstimate: e.revenueEstimate ?? null,
      session: e.session ?? null,
    }));
}

/**
 * Positions earnings reports on a bar series by DATE.
 *
 * Replaces a marker drawn at `Math.round(n * 0.82)` — a hardcoded 82% of chart
 * width unrelated to any real reporting date, which still rendered a confident
 * "◆ ER" label. Exported so the placement rules below are directly testable.
 *
 * Rules: a report maps to the LAST bar at or before its date, so one filed on a
 * weekend or holiday lands on the preceding session instead of disappearing;
 * reports outside the loaded range are dropped rather than clamped to an edge
 * (clamping would assert a date the chart does not actually cover); and two
 * reports falling on the same bar keep only the first, since a monthly bar can
 * span a whole quarter and stacked dots are unclickable.
 */
export function mapEarningsToBars(
  bars: ReadonlyArray<{ t: number }>,
  earnings: ReadonlyArray<ChartEarnings>,
): Array<{ i: number; e: ChartEarnings }> {
  const n = bars.length;
  if (!earnings.length || n === 0) return [];
  const first = bars[0].t, last = bars[n - 1].t;
  const out: Array<{ i: number; e: ChartEarnings }> = [];
  const seen = new Set<number>();
  for (const e of earnings) {
    const t = Date.parse(`${e.date}T00:00:00Z`);
    if (!Number.isFinite(t) || t < first || t > last) continue;
    let idx = -1;
    for (let i = 0; i < n; i++) {
      if (bars[i].t <= t) idx = i; else break;
    }
    if (idx < 0 || seen.has(idx)) continue;
    seen.add(idx);
    out.push({ i: idx, e });
  }
  return out;
}

