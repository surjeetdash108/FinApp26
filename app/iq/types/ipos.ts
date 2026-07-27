/** Mirrors backend's `ipos` collection (src/market-data/ipos.controller.ts) — GET /market-data/ipos. */
export interface IpoEventDoc {
  id: string;
  date: string;
  symbol: string | null;
  name: string;
  exchange: string | null;
  priceLow: number | null;
  priceHigh: number | null;
  status: "expected" | "priced" | "filed" | "withdrawn";
}
