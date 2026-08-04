import type { PulseItem } from "./data";
import type { TapeItem } from "./types/tape";

export interface IndexDoc {
  id: string; label: string; value: number; change: number; pctChange: number;
  proxyTicker: string; isProxy: boolean; note: string | null;
  open?: number; prevClose?: number;
}

// Display order for the pulse ticker strip — just which indices to show and in
// what order, not fabricated values. An index only renders once the live tape
// has actually delivered a doc for it.
const PULSE_INDEX_ORDER = ["SPX", "NDX", "DJI", "RUT", "VIX", "US10Y", "WTI", "GOLD", "DXY"];

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
    }));
}

/** Shared by Dashboard's Market Pulse widget and the shell's top ticker strip — keeps both builds identical instead of drifting apart. */
export function buildPulse(live: IndexDoc[]): PulseItem[] {
  const liveById = new Map(live.map(l => [l.id, l]));
  return PULSE_INDEX_ORDER
    .map(id => liveById.get(id))
    .filter((l): l is IndexDoc => l != null)
    .map(l => ({
      label: l.label,
      value: l.value,
      change: l.pctChange,
      open: l.open ?? l.value,
      prevClose: l.prevClose ?? l.value,
    }));
}
