/** Mirrors backend's `splits/{ticker}` doc (src/live/ondemand.service.ts's getSplits) — GET /live/splits?ticker=X. */
export interface SplitsDoc {
  ticker: string;
  splits: Array<{ executionDate: string; splitFrom: number; splitTo: number }>;
  latestSplit: { executionDate: string; splitFrom: number; splitTo: number } | null;
  source: string;
}
