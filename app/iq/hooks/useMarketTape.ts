"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The header ticker tape, streamed from OUR backend.
 *
 * The browser holds no vendor key and makes no vendor request. It opens ONE
 * EventSource against `/live/tape/stream`; the backend makes a single
 * `/v3/snapshot` call per refresh and fans the identical frame out to every
 * connected client. Two consequences worth stating, because they are the whole
 * reason this is a stream rather than a poll:
 *
 *   - Upstream cost is independent of how many people have the app open.
 *     Verified: 25 concurrent clients over ~3 minutes produced 3 vendor calls,
 *     not 75.
 *   - The browser never decides when to fetch, so there is no client poll
 *     interval stacked on top of the vendor's own delay.
 *
 * EventSource (not WebSocket) because the stream is one-way and EventSource
 * reconnects by itself — there is deliberately no retry code below. Same choice
 * and same reasoning as useLiveQuote.
 */

import { SSE_BASE } from "../backend";
const BACKEND = SSE_BASE;

/**
 * No frame and no heartbeat for this long means the stream is wedged in a way
 * EventSource has not noticed (a half-open connection through a proxy looks
 * identical to a quiet market otherwise). The backend heartbeats every 20s.
 */
const STALL_MS = 70_000;

export type TapeKind = "index" | "stock" | "rate";

export interface TapeItem {
  id: string;
  kind: TapeKind;
  label: string;
  name: string | null;
  proxyTicker: string | null;
  isProxy: boolean;
  note: string | null;
  /** "percent" on the 10Y tile: its `change` is a basis-point move, not a %. */
  unit?: "percent";
  value: number | null;
  change: number | null;
  pctChange: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  prevClose: number | null;
}

export interface TapeFrame {
  items: TapeItem[];
  asOf: string;
  vendorDelayNote: string;
  marketPhase: "open" | "pre" | "after" | "closed" | "unknown";
  stale: boolean;
}

export interface MarketTape {
  items: TapeItem[];
  asOf: string | null;
  /** Backend could not refresh — these are the last good values. */
  stale: boolean;
  /** EventSource is open AND we have heard from it recently. */
  connected: boolean;
  phase: TapeFrame["marketPhase"];
  delayNote: string | null;
}

const EMPTY: MarketTape = {
  items: [],
  asOf: null,
  stale: false,
  connected: false,
  phase: "unknown",
  delayNote: null,
};

export function useMarketTape(): MarketTape {
  const [tape, setTape] = useState<MarketTape>(EMPTY);
  // Last inbound frame OR heartbeat. Held in a ref so the stall check does not
  // re-run the effect (and tear down the stream) on every event.
  const lastSeenRef = useRef(0);

  useEffect(() => {
    const es = new EventSource(`${BACKEND}/live/tape/stream`);

    const onTape = (e: MessageEvent) => {
      lastSeenRef.current = Date.now();
      try {
        const f: TapeFrame = JSON.parse(e.data);
        setTape({
          items: f.items ?? [],
          asOf: f.asOf ?? null,
          stale: !!f.stale,
          connected: true,
          phase: f.marketPhase ?? "unknown",
          delayNote: f.vendorDelayNote ?? null,
        });
      } catch {
        // A malformed frame is not a reason to blank a working tape.
      }
    };

    const onHeartbeat = () => {
      lastSeenRef.current = Date.now();
      setTape((t) => (t.connected ? t : { ...t, connected: true }));
    };

    // EventSource fires `error` on every reconnect attempt too, so this marks
    // the tape disconnected without clearing `items` — the strip keeps showing
    // the last known values instead of emptying while it reconnects.
    const onError = () => setTape((t) => ({ ...t, connected: false }));

    es.addEventListener("tape", onTape as EventListener);
    es.addEventListener("heartbeat", onHeartbeat);
    es.addEventListener("error", onError);

    const stallTimer = setInterval(() => {
      if (lastSeenRef.current && Date.now() - lastSeenRef.current > STALL_MS) {
        setTape((t) => (t.connected ? { ...t, connected: false } : t));
      }
    }, 10_000);

    return () => {
      clearInterval(stallTimer);
      es.removeEventListener("tape", onTape as EventListener);
      es.removeEventListener("heartbeat", onHeartbeat);
      es.removeEventListener("error", onError);
      // Closing releases the backend's ref count, which is what stops its
      // poller once the last viewer leaves.
      es.close();
    };
  }, []);

  return tape;
}
