// ============================================================
// STOCKWISE — MOCK DATA (TypeScript)
// ============================================================

export interface PulseItem { label: string; value: number; change: number; open: number; prevClose: number; dayHigh?: number; dayLow?: number; }
export interface WMNItem { headline: string; body: string; tag: 'macro' | 'earn' | 'sector'; }
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
  weekPct: number; techContext: string; newsContext: string;
}
export interface AnalystAction {
  ticker: string; name: string; firm: string;
  actionType: 'up' | 'down' | 'init' | 'hold';
  previousRating: string; newRating: string;
  prevPriceTarget: number; newPriceTarget: number;
  priceChangeSince: number; actionsLast30Days: number; owned: boolean;
}
export interface FolioItem {
  ticker: string; name: string;
  price: number;
  pctChange: number;
  gainLossPct: number;
  positionSize: "Small" | "Medium" | "Large";
  conviction: "High" | "Medium" | "Low";
  eventNote: string;
}
export interface Fund {
  fundName: string; avatar: string; managerName: string;
  aum: string; totalPositions: number; topHolding: string;
  newPositions: number; exitCount: number; quarter: string;
}
export interface FundDetail {
  holdings: [string, number, string][];
  buys: [string, string][];
  exits: [string, string][];
  theme: string;
  conc: string;
}
export interface WatchItem {
  ticker: string; name: string; price: number; pctChange: number;
  nextEarningsDate: string; lastAnalystAction: string | null; hasOptions: boolean; latestHeadline: string;
}
export interface StockInfo {
  name: string; price: number; pctChange: number; marketCap: string;
  peRatio: number; eps: number; week52High: number; week52Low: number;
  dividendYield: number; beta: number; sector: string;
  aiRating: string; aiThesis: string; aiRisk: string;
  aiMetrics: { label: string; value: string; }[];
  financials: { label: string; value: string; }[];
  news: { headline: string; date: string; }[];
  insiderActivity: { name: string; action: string; date: string; }[];
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
export interface CommentaryItem {
  cat: string; accent: string; time: string; text: string; why: string;
}
export interface RecapData {
  date: string; subtitle: string; headline: string;
  indices: { label: string; value: number }[];
  stories: string[];
  tomorrow: { time: string; event: string }[];
  movers: { ticker: string; reason: string; pctChange: number }[];
  internals: { label: string; value: string; direction: number }[];
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