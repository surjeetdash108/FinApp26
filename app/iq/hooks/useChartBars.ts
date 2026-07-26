"use client";

import { useEffect, useState } from "react";
import type { OHLCBar } from "../utils";

/**
 * Real bars for every chart timeframe — ON-DEMAND (2026-07-24 redesign).
 *
 * Bars come from `GET /live/bars?ticker&tf` instead of direct Firestore reads.
 * The backend is a cache-aside layer: Firestore `stock_bars/{T}_{resolution}`
 * docs (single doc per resolution family, `createdAt` + TTL) backed by one
 * coalesced Polygon call on miss. First user of a ticker pays one vendor call;
 * everyone after reads the shared cache. Responses carry Cache-Control +
 * ETag, so the BROWSER also caches — repeat views inside a minute cost zero
 * network. Firestore is never read from the client for bars anymore.
 *
 * Timeframes: 1H (new) · 1D · 1W · 1M · 3M · 6M · 1Y · 5Y.
 * On any failure the hook returns undefined and the chart renders its honest
 * empty state — it never fabricates bars.
 */

import { API_BASE } from "../backend";
const BACKEND = API_BASE;

export const BAR_TFS = ["1H", "1D", "1W", "1M", "3M", "6M", "1Y", "5Y"] as const;

interface WireBar {
  t: number; o: number; h: number; l: number; c: number; v: number; vw: number | null;
}

/** Module-level cache + inflight dedupe: N chart mounts share one fetch. */
const cache = new Map<string, { bars: OHLCBar[]; at: number }>();
const inflight = new Map<string, Promise<OHLCBar[]>>();
const CACHE_MS = 60_000;

/** Resolves to [] when the fetch completes with no usable bars (vs. undefined,
 *  which the HOOK uses to mean "still fetching" so the chart shows a spinner). */
async function fetchBars(sym: string, tf: string): Promise<OHLCBar[]> {
  const key = `${sym}_${tf}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.bars;
  const running = inflight.get(key);
  if (running) return running;

  const p = (async () => {
    try {
      const res = await fetch(
        `${BACKEND}/live/bars?ticker=${encodeURIComponent(sym)}&tf=${encodeURIComponent(tf)}`,
      );
      if (!res.ok) return [];
      const body = (await res.json()) as { bars?: WireBar[] };
      const bars: OHLCBar[] = (body.bars ?? []).map((b) => ({
        o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
      }));
      if (bars.length < 2) return [];
      cache.set(key, { bars, at: Date.now() });
      return bars;
    } catch {
      return []; // network/backend down → chart shows its honest empty state
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/**
 * undefined → fetch in flight (chart renders a spinner) ·
 * []        → resolved, no data (chart renders its honest empty state) ·
 * bars      → plot them.
 */
export function useChartBars(sym: string, tf: string): OHLCBar[] | undefined {
  const [bars, setBars] = useState<OHLCBar[] | undefined>(undefined);

  useEffect(() => {
    if (!sym || !(BAR_TFS as readonly string[]).includes(tf)) {
      setBars([]);
      return;
    }
    let alive = true;
    setBars(undefined); // spinner while the on-demand fetch runs
    void fetchBars(sym.toUpperCase(), tf).then((b) => {
      if (alive) setBars(b);
    });
    return () => { alive = false; };
  }, [sym, tf]);

  return bars;
}

/** True when this timeframe is served by real bars — for the "live data" badge. */
export function isRealBarTimeframe(tf: string): boolean {
  return (BAR_TFS as readonly string[]).includes(tf);
}
