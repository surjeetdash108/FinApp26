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
  // Polygon company profile blurb + IR homepage (from /v3/reference/tickers),
  // populated on-demand by /live/company. Absent on bulk-synced docs.
  description?: string | null;
  homepageUrl?: string | null;
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
  // Price vs 50/200-day SMA, precomputed by technical-indicators.job so the
  // screener can filter without refetching bars.
  aboveSma50?: boolean | null;
  aboveSma200?: boolean | null;
  // Rolling 52-week high/low from technical-indicators.job — lets the recap
  // count new highs/lows without a dedicated breadth job.
  high52?: number | null;
  low52?: number | null;
  // Sector rank from tech-rating.job; source records which vendor served the profile.
  sectorRank: number | null;
  sectorRankTotal: number | null;
  // Real related companies from Polygon /v1/related-companies (AAPL → MSFT,
  // AMZN, GOOGL, NVDA…) — algorithmic peers, not just same-sector.
  peers: string[] | null;
  source: string | null;
}
