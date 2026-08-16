import type { PulseItem, SectorRow } from "./data";
import type { TapeItem } from "./types/tape";
import type { CompanyDoc } from "./types/companies";
import type { SectorApiDoc } from "./types/sectors";

/**
 * Builds the sector treemap PURELY from live data — no static seed. Sector
 * names + order come from the live `/market-data/sectors` response (the 11 GICS
 * sectors); constituents are the live `companies` grouped by their own GICS
 * `sector` field; every number (market cap, %) is live. A company whose sector
 * isn't one of the 11 clean GICS names (a stale raw-SIC value, or null) is
 * excluded rather than mis-bucketed — the map self-heals as company profiles
 * re-sync to normalized sectors. Sector % is the live per-sector figure, else
 * the average of that sector's own live constituents; never a fabricated value.
 */
export function buildSectorList(
  companies: CompanyDoc[],
  sectorsLive: SectorApiDoc[],
): SectorRow[] {
  const livePctByName = new Map(sectorsLive.map((s) => [s.sector, s.pctChange]));
  const gics = sectorsLive.map((s) => s.sector);
  const gicsSet = new Set(gics);

  const bySector = new Map<string, [string, number, number][]>();
  for (const c of companies) {
    const sec = c.sector;
    if (!sec || !gicsSet.has(sec) || c.marketCap == null || c.pctChange == null) continue;
    let bucket = bySector.get(sec);
    if (!bucket) { bucket = []; bySector.set(sec, bucket); }
    bucket.push([c.ticker, c.marketCap / 1e9, c.pctChange]);
  }

  const rows: SectorRow[] = [];
  gics.forEach((name, i) => {
    const items = bySector.get(name);
    if (!items || items.length === 0) return;
    const pctChange =
      livePctByName.get(name) ??
      items.reduce((s, [, , p]) => s + p, 0) / items.length;
    const trend =
      pctChange == null ? null : pctChange > 0.5 ? "Improving" : pctChange < -0.5 ? "Deteriorating" : "Flat";
    rows.push({ name, rank: i + 1, trend, pctChange, items });
  });
  return rows;
}

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
const PULSE_INDEX_IDS = ["SPX", "NDX", "DJI", "RUT", "VIX", "US10Y", "WTI", "GOLD", "BTC", "DXY"];

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
