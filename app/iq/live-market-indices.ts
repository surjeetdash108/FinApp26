import type { PulseItem } from "./data";
import type { TapeItem } from "./types/tape";

export interface IndexDoc {
  id: string; label: string; value: number; change: number; pctChange: number;
  proxyTicker: string; isProxy: boolean; note: string | null;
  // market-indices.job.ts has always written these; the type simply never
  // declared them, so mergePulse could not read them and silently kept the
  // mock's open/prevClose beside a live price.
  open?: number; prevClose?: number;
  // Same story: the tape has always carried these (TapeItem.dayHigh/dayLow),
  // IndexDoc just never declared them, so the S&P/index detail drawer only
  // ever showed Open/Prev close.
  dayHigh?: number; dayLow?: number;
}

export const PULSE_LABEL_TO_INDEX_ID: Record<string, string> = {
  "S&P 500": "SPX", "Nasdaq": "NDX", "Dow": "DJI", "Russell 2K": "RUT",
  "VIX": "VIX", "10Y Yield": "US10Y", "WTI Crude": "WTI", "Gold": "GOLD", "Dollar (DXY)": "DXY",
};

/**
 * Maps the backend tape's items onto IndexDoc — items without a price are
 * dropped rather than coerced to 0, so mergePulse's own mock-fallback covers
 * them instead of a fabricated zero rendering next to a real price.
 */
export function tapeItemsToIndexDocs(items: TapeItem[]): IndexDoc[] {
  return items
    .filter((i) => i.value != null && i.pctChange != null)
    .map((i) => ({
      id: i.id,
      label: i.label,
      value: i.value as number,
      change: i.pctChange as number,
      pctChange: i.pctChange as number,
      proxyTicker: i.proxyTicker ?? "",
      isProxy: i.isProxy,
      note: i.note,
      open: i.open ?? undefined,
      prevClose: i.prevClose ?? undefined,
      dayHigh: i.dayHigh ?? undefined,
      dayLow: i.dayLow ?? undefined,
    }));
}

/**
 * Shared by Dashboard's Market Pulse widget and the shell's top ticker strip
 * — keeps both merges identical instead of drifting apart.
 *
 * `mock` supplies only the STRUCTURE (which 9 indices exist and their
 * display labels — fixed configuration, not market data). Every numeric
 * field (value/change/open/prevClose) must come from a live match; an index
 * with no live doc yet is dropped from the result rather than rendered with
 * its old static price, which used to render as if it were a real quote.
 */
export function mergePulse(mock: PulseItem[], live: IndexDoc[]): PulseItem[] {
  const liveById = new Map(live.map(l => [l.id, l]));
  const merged: PulseItem[] = [];
  for (const p of mock) {
    const id = PULSE_LABEL_TO_INDEX_ID[p.label];
    const l = id ? liveById.get(id) : undefined;
    if (!l) continue;
    // open/prevClose aren't always on the live doc yet; fall back to the
    // current value (reads as "flat"), never to the old mock's number.
    // dayHigh/dayLow have no safe "flat" fallback — left undefined (renders
    // NotAvailable) rather than guessed at from the current value.
    merged.push({
      ...p, value: l.value, change: l.pctChange,
      open: l.open ?? l.value, prevClose: l.prevClose ?? l.value,
      dayHigh: l.dayHigh, dayLow: l.dayLow,
    });
  }
  return merged;
}
