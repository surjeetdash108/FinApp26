import type { PulseItem } from "./data";
import type { TapeItem } from "./types/tape";

export interface IndexDoc {
  id: string; label: string; value: number; change: number; pctChange: number;
  proxyTicker: string; isProxy: boolean; note: string | null;
  // market-indices.job.ts has always written these; the type simply never
  // declared them, so mergePulse could not read them and silently kept the
  // mock's open/prevClose beside a live price.
  open?: number; prevClose?: number;
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
    }));
}

/** Shared by Dashboard's Market Pulse widget and the shell's top ticker strip — keeps both merges identical instead of drifting apart. */
export function mergePulse(mock: PulseItem[], live: IndexDoc[]): PulseItem[] {
  const liveById = new Map(live.map(l => [l.id, l]));
  return mock.map(p => {
    const id = PULSE_LABEL_TO_INDEX_ID[p.label];
    const l = id ? liveById.get(id) : undefined;
    if (!l) return p;
    // open/prevClose now come from the live doc. They used to be re-assigned
    // from the mock (`open: p.open`) because IndexDoc never declared these
    // fields — so a fabricated "O … · PC …" rendered directly beside a real
    // price. The mock value remains only as a last-resort fallback for a doc
    // written before those fields existed.
    return {
      ...p,
      value: l.value,
      change: l.pctChange,
      open: l.open ?? p.open,
      prevClose: l.prevClose ?? p.prevClose,
    };
  });
}
