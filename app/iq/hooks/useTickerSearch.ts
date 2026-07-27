"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../backend";

export interface TickerSearchResult {
  ticker: string;
  name: string | null;
  price: number | null;
  pctChange: number | null;
}

interface SearchResponse {
  q: string;
  results: Array<{ ticker: string; name: string | null }>;
}

const DEBOUNCE_MS = 200;

/**
 * On-demand ticker search via GET /live/search — an in-memory ~10,000-ticker
 * universe (src/live/ticker-search.service.ts), zero Firestore reads.
 * Replaces three parallel Firestore prefix-range queries against the
 * `tickers` collection (ticker prefix, nameLower prefix, searchTokens
 * array-contains).
 *
 * The backend's in-memory universe carries no live quote, so `price`/
 * `pctChange` are always null here — callers already handle that gracefully
 * (shell.tsx's curated fallback list has never had a price either).
 */
export function useTickerSearch(rawQuery: string): TickerSearchResult[] {
  const [results, setResults] = useState<TickerSearchResult[]>([]);

  useEffect(() => {
    const trimmed = rawQuery.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    let cancelled = false;

    const handle = setTimeout(() => {
      apiGet<SearchResponse>(`/live/search?q=${encodeURIComponent(trimmed)}`)
        .then((data) => {
          if (cancelled) return;
          setResults(data.results.map((r) => ({ ticker: r.ticker, name: r.name, price: null, pctChange: null })));
        })
        .catch((err) => {
          if (cancelled) return;
          console.error(`Ticker search failed for "${trimmed}":`, err);
          setResults([]);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [rawQuery]);

  return results;
}
