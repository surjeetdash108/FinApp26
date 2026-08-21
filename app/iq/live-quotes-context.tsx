"use client";

import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { apiGet } from "./backend";

/**
 * ONE poller for every live price in the app.
 *
 * WHY THIS EXISTS
 * Each surface used to run its own timer against its own endpoint: the heatmap
 * polled /live/snapshot every 15s, the stock drawer / movers / watchlist /
 * portfolio / search each polled /live/quotes every 30s, on independent phases.
 * Even after both endpoints were unified onto one server-side cache, two panels
 * could still DISPLAY values a refresh apart — one had fetched 5s ago, another
 * 25s ago — so the same ticker read differently on two parts of the screen.
 *
 * Here every consumer registers the tickers it needs, a single timer fetches the
 * union of them, and the SAME Map instance is handed to all of them. Two
 * components rendering one ticker cannot disagree, because they are literally
 * reading the same object. It also collapses N overlapping requests per interval
 * into one.
 */

export interface LiveQuote {
  price: number | null;
  pctChange: number | null;
}

/** Matches MAX_TICKERS on /live/snapshot (the vendor's per-call ceiling). */
const CHUNK = 250;
const TICKER_RE = /^[A-Z.]{1,10}$/;
const POLL_MS = 30_000;

interface SnapshotRow {
  ticker: string;
  price: number | null;
  /** NOTE: /live/snapshot names it `changePct`; /live/quotes calls it `pctChange`. */
  changePct: number | null;
}
interface SnapshotResponse {
  quotes?: SnapshotRow[];
}

interface LiveQuotesCtx {
  quotes: Map<string, LiveQuote>;
  subscribe: (id: string, tickers: string[]) => void;
  unsubscribe: (id: string) => void;
}

const EMPTY = new Map<string, LiveQuote>();
const LiveQuotesContext = createContext<LiveQuotesCtx>({
  quotes: EMPTY,
  subscribe: () => {},
  unsubscribe: () => {},
});

export function LiveQuotesProvider({ children }: { children: ReactNode }) {
  const [quotes, setQuotes] = useState<Map<string, LiveQuote>>(EMPTY);
  /** subscriberId -> its tickers. A ref so registering doesn't re-render. */
  const demand = useRef<Map<string, string[]>>(new Map());
  /** Bumped when the demanded SET changes, to recompute the union. */
  const [version, setVersion] = useState(0);

  const subscribe = useCallback((id: string, tickers: string[]) => {
    const prev = demand.current.get(id);
    const next = tickers.join(",");
    if (prev && prev.join(",") === next) return; // no-op re-register
    demand.current.set(id, tickers);
    setVersion(v => v + 1);
  }, []);

  const unsubscribe = useCallback((id: string) => {
    if (!demand.current.delete(id)) return;
    setVersion(v => v + 1);
  }, []);

  // Union of everything currently on screen, sorted so the effect key is stable.
  const union = useMemo(() => {
    const s = new Set<string>();
    for (const list of demand.current.values()) for (const t of list) s.add(t);
    return [...s].sort();
    // `version` is the dependency — `demand` is a ref by design.
  }, [version]);
  const unionKey = union.join(",");

  const unionRef = useRef<string[]>(union);
  unionRef.current = union;

  useEffect(() => {
    if (!unionKey) {
      setQuotes(EMPTY);
      return;
    }
    let cancelled = false;

    const load = async () => {
      const list = unionRef.current;
      const chunks: string[][] = [];
      for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK));
      const results = await Promise.all(
        chunks.map(c =>
          apiGet<SnapshotResponse>(
            `/live/snapshot?tickers=${encodeURIComponent(c.join(","))}`,
          ).catch(() => null),
        ),
      );
      if (cancelled) return;
      // A total failure keeps the last good map rather than blanking every
      // surface at once — stale-but-present beats empty.
      if (results.every(r => r == null)) return;
      // MERGE onto the previous map instead of replacing it. Rebuilding from
      // scratch meant one failed chunk silently dropped up to CHUNK tickers:
      // the heatmap tile then fell back to its day-old stored pctChange while
      // the stock drawer fell back to its own useLiveTick poll, so the same
      // ticker read differently on two parts of the screen — the precise
      // disagreement this provider exists to prevent. A ticker keeps its last
      // known quote until a chunk covering it actually succeeds.
      setQuotes(prev => {
        const merged = new Map(prev);
        for (const r of results) {
          for (const q of r?.quotes ?? []) {
            if (!q.ticker) continue;
            merged.set(q.ticker, { price: q.price, pctChange: q.changePct });
          }
        }
        return merged;
      });
    };

    void load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [unionKey]);

  const value = useMemo(
    () => ({ quotes, subscribe, unsubscribe }),
    [quotes, subscribe, unsubscribe],
  );
  return <LiveQuotesContext.Provider value={value}>{children}</LiveQuotesContext.Provider>;
}

/**
 * Live prices for `tickers`, from the app-wide shared poll. Every caller gets
 * the SAME Map, so two surfaces showing one ticker always agree exactly.
 * Tickers with no quote are absent — callers keep their stored fallback.
 */
export function useLiveQuotes(tickers: string[]): Map<string, LiveQuote> {
  const { quotes, subscribe, unsubscribe } = useContext(LiveQuotesContext);
  const id = useId();

  const key = useMemo(
    () =>
      Array.from(
        new Set(tickers.map(t => t.toUpperCase().trim()).filter(t => TICKER_RE.test(t))),
      )
        .sort()
        .join(","),
    [tickers],
  );

  useEffect(() => {
    subscribe(id, key ? key.split(",") : []);
    return () => unsubscribe(id);
  }, [id, key, subscribe, unsubscribe]);

  return quotes;
}
