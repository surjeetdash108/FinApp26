/**
 * Mirrors backend's `news` collection doc (src/sync/news.job.ts writes it in
 * bulk; src/market-data/news.controller.ts serves the global recent feed —
 * GET /market-data/news — and src/live/ondemand.controller.ts serves the
 * per-ticker cache-aside fill — GET /live/news?ticker=X).
 */
export interface NewsArticleDoc {
  id: string;
  ticker: string;
  headline: string;
  summary: string | null;
  /** Publisher / outlet (e.g. "Reuters"). */
  source: string;
  /** Data vendor that delivered it — "polygon" | "fmp" (older docs omit it). */
  vendor?: string;
  url: string;
  category: string | null;
  sentiment: "positive" | "negative" | "neutral" | null;
  sentimentReasoning: string | null;
  keywords: string[];
  imageUrl: string | null;
  publishedAt: string;
  updatedAt: string;
}
