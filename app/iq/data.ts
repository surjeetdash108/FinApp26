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
  catalystLabel: string; maPosture: string; owned: boolean;
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
export const pulse: PulseItem[] = [
  { label: 'S&P 500',      value: 5312.08,  change: 0.73,  open: 5281.4,  prevClose: 5273.66 },
  { label: 'Nasdaq',       value: 16973.17, change: 1.02,  open: 16800.0, prevClose: 16801.7 },
  { label: 'Dow',          value: 39872.4,  change: 0.41,  open: 39714.0, prevClose: 39709.6 },
  { label: 'Russell 2K',   value: 2061.3,   change: -0.32, open: 2071.4,  prevClose: 2067.9  },
  { label: 'VIX',          value: 14.18,    change: -2.51, open: 14.52,   prevClose: 14.54   },
  { label: '10Y Yield',    value: 4.32,     change: -0.04, open: 4.36,    prevClose: 4.36    },
  { label: 'WTI Crude',    value: 78.64,    change: -1.21, open: 79.42,   prevClose: 79.60   },
  { label: 'Gold',         value: 2344.10,  change: 0.31,  open: 2337.0,  prevClose: 2336.8  },
  { label: 'Dollar (DXY)', value: 104.21,   change: 0.12,  open: 104.08,  prevClose: 104.09  },
];

// ---- What Matters Now ----
function _hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const _bigCap: Record<string, number> = {
  NVDA: 2910, MSFT: 3100, AAPL: 3000, AMZN: 1900, META: 1200,
  AVGO: 612, GOOG: 2100, TSLA: 536, 'BRK.B': 860, JPM: 560,
};
function _mcap(t: string): number { return _bigCap[t] || (12 + _hash(t) % 270); }

const SEC: [string, number, string[]][] = [
  ['Semiconductors',   3.1,  ['NVDA','AVGO','TSM','QCOM','AMD','TXN','MU','AMAT','KLAC','LRCX','INTC','ON','MRVL','MPWR']],
  ['Mega-Cap Tech',    2.4,  ['AAPL','MSFT','GOOG','AMZN','META','NFLX','ORCL','ADBE','CSCO','IBM','SAP','INTU']],
  ['Cloud Software',   1.8,  ['CRM','NOW','SNOW','DDOG','MDB','WDAY','ADSK','VEEV','HUBS','OKTA','ZI','APP','TEAM']],
  ['Social Media',     2.1,  ['META','SNAP','PINS','RDDT','YELP','MTCH','ZG','IAC','ANGI','BMBL','SOFI','HOOD']],
  ['E-Commerce',       1.5,  ['AMZN','SHOP','BABA','MELI','JD','PDD','EBAY','ETSY','W','CHWY','WISH','CART']],
  ['Cybersecurity',    0.9,  ['CRWD','PANW','ZS','FTNT','S','OKTA','CYBR','NET','GEN','TENB','QLYS','RPM']],
  ['EV / Clean Energy',-1.3, ['TSLA','BYD','RIVN','NIO','LCID','GM','F','PLUG','FCEL','BLNK','BE','CHPT','NKLA']],
  ['Consumer Disc.',   0.6,  ['AMZN','HD','MCD','NKE','SBUX','TGT','LULU','CMG','LOW','BKNG','MAR','HLT','DG']],
  ['Financials',       0.8,  ['JPM','BAC','GS','MS','V','MA','AXP','BRK.B','WFC','C','SCHW','BX','KKR']],
  ['Healthcare',       0.2,  ['UNH','JNJ','LLY','ABBV','MRK','TMO','DHR','PFE','BMY','GILD','CVS','CI','HUM']],
  ['Energy',          -0.7,  ['XOM','CVX','COP','SLB','EOG','OXY','PSX','VLO','MPC','HAL','DVN','PXD','BKR']],
  ['Industrials',      0.4,  ['CAT','GE','HON','RTX','UPS','LMT','NOC','GD','MMM','EMR','ETN','ITW','PH']],
  ['Real Estate',     -0.5,  ['AMT','PLD','EQIX','SPG','O','WELL','DLR','PSA','VTR','AVB','EQR','ARE','WY']],
  ['Utilities',       -0.3,  ['NEE','DUK','SO','AEP','EXC','D','PCG','SRE','ES','XEL','PEG','ED','WEC']],
  ['Materials',        0.1,  ['LIN','APD','SHW','FCX','NEM','DOW','DD','NUE','ALB','MOS','IP','PKG','CE']],
  ['Consumer Staples', 0.3,  ['PG','KO','PEP','WMT','COST','PM','MO','CL','GIS','KMB','KHC','SYY','MKC']],
  ['Biotech',          1.2,  ['AMGN','BIIB','REGN','VRTX','MRNA','GILD','ILMN','ALNY','EXAS','SGEN','SAGE','SRPT']],
  ['Med Devices',      0.5,  ['MDT','ABT','ISRG','BSX','SYK','EW','ZBH','BDX','IQV','TMO','RMD','HOLX']],
  ['Insurance',        0.6,  ['CB','MET','AIG','PRU','AFL','TRV','ALL','MKL','HIG','LNC','GL','EQH']],
  ['Banks',            0.9,  ['JPM','BAC','WFC','C','USB','PNC','TFC','FITB','KEY','RF','HBAN','CFG','MTB']],
  ['Autos',           -0.8,  ['TSLA','TM','GM','F','STLA','HMC','RIVN','NIO','LCID','RACE','BWM','VWAGY']],
];

export const sectorList: SectorRow[] = SEC.map((row, i) => {
  const [name, pctChange, tk] = row;
  return {
    name, rank: i + 1,
    trend: pctChange > 0.5 ? 'Improving' : pctChange < -0.5 ? 'Deteriorating' : 'Flat',
    pctChange,
    items: tk.map(t => [t, _mcap(t), +(pctChange + ((_hash(t + name) % 9) - 4) * 0.35).toFixed(2)] as [string, number, number]),
  };
});

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