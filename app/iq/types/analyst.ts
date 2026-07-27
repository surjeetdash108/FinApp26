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
}
