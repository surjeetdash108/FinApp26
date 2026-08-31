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
import { fmtDate } from "./calendar-range";

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
/**
 * The reported-EPS history shaped like QuarterFinancials, for issuers whose
 * SEC-derived `quarters` series is empty.
 *
 * Not every listed company files a 10-Q. A foreign private issuer files 20-F /
 * 6-K and typically reports SEMI-ANNUALLY, so Polygon's quarterly series is
 * legitimately empty for it and always will be — GFI (Gold Fields) is one:
 * `quarters` and `annual` both return 0 rows while FMP's epsHistory carries 39
 * reported periods back to 2007, only ever Q1 and Q3. The screens read
 * `quarters`, so all of that was thrown away and the card claimed nothing was
 * "synced yet".
 *
 * Revenue is genuinely absent from this source, so `sales` stays null rather
 * than being invented — the EPS side populates and the Sales side honestly
 * shows nothing.
 */
export function quartersFromEpsHistory(epsHistory: EpsHistoryRow[]): QuarterFinancials[] {
  return epsHistory
    .filter(h => h.epsActual != null && h.date)
    .map(h => ({
      fiscalPeriod: h.fiscalPeriod ?? null,
      fiscalYear: h.fiscalYear != null ? String(h.fiscalYear) : null,
      // The REPORT date, not the period end — the only date this source has.
      // It orders and labels correctly, which is all these builders need.
      endDate: h.date,
      filingDate: h.date,
      revenue: null,
      grossProfit: null, operatingIncome: null, netIncome: null,
      epsActual: h.epsActual,
      epsEstimate: h.epsEstimate,
      epsActualReported: h.epsActual,
      epsEstimateReported: h.epsEstimate,
      costOfRevenue: null, operatingExpenses: null, researchAndDevelopment: null,
      sellingGeneralAndAdministrative: null, incomeTaxExpense: null,
      dilutedAverageShares: null, totalAssets: null, currentAssets: null,
      totalLiabilities: null, currentLiabilities: null, equity: null, inventory: null,
      // Every remaining statement field is listed rather than cast away, so
      // adding one to QuarterFinancials fails the build here instead of
      // silently arriving as undefined.
      longTermDebt: null, netCashFlow: null, operatingCashFlow: null,
      investingCashFlow: null, financingCashFlow: null,
      grossMarginPct: null, operatingMarginPct: null, netMarginPct: null,
      currentRatio: null,
    }));
}

/** `quarters` when the filer publishes them, else the reported-EPS history. */
function quarterSource(doc: FinancialsDoc): QuarterFinancials[] {
  return doc.quarters.length > 0
    ? doc.quarters
    : quartersFromEpsHistory(doc.epsHistory ?? []);
}

export function epsSalesSeries(
  period: "Q" | "A",
  doc: FinancialsDoc | null,
): EpsSalesPt[] {
  if (!doc) return [];
  if (period === "Q") {
    return [...quarterSource(doc)]
      .filter(r => r.endDate)
      .sort((a, b) => (a.endDate as string).localeCompare(b.endDate as string))
      .slice(-12)
      .map(r => ({
        label: fmtDate(r.endDate, { month: "short", year: "2-digit" }).replace(" ", "-"),
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
  /** Used only when `quarters` is empty — see quartersFromEpsHistory. */
  epsHistory: EpsHistoryRow[] = [],
): QuarterRow[] {
  const src = quarters.length > 0 ? quarters : quartersFromEpsHistory(epsHistory);
  const asc = [...src]
    .filter(r => r.endDate)
    .sort((a, b) => (a.endDate as string).localeCompare(b.endDate as string));

  // Year-ago comparison matched on FISCAL LABELS, not by stepping back four
  // rows. "Four back" assumes four filings a year, which is two YEARS back for
  // a semi-annual reporter — GFI files only Q1 and Q3, so its %chg column was
  // comparing across two years while calling it year-on-year. Positional
  // stepping is kept only for rows with no fiscal labels to match on.
  const byPeriod = new Map<string, QuarterFinancials>();
  for (const r of asc) {
    if (r.fiscalPeriod && r.fiscalYear) byPeriod.set(`${r.fiscalYear}-${r.fiscalPeriod}`, r);
  }
  const yearAgoOf = (r: QuarterFinancials, i: number): QuarterFinancials | null => {
    if (r.fiscalPeriod && r.fiscalYear) {
      const prevYear = Number(r.fiscalYear) - 1;
      return byPeriod.get(`${prevYear}-${r.fiscalPeriod}`) ?? null;
    }
    return i >= 4 ? asc[i - 4] : null;
  };

  return asc.map((r, i) => {
    const yoy = yearAgoOf(r, i);
    const eps = reportedQuarterEps(r);
    return {
      // Always show fiscal quarter + year (e.g. "Q3 2026"); fall back to the
      // period-end month/year only when the fiscal labels are missing.
      label:
        r.fiscalPeriod && r.fiscalYear
          ? `${r.fiscalPeriod} ${r.fiscalYear}`
          : fmtDate(r.endDate, { month: "short", year: "2-digit" }),
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
