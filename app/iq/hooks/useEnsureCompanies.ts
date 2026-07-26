"use client";

import { useEffect } from "react";

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "").replace(/\/$/, "");
const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

// Module-level, not component-level: two screens showing the same ticker (or
// one screen remounting) must not refire the request. The backend's own
// cache TTL is what decides when a ticker is actually stale, not a React
// component's lifetime.
const requested = new Set<string>();

/**
 * Triggers the backend's on-demand cache-aside fetch (`GET /live/company`)
 * for every ticker currently shown on screen. Fire-and-forget: the backend
 * writes the result to Firestore `companies/{ticker}`, and the
 * `useCollection("companies")` listener every screen already has picks it up
 * on its own — this hook returns nothing, it only makes sure the write
 * happens instead of nothing ever asking for it.
 *
 * Without this, `companies` only grows via the once-daily premarket batch
 * job's "warm" phase (tape universe + existing watchlists/portfolios), so a
 * ticker nobody has looked at yet — or a freshly emptied database — never
 * gets data on its own.
 */
export function useEnsureCompanies(tickers: (string | null | undefined)[]): void {
  const key = tickers.filter(Boolean).join(",");

  useEffect(() => {
    if (!BACKEND_URL) return;
    for (const raw of tickers) {
      const t = (raw ?? "").toUpperCase().trim();
      if (!TICKER_RE.test(t) || requested.has(t)) continue;
      requested.add(t);
      fetch(`${BACKEND_URL}/live/company?ticker=${encodeURIComponent(t)}`).catch(() => {
        requested.delete(t); // let a later render retry a transient failure
      });
    }
    // `key` is the stable, string-ified form of `tickers` used for comparison.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
