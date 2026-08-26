// ============================================================
// STOCKWISE — MOCK DATA (TypeScript)
// ============================================================

export interface PulseItem { label: string; value: number; change: number; open: number; prevClose: number; dayHigh?: number; dayLow?: number; }
export interface Earning {
  ticker: string; name: string; session: string; marketCap: string; sector: string;
  // nullable: the live earnings feed supplies estimate/actual only, and not
  // for every row — a 0 default would read as a real forecast of zero.
  epsEstimate: number | null; epsActual: number | null;
  revenueEstimate: number | null; revenueActual: number | null;
  guidanceStatus: string | null; priceReaction: number | null;
  tags: string[]; owned: boolean; impliedMove: number | null;
}
export interface Mover {
  ticker: string; name: string; price: number; pctChange: number; rvolRatio: number; relativeStrength: number;
  maPosture: string; owned: boolean;
  sector: string; cap: 'Mega' | 'Large' | 'Mid' | 'Small';
  weekPct: number | null; techContext: string; newsContext: string;
}

/** Moving-average posture label from the two booleans on the company doc
 *  (aboveSma50 / aboveSma200, written by technical-indicators.job). Null on
 *  either → "—" so an un-synced ticker never reads as a real posture. */
export function maPostureLabel(above50?: boolean | null, above200?: boolean | null): string {
  if (above50 == null || above200 == null) return "—";
  if (above50 && above200) return "Above 50 & 200 DMA";
  if (!above50 && !above200) return "Below 50 & 200 DMA";
  return above50 ? "Above 50 · below 200" : "Below 50 · above 200";
}

// Leveraged / inverse ETF products (e.g. "T-REX 2X Long AXTI Daily ETF",
// "ProShares UltraPro …") routinely top the raw grouped-daily gainers but aren't
// stock movers. A normal operating company never carries both a multiplier
// ("2X"/"3X") and an ETF/ETN/Shares suffix, nor "leveraged/inverse/ultrapro/
// ultrashort", so the false-positive risk is negligible. Shared by the Movers
// screen and the Dashboard movers widget so both hide these the same way.
export function isLeveragedProduct(name: string | null | undefined): boolean {
  const n = name ?? "";
  if (/\b(leveraged?|inverse|ultrapro|ultrashort)\b/i.test(n)) return true;
  if (/\b[1-9](?:\.\d)?x\b/i.test(n) && /\b(etf|etn|shares)\b/i.test(n)) return true;
  return false;
}
export interface FolioItem {
  ticker: string; name: string;
  price: number;
  pctChange: number;
  /** Unrealized return % vs cost basis; 0 when no basis is stored. */
  gainLossPct: number;
  /** Average cost per share; null when the user hasn't entered one. */
  costBasis: number | null;
  positionSize: "Small" | "Medium" | "Large";
  conviction: "High" | "Medium" | "Low";
  eventNote: string;
}
export interface WatchItem {
  ticker: string; name: string; price: number; pctChange: number;
  nextEarningsDate: string; lastAnalystAction: string | null; hasOptions: boolean; latestHeadline: string;
}
/**
 * name/items (sector taxonomy + ticker membership) are fixed structural
 * config, same status as mergePulse's "which indices exist" — pctChange/trend
 * are only ever real, computed by the merge functions in heatmap.tsx and
 * dashboard.tsx from live sector/company data. This base array's own
 * pctChange/trend values are merge-input placeholders, never rendered as-is.
 */
export interface SectorRow { name: string; rank: number; trend: string | null; pctChange: number | null; items: [string, number, number][]; }
export interface ScreenerStock {
  ticker: string; name: string; sector: string;
  marketCap: number; peRatio: number;
  relativeStrength: number;
  salesGrowth: number;
  epsGrowth: number;
  grossMargin: number;
  rvolRatio: number;
  techRating: string;
}

// ---- Market Pulse (10 items) ----

// ---- What Matters Now ----
export interface ScreenerPreset {
  name: string;
  desc: string;
  f: { relativeStrength_min?: number; salesGrowth_min?: number; epsGrowth_min?: number; rvolRatio_min?: number; techRating?: string[]; marketCap_min?: number; };
}

export const screenerPresets: ScreenerPreset[] = [
  { name: 'Briefing growth screen',      desc: '6-mo RS ≥ 80 · sales & EPS growth · expanding margins', f: { relativeStrength_min: 80, salesGrowth_min: 20, epsGrowth_min: 25 } },
  { name: 'Post-earnings momentum',      desc: 'beat + raise · gap up · RVOL > 2×',                      f: { rvolRatio_min: 2 } },
  { name: 'Oversold quality',            desc: 'RSI < 35 · positive FCF · above 200-DMA',                f: {} },
  { name: 'Unusual volume',              desc: 'RVOL > 3× · price > $5',                                 f: { rvolRatio_min: 3 } },
  { name: 'CAN SLIM leaders',            desc: "O'Neil: EPS+sales accel · RS ≥ 90 · near highs",         f: { relativeStrength_min: 90, salesGrowth_min: 15, epsGrowth_min: 20 } },
  { name: 'Minervini trend template',    desc: 'price > 50 > 150 > 200-DMA, all rising',                 f: { relativeStrength_min: 75 } },
  { name: '52-week-high breakouts',      desc: 'new 52w high · volume surge',                             f: { rvolRatio_min: 1.5, relativeStrength_min: 80 } },
  { name: 'Gap-and-go (premarket)',      desc: 'gap > 4% · premarket RVOL > 5×',                          f: { rvolRatio_min: 3 } },
  { name: 'Relative-strength leaders',  desc: 'RS ≥ 90 vs S&P over 6 months',                            f: { relativeStrength_min: 90 } },
  { name: 'Dividend growth aristocrats', desc: '25-yr dividend growth · payout < 60%',                   f: {} },
  { name: 'Magic Formula (Greenblatt)', desc: 'high ROIC · high earnings yield',                          f: {} },
  { name: 'GARP',                        desc: 'growth ≥ 15% · PEG < 1.5',                               f: { salesGrowth_min: 15, epsGrowth_min: 15 } },
  { name: 'Deep value (low P/E + FCF)', desc: 'P/E < 12 · FCF yield > 8%',                               f: {} },
  { name: 'Net-net / asset value',       desc: 'price < net current assets',                              f: {} },
  { name: 'Short-squeeze candidates',   desc: 'short interest > 20% · rising price',                     f: { relativeStrength_min: 60 } },
  { name: 'Insider-buying cluster',      desc: '3+ insider buys in 90 days',                              f: {} },
  { name: 'Analyst-upgrade momentum',   desc: '2+ upgrades in 30 days · PT raised',                      f: { relativeStrength_min: 70 } },
  { name: 'Golden cross (50>200)',       desc: '50-DMA crossing above 200-DMA',                           f: { relativeStrength_min: 65 } },
  { name: 'Bollinger squeeze breakout', desc: 'low volatility → expansion',                               f: { rvolRatio_min: 2 } },
  { name: 'Cup-with-handle setups',     desc: 'classic base · breakout pivot',                            f: { relativeStrength_min: 80 } },
];

// ---- Commentary (live intraday feed) ----