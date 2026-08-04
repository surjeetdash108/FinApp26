// ============================================================
// STOCKWISE — MOCK DATA (TypeScript)
// ============================================================

export interface PulseItem { label: string; value: number; change: number; open: number; prevClose: number; }
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
export interface SectorRow { name: string; rank: number; trend: string; pctChange: number; items: [string, number, number][]; }
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
export const wmn: WMNItem[] = [
  { headline: 'Cooler CPI print', body: 'May core inflation came in at <b>0.2% m/m</b>, below the 0.3% estimate — yields fell and rate-cut odds for September rose.', tag: 'macro' },
  { headline: 'NVDA earnings beat', body: '<span class="sym up">NVDA</span> beat EPS by 18% and raised FY25 guidance on Data Center demand. Stock <b class="up">+8.2%</b>.', tag: 'earn' },
  { headline: 'Fed minutes: higher-for-longer tone', body: 'FOMC minutes reiterated patience; committee needs <b>more evidence</b> before cutting. September cut probability fell to 38%.', tag: 'macro' },
  { headline: 'Target misses and guides down', body: '<span class="sym down">TGT</span> Q1 EPS missed by 11%; full-year guidance cut. Consumer discretionary facing <b class="warn">margin pressure</b>.', tag: 'earn' },
  { headline: 'Oil slides on demand concerns', body: 'Brent crude fell below $80 as OPEC+ compliance data disappointed. Energy sector <b class="down">−1.8%</b>.', tag: 'sector' },
  { headline: 'Semis rally on AI capex data', body: 'AMD, AVGO, MRVL all up 3–5% on strong hyperscaler spending signals from MSFT and GOOG earnings guidance.', tag: 'sector' },
  { headline: 'Dollar weakens on soft data', body: 'DXY slipped to 104.1 after softer jobs and CPI prints. Emerging-market equities and commodities caught a bid.', tag: 'macro' },
  { headline: 'JPM raises S&P 500 target', body: '<span class="sym">JPM</span> strategists lifted their year-end S&P 500 target to <b>5,800</b>, citing stronger-than-expected earnings resilience.', tag: 'macro' },
];

// ---- Earnings ----
export const earnings: Earning[] = [
  { ticker: 'NVDA', name: 'Nvidia',   session: 'Wed post', marketCap: '$2.91T', sector: 'Semiconductors', epsEstimate: 5.56, epsActual: 6.57,  revenueEstimate: 24.6,  revenueActual: 26.0,  guidanceStatus: 'Raised',   priceReaction: 8.2,  tags: ['Beat', 'Raised'], owned: true,  impliedMove: 7.2 },
  { ticker: 'MSFT', name: 'Microsoft',session: 'Tue post', marketCap: '$3.1T',  sector: 'Software',       epsEstimate: 2.82, epsActual: 2.94,  revenueEstimate: 60.8,  revenueActual: 61.9,  guidanceStatus: 'In-line', priceReaction: 2.1,  tags: ['Beat'],          owned: true,  impliedMove: 4.1 },
  { ticker: 'AMZN', name: 'Amazon',   session: 'Thu post', marketCap: '$1.9T',  sector: 'E-Commerce',     epsEstimate: 0.98, epsActual: null,  revenueEstimate: 142.6, revenueActual: null,  guidanceStatus: null,      priceReaction: null, tags: [],                owned: false, impliedMove: 5.8 },
  { ticker: 'GOOG', name: 'Alphabet', session: 'Mon post', marketCap: '$2.1T',  sector: 'Internet',       epsEstimate: 1.84, epsActual: 1.89,  revenueEstimate: 79.9,  revenueActual: 80.5,  guidanceStatus: 'In-line', priceReaction: 1.3,  tags: ['Beat'],          owned: false, impliedMove: 3.9 },
  { ticker: 'META', name: 'Meta',     session: 'Wed post', marketCap: '$1.2T',  sector: 'Social Media',   epsEstimate: 4.71, epsActual: 4.86,  revenueEstimate: 36.2,  revenueActual: 36.5,  guidanceStatus: 'Raised',  priceReaction: 3.2,  tags: ['Beat', 'Raised'], owned: true, impliedMove: 5.5 },
  { ticker: 'AAPL', name: 'Apple',    session: 'Thu post', marketCap: '$3.0T',  sector: 'Hardware',       epsEstimate: 1.50, epsActual: null,  revenueEstimate: 89.3,  revenueActual: null,  guidanceStatus: null,      priceReaction: null, tags: [],                owned: true,  impliedMove: 3.2 },
  { ticker: 'TGT',  name: 'Target',   session: 'Wed pre',  marketCap: '$58B',   sector: 'Retail',         epsEstimate: 2.05, epsActual: 1.82,  revenueEstimate: 24.5,  revenueActual: 24.1,  guidanceStatus: 'Lowered', priceReaction: -7.8, tags: ['Miss', 'Lowered'], owned: false, impliedMove: 4.6 },
  { ticker: 'WMT',  name: 'Walmart',  session: 'Thu pre',  marketCap: '$480B',  sector: 'Retail',         epsEstimate: 0.52, epsActual: 0.60,  revenueEstimate: 159.5, revenueActual: 161.5, guidanceStatus: 'Raised',  priceReaction: 5.2,  tags: ['Beat', 'Raised'], owned: false, impliedMove: 2.9 },
];

