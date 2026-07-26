"use client";

import { useEffect, useState } from "react";

export interface TickerSearchResult {
  ticker: string;
  name: string | null;
  price: number | null;
  pctChange: number | null;
}

/**
 * Ticker/company-name search — ON-DEMAND redesign (2026-07-24).
 *
 * Queries `GET /live/search?q=` — an in-memory index over the full ~10k-ticker
 * Polygon reference universe held by the backend, refreshed daily. This
 * replaced the Firestore `tickers` collection (10k docs synced nightly, three
 * range queries per keystroke per user): search now costs ZERO Firestore reads
 * and even matches mid-word substrings ("oogle" → Alphabet), which Firestore
 * prefix ranges never could.
 *
 * Prices are not part of the search response — the dropdown overlays live
 * delayed prices via useLivePrices exactly as before.
 */

const DEBOUNCE_MS = 200;
import { API_BASE } from "../backend";
const BACKEND = API_BASE;

export function useTickerSearch(rawQuery: string): TickerSearchResult[] {
  const [results, setResults] = useState<TickerSearchResult[]>([]);

  useEffect(() => {
    const trimmed = rawQuery.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    let alive = true;
    const handle = setTimeout(() => {
      fetch(`${BACKEND}/live/search?q=${encodeURIComponent(trimmed)}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((body: { results?: Array<{ ticker: string; name: string | null }> }) => {
          if (!alive) return;
          setResults(
            (body.results ?? []).map((r) => ({
              ticker: r.ticker,
              name: r.name,
              price: null,
              pctChange: null,
            })),
          );
        })
        .catch((err) => {
          console.error(`Ticker search failed for "${trimmed}":`, err);
          if (alive) setResults([]);
        });
    }, DEBOUNCE_MS);

    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [rawQuery]);

  return results;
}
