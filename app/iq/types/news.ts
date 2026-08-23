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
  /** Feed bucket derived at ingest by news-category.util (Earnings, Analyst
   *  Actions, M&A, Legal & Regulatory, Product & Launches, Capital &
   *  Dividends, Other). Older docs written before tagging may omit it. */
  tag?: "earnings" | "analyst" | "ma" | "legal" | "product" | "capital" | "other";
  /** Syndicated 13F/listicle noise, flagged at ingest by news-filler.util.
   *  Hidden by default in the feed; the rows are kept, not dropped. */
  filler?: boolean;
  sentiment: "positive" | "negative" | "neutral" | null;
  sentimentReasoning: string | null;
  keywords: string[];
  imageUrl: string | null;
  publishedAt: string;
  updatedAt: string;
}

/**
 * Feed category chips, in display order. Mirrors NEWS_CATEGORY_ORDER /
 * NEWS_CATEGORY_LABEL in the backend's news-category.util — the tags are
 * written at ingest, so the two lists must stay in step. "Other" is last.
 */
export const NEWS_TAGS: Array<{ key: string; label: string }> = [
  { key: "earnings", label: "Earnings" },
  { key: "analyst",  label: "Analyst Actions" },
  { key: "ma",       label: "M&A" },
  { key: "legal",    label: "Legal & Regulatory" },
  { key: "product",  label: "Product & Launches" },
  { key: "capital",  label: "Capital & Dividends" },
  { key: "other",    label: "Other" },
];
