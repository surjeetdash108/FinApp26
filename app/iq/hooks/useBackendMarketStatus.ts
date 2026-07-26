"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../backend";
import { getMarketStatus, type MarketStatus } from "../market-status";
import type { MarketStatusPayload } from "../types/market-status";

/** Matches the backend's own STATUS_TTL_MS (market-status.service.ts) — no point polling faster than its cache refreshes. */
const POLL_MS = 60_000;

/**
 * GET /live/market-status — the vendor's own session state, replacing the
 * local ET-clock computation in market-status.ts. Falls back to that local
 * computation on a fetch failure (stale-beats-blank, same rule the backend
 * itself follows) rather than leaving the header pill blank.
 */
export function useBackendMarketStatus(): MarketStatus {
  const [status, setStatus] = useState<MarketStatus>(() => getMarketStatus());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiGet<MarketStatusPayload>("/live/market-status");
        if (!cancelled) setStatus({ phase: payload.phase, label: payload.label });
      } catch (err) {
        console.error("market-status fetch failed, falling back to local clock:", err);
        if (!cancelled) setStatus(getMarketStatus());
      }
    }

    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return status;
}
