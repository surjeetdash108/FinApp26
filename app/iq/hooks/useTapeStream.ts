"use client";

import { useEffect, useState } from "react";
import { backendUrl } from "../backend";
import type { TapeFrame } from "../types/tape";

/**
 * Subscribes to the backend's ticker-tape SSE broadcast (one shared upstream
 * Polygon call fans out to every connected browser — see TapeService).
 * Replaces the shell's/Dashboard's direct `market_indices` Firestore listener.
 * EventSource reconnects on its own; no manual retry logic needed here.
 */
export function useTapeStream() {
  const [frame, setFrame] = useState<TapeFrame | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource(backendUrl("/live/tape/stream"));

    const onTape = (ev: MessageEvent<string>) => {
      try {
        setFrame(JSON.parse(ev.data) as TapeFrame);
      } catch (err) {
        console.error("tape stream: malformed frame", err);
      }
    };
    const onOpen = () => setConnected(true);
    const onError = () => setConnected(false);

    es.addEventListener("tape", onTape);
    es.addEventListener("open", onOpen);
    es.addEventListener("error", onError);

    return () => {
      es.removeEventListener("tape", onTape);
      es.removeEventListener("open", onOpen);
      es.removeEventListener("error", onError);
      es.close();
    };
  }, []);

  return { frame, connected };
}
