export type TapeKind = "index" | "stock" | "rate";

/** Mirrors backend TapeItem (src/live/tape.service.ts) — one tile in the header ticker tape. */
export interface TapeItem {
  id: string;
  kind: TapeKind;
  label: string;
  name: string | null;
  proxyTicker: string | null;
  isProxy: boolean;
  note: string | null;
  unit?: "percent";
  value: number | null;
  change: number | null;
  pctChange: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  prevClose: number | null;
}

/** Mirrors backend TapeFrame — the payload broadcast over GET /live/tape/stream. */
export interface TapeFrame {
  items: TapeItem[];
  asOf: string;
  vendorDelayNote: string;
  marketPhase: "open" | "pre" | "after" | "closed" | "unknown";
  stale: boolean;
}
