/** Mirrors backend's `market_sentiment` collection (src/market-data/market-sentiment.controller.ts) — GET /market-data/market-sentiment. Currently only the `fear_greed` doc exists. */
export interface MarketSentimentDoc {
  id: string;
  value?: number;
  label?: string;
}

/** Mirrors `market_sentiment_history/{date}` — GET /market-data/market-sentiment-history. One composite Fear & Greed value per past trading day. */
export interface MarketSentimentHistoryDoc {
  id: string; // date, YYYY-MM-DD
  value?: number;
  label?: string;
  asOfDate?: string;
}
