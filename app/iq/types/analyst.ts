/** One per-firm rating change (FMP grades). */
export interface AnalystRatingChange {
  date: string;
  firm: string | null;
  previousGrade: string | null;
  newGrade: string | null;
  action: string | null; // upgrade | downgrade | initiate | maintain
  /** This firm's own price target (FMP price-target-news). null when the firm
   * posted none — NOT the ticker consensus, so rows aren't all identical. */
  priceTarget?: number | null;
}

/** Mirrors backend's `analyst_actions` collection (src/market-data/analyst-actions.controller.ts) — GET /market-data/analyst-actions. */
export interface AnalystConsensusDoc {
  id: string;
  ticker: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  consensus: string;
  // ── Price target (12-mo, across firms) — FMP ──
  priceTargetConsensus?: number | null;
  priceTargetHigh?: number | null;
  priceTargetLow?: number | null;
  priceTargetMedian?: number | null;
  // ── Price-target trend (rolling averages) — FMP ──
  ptAvgLastMonth?: number | null;
  ptAvgLastQuarter?: number | null;
  ptAvgLastYear?: number | null;
  // ── Recent per-firm rating changes — FMP ──
  recentGrades?: AnalystRatingChange[];
}