// ---- Market Movers ----
export const movers: Mover[] = [
  { ticker: 'NVDA', name: 'Nvidia',     price: 1181.75, pctChange:  8.23, rvolRatio: 5.8, relativeStrength: 96, catalystLabel: 'Earnings beat',     maPosture: 'Above 50/200', owned: true,  sector: 'Semis',    cap: 'Mega',  weekPct: 18.9, techContext: 'Above 50/200 · RVOL 5.8× · RS 96/99. Buyers in control — momentum positive.', newsContext: 'Earnings beat is driving today\'s move.' },
  { ticker: 'ZIM',  name: 'ZIM Int\'l', price:   18.42, pctChange:  9.97, rvolRatio: 4.2, relativeStrength: 81, catalystLabel: 'Earnings beat',     maPosture: 'Above 50/200', owned: false, sector: 'Shipping', cap: 'Small', weekPct: 22.1, techContext: 'Above 50/200 · RVOL 4.2× · RS 81/99. Buyers in control — momentum positive.', newsContext: 'Earnings beat is driving today\'s move.' },
  { ticker: 'PLTR', name: 'Palantir',   price:   24.88, pctChange:  6.18, rvolRatio: 3.4, relativeStrength: 88, catalystLabel: 'Guidance raise',    maPosture: 'Above 50/200', owned: false, sector: 'Software', cap: 'Large', weekPct: 14.2, techContext: 'Above 50/200 · RVOL 3.4× · RS 88/99. Buyers in control — momentum positive.', newsContext: 'Guidance raise is driving today\'s move.' },
  { ticker: 'AVGO', name: 'Broadcom',   price: 1402.50, pctChange:  2.97, rvolRatio: 1.9, relativeStrength: 77, catalystLabel: 'Sympathy (semis)', maPosture: 'Above 50/200', owned: false, sector: 'Semis',    cap: 'Mega',  weekPct:  7.4, techContext: 'Above 50/200 · RVOL 1.9× · RS 77/99. Buyers in control — momentum positive.', newsContext: 'Sympathy (semis) is driving today\'s move.' },
  { ticker: 'CRM',  name: 'Salesforce', price:  316.50, pctChange:  4.21, rvolRatio: 2.6, relativeStrength: 73, catalystLabel: 'Analyst upgrade',   maPosture: 'Above 50/200', owned: false, sector: 'Software', cap: 'Large', weekPct:  9.6, techContext: 'Above 50/200 · RVOL 2.6× · RS 73/99. Buyers in control — momentum positive.', newsContext: 'Analyst upgrade is driving today\'s move.' },
  { ticker: 'DELL', name: 'Dell',       price:  161.80, pctChange: -3.45, rvolRatio: 3.1, relativeStrength: 42, catalystLabel: 'Margin miss',       maPosture: 'Below 50/200', owned: false, sector: 'Hardware', cap: 'Large', weekPct: -6.1, techContext: 'Below 50/200 · RVOL 3.1× · RS 42/99. Under distribution — momentum negative.', newsContext: 'Margin miss is driving today\'s move.' },
  { ticker: 'WBA',  name: 'Walgreens',  price:   15.30, pctChange: -5.80, rvolRatio: 2.7, relativeStrength: 18, catalystLabel: 'Guidance cut',      maPosture: 'Below 50/200', owned: false, sector: 'Retail',   cap: 'Mid',   weekPct:-11.3, techContext: 'Below 50/200 · RVOL 2.7× · RS 18/99. Under distribution — momentum negative.', newsContext: 'Guidance cut is driving today\'s move.' },
  { ticker: 'INTC', name: 'Intel',      price:   30.12, pctChange: -1.80, rvolRatio: 1.4, relativeStrength: 24, catalystLabel: 'No known catalyst', maPosture: 'Below 50/200', owned: false, sector: 'Semis',    cap: 'Large', weekPct: -4.2, techContext: 'Below 50/200 · RVOL 1.4× · RS 24/99. Under distribution — momentum negative.', newsContext: 'No company-specific headline — trading with its sector and the broad tape.' },
];

