"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Polls the backend's cached snapshot. The scalable counterpart to
 * useLiveQuote's SSE stream.
 *
 * WHY POLLING WINS HERE
 * Every client in a refresh window receives a byte-identical response, so a CDN
 * (or the browser cache) collapses them to roughly one origin request per
 * interval — user count barely affects backend load. Measured locally: 500
 * requests produced 1 upstream vendor call.
 *
 * The SSE path cannot do this. It holds a connection per user (~156 KB RSS
 * each), occupies one of Cloud Run's 80 concurrent slots per instance, and
 * depends on a single Polygon socket that only one instance may own.
 *
 * Freshness cost is negligible: the feed is already ~15 minutes delayed, so a
 * 10-second poll makes it 910s stale instead of 900s.
 */

import { API_BASE } from "../backend";
const BACKEND = API_BASE;

export interface SnapshotQuote {
  ticker: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  previousClose: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayVolume: number | null;
  dayVwap: number | null;
  minuteClose: number | null;
  minuteAt: number | null;
  vendorUpdatedAt: number | null;
  /**
   * Extended-hours session moves, from the v3 universal snapshot. Null outside
   * the relevant session. The Premarket / After-Hours feeds rendered hardcoded
   * copy before these existed on the response.
   */
  earlyTradingChangePct: number | null;
  lateTradingChangePct: number | null;
  regularTradingChangePct: number | null;
  marketStatus: string | null;
}

export interface SnapshotState {
  quote: SnapshotQuote | null;
  /** How stale the server's cached copy was when it answered. */
  cacheAgeMs: number | null;
  /** Round-trip time of the last poll. */
  latencyMs: number | null;
  /** True when the server answered 304 — no body transferred. */
  notModified: boolean;
  polls: number;
  /** Polls answered 304, i.e. served with no payload. */
  cacheHits: number;
  error: string | null;
  /** Vendor delay in seconds, from the snapshot's own clock. */
  feedLagSeconds: number | null;
}

const EMPTY: SnapshotState = {
  quote: null, cacheAgeMs: null, latencyMs: null, notModified: false,
  polls: 0, cacheHits: 0, error: null, feedLagSeconds: null,
};

/**
 * Live (delayed) prices for a LIST of tickers in one shared poll — the batched
 * counterpart to useSnapshotQuote. Backs the Watchlist, Portfolio and Search,
 * whose prices previously came only from the once-a-day `market-quotes` EOD
 * write on `companies` and so never moved intraday.
 *
 * One request per interval covers every ticker (the `?tickers=` cap is 50),
 * returns a byte-identical body for the same set (CDN/cache-collapsible), and
 * the backend still makes one Polygon call per refresh regardless of how many
 * browsers ask. Returns a Map keyed by upper-case ticker; missing tickers are
 * simply absent, so callers fall back to their EOD value.
 */
const MAX_SNAPSHOT_TICKERS = 50;
const EMPTY_SNAPSHOTS: Map<string, SnapshotQuote> = new Map();

export function useSnapshotQuotes(tickers: string[], intervalMs = 15_000): Map<string, SnapshotQuote> {
  const [quotes, setQuotes] = useState<Map<string, SnapshotQuote>>(new Map());
  // Stable, deduped, capped key so the effect only re-subscribes when the SET of
  // tickers changes — not on every render or price tick.
  const key = [...new Set(tickers.map((t) => t.toUpperCase()).filter(Boolean))]
    .sort()
    .slice(0, MAX_SNAPSHOT_TICKERS)
    .join(",");
  const etag = useRef<string | null>(null);

  useEffect(() => {
    // No tickers: don't poll and don't setState here (the hook returns the
    // stable EMPTY_SNAPSHOTS below instead — avoids a setState-in-effect).
    if (!key) return;
    etag.current = null;
    let cancelled = false;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const res = await fetch(`${BACKEND}/live/snapshot?tickers=${encodeURIComponent(key)}`, {
          signal: controller.signal,
          // Bypass the browser HTTP cache: the response carries
          // `stale-while-revalidate=30`, which would otherwise hand this poll a
          // cached body up to 30s old (the prices "freeze"). `no-store` forces a
          // real request every interval; our own If-None-Match still gets a cheap
          // 304 when nothing changed, and the server-side cache still collapses
          // the upstream vendor call, so this costs no extra Polygon requests.
          cache: "no-store",
          headers: etag.current ? { "If-None-Match": etag.current } : {},
        });
        if (cancelled || res.status === 304) return; // 304 → keep last map
        if (!res.ok) return; // keep last good prices rather than blanking
        const tag = res.headers.get("ETag");
        if (tag) etag.current = tag;
        const body = await res.json();
        const next = new Map<string, SnapshotQuote>();
        for (const q of (body.quotes ?? []) as SnapshotQuote[]) {
          if (q.ticker) next.set(q.ticker.toUpperCase(), q);
        }
        if (!cancelled) setQuotes(next);
      } catch {
        // Network blip — keep the last good prices.
      }
    };

    void poll();
    const id = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, [key, intervalMs]);

  // When there are no tickers, return the stable empty map (not stale `quotes`).
  return key ? quotes : EMPTY_SNAPSHOTS;
}

export function useSnapshotQuote(ticker: string | null, intervalMs = 10_000) {
  const [state, setState] = useState<SnapshotState>(EMPTY);
  // Kept in a ref so the polling effect doesn't re-run when the ETag changes,
  // which would restart the interval on every successful poll.
  const etag = useRef<string | null>(null);
  const counters = useRef({ polls: 0, hits: 0 });

  useEffect(() => {
    if (!ticker) return;
    etag.current = null;
    counters.current = { polls: 0, hits: 0 };
    setState(EMPTY);

    let cancelled = false;
    const controller = new AbortController();

    const poll = async () => {
      const started = performance.now();
      try {
        const res = await fetch(
          `${BACKEND}/live/snapshot?tickers=${encodeURIComponent(ticker)}`,
          {
            signal: controller.signal,
            // Bypass the browser HTTP cache (the response's
            // stale-while-revalidate=30 would otherwise serve a body up to 30s
            // old and the price appears frozen). Conditional request still costs
            // a cheap 304 with no body when the interval is unchanged.
            cache: "no-store",
            headers: etag.current ? { "If-None-Match": etag.current } : {},
          },
        );
        if (cancelled) return;
        const latencyMs = Math.round(performance.now() - started);
        counters.current.polls += 1;

        if (res.status === 304) {
          counters.current.hits += 1;
          setState((s) => ({
            ...s,
            latencyMs,
            notModified: true,
            polls: counters.current.polls,
            cacheHits: counters.current.hits,
            error: null,
          }));
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const tag = res.headers.get("ETag");
        if (tag) etag.current = tag;
        const body = await res.json();
        const quote: SnapshotQuote | null = body.quotes?.[0] ?? null;

        setState({
          quote,
          cacheAgeMs: body.cacheAgeMs ?? null,
          latencyMs,
          notModified: false,
          polls: counters.current.polls,
          cacheHits: counters.current.hits,
          error: null,
          feedLagSeconds:
            quote?.vendorUpdatedAt != null
              ? Math.round((Date.now() - quote.vendorUpdatedAt) / 1000)
              : null,
        });
      } catch (err) {
        if (cancelled || (err as Error).name === "AbortError") return;
        setState((s) => ({ ...s, error: (err as Error).message }));
      }
    };

    void poll();
    const id = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, [ticker, intervalMs]);

  return state;
}
