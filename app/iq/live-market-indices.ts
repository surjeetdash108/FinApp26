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
 * Builds the index strip (Dashboard Market Pulse + shell ticker strip) PURELY
 * from live tape data — no static seed. `PULSE_INDEX_IDS` is display config
 * (which indices to show and in what order), not market data: every label and
 * value comes from the live IndexDoc, and an index with no live match is
 * dropped rather than rendered with a fabricated number. Open/prevClose fall
 * back to the current value ("flat"), never to any static number.
 */
const PULSE_INDEX_IDS = ["SPX", "NDX", "DJI", "RUT", "VIX", "US10Y", "WTI", "GOLD", "DXY"];

export function pulseFromLive(live: IndexDoc[]): PulseItem[] {
  const byId = new Map(live.map(l => [l.id, l]));
  const out: PulseItem[] = [];
  for (const id of PULSE_INDEX_IDS) {
    const l = byId.get(id);
    if (!l) continue;
    out.push({
      label: l.label,
      value: l.value,
      change: l.pctChange,
      open: l.open ?? l.value,
      prevClose: l.prevClose ?? l.value,
      dayHigh: l.dayHigh,
      dayLow: l.dayLow,
    });
  }
  return out;
}
