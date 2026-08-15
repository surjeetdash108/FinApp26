/** Mirrors backend's `financials/{ticker}` doc (src/sync/financials.job.ts + src/live/ondemand.service.ts's getFinancials) — GET /live/financials?ticker=X. */
export interface QuarterFinancials {
  fiscalPeriod: string | null;
  fiscalYear: string | null;
  endDate: string | null;
  filingDate: string | null;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  epsActual: number | null;
  epsEstimate: number | null;
  costOfRevenue: number | null;
  operatingExpenses: number | null;
  researchAndDevelopment: number | null;
  sellingGeneralAndAdministrative: number | null;
  incomeTaxExpense: number | null;
  dilutedAverageShares: number | null;
  totalAssets: number | null;
  currentAssets: number | null;
  totalLiabilities: number | null;
  currentLiabilities: number | null;
  equity: number | null;
  inventory: number | null;
  longTermDebt: number | null;
  netCashFlow: number | null;
  operatingCashFlow: number | null;
  investingCashFlow: number | null;
  financingCashFlow: number | null;
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  currentRatio: number | null;
}

export interface AnnualFinancials {
  fiscalYear: string | null;
  endDate: string | null;
  filingDate: string | null;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  epsActual: number | null;
  netIncome: number | null;
}

/** Forward analyst estimate for a future fiscal year (the `*YYYY` rows). Only
 *  present when an estimates vendor (FMP) is wired; empty/absent otherwise. */
export interface AnnualEstimate {
  fiscalYear: string;
  epsEstimate: number | null;
  /** Raw dollars — divide by 1e6 for the "Sales (M)" column, like reported. */
  revenueEstimate: number | null;
}

export interface FinancialsDoc {
  ticker: string;
  quarters: QuarterFinancials[];
  annual: AnnualFinancials[];
  annualEstimates?: AnnualEstimate[];
}
