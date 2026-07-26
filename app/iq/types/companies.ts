/**
 * Mirrors backend's `companies` collection (src/market-data/companies.controller.ts)
 * — GET /market-data/companies. Union of every field a screen reads off this
 * doc today (Heatmap/Themes: price/pctChange/marketCap/name; Movers: rvol;
 * Screener: peRatio, rsRating, techRating, revenueGrowthYoY, epsGrowthYoY,
 * grossMargin; Stock Detail: dividendYield, beta, sector, rsi14, macd fields,
 * sectorRank fields, source) — one shared type instead of each screen
 * redefining an overlapping subset locally.
 */
export interface CompanyDoc {
  id: string;
  ticker: string;
  name: string | null;
  price: number | null;
  pctChange: number | null;
  marketCap: number | null;
  rvol?: number | null;
  peRatio: number | null;
  // 1-99 composite scores from rs-rating.job/tech-rating.job — null until
  // those jobs have run for this ticker.
  rsRating: number | null;
  techRating: number | null;
  // Decimals (0.064 = 6.4%) from fundamentals-growth.job.
  revenueGrowthYoY: number | null;
  epsGrowthYoY: number | null;
  grossMargin: number | null;
  dividendYield: number | null;
  beta: number | null;
  sector: string | null;
  // Real technicals from technical-indicators.job (null until it has run).
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  // Sector rank from tech-rating.job; source records which vendor served the profile.
  sectorRank: number | null;
  sectorRankTotal: number | null;
  source: string | null;
}
