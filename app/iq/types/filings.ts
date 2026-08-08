/** Mirrors backend's `filings_wire` collection (edgar-8k job) — GET /market-data/filings-wire. Recent SEC-EDGAR 8-K filings as a filings newswire. */
export interface FilingsWireDoc {
  id: string;
  ticker: string;
  companyName: string;
  form: string;
  filingDate: string;
  announceDate: string;
  acceptanceDateTime: string | null;
  items: string | null;
  session: "BMO" | "AMC" | "Intraday" | null;
  isEarnings: boolean;
  description: string;
  url: string;
}
