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
