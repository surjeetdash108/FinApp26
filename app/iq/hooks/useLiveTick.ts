"use client";

import { useEffect, useState } from "react";
import { apiGet, streamUrl } from "../backend";

/** How stale the last SSE tick must be before the JSON poll steps in (ms). */
const SSE_STALE_MS = 8000;
const POLL_MS = 30000;

/** One aggregate window as the backend forwards it on the `tick` SSE event. */
interface StreamTick {
  ticker: string;
  price: number;
  open: number;
  high: number;
  low: number;
  windowVolume: number;
  accumulatedVolume: number | null;
  vwap: number;
  sessionVwap: number | null;
  /** Window start, epoch ms — the time the DELAYED data refers to. */
  at: number;
  receivedAt: number;
}

/** The `snapshot` SSE event — arrives once, before any tick. */
interface StreamSnapshot {
  ticker: string;
  previousClose: number | null;
  feed: string;
  channel: string;
  delayMinutes: number;
  note: string;
}

/** One row of GET /live/quotes — the always-works poll fallback. */
interface QuoteRow {
  ticker: string;
  name: string | null;
  price: number | null;
  pctChange: number | null;
}

export interface LiveTick {
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  windowVolume: number | null;
  /** Window start, epoch ms (the delayed reference time). Null on the poll path. */
  at: number | null;
}

export interface UseLiveTickResult {
  tick: LiveTick | null;
  /** Prior session close, for change/%-change. Only the SSE snapshot carries it. */
  prevClose: number | null;
  /** Absolute price change vs prevClose, or derived from the quote's pctChange. */
  change: number | null;
  /** Percent change, from prevClose when known, else the quote's own pctChange. */
  pct: number | null;
  /** True once an SSE frame (tick or snapshot) has arrived on this stream. */
  connected: boolean;
  /** Vendor delay the backend advertises (Stocks Starter = 15). Null until known. */
  delayMinutes: number | null;
}

const TICKER_RE = /^[A-Z.]{1,10}$/;

/**
 * Live (delayed) price for one ticker, mirroring useTapeStream: an EventSource
 * on /live/stream?ticker=SYM for push, with a JSON poll of /live/quotes so the
 * price ALWAYS populates.
 *
 * Why the fallback: /live/stream (SSE) works against Cloud Run directly, but
 * Firebase Hosting does not proxy the long-lived stream — through the hosting
 * origin the browser's EventSource never receives a frame. So we also fetch the
 * plain JSON quote immediately and poll it whenever SSE hasn't delivered
 * recently. When SSE works (local dev / direct origin) it drives live updates
 * and the poll stays idle.
 *
 * The feed is ~15 minutes DELAYED (Polygon Stocks Starter, `A` channel) — the
 * caller must label it. `delayMinutes` carries what the backend advertises.
 */
export function useLiveTick(sym: string): UseLiveTickResult {
  const [tick, setTick] = useState<LiveTick | null>(null);
  const [prevClose, setPrevClose] = useState<number | null>(null);
  const [pctFromQuote, setPctFromQuote] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [delayMinutes, setDelayMinutes] = useState<number | null>(null);

  useEffect(() => {
    const upper = (sym ?? "").toUpperCase().trim();
    let cancelled = false;
    let lastSse = 0;

    // Clear per-symbol state so a stale price never flashes on the new ticker.
    // Deferred (not a synchronous setState in the effect body) to satisfy
    // react-hooks/set-state-in-effect, same pattern as useApiResource.
    queueMicrotask(() => {
      if (cancelled) return;
      setTick(null);
      setPrevClose(null);
      setPctFromQuote(null);
      setConnected(false);
    });

    if (!TICKER_RE.test(upper)) return;

    // Plain-JSON snapshot — the always-works path. Suppressed while a fresh SSE
    // tick is arriving, so live push wins when it's actually available.
    const fetchOnce = async () => {
      try {
        const rows = await apiGet<QuoteRow[]>(`/live/quotes?tickers=${encodeURIComponent(upper)}`);
        const q = rows?.find((r) => r.ticker?.toUpperCase() === upper) ?? rows?.[0];
        if (!q || q.price == null) return;
        if (!cancelled && Date.now() - lastSse > SSE_STALE_MS) {
          setTick({ price: q.price, open: null, high: null, low: null, windowVolume: null, at: null });
          setPctFromQuote(q.pctChange ?? null);
        }
      } catch {
        /* transient — the next poll or the SSE may succeed */
      }
    };
    void fetchOnce();

    const es = new EventSource(streamUrl(`/live/stream?ticker=${encodeURIComponent(upper)}`));

    const onTick = (ev: MessageEvent<string>) => {
      try {
        const t = JSON.parse(ev.data) as StreamTick;
        lastSse = Date.now();
        if (!cancelled) {
          setTick({
            price: t.price,
            open: t.open,
            high: t.high,
            low: t.low,
            windowVolume: t.windowVolume,
            at: t.at,
          });
          setConnected(true);
        }
      } catch (err) {
        console.error("live stream: malformed tick", err);
      }
    };

    const onSnapshot = (ev: MessageEvent<string>) => {
      try {
        const s = JSON.parse(ev.data) as StreamSnapshot;
        if (!cancelled) {
          setPrevClose(s.previousClose);
          setDelayMinutes(s.delayMinutes ?? null);
          setConnected(true);
        }
      } catch (err) {
        console.error("live stream: malformed snapshot", err);
      }
    };

    const onError = () => setConnected(false);

    es.addEventListener("tick", onTick);
    es.addEventListener("snapshot", onSnapshot);
    es.addEventListener("error", onError);

    const poll = setInterval(() => void fetchOnce(), POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      es.removeEventListener("tick", onTick);
      es.removeEventListener("snapshot", onSnapshot);
      es.removeEventListener("error", onError);
      es.close();
    };
  }, [sym]);

  // Prefer a real prevClose (from the SSE snapshot) for change/%. When only the
  // poll's pctChange is available, back out the dollar move from price and pct.
  const price = tick?.price ?? null;
  let change: number | null = null;
  let pct: number | null = null;
  if (price != null && prevClose != null && prevClose !== 0) {
    change = price - prevClose;
    pct = (change / prevClose) * 100;
  } else if (price != null && pctFromQuote != null) {
    pct = pctFromQuote;
    const prev = price / (1 + pctFromQuote / 100);
    change = price - prev;
  }

  return { tick, prevClose, change, pct, connected, delayMinutes };
}