// ---- Analyst Actions ----
export const analyst: AnalystAction[] = [
  // CRM — 6 actions (consensus shift flagged)
  { ticker: 'CRM',  name: 'Salesforce', firm: 'Morgan Stanley', actionType: 'up',   previousRating: 'Equal Weight',   newRating: 'Overweight',  prevPriceTarget: 280,  newPriceTarget: 340,  priceChangeSince:  3.80, actionsLast30Days: 6, owned: false },
  { ticker: 'CRM',  name: 'Salesforce', firm: 'Bernstein',      actionType: 'up',   previousRating: 'Market Perform', newRating: 'Outperform',  prevPriceTarget: 260,  newPriceTarget: 320,  priceChangeSince:  2.90, actionsLast30Days: 6, owned: false },
  { ticker: 'CRM',  name: 'Salesforce', firm: 'RBC Capital',    actionType: 'up',   previousRating: 'Sector Perform', newRating: 'Outperform',  prevPriceTarget: 270,  newPriceTarget: 330,  priceChangeSince:  3.10, actionsLast30Days: 6, owned: false },
  { ticker: 'CRM',  name: 'Salesforce', firm: 'Piper Sandler',  actionType: 'up',   previousRating: 'Neutral',        newRating: 'Overweight',  prevPriceTarget: 265,  newPriceTarget: 315,  priceChangeSince:  1.80, actionsLast30Days: 6, owned: false },
  { ticker: 'CRM',  name: 'Salesforce', firm: 'Wolfe Research', actionType: 'up',   previousRating: 'Peer Perform',   newRating: 'Outperform',  prevPriceTarget: 275,  newPriceTarget: 335,  priceChangeSince:  2.50, actionsLast30Days: 6, owned: false },
  { ticker: 'CRM',  name: 'Salesforce', firm: 'Barclays',       actionType: 'init', previousRating: '—',              newRating: 'Overweight',  prevPriceTarget: 0,    newPriceTarget: 350,  priceChangeSince:  4.20, actionsLast30Days: 6, owned: false },
  // NVDA — 5 actions
  { ticker: 'NVDA', name: 'Nvidia',     firm: 'Goldman Sachs',  actionType: 'up',   previousRating: 'Buy',            newRating: 'Strong Buy',  prevPriceTarget: 1000, newPriceTarget: 1250, priceChangeSince:  8.23, actionsLast30Days: 5, owned: true  },
  { ticker: 'NVDA', name: 'Nvidia',     firm: 'JPMorgan',       actionType: 'up',   previousRating: 'Overweight',     newRating: 'Overweight',  prevPriceTarget: 950,  newPriceTarget: 1200, priceChangeSince:  5.10, actionsLast30Days: 5, owned: true  },
  { ticker: 'NVDA', name: 'Nvidia',     firm: 'Wedbush',        actionType: 'up',   previousRating: 'Outperform',     newRating: 'Outperform',  prevPriceTarget: 900,  newPriceTarget: 1180, priceChangeSince:  6.40, actionsLast30Days: 5, owned: true  },
  { ticker: 'NVDA', name: 'Nvidia',     firm: 'Bank of America',actionType: 'up',   previousRating: 'Buy',            newRating: 'Buy',         prevPriceTarget: 1050, newPriceTarget: 1300, priceChangeSince:  7.80, actionsLast30Days: 5, owned: true  },
  { ticker: 'NVDA', name: 'Nvidia',     firm: 'Mizuho',         actionType: 'up',   previousRating: 'Outperform',     newRating: 'Outperform',  prevPriceTarget: 980,  newPriceTarget: 1220, priceChangeSince:  4.60, actionsLast30Days: 5, owned: true  },
  // Others
  { ticker: 'TSLA', name: 'Tesla',      firm: 'UBS',            actionType: 'up',   previousRating: 'Sell',           newRating: 'Neutral',     prevPriceTarget: 120,  newPriceTarget: 135,  priceChangeSince:  3.45, actionsLast30Days: 2, owned: true  },
  { ticker: 'AAPL', name: 'Apple',      firm: 'Morgan Stanley', actionType: 'up',   previousRating: 'Neutral',        newRating: 'Buy',         prevPriceTarget: 195,  newPriceTarget: 215,  priceChangeSince:  1.02, actionsLast30Days: 1, owned: true  },
  { ticker: 'AMZN', name: 'Amazon',     firm: 'Citi',           actionType: 'hold', previousRating: 'Buy',            newRating: 'Buy',         prevPriceTarget: 205,  newPriceTarget: 225,  priceChangeSince:  2.11, actionsLast30Days: 2, owned: false },
  { ticker: 'INTC', name: 'Intel',      firm: 'Deutsche Bank',  actionType: 'down', previousRating: 'Buy',            newRating: 'Neutral',     prevPriceTarget: 50,   newPriceTarget: 32,   priceChangeSince: -2.14, actionsLast30Days: 1, owned: false },
  { ticker: 'GOOG', name: 'Alphabet',   firm: 'BofA',           actionType: 'hold', previousRating: 'Buy',            newRating: 'Buy',         prevPriceTarget: 195,  newPriceTarget: 210,  priceChangeSince:  1.30, actionsLast30Days: 2, owned: false },
  { ticker: 'META', name: 'Meta',       firm: 'Wells Fargo',    actionType: 'init', previousRating: '—',              newRating: 'Overweight',  prevPriceTarget: 0,    newPriceTarget: 550,  priceChangeSince:  2.40, actionsLast30Days: 1, owned: true  },
  { ticker: 'MSFT', name: 'Microsoft',  firm: 'Oppenheimer',    actionType: 'up',   previousRating: 'Perform',        newRating: 'Outperform',  prevPriceTarget: 380,  newPriceTarget: 450,  priceChangeSince:  1.90, actionsLast30Days: 1, owned: true  },
];

