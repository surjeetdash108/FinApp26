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
  /** Consensus estimate — present on FMP economic-calendar events, null on FRED. */
  estimate?: number | null;
  /** Country code — "US" on FMP economic events. */
  country?: string;
  source: string;
}
