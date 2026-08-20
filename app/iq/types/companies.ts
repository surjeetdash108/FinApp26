/**
 * Mirrors backend's `companies` collection (src/market-data/companies.controller.ts)
 * — GET /market-data/companies. Union of every field a screen reads off this
 * doc today (Heatmap/Themes: price/pctChange/marketCap/name; Movers: rvol;
 * Screener: peRatio, rsRating, techRating, revenueGrowthYoY, epsGrowthYoY,
 * grossMargin; Stock Detail: dividendYield, beta, sector, rsi14, macd fields,
 * sectorRank fields, source) — one shared type instead of each screen
 * redefining an overlapping subset locally.
 */
/** Classic pivot support/resistance levels (technical-indicators.job). */
export interface PivotLevels {
  pivot: number | null;
  r1: number | null;
  r2: number | null;
  r3: number | null;
  s1: number | null;
  s2: number | null;
  s3: number | null;
}

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
  // Latest reported EPS (eps) and trailing-twelve-month EPS (epsTtm), written
  // by /live/company (ondemand.service). Absent on bulk-synced docs.
  eps?: number | null;
  epsTtm?: number | null;
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
  // FMP profile industry (e.g. "Consumer Electronics") when FMP is wired,
  // else the Polygon SIC description. Shown next to Sector on the detail page.
  industry: string | null;
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
  sma50?: number | null;
  sma200?: number | null;
  // Support/resistance — classic pivot points computed from prior daily and
  // prior-complete-weekly bars (technical-indicators.job).
  keyLevels?: {
    daily?: PivotLevels | null;
    weekly?: PivotLevels | null;
  } | null;
  // More technicals from technical-indicators.job: true 5-session change,
  // Stochastic %K, Wilder ADX(14). beta (above) is now computed there too.
  week5ChangePct?: number | null;
  stochK?: number | null;
  adx14?: number | null;
  /** Annualized 30-day realized volatility (%) — the Macro "30d Vol" column. */
  realizedVol30?: number | null;
  // FMP 13F institutional-ownership rollup (stock-detail Institutional card).
  /** % of shares outstanding held by 13F institutions (0-100). */
  instOwnershipPct?: number | null;
  /** Number of institutions holding (13F filers). */
  inst13FHolders?: number | null;
  /** QoQ change in holder count. */
  inst13FHoldersChange?: number | null;
  inst13FShares?: number | null;
  inst13FSharesChange?: number | null;
  instTotalInvested?: number | null;
  instPutCallRatio?: number | null;
  /** Rollup period, e.g. "Q1 2026". */
  instAsOf?: string | null;
  // Sector rank from tech-rating.job; source records which vendor served the profile.
  sectorRank: number | null;
  sectorRankTotal: number | null;
  // Real related companies from Polygon /v1/related-companies (AAPL → MSFT,
  // AMZN, GOOGL, NVDA…) — algorithmic peers, not just same-sector.
  peers: string[] | null;
  source: string | null;
}
