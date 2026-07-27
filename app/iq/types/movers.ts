/** Mirrors backend's `market_movers` collection (src/market-data/market-movers.controller.ts) — GET /market-data/movers. */
export interface LiveMoverDoc {
  id: string;
  ticker: string;
  name: string | null;
  price: number;
  pctChange: number;
  volume: number;
  sector: string | null;
  cap: string | null;
  direction: "gainer" | "loser";
  asOfDate: string;
}
