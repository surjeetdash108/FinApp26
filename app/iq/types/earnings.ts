/** Mirrors backend's `earnings_events` collection (src/market-data/earnings.controller.ts) — GET /market-data/earnings. */
/** Mirrors backend's `earnings_announcements` (edgar-8k job) — GET /market-data/earnings-announcements. 8-K item-2.02 announcements with session + price reaction. */
export interface EarningsAnnouncementDoc {
  id: string;
  ticker: string;
  companyName: string;
  announceDate: string;
  session: "BMO" | "AMC" | "Intraday" | null;
  reactionPct: number | null;
  accessionNumber: string;
  url: string;
}

export interface LiveEarningsDoc {
  id: string;
  ticker: string;
  /** Company name from Polygon financials; falls back to the ticker in the UI. */
  companyName?: string | null;
  /** Reporting date = SEC filing date (Polygon has no announcement feed). */
  date: string;
  /** Reporting session when a vendor supplies it; null for the Polygon feed. */
  session?: "BMO" | "AMC" | null;
  /** Estimates are null on the Polygon feed (actuals only, no beat/miss). */
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate?: number | null;
  revenueActual?: number | null;
  /** Same fiscal quarter, prior year — drives the "1 Year Ago" EPS and
   *  "Yr/Yr Rev" columns of the at-a-glance snapshot. Null when no year-ago
   *  quarter is on file (e.g. newly-listed names, or an upcoming report). */
  epsActualYearAgo?: number | null;
  revenueYearAgo?: number | null;
}
