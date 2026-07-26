"use client";

import { useEffect, useState } from "react";
import type { OHLCBar } from "../utils";

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "").replace(/\/$/, "");

interface StoredBar {
  t: number; o: number; h: number; l: number; c: number; v: number; vw: number | null;
}
interface BarsResponse {
  ticker: string; tf: string; bars: StoredBar[]; source: string; asOf: string;
}

/**
 * Real OHLCV bars for one ticker+timeframe, via the backend's on-demand
 * cache-aside endpoint (`GET /live/bars`, see ondemand.service.ts in
 * MarketCatalystBackEnd). The first request for a given ticker+timeframe
 * costs one vendor call and seeds the shared Firestore `stock_bars` cache;
 * every request after that — from any user, any backend instance — is served
 * from that cache until it goes stale, so this hook is what actually grows
 * the data set as people browse, not a background job.
 *
 * Covers every timeframe the backend supports (1H/1D/1W/1M/3M/6M/1Y/5Y) —
 * the old Firestore-listener version only had real data for 3M/6M/1Y.
 * Returns undefined while loading, when NEXT_PUBLIC_BACKEND_URL isn't
 * configured, or when the fetch fails, so callers fall back to the
 * simulated generator.
 */
function keyOf(sym: string, tf: string): string {
  return `${sym}_${tf}`;
}

export function useOhlcvBars(sym: string, tf: string): OHLCBar[] | undefined {
  // Keyed by sym+tf so a still-loading ticker/timeframe change never renders
  // the PREVIOUS ticker's bars under the new axis — the mismatch is detected
  // at render time below instead of an imperative reset inside the effect.
  const [result, setResult] = useState<{ key: string; bars: OHLCBar[] } | null>(null);

  useEffect(() => {
    if (!BACKEND_URL || !sym || !tf) return;

    let cancelled = false;
    const key = keyOf(sym, tf);
    const url = `${BACKEND_URL}/live/bars?ticker=${encodeURIComponent(sym)}&tf=${encodeURIComponent(tf)}`;
    fetch(url)
      .then((res) => (res.ok ? (res.json() as Promise<BarsResponse>) : Promise.reject(new Error(`${res.status}`))))
      .then((data) => {
        if (cancelled) return;
        setResult({ key, bars: data.bars.map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })) });
      })
      .catch((err) => {
        if (!cancelled) console.error(`/live/bars failed for ${sym} ${tf}:`, err);
      });
    return () => {
      cancelled = true;
    };
  }, [sym, tf]);

  if (!result || result.key !== keyOf(sym, tf)) return undefined;
  return result.bars.length > 1 ? result.bars : undefined;
}
