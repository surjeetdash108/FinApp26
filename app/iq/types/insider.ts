/** Mirrors backend's `insider_transactions` collection (src/market-data/insider-transactions.controller.ts) — GET /market-data/insider-transactions. Source: SEC Form 4 filings (src/sync/sec-form4.job.ts). */
export interface InsiderTxDoc {
  id: string;
  ticker: string;
  issuerName: string | null;
  ownerName: string | null;
  isOfficer: boolean;
  officerTitle: string | null;
  transactionDate: string;
  transactionCode: string;
  acquiredOrDisposed: "A" | "D" | string;
  shares: number;
  pricePerShare: number | null;
}