// ---- Portfolio ----
export const folio: FolioItem[] = [
  { ticker: 'NVDA', name: 'NVIDIA',     price: 1181.75, pctChange:  8.23, gainLossPct:  42.60, positionSize: 'Large',  conviction: 'High',   eventNote: 'Earnings beat · raised guide' },
  { ticker: 'AAPL', name: 'Apple',      price:  189.98, pctChange:  1.02, gainLossPct:  12.40, positionSize: 'Large',  conviction: 'High',   eventNote: 'Reports after close today' },
  { ticker: 'TSLA', name: 'Tesla',      price:  171.40, pctChange:  3.45, gainLossPct:  -8.10, positionSize: 'Medium', conviction: 'Medium', eventNote: 'UBS upgrade to Neutral' },
  { ticker: 'META', name: 'Meta',       price:  415.32, pctChange:  0.86, gainLossPct:  28.90, positionSize: 'Medium', conviction: 'High',   eventNote: 'WF initiates Overweight' },
  { ticker: 'HD',   name: 'Home Depot', price:  342.10, pctChange: -1.10, gainLossPct:   4.20, positionSize: 'Small',  conviction: 'Low',    eventNote: 'Lowered guidance' },
  { ticker: 'MSFT', name: 'Microsoft',  price:  415.50, pctChange:  0.41, gainLossPct:  19.70, positionSize: 'Large',  conviction: 'High',   eventNote: '—' },
  { ticker: 'AMZN', name: 'Amazon',     price:  182.20, pctChange:  2.11, gainLossPct:  30.14, positionSize: 'Medium', conviction: 'High',   eventNote: '—' },
  { ticker: 'PLTR', name: 'Palantir',   price:   24.88, pctChange:  6.18, gainLossPct:  55.50, positionSize: 'Small',  conviction: 'High',   eventNote: 'Guidance raise' },
];

// ---- 13F Funds ----
export const funds: Fund[] = [
  { fundName: 'Berkshire Hathaway', avatar: 'BH', managerName: 'Warren Buffett',  aum: '$331B',  totalPositions: 42,  topHolding: 'AAPL', newPositions: 1,   exitCount: 2,  quarter: 'Q1 2024' },
  { fundName: 'Pershing Square',    avatar: 'PS', managerName: 'Bill Ackman',      aum: '$10.4B', totalPositions: 8,   topHolding: 'CMG',  newPositions: 1,   exitCount: 1,  quarter: 'Q1 2024' },
  { fundName: 'Tiger Global',       avatar: 'TG', managerName: 'Chase Coleman',    aum: '$24.9B', totalPositions: 34,  topHolding: 'MSFT', newPositions: 5,   exitCount: 6,  quarter: 'Q1 2024' },
  { fundName: 'Scion Asset Mgmt',   avatar: 'SC', managerName: 'Michael Burry',    aum: '$1.6B',  totalPositions: 11,  topHolding: 'BABA', newPositions: 4,   exitCount: 3,  quarter: 'Q1 2024' },
  { fundName: 'Bridgewater',        avatar: 'BW', managerName: 'Ray Dalio (fmr)',  aum: '$19.8B', totalPositions: 680, topHolding: 'IVV',  newPositions: 120, exitCount: 90, quarter: 'Q1 2024' },
];

