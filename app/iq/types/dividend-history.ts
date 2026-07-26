/** Mirrors backend's `dividend_history/{ticker}` doc (src/live/ondemand.service.ts's getDividendHistory) — GET /live/dividend-history?ticker=X. */
export interface DividendHistoryDoc {
  ticker: string;
  history: Array<{
    exDividendDate: string | null;
    paymentDate: string | null;
    declarationDate: string | null;
    recordDate: string | null;
    amount: number;
    dividendType: string | null;
    frequency: number | null;
  }>;
  annualTotals: Array<{ year: number; total: number; payments: number }>;
  ttmTotal: number | null;
  ttmPayments: number;
  yieldPct: number | null;
  yieldBasisPrice: number | null;
  cagr5yPct: number | null;
  increaseStreakYears: number;
  frequency: number | null;
  isPayer: boolean;
  source: string;
}
