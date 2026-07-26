/** Mirrors backend's `users/{uid}/portfolios/default/holdings/{ticker}` doc (src/user-data/portfolio.controller.ts) — GET/POST/DELETE /api/portfolio. */
export interface HoldingDoc {
  id: string;
  ticker: string;
  shares: number;
  positionSize: "Small" | "Medium" | "Large";
  conviction: "High" | "Medium" | "Low";
}
