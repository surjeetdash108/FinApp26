"use client";

import { useEffect, useState } from "react";
import { apiGet, streamUrl } from "../backend";
import type { TapeFrame } from "../types/tape";

/** How stale the last SSE frame must be before the JSON poll steps in (ms). */
const SSE_STALE_MS = 8000;
const POLL_MS = 20000;

/**
 * Subscribes to the backend's ticker-tape SSE broadcast for live push, with a
 * JSON fallback so the tape ALWAYS populates.
 *
 * Why the fallback: `/live/tape/stream` (SSE) works against the Cloud Run
 * service directly, but Firebase Hosting does not proxy the long-lived stream —
 * through the hosting origin the browser's EventSource never receives a frame,
 * which left the VIX/index cards (Macro, Dashboard, Recap, marquee) spinning
 * forever. The EventSource is now built via `streamUrl()`, which targets the
 * Cloud Run `live` origin directly when NEXT_PUBLIC_LIVE_STREAM_ORIGIN is set,
 * so SSE drives live updates in production too. The poll stays as a safety net:
 * we still fetch the plain JSON `/live/tape` immediately and poll it whenever
 * SSE hasn't delivered recently, so the tape ALWAYS populates even if the
 * direct origin is unset or unreachable.
 */
export function useTapeStream() {
  const [frame, setFrame] = useState<TapeFrame | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let lastSse = 0;

    // Plain-JSON snapshot — the always-works path. Suppressed while a fresh SSE
    // frame is arriving, so live push wins when it's actually available.
    const fetchOnce = async () => {
      try {
        const f = await apiGet<TapeFrame>("/live/tape");
        if (!cancelled && Date.now() - lastSse > SSE_STALE_MS) setFrame(f);
      } catch {
        /* transient — the next poll or the SSE may succeed */
      }
    };
    void fetchOnce();

    const es = new EventSource(streamUrl("/live/tape/stream"));
    const onTape = (ev: MessageEvent<string>) => {
      try {
        lastSse = Date.now();
        if (!cancelled) {
          setFrame(JSON.parse(ev.data) as TapeFrame);
          setConnected(true);
        }
      } catch (err) {
        console.error("tape stream: malformed frame", err);
      }
    };
    const onOpen = () => setConnected(true);
    const onError = () => setConnected(false);

    es.addEventListener("tape", onTape);
    es.addEventListener("open", onOpen);
    es.addEventListener("error", onError);

    const poll = setInterval(() => void fetchOnce(), POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      es.removeEventListener("tape", onTape);
      es.removeEventListener("open", onOpen);
      es.removeEventListener("error", onError);
      es.close();
    };
  }, []);

  return { frame, connected };
}
