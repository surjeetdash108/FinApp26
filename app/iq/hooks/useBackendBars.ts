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
export function useBackendBars(sym: string, tf: string): OHLCBar[] | undefined {
  const { data } = useApiResource<BarsResponse>(`/live/bars?ticker=${encodeURIComponent(sym)}&tf=${tf}`);
  if (!data || data.bars.length < 2) return undefined;
  return data.bars.map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
}
