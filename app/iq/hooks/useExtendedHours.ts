"use client";

import { useEffect, useState } from "react";
import type { SnapshotQuote } from "./useSnapshotQuote";

/**
 * Real pre-market and after-hours moves for a set of tickers.
 *
 * The Commentary screen's Premarket and After Hours tabs appended a hardcoded
 * array (`PREMARKET`, `AFTERHOURS`) containing invented lines like
 * "NVDA AH +7.1%". Those numbers never changed and never referred to a real
 * session. The v3 universal snapshot carries `early_trading_change_percent` and
 * `late_trading_change_percent` on the plan already in use, and the backend
 * snapshot cache now passes them through.
 *
 * Still ~15 minutes delayed like everything else on this plan — the caller
 * should say so rather than implying a live extended-hours tape.
 */

import { API_BASE } from "../backend";
const BACKEND = API_BASE;

/** The backend caps a single snapshot request at 50 tickers. */
const MAX_TICKERS = 50;

export interface ExtendedHoursMover {
  ticker: string;
  /** Signed percent move in the requested session. */
  changePct: number;
  price: number | null;
  previousClose: number | null;
}

export interface ExtendedHoursState {
  movers: ExtendedHoursMover[];
  /** Vendor's own session label — "early_trading" / "late_trading" / "open" / "closed". */
  marketStatus: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * @param tickers  symbols to check (truncated to the backend's per-request cap)
 * @param session  which extended session to read
 * @param enabled  skip polling entirely when the tab isn't showing
 */
export function useExtendedHours(
  tickers: string[],
  session: "pre" | "after",
  enabled = true,
  intervalMs = 30_000,
): ExtendedHoursState {
  const [state, setState] = useState<ExtendedHoursState>({
    movers: [], marketStatus: null, loading: false, error: null,
  });

  // Join to a primitive so the effect doesn't re-run on every render just
  // because the caller built a new array with the same contents.
  const key = tickers.slice(0, MAX_TICKERS).join(",");

  useEffect(() => {
    if (!enabled || !key) {
      setState({ movers: [], marketStatus: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    const poll = async () => {
      try {
        setState(s => ({ ...s, loading: s.movers.length === 0 }));
        const res = await fetch(
          `${BACKEND}/live/snapshot?tickers=${encodeURIComponent(key)}`,
          { signal: controller.signal },
        );
        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const quotes: SnapshotQuote[] = body.quotes ?? [];

        const movers = quotes
          .map(q => {
            const pct = session === "pre" ? q.earlyTradingChangePct : q.lateTradingChangePct;
            return pct == null
              ? null
              : { ticker: q.ticker, changePct: pct, price: q.price, previousClose: q.previousClose };
          })
          .filter((m): m is ExtendedHoursMover => m !== null)
          // Biggest absolute move first — a -6% is as newsworthy as a +6%.
          .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

        setState({
          movers,
          marketStatus: quotes[0]?.marketStatus ?? null,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled || (err as Error).name === "AbortError") return;
        setState(s => ({ ...s, loading: false, error: (err as Error).message }));
      }
    };

    void poll();
    const id = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, [key, session, enabled, intervalMs]);

  return state;
}
