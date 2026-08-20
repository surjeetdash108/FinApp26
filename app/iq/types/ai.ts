// AI analysis docs served by GET /live/ai-analysis?ticker= (backend
// ai_technical_analysis collection). The read synthesises the technical
// indicators AND the news; `ok:false` marks a failed / disabled generation.

export interface AiVolatility {
  flag: "elevated" | "normal" | "low" | string;
  note: string;
}
export interface AiMomentum {
  state: "up" | "down" | "bear-market" | string;
  note: string;
}

export interface AiStockAnalysis {
  headline: string | null;
  volatility: AiVolatility | null;
  momentum: AiMomentum | null;
  newsSummary: string | null;
  technicalSummary: string | null;
}

export interface AiAnalysisDoc {
  ticker: string;
  ok: boolean;
  model: string;
  usedWebSearch: boolean;
  newsCount: number;
  sourcesUsed: string[];
  analysis: AiStockAnalysis | null;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** One flag+note pair inside an aggregate read. */
export interface AiAggFlag {
  flag: string | null;
  note: string | null;
}

/** Cumulative AI read across a whole basket (portfolio or one watchlist).
 *  Mirrors the docs written to `ai_portfolio_analysis` / `ai_watchlist_analysis`
 *  by AiAnalysisService. */
export interface AiAggregateDoc {
  kind: "portfolio" | "watchlist";
  ok: boolean;
  model: string;
  /** Fingerprint of the basket's members — changes invalidate the cache. */
  composition: string;
  memberCount: number;
  /** How many members contributed their own cached per-stock AI read. */
  reusedStockReads?: number;
  analysis: {
    headline: string | null;
    posture: AiAggFlag | null;
    concentration: AiAggFlag | null;
    leaders: string | null;
    laggards: string | null;
    watchItems: string | null;
  } | null;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
