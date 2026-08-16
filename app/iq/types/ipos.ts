/** Mirrors backend's `ipos` collection (src/market-data/ipos.controller.ts) — GET /market-data/ipos. */
export interface IpoEventDoc {
  id: string;
  date: string;
  symbol: string | null;
  name: string;
  /** Sector from Polygon's ticker reference (SIC-derived), on the IPO doc since
   *  new listings aren't in the `companies` universe yet. Null when unknown. */
  sector?: string | null;
  exchange: string | null;
  priceLow: number | null;
  priceHigh: number | null;
  /** Midpoint offer price (offerPrice), and aftermarket performance computed by
   *  the ipos job from Polygon daily bars for already-listed names. Null when the
   *  name hasn't listed yet or Polygon has no series for it. */
  offerPrice: number | null;
  currentPrice: number | null;
  day1Close: number | null;
  day1PopPct: number | null;
  returnSinceIpoPct: number | null;
  numberOfShares: number | null;
  totalSharesValue: number | null;
  /** Raw Polygon status (e.g. "history", "new", "pending", "priced",
   *  "direct_listing_process", "withdrawn"). The UI maps it to a friendly label. */
  status: string;
}

/** Mirrors backend's `ipo_pipeline` collection (edgar-ipo-pipeline job) — GET /market-data/ipo-pipeline. Recent SEC-EDGAR S-1/424B registration filings. */
export interface IpoPipelineDoc {
  id: string;
  cik: string;
  companyName: string;
  form: string;
  dateFiled: string;
  accessionNumber: string;
  url: string;
}
