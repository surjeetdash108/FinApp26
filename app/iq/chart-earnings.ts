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