// ---- Watchlist ----
export const watch: WatchItem[] = [
  { ticker: 'AMD',  name: 'Adv Micro Dev', price: 165.20,  pctChange: -2.10, nextEarningsDate: 'Jul 30', lastAnalystAction: 'JPM → Neutral',     hasOptions: true,  latestHeadline: 'Downgraded on AI-share concerns' },
  { ticker: 'AVGO', name: 'Broadcom',      price: 1402.50, pctChange:  2.97, nextEarningsDate: 'Jun 12', lastAnalystAction: null,                  hasOptions: true,  latestHeadline: 'Semis rally on NVDA read-through' },
  { ticker: 'SMCI', name: 'Super Micro',   price:  812.40, pctChange:  5.60, nextEarningsDate: 'Aug 06', lastAnalystAction: 'Barclays PT $1,000',  hasOptions: true,  latestHeadline: 'Server demand commentary lifts shares' },
  { ticker: 'UBER', name: 'Uber',          price:   64.50, pctChange:  0.80, nextEarningsDate: 'Aug 06', lastAnalystAction: 'GS reiterates Buy',   hasOptions: false, latestHeadline: '—' },
  { ticker: 'PLTR', name: 'Palantir',      price:   24.88, pctChange:  6.18, nextEarningsDate: 'Aug 05', lastAnalystAction: null,                  hasOptions: true,  latestHeadline: 'Guidance raise drives momentum' },
];

// ---- Stock Detail ----
export const stockInfo: Record<string, StockInfo> = {
  NVDA: {
    name: 'Nvidia', price: 1025, pctChange: 8.2, marketCap: '$2.91T', peRatio: 78, eps: 13.14,
    week52High: 1250, week52Low: 350, dividendYield: 0.04, beta: 1.72, sector: 'Semiconductors',
    aiRating: 'Strong Buy',
    aiThesis: "NVDA's data center dominance, Hopper architecture moat, and accelerating AI inference demand make this the best-positioned semiconductor for the AI buildout cycle. H200 supply constraints are easing into H2 2025, with Blackwell ramping.",
    aiRisk: 'Valuation pricing in perfection; any miss on data center revenue could compress the multiple sharply. AMD/Intel competition timeline uncertain.',
    aiMetrics: [
      { label: 'AI Confidence', value: '94 / 100' }, { label: 'Moat', value: 'Wide' },
      { label: 'Insider Activity', value: 'Neutral' }, { label: 'Short Interest', value: '0.8%' },
    ],
    financials: [
      { label: 'Revenue', value: '$26.0B' }, { label: 'EPS', value: '$6.57' }, { label: 'Gross Margin', value: '78.4%' },
      { label: 'P/E', value: '78×' }, { label: 'P/S', value: '30×' }, { label: 'Debt/Equity', value: '0.43' },
    ],
    news: [
      { headline: 'NVDA raises FY25 Data Center forecast above $100B', date: 'May 22' },
      { headline: 'Blackwell GPU shipments on track for Q2 ramp — CEO Jensen Huang', date: 'May 21' },
      { headline: 'Microsoft Azure expands NVDA H200 cluster to 50K GPUs', date: 'May 19' },
    ],
    insiderActivity: [
      { name: 'Jensen Huang (CEO)', action: 'Plan 10b5-1 sale 50K sh', date: 'May 10' },
      { name: 'Colette Kress (CFO)', action: 'Plan 10b5-1 sale 8K sh', date: 'May 10' },
    ],
  },
  TSLA: {
    name: 'Tesla', price: 168, pctChange: -3.1, marketCap: '$536B', peRatio: 42, eps: 4.00,
    week52High: 295, week52Low: 138, dividendYield: 0, beta: 2.34, sector: 'Auto / EV',
    aiRating: 'Neutral',
    aiThesis: "Tesla's energy storage segment is growing rapidly, and FSD progress could unlock robotaxi optionality. However, near-term margin pressure from price cuts and China competition weigh on the thesis.",
    aiRisk: 'Margin deterioration from EV price war; execution risk on Cybertruck ramp; Elon distraction risk.',
    aiMetrics: [
      { label: 'AI Confidence', value: '51 / 100' }, { label: 'Moat', value: 'Narrow' },
      { label: 'Insider Activity', value: 'Selling' }, { label: 'Short Interest', value: '3.1%' },
    ],
    financials: [
      { label: 'Revenue', value: '$21.3B' }, { label: 'EPS', value: '$0.45' }, { label: 'Gross Margin', value: '17.4%' },
      { label: 'P/E', value: '42×' }, { label: 'P/S', value: '5.6×' }, { label: 'Debt/Equity', value: '0.15' },
    ],
    news: [
      { headline: 'Tesla cuts Model Y price in Europe for second time in 2025', date: 'May 23' },
      { headline: 'China EV sales fall 8% MoM in April — CAAM data', date: 'May 20' },
      { headline: 'FSD v12.4 rollout begins in North America', date: 'May 18' },
    ],
    insiderActivity: [{ name: 'Elon Musk (CEO)', action: 'No recent activity', date: '—' }],
  },
  MSFT: {
    name: 'Microsoft', price: 415, pctChange: 2.1, marketCap: '$3.1T', peRatio: 36, eps: 11.53,
    week52High: 430, week52Low: 310, dividendYield: 0.8, beta: 0.89, sector: 'Software',
    aiRating: 'Buy',
    aiThesis: 'Azure AI services growing 29% YoY, Copilot integration driving ARPU expansion across M365. Nuance and Activision integrations maturing. Dominant enterprise position provides durable moat.',
    aiRisk: 'AI monetization slower than expected; regulatory scrutiny on Activision; cloud competition from AWS and GCP intensifying.',
    aiMetrics: [
      { label: 'AI Confidence', value: '87 / 100' }, { label: 'Moat', value: 'Wide' },
      { label: 'Insider Activity', value: 'Neutral' }, { label: 'Short Interest', value: '0.5%' },
    ],
    financials: [
      { label: 'Revenue', value: '$61.9B' }, { label: 'EPS', value: '$2.94' }, { label: 'Gross Margin', value: '69.4%' },
      { label: 'P/E', value: '36×' }, { label: 'P/S', value: '14×' }, { label: 'Debt/Equity', value: '0.31' },
    ],
    news: [
      { headline: 'Azure OpenAI services available in 12 new regions', date: 'May 20' },
      { headline: 'Copilot for M365 reaches 1M paid seats — MSFT CEO', date: 'May 17' },
    ],
    insiderActivity: [{ name: 'Satya Nadella (CEO)', action: 'No recent activity', date: '—' }],
  },
};

