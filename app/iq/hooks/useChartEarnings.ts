"use client";

import { useMemo } from "react";
import { useApiResource } from "./useApiResource";
import { useApiList } from "./useApiList";
import { buildChartEarnings, type ChartEarnings } from "../chart-earnings";
import type { FinancialsDoc, LiveEarningsDoc } from "../types";

/**
 * Chart earnings dots for one ticker, for callers that do NOT already hold a
 * financials doc — the watchlist / portfolio / screener / movers / IPO chart
 * panels. Screens that already fetch `/live/financials` (stock details) should
 * call buildChartEarnings() with the doc they have rather than this hook, so
 * they don't fetch it twice.
 *
 * The derivation itself lives in buildChartEarnings so both paths produce
 * identical dots; this only supplies the data it needs.
 */
export function useChartEarnings(sym: string, enabled = true): ChartEarnings[] {
  const { data: doc } = useApiResource<FinancialsDoc>(
    enabled && sym ? `/live/financials?ticker=${encodeURIComponent(sym)}` : null,
  );
  // Shared across every consumer on the page, so this is not an extra request
  // per chart — the same list already backs the earnings calendar.
  const { data: calendar } = useApiList<LiveEarningsDoc>("/market-data/earnings");

  return useMemo(() => {
    if (!enabled || !sym) return [];
    const todayIso = new Date().toISOString().slice(0, 10);
    const events = calendar.filter(e => e.ticker === sym);
    return buildChartEarnings(doc, events, todayIso);
  }, [enabled, sym, doc, calendar]);
}
