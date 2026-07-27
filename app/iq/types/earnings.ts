/** Mirrors backend's `earnings_events` collection (src/market-data/earnings.controller.ts) — GET /market-data/earnings. */
export interface LiveEarningsDoc {
  id: string;
  ticker: string;
  date: string;
  epsEstimate: number | null;
  epsActual: number | null;
}