// ---- Sector / Heatmap ----
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

export const sectorByName: Record<string, SectorRow> = Object.fromEntries(sectorList.map(s => [s.name, s]));

// ---- Screener ----
export const screenerStocks: ScreenerStock[] = [
  { ticker: 'NVDA', name: 'NVIDIA',       sector: 'Semis',    marketCap: 2910, peRatio: 71.4, relativeStrength: 98, salesGrowth: 262, epsGrowth: 486, grossMargin: 53, rvolRatio: 4.2, techRating: 'Strong Buy' },
  { ticker: 'AVGO', name: 'Broadcom',     sector: 'Semis',    marketCap: 648,  peRatio: 48.2, relativeStrength: 91, salesGrowth: 34,  epsGrowth: 12,  grossMargin: 46, rvolRatio: 1.8, techRating: 'Buy' },
  { ticker: 'CRM',  name: 'Salesforce',   sector: 'Software', marketCap: 281,  peRatio: 44.1, relativeStrength: 78, salesGrowth: 11,  epsGrowth: 44,  grossMargin: 30, rvolRatio: 2.2, techRating: 'Buy' },
  { ticker: 'PLTR', name: 'Palantir',     sector: 'Software', marketCap: 52,   peRatio: 66.0, relativeStrength: 88, salesGrowth: 21,  epsGrowth: 60,  grossMargin: 25, rvolRatio: 3.4, techRating: 'Strong Buy' },
  { ticker: 'META', name: 'Meta',         sector: 'Internet', marketCap: 1060, peRatio: 27.8, relativeStrength: 84, salesGrowth: 27,  epsGrowth: 117, grossMargin: 38, rvolRatio: 1.3, techRating: 'Buy' },
  { ticker: 'AMD',  name: 'Adv Micro Dev',sector: 'Semis',    marketCap: 266,  peRatio: 51.5, relativeStrength: 62, salesGrowth: 2,   epsGrowth: -7,  grossMargin: 11, rvolRatio: 1.9, techRating: 'Neutral' },
  { ticker: 'MU',   name: 'Micron',       sector: 'Semis',    marketCap: 152,  peRatio: 39.0, relativeStrength: 81, salesGrowth: 58,  epsGrowth: 120, grossMargin: 18, rvolRatio: 1.6, techRating: 'Buy' },
  { ticker: 'INTC', name: 'Intel',        sector: 'Semis',    marketCap: 128,  peRatio: 32.1, relativeStrength: 34, salesGrowth: -9,  epsGrowth: -40, grossMargin: 5,  rvolRatio: 1.9, techRating: 'Sell' },
  { ticker: 'SMCI', name: 'Super Micro',  sector: 'Hardware', marketCap: 48,   peRatio: 38.4, relativeStrength: 95, salesGrowth: 200, epsGrowth: 308, grossMargin: 14, rvolRatio: 4.8, techRating: 'Strong Buy' },
  { ticker: 'WBA',  name: 'Walgreens',    sector: 'Retail',   marketCap: 14,   peRatio: 6.2,  relativeStrength: 9,  salesGrowth: 6,   epsGrowth: -60, grossMargin: 2,  rvolRatio: 2.7, techRating: 'Strong Sell' },
  { ticker: 'ZIM',  name: 'ZIM Shipping', sector: 'Shipping', marketCap: 3,    peRatio: 5.0,  relativeStrength: 81, salesGrowth: 30,  epsGrowth: 120, grossMargin: 12, rvolRatio: 4.2, techRating: 'Buy' },
  { ticker: 'DELL', name: 'Dell Tech',    sector: 'Hardware', marketCap: 90,   peRatio: 18.0, relativeStrength: 42, salesGrowth: 6,   epsGrowth: 10,  grossMargin: 6,  rvolRatio: 3.1, techRating: 'Neutral' },
];

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
export const commentary: CommentaryItem[] = [
  { cat: 'Macro',       accent: 'var(--warn)',     time: '10:18a', text: 'Treasury yields extend decline; 10-year down to <b>4.32%</b>', why: 'Softer CPI keeps a September cut in play — supportive for long-duration growth names.' },
  { cat: 'Sector',      accent: 'var(--ai)',       time: '10:02a', text: 'Semiconductors lead all groups, <b>+3.1%</b>', why: "NVDA's print is lifting the whole complex; AVGO, MU, AMD all participating." },
  { cat: 'Earnings',    accent: 'var(--up)',       time: '9:31a',  text: '<b>NVDA</b> beats EPS by 18%, raises FY25 guidance', why: "Removes the market's biggest worry — that AI data-center demand was peaking." },
  { cat: 'Analyst',     accent: 'var(--brand-2)',  time: '9:18a',  text: 'Morgan Stanley upgrades <b>CRM</b> to Overweight, PT $340', why: 'Third upgrade this week; the sell-side is turning constructive on the margin story.' },
  { cat: 'Block Trade', accent: 'var(--ai)',       time: '9:05a',  text: '4.2M-share block in <b>XLF</b> crossed above VWAP', why: 'Large institutional buyer in financials aligns with today\'s risk-on rotation.' },
  { cat: 'Story Stock', accent: 'var(--warn)',     time: '8:58a',  text: '<b>ZIM</b> +10% on a blowout quarter and reinstated dividend', why: 'Freight-rate spike is flowing straight to the bottom line for shippers.' },
  { cat: 'Fed/Rates',   accent: 'var(--warn)',     time: '8:30a',  text: 'May core CPI <b>+0.2%</b> m/m vs +0.3% est.', why: 'First clean downside inflation surprise in months; rate-cut odds repriced higher.' },
];

