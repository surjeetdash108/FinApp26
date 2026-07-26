/** Mirrors backend's `macro_events` collection (src/market-data/macro-events.controller.ts) — GET /market-data/macro-events. */
export interface MacroEventDoc {
  id: string;
  name: string;
  seriesId: string;
  unit: string;
  importance: "high" | "medium" | "low";
  eventDate: string;
  actual: number | null;
  previous: number | null;
  source: string;
}

/** Mirrors backend's `dividends` collection (src/market-data/dividends.controller.ts) — GET /market-data/dividends. */
export interface DividendDoc {
  id: string;
  ticker: string;
  exDividendDate: string;
  paymentDate: string | null;
  dividendAmount: number;
  yieldPct: number | null;
  frequency: string | null;
}
