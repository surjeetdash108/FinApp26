/** Mirrors backend's `sectors` collection (src/market-data/sectors.controller.ts) — GET /market-data/sectors. */
export interface SectorApiDoc {
  id: string;
  sector: string;
  pctChange: number;
}
