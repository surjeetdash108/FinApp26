"use client";

import type { OHLCBar } from "../utils";
import { useApiResource } from "./useApiResource";

interface BarsResponse {
  ticker: string;
  tf: string;
  bars: Array<{ t: number; o: number; h: number; l: number; c: number; v: number; vw: number | null }>;
  source: "memory" | "firestore" | "vendor";
  asOf: string;
}

/**
 * Real OHLCV bars for one ticker+timeframe via GET /live/bars — replaces the
 * Firestore ohlcv_bars query useOhlcvBars() used to run. Covers all 7 chart
 * timeframes (the old hook only ever had real data for 3M/6M/1Y; 1D/1W/1M/5Y
 * always fell back to the synthetic generator).
 */
export function useBackendBars(
  sym: string,
  tf: string,
): { bars: OHLCBar[] | undefined; loading: boolean; asOf?: string; source?: BarsResponse["source"] } {
  const { data, loading } = useApiResource<BarsResponse>(`/live/bars?ticker=${encodeURIComponent(sym)}&tf=${tf}`);
  const bars = !data || data.bars.length < 2
    ? undefined
    : data.bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
  // Surface the backend's freshness stamp (createdAt) and serving tier additively
  // (BUG-DATA-008); existing call sites destructure only { bars, loading } and
  // are unaffected.
  return { bars, loading, asOf: data?.asOf, source: data?.source };
}