// ---- End-of-Day Recap ----
export const recap: RecapData = {
  date: 'Tuesday, May 21',
  subtitle: 'auto-generated 4:31 ET',
  headline: 'Markets closed broadly higher on cooler inflation',
  indices: [
    { label: 'S&P 500',    value:  0.73 },
    { label: 'Nasdaq',     value:  1.02 },
    { label: 'Dow',        value:  0.41 },
    { label: 'Russell 2K', value: -0.32 },
  ],
  stories: [
    'Cooler-than-expected CPI lifted rate-cut hopes and sent yields lower.',
    "NVDA's beat-and-raise powered a 3.1% rally in semiconductors.",
    'Defensive sectors lagged as risk appetite returned across the tape.',
  ],
  tomorrow: [
    { time: '8:30a', event: 'Initial jobless claims' },
    { time: 'BMO',   event: 'Earnings: DELL, HD' },
    { time: '2:00p', event: 'FOMC minutes' },
    { time: 'AMC',   event: 'Earnings: SNOW, WDAY' },
  ],
  movers: [
    { ticker: 'NVDA', reason: 'Earnings beat',  pctChange:  8.23 },
    { ticker: 'ZIM',  reason: 'Earnings beat',  pctChange:  9.97 },
    { ticker: 'PLTR', reason: 'Guidance raise', pctChange:  6.18 },
    { ticker: 'DELL', reason: 'Margin miss',    pctChange: -3.45 },
    { ticker: 'WBA',  reason: 'Guidance cut',   pctChange: -5.80 },
  ],
  internals: [
    { label: 'Advancers / Decliners', value: '2,810 / 1,140', direction:  1 },
    { label: 'New 52-wk highs',       value: '184',            direction:  1 },
    { label: 'New 52-wk lows',        value: '39',             direction: -1 },
    { label: 'Up volume',             value: '71%',            direction:  1 },
  ],
};

