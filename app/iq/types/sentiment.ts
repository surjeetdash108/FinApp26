/** Mirrors backend's `market_sentiment` collection (src/market-data/market-sentiment.controller.ts) — GET /market-data/market-sentiment. Currently only the `fear_greed` doc exists. */
export interface MarketSentimentDoc {
  id: string;
  value?: number;
  label?: string;
}
