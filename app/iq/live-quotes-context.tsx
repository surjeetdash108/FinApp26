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
  /**
   * Today's PRE-MARKET move (04:00–09:30 ET), from the vendor's
   * `early_trading_change_percent`. Verified: it persists through the regular
   * session rather than clearing at the open, and squares with the open price.
   */
  earlyPct: number | null;
  /**
   * The vendor's `late_trading_change_percent`, shown as the after-hours move.
   *
   * CARRIED WITH A KNOWN CAVEAT. Measured 2026-09-01 with the market open, this
   * came back as very nearly the NEGATIVE of the regular-session move for every
   * stock that had not reported — WMT +1.211/-1.22, AAPL +2.601/-2.47, MSFT
   * -1.40/+1.537, JNJ +1.186/-1.09, each summing to roughly zero. An after-hours
   * move has no reason to mirror the day session, so the field is measuring
   * something other than, or in addition to, late trading. Stocks reporting that
   * day broke the pattern by a consistent ~+1.05 (CRDO -5.00/+6.06, DELL
   * -4.12/+5.18, MDB -3.99/+5.02), which suggests a real signal is in there.
   *
   * The vendor's docs define neither the window nor the baseline; support has
   * not been asked yet. Displayed at the product owner's direction with the
   * column labelled as vendor-reported. If the meaning is ever pinned down,
   * update this note and the column's tooltip together.
   */
  latePct: number | null;
}

/** Matches MAX_TICKERS on /live/snapshot (the vendor's per-call ceiling). */
const CHUNK = 250;
const TICKER_RE = /^[A-Z.]{1,10}$/;
const POLL_MS = 30_000;

/**
 * What these prices actually are, in the user's words.
 *
 * The poll interval is 30s, but that is OUR cadence, not the data's age: the
 * Polygon feed behind /live/snapshot is itself ~15 minutes delayed (see the
 * header of snapshot-cache.service.ts in the backend). Refreshing faster moves
 * the number from ~900s old to ~910s old and no further.
 *
 * Surfaces used to describe this in their own words — the index drawer claimed
 * "delayed ≤15s" and the movers table said "live prices", both off by a factor
 * of sixty. A reader comparing against a real-time screener concluded the app
 * was broken, which is a fair reading of a wrong label. One string, exported,
 * so a price surface cannot quietly disagree about what it is showing.
 */
export const QUOTE_DELAY_LABEL = "~15 min delayed";

/**
 * Take price and change from the SAME source, never one from each.
 *
 * Screens overlay a live quote on a stored doc, and the natural way to write
 * that is one `??` chain per field:
 *
 *     const price = live?.price     ?? stored?.price;
 *     const pct   = live?.pctChange ?? stored?.pctChange;
 *
 * Those two chains are independent. A quote carrying a price but no percentage
 * takes the first branch and the second, so the row shows a live price beside a
 * stored percentage — two different moments, presented as one quote. That is
 * how AEHL came to read $6.34 at +93.14% when $6.34 was +79.1% against the same
 * previous close.
 *
 * Sources are tried in order and the first COMPLETE pair wins. If none is
 * complete, the first source with anything at all is used whole, so a row may be
 * partial but is never a splice of two.
 */
export function pairedQuote(
  ...sources: Array<{ price?: number | null; pctChange?: number | null } | null | undefined>
): { price: number | null; pctChange: number | null } {
  for (const s of sources) {
    if (s && s.price != null && s.pctChange != null) {
      return { price: s.price, pctChange: s.pctChange };
    }
  }
  for (const s of sources) {
    if (s && (s.price != null || s.pctChange != null)) {
      return { price: s.price ?? null, pctChange: s.pctChange ?? null };
    }
  }
  return { price: null, pctChange: null };
}

interface SnapshotRow {
  ticker: string;
  price: number | null;
  /** NOTE: /live/snapshot names it `changePct`; /live/quotes calls it `pctChange`. */
  changePct: number | null;
  /** Pre/post-market moves; absent from /live/quotes, which serves a narrower shape. */
  earlyTradingChangePct?: number | null;
  lateTradingChangePct?: number | null;
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
            merged.set(q.ticker, {
              price: q.price,
              pctChange: q.changePct,
              earlyPct: q.earlyTradingChangePct ?? null,
              latePct: q.lateTradingChangePct ?? null,
            });
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
