"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Streams delayed prices from OUR backend (never from Polygon directly).
 *
 * The browser holds no vendor API key: it opens an EventSource against
 * `/live/stream` on our own origin, and the backend owns the single upstream
 * Polygon WebSocket. Putting the key in the browser would expose it to anyone
 * who opens devtools — there is no way to hide a key in client-side code.
 *
 * EventSource (SSE) rather than a browser WebSocket because the stream is
 * one-way and EventSource reconnects on its own.
 */

import { SSE_BASE } from "../backend";
const BACKEND = SSE_BASE;

export interface LiveTick {
  ticker: string;
  price: number;
  open: number;
  high: number;
  low: number;
  windowVolume: number;
  accumulatedVolume: number | null;
  vwap: number;
  sessionVwap: number | null;
  /** Window start (epoch ms) — the moment the DELAYED data describes. */
  at: number;
  /** When our backend received it. The gap versus `at` is the vendor delay. */
  receivedAt: number;
}

export interface LiveSnapshot {
  ticker: string;
  previousClose: number | null;
  feed: string;
  channel: string;
  delayMinutes: number;
  note: string;
}

/**
 * Everything derived from the stream. Recomputed on every tick so the whole
 * panel stays consistent with the latest price — which is the point of the
 * exercise: one tick in, every dependent number out.
 */
export interface LiveDerived {
  last: number | null;
  change: number | null;
  changePct: number | null;
  /** Session extremes accumulated from the ticks WE have seen, not vendor day stats. */
  sessionHigh: number | null;
  sessionLow: number | null;
  /** Where `last` sits inside [sessionLow, sessionHigh], 0..1. */
  rangePosition: number | null;
  vwap: number | null;
  /** Premium/discount of last vs session VWAP, in %. */
  vwapPremiumPct: number | null;
  accumulatedVolume: number | null;
  tickCount: number;
  /** Ticks per second over the observed window — a liveness measure. */
  tickRate: number | null;
  direction: "up" | "down" | "flat" | null;
  /** Vendor delay in seconds: receivedAt - at. Exposes the 15-minute lag. */
  feedLagSeconds: number | null;
  /** Seconds since the last tick arrived — detects a stalled stream. */
  ageSeconds: number | null;
}

const EMPTY: LiveDerived = {
  last: null, change: null, changePct: null,
  sessionHigh: null, sessionLow: null, rangePosition: null,
  vwap: null, vwapPremiumPct: null, accumulatedVolume: null,
  tickCount: 0, tickRate: null, direction: null,
  feedLagSeconds: null, ageSeconds: null,
};

export function useLiveQuote(ticker: string | null) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [derived, setDerived] = useState<LiveDerived>(EMPTY);
  const [status, setStatus] = useState<{ connected: boolean; message: string }>({
    connected: false,
    message: "idle",
  });
  const [lastTick, setLastTick] = useState<LiveTick | null>(null);

  // Accumulators live in refs: they must survive re-renders without causing
  // one, and must reset when the ticker changes.
  const acc = useRef({ high: -Infinity, low: Infinity, count: 0, firstAt: 0, prevPrice: 0 });

  useEffect(() => {
    if (!ticker) return;

    acc.current = { high: -Infinity, low: Infinity, count: 0, firstAt: 0, prevPrice: 0 };
    setSnapshot(null);
    setDerived(EMPTY);
    setLastTick(null);
    setStatus({ connected: false, message: "connecting" });

    const url = `${BACKEND}/live/stream?ticker=${encodeURIComponent(ticker)}`;
    const es = new EventSource(url);

    es.addEventListener("snapshot", (e) => {
      setSnapshot(JSON.parse((e as MessageEvent).data) as LiveSnapshot);
    });

    es.addEventListener("status", (e) => {
      setStatus(JSON.parse((e as MessageEvent).data));
    });

    es.addEventListener("tick", (e) => {
      const t = JSON.parse((e as MessageEvent).data) as LiveTick;
      const a = acc.current;
      a.count += 1;
      if (!a.firstAt) a.firstAt = t.receivedAt;
      a.high = Math.max(a.high, t.high);
      a.low = Math.min(a.low, t.low);

      setLastTick(t);
      setSnapshot((snap) => {
        // Derivation is done inside this updater so it always sees the current
        // snapshot (for previousClose) without adding it to the effect deps —
        // which would tear down and rebuild the EventSource on every snapshot.
        const pc = snap?.previousClose ?? null;
        const high = Number.isFinite(a.high) ? a.high : null;
        const low = Number.isFinite(a.low) ? a.low : null;
        const span = high != null && low != null ? high - low : null;
        const elapsedSec = (t.receivedAt - a.firstAt) / 1000;

        setDerived({
          last: t.price,
          change: pc != null ? t.price - pc : null,
          changePct: pc != null && pc !== 0 ? ((t.price - pc) / pc) * 100 : null,
          sessionHigh: high,
          sessionLow: low,
          // Guard the degenerate case: on the first tick high === low, so the
          // ratio is 0/0. Report the midpoint rather than NaN.
          rangePosition: span != null && span > 0 && low != null
            ? (t.price - low) / span
            : span === 0 ? 0.5 : null,
          vwap: t.sessionVwap ?? t.vwap,
          vwapPremiumPct: t.sessionVwap
            ? ((t.price - t.sessionVwap) / t.sessionVwap) * 100
            : null,
          accumulatedVolume: t.accumulatedVolume,
          tickCount: a.count,
          tickRate: elapsedSec > 0 ? a.count / elapsedSec : null,
          direction:
            a.prevPrice === 0 ? null
              : t.price > a.prevPrice ? "up"
              : t.price < a.prevPrice ? "down"
              : "flat",
          feedLagSeconds: Math.round((t.receivedAt - t.at) / 1000),
          ageSeconds: 0,
        });
        a.prevPrice = t.price;
        return snap;
      });
    });

    es.onerror = () => {
      // EventSource retries on its own; report the gap rather than tearing down.
      setStatus({ connected: false, message: "stream interrupted — retrying" });
    };

    return () => es.close();
  }, [ticker]);

  // Ticks stop entirely outside market hours. A stopwatch on the last tick is
  // the only way to tell "market closed" from "backend died".
  useEffect(() => {
    if (!lastTick) return;
    const id = setInterval(() => {
      setDerived((d) => ({
        ...d,
        ageSeconds: Math.round((Date.now() - lastTick.receivedAt) / 1000),
      }));
    }, 1000);
    return () => clearInterval(id);
  }, [lastTick]);

  return { snapshot, derived, status, lastTick };
}