// ---- 13F Fund Detail (for drawer) ----
export const fundDetail: Record<string, FundDetail> = {
  'Berkshire Hathaway': {
    holdings: [['AAPL',42.8,'reduced'],['BAC',10.9,'unchanged'],['AXP',7.6,'unchanged'],['KO',6.1,'unchanged'],['CVX',5.8,'unchanged'],['OXY',4.2,'unchanged'],['MCO',3.2,'unchanged'],['CB',2.8,'new'],['KHC',2.2,'unchanged'],['DVA',1.1,'unchanged']],
    buys: [['CB','New position disclosed at ~$6.7B'],['OXY','Added 7.2M shares (+4.3%)']],
    exits: [['HP','Fully exited'],['PARA','Fully exited']],
    theme: 'Berkshire trimmed its largest position (Apple) by 13% while sharply building cash reserves. Net posture turned more defensive this quarter — rotation away from mega-cap tech toward insurance and energy.',
    conc: 'Slightly less concentrated: top-5 weight fell from 79% to 75% after the Apple trim. Still extremely concentrated by typical fund standards.',
  },
  'Pershing Square': {
    holdings: [['CMG',24.1,'unchanged'],['HLT',21.3,'unchanged'],['CP',15.6,'unchanged'],['GOOGL',11.3,'new'],['QSR',9.2,'unchanged'],['HHC',7.6,'reduced'],['FRPH',4.5,'unchanged'],['LOW',3.8,'new'],['OPK',1.6,'unchanged'],['UNH',1.0,'reduced']],
    buys: [['GOOGL','New position ~$2.1B (11.3% of portfolio)'],['LOW','Added $300M']],
    exits: [['NFLX','Fully exited after +62% gain']],
    theme: 'Ackman initiated a significant GOOGL position while adding to LOW, signaling conviction in AI-driven ad monetization and home improvement durability.',
    conc: 'Highly concentrated: top-5 positions = 81% of AUM. Deliberately concentrated, high-conviction style.',
  },
  'Tiger Global': {
    holdings: [['MSFT',18.2,'unchanged'],['NVDA',14.1,'added'],['META',9.8,'unchanged'],['AMZN',8.2,'unchanged'],['CRM',6.5,'new'],['GOOGL',6.1,'unchanged'],['DDOG',4.5,'added'],['CRWD',3.8,'new'],['NOW',3.1,'unchanged'],['SHOP',2.4,'reduced']],
    buys: [['NVDA','Added $1.1B (now #2 position)'],['CRM','New position $680M'],['CRWD','New position $450M']],
    exits: [['TSLA','Fully exited'],['NFLX','Fully exited'],['PTON','Fully exited'],['SPOT','Trimmed 80%'],['RBLX','Fully exited'],['LYFT','Fully exited']],
    theme: 'Tiger rotated aggressively into AI infrastructure plays — NVDA, CRM, CRWD — while exiting legacy/consumer tech names.',
    conc: 'Less concentrated than peers; top-10 = 77% of AUM. Showing high conviction in AI theme.',
  },
  'Scion Asset Mgmt': {
    holdings: [['BABA',31.5,'unchanged'],['JD',21.3,'added'],['REAL',14.8,'new'],['BIDU',8.6,'unchanged'],['PDD',7.4,'new'],['GOOG',6.5,'new'],['ACM',4.9,'unchanged'],['OLPX',2.3,'reduced'],['CPRI',1.8,'unchanged'],['GOOS',0.9,'unchanged']],
    buys: [['JD','Added 3.2M shares'],['REAL','New position'],['PDD','New position'],['GOOG','New position']],
    exits: [['GXO','Fully exited'],['WDC','Fully exited'],['HGV','Fully exited']],
    theme: 'Burry is doubling down on China + value plays. Significant new positions in Chinese e-commerce while adding a first U.S. tech position (GOOG).',
    conc: 'Extremely concentrated: top-5 = 84% of portfolio. Classic Burry high-conviction style.',
  },
  'Bridgewater': {
    holdings: [['IVV',14.3,'unchanged'],['SPY',11.2,'unchanged'],['EEM',8.6,'added'],['GLD',7.5,'added'],['VWO',6.2,'unchanged'],['IEMG',5.8,'unchanged'],['IEF',4.9,'new'],['TIP',4.2,'new'],['EFA',3.8,'unchanged'],['DIA',3.1,'reduced']],
    buys: [['EEM','Added $1.2B'],['GLD','Added $900M gold ETF'],['IEF','New position — rate positioning'],['TIP','New position — inflation hedge']],
    exits: [['BRK.B','Fully exited'],['MSFT','Reduced 60%'],['GOOG','Reduced 45%']],
    theme: 'Bridgewater shifted toward a classic all-weather defensive posture: more EM exposure, added gold and TIPS, reduced single-stock equity concentration.',
    conc: 'Portfolio is diversified across 680 positions — very low concentration by design (Ray Dalio philosophy).',
  },
};
