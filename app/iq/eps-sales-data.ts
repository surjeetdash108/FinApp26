/**
 * Shared EPS/Sales table + chart data derivations.
 *
 * These lived as near-verbatim copies in BOTH `eps-sales-widget.tsx` (rendered
 * by the Earnings screen) and `screens/stock.tsx` (the stock detail's Financials
 * card), and had already drifted: the stock copy labelled quarters by period-end
 * month ("Mar 26") instead of the fiscal quarter ("Q3 2026"), and lacked the
 * estimate column entirely — so the same quarter read differently depending on
 * which screen you opened. One definition, imported by both.
 *
 * Note: `MetricBars` is deliberately NOT shared — the two screens size that
 * chart differently on purpose (viewBox/padding/title), which is a real design
 * difference rather than drift.
 */
import type {
  FinancialsDoc,
  AnnualFinancials,
  QuarterFinancials,
  EpsHistoryRow,
} from "./types";
import {
  reportedQuarterEps,
  quarterEpsSurprisePct,
  reportedAnnualEps,
  estimatedAnnualEps,
  surprisePct,
} from "./types";

/** "+12%" / "-4%" / "—" — rounded YoY %change, blank when either side is missing. */
export function pctChangeStr(
  curr: number | null | undefined,
  prev: number | null | undefined,
): string {
  if (curr == null || prev == null || Math.abs(prev) < 0.05) return "—";
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  // Near-zero base (spin-off / first reporting period) → meaningless four-digit %.
  if (Math.abs(pct) > 1000) return "—";
  return `${pct >= 0 ? "+" : ""}${Math.round(pct)}%`;
}

/** Signed, rounded percentage for a surprise cell, or "—" when null. */
function pctCell(v: number | null): string {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${Math.round(v)}%`;
}

export type EpsSalesPt = { label: string; eps: number | null; sales: number | null };

export type AnnualRow = {
  year: string;
  eps: number | null;
  epsEst: number | null;
  epsChg: string;
  epsSurp: string;
  sales: number | null;
  salesChg: string;
};

export type QuarterRow = {
  label: string;
  eps: number | null;
  epsEst: number | null;
  epsChg: string;
  epsSurp: string;
  sales: number | null;
  salesChg: string;
  salesSurp: string;
};

/** EPS + Sales(M) per period, oldest→newest, for the dual bar charts. Actuals only. */
export function epsSalesSeries(
  period: "Q" | "A",
  doc: FinancialsDoc | null,
): EpsSalesPt[] {
  if (!doc) return [];
  if (period === "Q") {
    return [...doc.quarters]
      .filter(r => r.endDate)
      .sort((a, b) => (a.endDate as string).localeCompare(b.endDate as string))
      .slice(-12)
      .map(r => ({
        label: new Date(r.endDate + "T00:00:00")
          .toLocaleDateString("en-US", { month: "short", year: "2-digit" })
          .replace(" ", "-"),
        eps: reportedQuarterEps(r),
        sales: r.revenue != null ? r.revenue / 1e6 : null,
      }));
  }
  return [...doc.annual]
    .filter(r => r.fiscalYear)
    .sort((a, b) => Number(a.fiscalYear) - Number(b.fiscalYear))
    .slice(-10)
    .map(r => ({
      label: r.fiscalYear as string,
      eps: reportedAnnualEps(r.fiscalYear, doc.epsHistory, r.epsActual),
      sales: r.revenue != null ? r.revenue / 1e6 : null,
    }));
}

/** One row per reported fiscal year, oldest first, with EPS/Sales YoY %change
 *  and the derived full-year estimate + surprise. */
export function annualEpsSalesRows(
  annual: AnnualFinancials[],
  epsHistory: EpsHistoryRow[],
): AnnualRow[] {
  const asc = [...annual]
    .filter(r => r.fiscalYear)
    .sort((a, b) => Number(a.fiscalYear) - Number(b.fiscalYear));
  return asc.map((r, i) => {
    const prev = i > 0 ? asc[i - 1] : null;
    // Non-GAAP annual EPS (summed reported quarters from the deep FMP history,
    // matches IBD/NASDAQ); GAAP fallback when a year isn't fully covered.
    const eps = reportedAnnualEps(r.fiscalYear, epsHistory, r.epsActual);
    const prevEps = prev
      ? reportedAnnualEps(prev.fiscalYear, epsHistory, prev.epsActual)
      : null;
    const epsEst = estimatedAnnualEps(r.fiscalYear, epsHistory);
    const surp = surprisePct(eps, epsEst);
    return {
      year: r.fiscalYear as string,
      eps,
      epsEst,
      epsChg: pctChangeStr(eps, prevEps),
      epsSurp: pctCell(surp),
      sales: r.revenue != null ? r.revenue / 1e6 : null,
      salesChg: pctChangeStr(r.revenue, prev?.revenue),
    };
  });
}

/** One row per reported quarter, oldest first. %chg is YoY (4 back); %surp is
 *  actual-vs-estimate on the FMP consensus (non-GAAP) basis. Sales has no
 *  estimate feed, so its surprise column stays "—" rather than fabricated. */
export function quarterlyEpsSalesRows(
  quarters: QuarterFinancials[],
): QuarterRow[] {
  const asc = [...quarters]
    .filter(r => r.endDate)
    .sort((a, b) => (a.endDate as string).localeCompare(b.endDate as string));
  return asc.map((r, i) => {
    const yoy = i >= 4 ? asc[i - 4] : null;
    const eps = reportedQuarterEps(r);
    return {
      // Always show fiscal quarter + year (e.g. "Q3 2026"); fall back to the
      // period-end month/year only when the fiscal labels are missing.
      label:
        r.fiscalPeriod && r.fiscalYear
          ? `${r.fiscalPeriod} ${r.fiscalYear}`
          : new Date(r.endDate + "T00:00:00").toLocaleDateString("en-US", {
              month: "short",
              year: "2-digit",
            }),
      eps,
      epsEst: r.epsEstimateReported ?? null,
      epsChg: pctChangeStr(eps, yoy ? reportedQuarterEps(yoy) : null),
      epsSurp: pctCell(quarterEpsSurprisePct(r)),
      sales: r.revenue != null ? r.revenue / 1e6 : null,
      salesChg: pctChangeStr(r.revenue, yoy?.revenue),
      salesSurp: "—",
    };
  });
}
