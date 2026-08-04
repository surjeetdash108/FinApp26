"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { firebaseAuth } from "../../firebase";
import { useIQActions, ExpandBtn } from "../shell";
import { type Mover, type SectorRow, type Earning, type FolioItem, type WatchItem, type ScreenerStock, type WMNItem } from "../data";
import { fmt, sign, cls, arr, Spark, SemiGauge, StockLogo, heatCol } from "../utils";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import { useTapeStream } from "../hooks/useTapeStream";
import { buildPulse, tapeItemsToIndexDocs } from "../live-market-indices";
import type {
  LiveMoverDoc, LiveEarningsDoc, CompanyDoc, SectorApiDoc,
  InsiderTxDoc, AnalystConsensusDoc, MarketSentimentDoc,
  WatchlistDoc, HoldingDoc, NewsArticleDoc,
} from "../types";

const INSIDER_MINI_MOCK = [
  { s: "NVDA", role: "CEO",        dir: "buy",  val: "4.8M" },
  { s: "MSFT", role: "CFO",        dir: "buy",  val: "2.2M" },
  { s: "META", role: "Director",   dir: "buy",  val: "880K" },
  { s: "AAPL", role: "10% owner",  dir: "sell", val: "12.1M" },
  { s: "TSLA", role: "10% owner",  dir: "sell", val: "22.4M" },
];

const MARKET_INTERNALS = [
  { k: "Advancing",      v: "2,186",  note: "NYSE+NASDAQ",         up: true  },
  { k: "Declining",      v: "1,247",  note: "",                    up: false },
  { k: "New 52W Highs",  v: "124",    note: "",                    up: true  },
  { k: "New 52W Lows",   v: "38",     note: "",                    up: false },
  { k: "Up Volume",      v: "68%",    note: "bullish",             up: true  },
  { k: "Down Volume",    v: "32%",    note: "",                    up: false },
  { k: "NYSE TICK",      v: "+420",   note: "bullish",             up: true  },
  { k: "TRIN (Arms)",    v: "0.74",   note: "< 1 = bullish",       up: true  },
  { k: "McClellan Osc",  v: "+38.5",  note: "breadth expanding",  up: true  },
  { k: "Put/Call Ratio", v: "0.82",   note: "neutral",             up: null  },
] as { k: string; v: string; note: string; up: boolean | null }[];

const FG_HISTORY = [
  { date: "Jun 25", val: 62, label: "Greed"       },
  { date: "Jun 18", val: 58, label: "Greed"       },
  { date: "Jun 11", val: 52, label: "Neutral"     },
  { date: "Jun 4",  val: 45, label: "Neutral"     },
  { date: "May 28", val: 38, label: "Fear"        },
  { date: "May 21", val: 32, label: "Fear"        },
  { date: "May 14", val: 28, label: "Fear"        },
  { date: "May 7",  val: 41, label: "Neutral"     },
  { date: "Apr 30", val: 55, label: "Neutral"     },
  { date: "Apr 23", val: 63, label: "Greed"       },
  { date: "Apr 16", val: 71, label: "Extreme Greed"},
  { date: "Apr 9",  val: 68, label: "Greed"       },
  { date: "Apr 2",  val: 60, label: "Greed"       },
  { date: "Mar 26", val: 48, label: "Neutral"     },
  { date: "Mar 19", val: 36, label: "Fear"        },
  { date: "Mar 12", val: 22, label: "Extreme Fear"},
  { date: "Mar 5",  val: 29, label: "Fear"        },
  { date: "Feb 26", val: 44, label: "Neutral"     },
  { date: "Feb 19", val: 61, label: "Greed"       },
  { date: "Feb 12", val: 74, label: "Extreme Greed"},
];

type DrawerKey = "earnings" | "movers" | "analyst" | "earn-movers" | "internals" | "watchlist" | "portfolio" | "insider" | "fg-history" | null;

// ---- Dash hover popup ----
type PopBlock = "earnings" | "movers" | "analyst" | "watchlist" | "portfolio" | "insider" | "screener";

interface PopState {
  sym: string;
  block: PopBlock;
  x: number;
  y: number;
}

const BLOCK_LABEL: Record<PopBlock, string> = {
  earnings:  "Earnings",
  movers:    "Movers",
  analyst:   "Analyst action",
  watchlist: "Watchlist",
  portfolio: "Portfolio",
  insider:   "Insider / 13F",
  screener:  "Screener",
};

const BLOCK_NAV: Record<PopBlock, string> = {
  earnings:  "earnings page",
  movers:    "movers page",
  analyst:   "analyst page",
  watchlist: "watchlist",
  portfolio: "portfolio",
  insider:   "insider feed",
  screener:  "screener",
};

function DpRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="dp-row">
      <span>{label}</span>
      <b>{children}</b>
    </div>
  );
}

// ---- live doc shapes (movers/earnings/companies/sectors/insider/analyst/
// watchlist/portfolio are promoted to ../types — Phase 2/3/5 of the
// UI→backend migration) ----


/**
 * Builds the mover row list directly from live Firestore market_movers data —
 * there is no mock base anymore. Each live row is overlaid with real RVOL
 * from companies.rvol when available; narrative fields with no live source
 * yet (relative strength, catalyst, moving-average posture, weekly change,
 * technical/news context) fall back to neutral/empty defaults. Mirrors
 * MoversScreen's buildMovers in ../screens/movers.tsx (independent, per-file
 * helper by design in this codebase).
 */
function buildMoversData(live: LiveMoverDoc[], companyRvol: Map<string, number | null>): Mover[] {
  const rv = (ticker: string) => companyRvol.get(ticker) ?? 1;
  return live.map(l => ({
    ticker: l.ticker, name: l.name ?? l.ticker, price: l.price, pctChange: l.pctChange,
    rvolRatio: rv(l.ticker), relativeStrength: 50, catalystLabel: "No known catalyst",
    maPosture: l.pctChange >= 0 ? "Above 50/200" : "Below 50/200", owned: false,
    sector: l.sector ?? "Unclassified", cap: (l.cap as Mover["cap"]) ?? "Mid", weekPct: l.pctChange,
    techContext: `Live EOD data as of ${l.asOfDate}. RVOL/technical context not available for this synced name yet.`,
    newsContext: "Live market data — catalyst not yet available from a connected news source.",
  }));
}

/**
 * Builds earnings rows directly from the live earnings_events feed — it only
 * supplies ticker/date/epsEstimate/epsActual, so every richer mock field
 * (name, sector, marketCap, tags, guidance, price reaction, implied move)
 * gets a graceful "unknown" default rather than a fabricated value.
 */
function buildEarningsData(live: LiveEarningsDoc[]): Earning[] {
  return live.map(l => ({
    ticker: l.ticker, name: l.ticker, session: "—", marketCap: "—", sector: "—",
    epsEstimate: l.epsEstimate, epsActual: l.epsActual,
    revenueEstimate: null, revenueActual: null,
    guidanceStatus: null, priceReaction: null,
    tags: [], owned: false, impliedMove: null,
  }));
}

function sectorTrend(pctChange: number): string {
  return pctChange > 0.5 ? "Improving" : pctChange < -0.5 ? "Deteriorating" : "Flat";
}

/**
 * Builds the sector list entirely from live data — companies grouped by their
 * reported `sector`, sector-level %change from the sectors feed (or averaged
 * from constituents when a sector doc hasn't synced yet). Mirrors
 * HeatmapScreen's buildSectorList in ../screens/heatmap.tsx exactly
 * (independent, per-file helper by design in this codebase).
 */
function buildSectorList(companies: CompanyDoc[], sectorsLive: SectorApiDoc[]): SectorRow[] {
  const bySector = new Map<string, CompanyDoc[]>();
  for (const c of companies) {
    if (!c.sector) continue;
    if (!bySector.has(c.sector)) bySector.set(c.sector, []);
    bySector.get(c.sector)!.push(c);
  }
  const sectorPctByName = new Map(sectorsLive.map(s => [s.sector, s.pctChange]));
  const names = new Set<string>([...bySector.keys(), ...sectorsLive.map(s => s.sector)]);

  const rows = [...names].map(name => {
    const members = bySector.get(name) ?? [];
    const pctChange = sectorPctByName.get(name) ?? (
      members.length > 0
        ? members.reduce((s, c) => s + (c.pctChange ?? 0), 0) / members.length
        : 0
    );
    const items: [string, number, number][] = members.map(c =>
      [c.ticker, c.marketCap != null ? c.marketCap / 1e9 : 0, c.pctChange ?? 0]);
    return { name, rank: 0, trend: sectorTrend(pctChange), pctChange, items };
  });

  return rows
    .sort((a, b) => b.pctChange - a.pctChange)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

function ratingLabel(n: number): string {
  if (n >= 90) return "Strong Buy";
  if (n >= 70) return "Buy";
  if (n >= 40) return "Neutral";
  if (n >= 20) return "Sell";
  return "Strong Sell";
}

/**
 * Builds the screener universe used by the Leaders/Laggards popovers and the
 * heatmap peer-detail tooltip, directly from live companies — mirrors
 * ScreenerScreen's buildScreenerStocks in ../screens/screener.tsx (independent,
 * per-file helper by design in this codebase).
 */
function buildScreenerStocks(companies: CompanyDoc[]): ScreenerStock[] {
  return companies
    .filter(c =>
      c.marketCap != null || c.peRatio != null || c.rsRating != null ||
      c.techRating != null || c.rvol != null || c.revenueGrowthYoY != null)
    .map(c => ({
      ticker: c.ticker,
      name: c.name ?? c.ticker,
      sector: c.sector ?? "—",
      marketCap: c.marketCap != null ? c.marketCap / 1e9 : 0,
      peRatio: c.peRatio ?? 0,
      relativeStrength: c.rsRating ?? 0,
      techRating: c.techRating != null ? ratingLabel(c.techRating) : "Neutral",
      rvolRatio: c.rvol ?? 0,
      salesGrowth: c.revenueGrowthYoY != null ? c.revenueGrowthYoY * 100 : 0,
      epsGrowth: c.epsGrowthYoY != null ? c.epsGrowthYoY * 100 : 0,
      grossMargin: c.grossMargin != null ? c.grossMargin * 100 : 0,
    }));
}

function DashPopContent({ sym, block, movers, earnings, watchlist, portfolio, screener, consensusByTicker }: {
  sym: string; block: PopBlock; movers: Mover[]; earnings: Earning[]; watchlist: WatchItem[]; portfolio: FolioItem[];
  screener: ScreenerStock[]; consensusByTicker: Map<string, AnalystConsensusDoc>;
}) {
  const mv  = movers.find(x => x.ticker ===sym);
  const er  = earnings.find(x => x.ticker ===sym);
  const co  = consensusByTicker.get(sym);
  const w   = watchlist.find(x => x.ticker ===sym);
  const pf  = portfolio.find(x => x.ticker ===sym);
  const scr = screener.find(x => x.ticker ===sym);
  const ins = INSIDER_MINI_MOCK.find(x => x.s === sym);
  const name = mv?.name ?? er?.name ?? w?.name ?? scr?.name ?? sym;

  let body: React.ReactNode;

  if (block === "earnings") {
    if (er) {
      body = <>
        <DpRow label="When">{er.session === "BMO" ? "Before open" : er.session === "AMC" ? "After close" : er.session}</DpRow>
        <DpRow label="EPS est → act">
          {er.epsEstimate != null ? `$${er.epsEstimate}` : "—"}{er.epsActual != null && er.epsEstimate != null && <> → ${er.epsActual} <span className={er.epsActual >= er.epsEstimate ? "up" : "down"}>({er.epsActual >= er.epsEstimate ? "beat" : "miss"})</span></>}
        </DpRow>
        <DpRow label="Guidance">
          <span className={er.guidanceStatus === "Raised" ? "up" : er.guidanceStatus === "Lowered" ? "down" : ""}>{er.guidanceStatus ?? "—"}</span>
        </DpRow>
        {er.priceReaction != null
          ? <DpRow label="Reaction"><span className={cls(er.priceReaction)}>{sign(er.priceReaction)}</span></DpRow>
          : er.impliedMove != null
          ? <DpRow label="Implied move">±{er.impliedMove}%</DpRow>
          : null
        }
        <div className="dp-note">
          {er.session === "BMO" || er.session === "AMC"
            ? <>Why it&apos;s here: reporting {er.session === "BMO" ? "before the open" : "after the close"}{er.guidanceStatus === "Raised" ? " — and raised guidance." : "."}</>
            : "On this week's earnings calendar."}
        </div>
      </>;
    } else {
      body = <div className="dp-note">On this week&apos;s earnings calendar.</div>;
    }
  } else if (block === "movers" && mv) {
    body = <>
      <DpRow label="Today"><span className={cls(mv.pctChange)}>{sign(mv.pctChange)}</span></DpRow>
      <DpRow label="Rel. volume">{mv.rvolRatio.toFixed(1)}×</DpRow>
      <DpRow label="Catalyst">{mv.catalystLabel}</DpRow>
      <DpRow label="Technicals">{mv.maPosture} · RS {mv.relativeStrength}</DpRow>
      <div className="dp-note">Why it&apos;s moving: {mv.catalystLabel === "No known catalyst" ? "trading with its sector and the broad tape" : mv.catalystLabel.toLowerCase()}, on {mv.rvolRatio.toFixed(1)}× normal volume.</div>
    </>;
  } else if (block === "analyst") {
    if (co) {
      body = <>
        <DpRow label="Consensus"><span style={{ color: "var(--up)" }}>{co.consensus}</span></DpRow>
        <DpRow label="Buy / Hold / Sell">{co.strongBuy + co.buy}B / {co.hold}H / {co.sell + co.strongSell}S</DpRow>
        <div className="dp-note">Why it&apos;s here: aggregate analyst consensus synced live — per-firm upgrade/downgrade events aren&apos;t available from this feed.</div>
      </>;
    } else {
      body = <div className="dp-note">No live analyst consensus data available for this ticker.</div>;
    }
  } else if (block === "watchlist") {
    const px = w?.price ?? mv?.price;
    body = <>
      {px != null && <DpRow label="Price"><span className="mono">${fmt(px, 2)}</span></DpRow>}
      <DpRow label="Day"><span className={cls(w?.pctChange ?? mv?.pctChange ?? 0)}>{sign(w?.pctChange ?? mv?.pctChange ?? 0)}</span></DpRow>
      {scr && <DpRow label="Mkt Cap">{scr.marketCap >= 1000 ? `${(scr.marketCap / 1000).toFixed(1)}T` : `${Math.round(scr.marketCap)}B`}</DpRow>}
      {scr && <DpRow label="P/E">{scr.peRatio > 0 ? scr.peRatio.toFixed(1) : "—"}</DpRow>}
      {scr && <DpRow label="RS rank">{scr.relativeStrength}/99</DpRow>}
      {scr && <DpRow label="Sector">{scr.sector}</DpRow>}
      <DpRow label="Next ER">{w?.nextEarningsDate ?? "—"}</DpRow>
      {co && <DpRow label="Analyst consensus"><span style={{ color: "var(--up)" }}>{co.consensus}</span></DpRow>}
      {w?.latestHeadline && w.latestHeadline !== "—" && <div className="dp-note">{w.latestHeadline}</div>}
    </>;
  } else if (block === "portfolio" && pf) {
    body = <>
      <DpRow label="Day"><span className={cls(pf.pctChange)}>{sign(pf.pctChange)}</span></DpRow>
      <DpRow label="Unrealized"><span className={cls(pf.gainLossPct)}>{pf.gainLossPct > 0 ? "+" : ""}{pf.gainLossPct.toFixed(1)}%</span></DpRow>
      <DpRow label="Conviction">{pf.conviction}</DpRow>
      <div className="dp-note">Why it&apos;s here: {pf.eventNote !== "—" ? pf.eventNote : "a position in your book"}.</div>
    </>;
  } else if (block === "insider" && ins) {
    const buy = ins.dir === "buy";
    body = <>
      <DpRow label="Activity"><span className={buy ? "up" : "down"}>{buy ? "Insider buying" : "Insider selling"}</span></DpRow>
      <DpRow label="Insider">{ins.role}</DpRow>
      <DpRow label="Value"><span className={buy ? "up" : "down"}>{buy ? "+" : "−"}${ins.val}</span></DpRow>
      <div className="dp-note">Why it&apos;s here: notable {buy ? "buying" : "selling"} flagged in the feed.</div>
    </>;
  } else if (block === "screener" && scr) {
    body = <>
      <DpRow label="RS rank">{scr.relativeStrength}/99</DpRow>
      <DpRow label="Sector">{scr.sector}</DpRow>
      <DpRow label="Rating">{scr.techRating}</DpRow>
      <DpRow label="Rev growth"><span className={cls(scr.salesGrowth)}>{sign(scr.salesGrowth)}</span></DpRow>
      <div className="dp-note">Why it&apos;s here: clears the leaders screen — high relative strength + growth.</div>
    </>;
  } else {
    const c = mv?.pctChange ?? (w ? w.pctChange : 0);
    body = <>
      <DpRow label="Price">{mv ? `$${fmt(mv.price)}` : "—"}</DpRow>
      <DpRow label="Today"><span className={cls(c)}>{sign(c)}</span></DpRow>
      <DpRow label="Sector">{mv?.sector ?? scr?.sector ?? "—"}</DpRow>
      <DpRow label="Rating">{scr?.techRating ?? "—"}</DpRow>
    </>;
  }

  return <>
    <div className="dp-head">
      <span className="dp-sym">{sym}</span>
      <span className="dp-nm">{name}</span>
      <span className="dp-tag">{BLOCK_LABEL[block]}</span>
    </div>
    <div>{body}</div>
    <div className="dp-foot">Click to open {BLOCK_NAV[block]} →</div>
  </>;
}

function MoverPopup({ m }: { m: Mover }) {
  return (
    <div className="mv-dp" onClick={e => e.stopPropagation()}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 800, color: "var(--text-hi)", fontSize: ".9rem" }}>{m.ticker}</span>
        <span style={{ flex: 1, fontSize: ".72rem", color: "var(--text-dim-solid)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
        <span className={`r ${cls(m.pctChange)}`} style={{ fontSize: ".78rem" }}>{sign(m.pctChange)}</span>
      </div>
      <div className="mvtabs">
        <span className="mvt mvt-t">Technical</span>
        <span className="mvt mvt-n">News</span>
      </div>
      <div className="mvp mvp-t">
        <div className="dp-row"><span>Price</span><b>${fmt(m.price)}</b></div>
        <div className="dp-row"><span>RVOL</span><b>{m.rvolRatio}×</b></div>
        <div className="dp-row"><span>RS Rating</span><b>{m.relativeStrength}/99</b></div>
        <div className="dp-row"><span>4-Week</span><b className={cls(m.weekPct)}>{m.weekPct > 0 ? "+" : ""}{m.weekPct}%</b></div>
        <div className="dp-note" style={{ marginTop: 6 }}>{m.techContext}</div>
      </div>
      <div className="mvp mvp-n">
        <span className="dp-tag" style={{ display: "inline-block", marginBottom: 6 }}>{m.catalystLabel}</span>
        <div className="dp-note">{m.newsContext}</div>
      </div>
    </div>
  );
}

export function DashboardScreen() {
  const { openStock, openMoverModal, openEarnings, openSector, openIndex } = useIQActions();

  // Same shared upstream tape SSE broadcast the shell's ticker strip uses
  // (Phase 1) — not a direct market_indices Firestore listener.
  const { frame: tapeFrame } = useTapeStream();
  const liveIndices = tapeFrame ? tapeItemsToIndexDocs(tapeFrame.items) : [];
  const { data: liveMovers } = useApiList<LiveMoverDoc>("/market-data/movers");
  const { data: liveEarnings } = useApiList<LiveEarningsDoc>("/market-data/earnings");
  const { data: companies } = useApiList<CompanyDoc>("/market-data/companies");
  const { data: sectorsLive } = useApiList<SectorApiDoc>("/market-data/sectors");
  const { data: liveInsiderTx } = useApiList<InsiderTxDoc>("/market-data/insider-transactions");
  // Live Fear & Greed (fear-greed.job → market_sentiment/fear_greed); falls
  // back to the illustrative 62/"Greed" until the job has run.
  const { data: marketSentiment } = useApiList<MarketSentimentDoc>("/market-data/market-sentiment");
  const fearGreed = marketSentiment.find(d => d.id === "fear_greed");
  const fgVal = fearGreed?.value ?? 62;
  const fgLabel = fearGreed?.label ?? "Greed";
  const { data: consensusLive } = useApiList<AnalystConsensusDoc>("/market-data/analyst-actions");
  // Same live news feed the Live Market Feed widget uses (below) — reused here
  // to back "What Matters Now" now that its curated mock list is gone.
  const { data: liveNews } = useApiList<NewsArticleDoc>("/market-data/news");

  const pulse = buildPulse(liveIndices);
  const companyRvol = new Map(companies.map(c => [c.ticker, c.rvol ?? null]));
  const movers = buildMoversData(liveMovers, companyRvol);
  const earnings = buildEarningsData(liveEarnings);
  const mergedSectorList = buildSectorList(companies, sectorsLive);
  const screenerUniverse = buildScreenerStocks(companies);
  const companyByTicker = new Map(companies.map(c => [c.ticker, c]));
  const consensusByTicker = new Map(consensusLive.map(c => [c.ticker, c]));
  const liveConsensusRows = [...consensusLive].sort((a, b) => (b.strongBuy + b.buy) - (a.strongBuy + a.buy));

  const wmnItems: WMNItem[] = [...liveNews]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 8)
    .map(n => ({
      headline: n.headline,
      body: n.summary ?? "",
      tag: n.category === "earnings" ? "earn" : n.category === "sector" ? "sector" : "macro",
    }));

  // key MUST come from the Firestore doc id, not ticker+dir: a single ticker can
  // have dozens of insider filings in the same direction (CRWD has 42 disposals),
  // so ticker+dir collides constantly on real data. It only looked unique against
  // the 5-row mock.
  const liveInsiderMini = liveInsiderTx.slice(0, 5).map(x => ({
    key: x.id,
    s: x.ticker,
    role: x.officerTitle ?? x.ownerName ?? "Filer",
    dir: (x.acquiredOrDisposed === "A" ? "buy" : "sell") as "buy" | "sell",
    val: x.pricePerShare ? (x.shares * x.pricePerShare / 1e6).toFixed(2) + "M" : "0",
    live: true,
  }));
  const insiderMock = INSIDER_MINI_MOCK.map(m => ({ ...m, key: `mock-${m.s}-${m.dir}` }));
  const INSIDER_MINI = liveInsiderMini.length > 0 ? [...liveInsiderMini, ...insiderMock] : insiderMock;

  // Real watchlist/portfolio (signed-in user) — no mock fallback anymore;
  // an empty backend result just means an empty list (same pattern as the
  // standalone Watchlist/Portfolio screens).
  const uid = firebaseAuth.currentUser?.uid ?? null;
  const { data: watchlistDoc } = useApiResource<WatchlistDoc>(uid ? "/api/watchlist" : null);
  const { data: portfolioDoc } = useApiResource<{ holdings: HoldingDoc[] }>(uid ? "/api/portfolio" : null);
  const realWatchTickers = watchlistDoc?.tickers ?? [];
  const realHoldings = portfolioDoc?.holdings ?? [];

  const isRealWatch = realWatchTickers.length > 0;
  const watchMini: WatchItem[] = realWatchTickers.map(t => {
    const c = companyByTicker.get(t);
    return {
      ticker: t, name: c?.name ?? t, price: c?.price ?? 0, pctChange: c?.pctChange ?? 0,
      nextEarningsDate: "—", lastAnalystAction: null, hasOptions: false, latestHeadline: "—",
    };
  });

  const isRealFolio = realHoldings.length > 0;
  const folioMini: FolioItem[] = realHoldings.map(h => {
    const c = companyByTicker.get(h.ticker);
    return {
      ticker: h.ticker, name: c?.name ?? h.ticker, price: c?.price ?? 0, pctChange: c?.pctChange ?? 0,
      gainLossPct: 0, positionSize: h.positionSize, conviction: h.conviction, eventNote: "—",
    };
  });

  // Leaders/Laggards: real price/pctChange data is already fetched in this
  // file (companies), so this is a straightforward live sort rather than a gap.
  const rankedCompanies = companies.filter(c => c.pctChange != null);
  const leaders  = [...rankedCompanies].sort((a, b) => (b.pctChange ?? 0) - (a.pctChange ?? 0)).slice(0, 3);
  const laggards = [...rankedCompanies].sort((a, b) => (a.pctChange ?? 0) - (b.pctChange ?? 0)).slice(0, 3);

  const EARN_MOVERS = [...earnings]
    .filter(e => e.priceReaction !== null)
    .sort((a, b) => Math.abs(b.priceReaction!) - Math.abs(a.priceReaction!));

  const [drawer, setDrawer] = useState<DrawerKey>(null);
  const [moversTab, setMoversTab] = useState<0 | 1 | 2>(0);
  const [scrTab, setScrTab] = useState<"leaders" | "laggards">("leaders");

  // ---- Dash pop hover ----
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pop, setPop] = useState<PopState | null>(null);

  // ---- Heatmap hover popup ----
  type HeatPop = { sd: SectorRow; x: number; y: number };
  const heatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [heatPop, setHeatPop] = useState<HeatPop | null>(null);
  const [heatSym, setHeatSym] = useState<string | null>(null);
  const showHeatPop = (e: React.MouseEvent, sd: SectorRow) => {
    if (heatTimerRef.current) clearTimeout(heatTimerRef.current);
    const x = Math.max(8, Math.min(e.clientX + 14, window.innerWidth - 268));
    const y = Math.max(8, Math.min(e.clientY - 10, window.innerHeight - 280));
    setHeatPop({ sd, x, y });
  };
  const hideHeatPop = () => { heatTimerRef.current = setTimeout(() => setHeatPop(null), 300); };
  const cancelHideHeat = () => { if (heatTimerRef.current) clearTimeout(heatTimerRef.current); };

  const showPop = (e: React.MouseEvent<HTMLElement>, sym: string, block: PopBlock) => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    const x = Math.max(8, Math.min(e.clientX + 14, window.innerWidth - 320));
    const y = Math.max(8, Math.min(e.clientY - 10, window.innerHeight - 280));
    setPop({ sym, block, x, y });
  };
  const hidePop = () => {
    hideTimerRef.current = setTimeout(() => setPop(null), 150);
  };
  const cancelHide = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  };

  // Minirow props factory
  const mr = (sym: string, block: PopBlock) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showPop(e, sym, block),
    onMouseLeave: hidePop,
  });

  function downloadRecap(which: string) {
    if (typeof window === "undefined") return;
    const blob = new Blob([`MarketCatalyst ${which} Recap`], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `MarketCatalyst-Recap-${which}.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="dash-pg">
      {/* ── Header ── */}
      <div className="dash" style={{ alignItems: "stretch" }}>

        {/* ── 1. Pulse strip ── */}
        <div className="col-12">
          <div className="pulse">
            {pulse.slice(0, 6).map((x, i) => (
              <div key={x.label} className="p" style={{ cursor: "pointer" }} onClick={() => openIndex(i)}>
                <div className="lbl">{x.label}</div>
                <div className="val">{fmt(x.value, x.value > 1000 ? 0 : 2)}</div>
                <div className={`chg ${cls(x.change)}`}>{arr(x.change)} {sign(x.change)}</div>
                <Spark seed={i + 1} up={x.change >= 0} />
              </div>
            ))}
          </div>
        </div>

        {/* ── 2. What Matters Now ── */}
        <div className="col-12">
          <div className="wmn">
            <div className="wmn-h">
              <div className="t">
                <div className="wmn-orb">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9z" fill="currentColor" />
                  </svg>
                </div>
                <div>
                  <h2>What Matters Now</h2>
                  <div className="meta">
                    <span className="live"><span className="dot" />Live</span>
                    · AI-curated · updates every 90s
                  </div>
                </div>
              </div>
              <button className="btn ai">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                30-sec audio
              </button>
            </div>
            <ul className="wmn-body" style={{ maxHeight: 220, overflowY: "scroll" }}>
              {wmnItems.length === 0 ? (
                <li><span className="bullet" /><span style={{ color: "var(--text-dim-solid)" }}>No live news synced yet.</span></li>
              ) : wmnItems.map((b, i) => (
                <li key={i}>
                  <span className="bullet" />
                  <span>
                    <b>{b.headline}.</b>{" "}
                    <span dangerouslySetInnerHTML={{ __html: b.body }} />
                  </span>
                </li>
              ))}
            </ul>
            <div className="wmn-foot">
              Sources used:
              <span className="src-chip">CPI release</span>
              <span className="src-chip">NVDA 10-Q</span>
              <span className="src-chip">Analyst feed</span>
              <span className="src-chip">Your portfolio</span>
              <span style={{ marginLeft: "auto", color: "var(--ai)" }}>
                AI-generated · informational, not investment advice
              </span>
            </div>
          </div>
        </div>

        {/* ── 3. Earnings Today ── */}
        <div className="col-4">
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>Earnings Today</h3>
              <button className="link" onClick={() => setDrawer("earnings")}>View all →</button>
            </div>
            <div className="card-b" style={{ paddingTop: 4 }}>
              {earnings.slice(0, 5).map(e => (
                <div key={e.ticker} className="minirow" style={{ cursor: "pointer" }}
                  onClick={() => openEarnings(e.ticker)}
                  {...mr(e.ticker, "earnings")}
                >
                  <StockLogo sym={e.ticker} size={26} />
                  <span className="tkr">{e.ticker}<small>{e.name}</small></span>
                  <span className="mid">
                    <span className={`pill ${e.session === "BMO" ? "bmo" : "amc"}`}>{e.session}</span>
                  </span>
                  <span className={`r ${e.priceReaction != null ? cls(e.priceReaction) : ""}`}>
                    {e.priceReaction != null
                      ? sign(e.priceReaction)
                      : <span style={{ color: "var(--text-dim-solid)" }}>pending</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 4. Market Movers ── */}
        <div className="col-4">
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>Movers</h3>
              <button className="link" onClick={() => setDrawer("movers")}>View all →</button>
            </div>
            <div style={{ display: "flex", gap: 4, padding: "6px 13px 0" }}>
              {(["Gainers", "Losers", "Most Active"] as const).map((label, i) => (
                <button key={label}
                  className={`chip${moversTab === i ? " on" : ""}`}
                  style={{ fontSize: ".65rem", padding: "3px 9px" }}
                  onClick={() => setMoversTab(i as 0 | 1 | 2)}
                >{label}</button>
              ))}
            </div>
            <div className="card-b" style={{ paddingTop: 8 }}>
              {(moversTab === 0
                ? [...movers].filter(m => m.pctChange > 0).sort((a, b) => b.pctChange - a.pctChange)
                : moversTab === 1
                ? [...movers].filter(m => m.pctChange < 0).sort((a, b) => a.pctChange - b.pctChange)
                : [...movers].sort((a, b) => b.rvolRatio - a.rvolRatio)
              ).slice(0, 6).map(m => (
                <div key={m.ticker} className="minirow mv-dash-row" style={{ cursor: "pointer" }} onClick={() => openMoverModal(m.ticker)}>
                  <StockLogo sym={m.ticker} size={26} />
                  <span className="tkr">{m.ticker}</span>
                  <span className="mid">{moversTab === 2 ? `${m.rvolRatio}× vol` : m.catalystLabel}</span>
                  <span className={`r ${cls(m.pctChange)}`}>{sign(m.pctChange)}</span>
                  <MoverPopup m={m} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 5. Market Heatmap ── */}
        <div className="col-4">
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>Market Heatmap</h3>
              <Link className="link" href="/menu/heatmap">Full map →</Link>
            </div>
            {(() => {
              // Top 16 stocks by market cap across all sectors (deduplicated)
              const seen = new Set<string>();
              const top16 = mergedSectorList
                .flatMap(sd => sd.items.map(([sym, mcap, chg]) => ({ sym, mcap, chg, sd })))
                .sort((a, b) => b.mcap - a.mcap)
                .filter(s => { if (seen.has(s.sym)) return false; seen.add(s.sym); return true; })
                .slice(0, 16);

              // Group back by sector, preserving sector order
              const groups = mergedSectorList
                .map(sd => ({ sd, stocks: top16.filter(s => s.sd === sd) }))
                .filter(g => g.stocks.length > 0);

              return (
                <div className="card-b" style={{ paddingTop: 6 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {groups.map(({ sd, stocks }) => {
                      const hcSect = heatCol(sd.pctChange);
                      return (
                        <div key={sd.name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <div
                            onClick={() => openSector(sd.name)}
                            onMouseEnter={e => showHeatPop(e, sd)}
                            onMouseLeave={hideHeatPop}
                            style={{
                              width: 90, flexShrink: 0, cursor: "pointer",
                              background: hcSect.bg, borderRadius: 6,
                              padding: "4px 7px", height: 40,
                              display: "flex", flexDirection: "column", justifyContent: "center", gap: 2,
                            }}
                          >
                            <span style={{ fontSize: ".65rem", fontWeight: 700, color: hcSect.fg, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sd.name}</span>
                            <span style={{ fontFamily: "var(--f-mono)", fontSize: ".6rem", color: hcSect.fg, opacity: .9 }}>{sign(sd.pctChange)}</span>
                          </div>
                          <div style={{ display: "flex", gap: 3 }}>
                            {stocks.map(({ sym, chg }) => {
                              const hc = heatCol(chg);
                              return (
                                <div key={sym}
                                  onClick={() => openStock(sym)}
                                  title={`${sym}  ${sign(chg)}`}
                                  style={{
                                    background: hc.bg, borderRadius: 6,
                                    width: 56, height: 40, flexShrink: 0,
                                    display: "flex", flexDirection: "column",
                                    alignItems: "center", justifyContent: "center",
                                    cursor: "pointer", transition: "filter .12s",
                                    gap: 2,
                                  }}
                                  onMouseOver={e => (e.currentTarget.style.filter = "brightness(1.3)")}
                                  onMouseOut={e => (e.currentTarget.style.filter = "")}
                                >
                                  <span style={{ fontSize: ".65rem", fontWeight: 800, color: hc.fg, lineHeight: 1 }}>{sym.slice(0, 4)}</span>
                                  <span style={{ fontSize: ".58rem", fontFamily: "var(--f-mono)", color: hc.fg, opacity: .88, lineHeight: 1 }}>{sign(chg)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* ── 6. Analyst Consensus ── */}
        {/* Per-firm actions table retired here too (mirrors ../screens/analyst.tsx):
            the live /market-data/analyst-actions feed only supplies an aggregate
            Buy/Hold/Sell snapshot per ticker, not individual upgrade/downgrade
            events, so there's no per-firm mock left to reconstruct. */}
        <div className="col-4">
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>Analyst Consensus</h3>
              <button className="link" onClick={() => setDrawer("analyst")}>View all →</button>
            </div>
            <div className="card-b" style={{ paddingTop: 4 }}>
              {liveConsensusRows.length === 0 ? (
                <div className="ec-none">No live analyst consensus data available.</div>
              ) : (
                liveConsensusRows.slice(0, 5).map(c => (
                  <div key={c.ticker} className="minirow" style={{ cursor: "pointer" }}
                    onClick={() => openStock(c.ticker)}
                    {...mr(c.ticker, "analyst")}
                  >
                    <StockLogo sym={c.ticker} size={26} />
                    <span className="tkr">{c.ticker}</span>
                    <span className="mid">{c.strongBuy + c.buy}B / {c.hold}H / {c.sell + c.strongSell}S</span>
                    <span className="r" style={{ color: "var(--up)" }}>{c.consensus}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── 7. Screener · Leaders & Laggards ── */}
        <div className="col-4">
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>Screener · Leaders &amp; Laggards</h3>
              <Link className="link" href="/menu/screener">View all →</Link>
            </div>
            <div style={{ display: "flex", gap: 4, padding: "6px 13px 0" }}>
              {(["▲ Leaders", "▼ Laggards"] as const).map((label, i) => (
                <button key={label}
                  className={`chip${scrTab === (i === 0 ? "leaders" : "laggards") ? " on" : ""}`}
                  style={{ fontSize: ".65rem", padding: "3px 9px" }}
                  onClick={() => setScrTab(i === 0 ? "leaders" : "laggards")}
                >{label}</button>
              ))}
            </div>
            <div className="card-b" style={{ paddingTop: 8 }}>
              {(scrTab === "leaders" ? leaders : laggards).map(s => {
                const dayC = s.pctChange ?? 0;
                return (
                  <div key={s.ticker} className="minirow" style={{ cursor: "pointer" }}
                    onClick={() => openStock(s.ticker)}
                    {...mr(s.ticker, "screener")}
                  >
                    <StockLogo sym={s.ticker} size={26} />
                    <span className="tkr">{s.ticker}</span>
                    <span className="mid">RS {s.rsRating ?? "—"} · {s.sector ?? "—"}</span>
                    <span className={`r ${cls(dayC)}`}>{sign(dayC)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── 8. Portfolio Pulse ── */}
        <div className="col-4">
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>Portfolio Pulse</h3>
              <button className="link" onClick={() => setDrawer("portfolio")}>View all →</button>
            </div>
            <div className="card-b" style={{ paddingTop: 8 }}>
              {isRealFolio ? (() => {
                const totalVal = realHoldings.reduce((s, h) => s + h.shares * (companyByTicker.get(h.ticker)?.price ?? 0), 0);
                const dayPL = realHoldings.reduce((s, h) => s + h.shares * (companyByTicker.get(h.ticker)?.price ?? 0) * (companyByTicker.get(h.ticker)?.pctChange ?? 0) / 100, 0);
                return (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <span className="mono" style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-hi)" }}>${totalVal >= 1000 ? (totalVal / 1000).toFixed(1) + "K" : totalVal.toFixed(2)}</span>
                    <span className={`mono ${cls(dayPL)}`} style={{ fontWeight: 600 }}>{arr(dayPL)} {dayPL >= 0 ? "+" : ""}${Math.abs(dayPL).toFixed(2)}</span>
                  </div>
                );
              })() : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <span className="mono" style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-hi)" }}>$128,430</span>
                  <span className="mono up" style={{ fontWeight: 600 }}>▲ +1.42%</span>
                </div>
              )}
              {folioMini.slice(0, 4).map(f => {
                const dayC = movers.find(m => m.ticker === f.ticker)?.pctChange ?? f.pctChange;
                return (
                  <div key={f.ticker} className="minirow" style={{ cursor: "pointer" }}
                    onClick={() => openStock(f.ticker)}
                    {...mr(f.ticker, "portfolio")}
                  >
                    <StockLogo sym={f.ticker} size={26} />
                    <span className="tkr">{f.ticker}</span>
                    <span className="mid">{f.positionSize} · {f.conviction} conv.</span>
                    <span className={`r ${cls(dayC)}`}>{sign(dayC)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── 9. Watchlist ── */}
        <div className="col-4">
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>Watchlist</h3>
              <button className="link" onClick={() => setDrawer("watchlist")}>View all →</button>
            </div>
            <div className="card-b" style={{ paddingTop: 8 }}>
              {watchMini.slice(0, 5).map(w => (
                <div key={w.ticker} className="minirow" style={{ cursor: "pointer" }}
                  onClick={() => openStock(w.ticker)}
                  {...mr(w.ticker, "watchlist")}
                >
                  <StockLogo sym={w.ticker} size={26} />
                  <span className="tkr">{w.ticker}</span>
                  <span className="mid">
                    {isRealWatch
                      ? (companyByTicker.get(w.ticker) ? "live" : "not synced")
                      : <>{w.hasOptions ? <span className="pill opt">⚡</span> : null}{w.hasOptions ? " " : ""}ER {w.nextEarningsDate}</>}
                  </span>
                  <span className={`r ${cls(w.pctChange)}`}>{sign(w.pctChange)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 10. Insider & Institutional ── */}
        <div className="col-4">
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>Insider &amp; Institutional</h3>
              <button className="link" onClick={() => setDrawer("insider")}>View all →</button>
            </div>
            <div className="card-b" style={{ paddingTop: 4 }}>
              {INSIDER_MINI.map(x => (
                <div key={x.key} className="minirow" style={{ cursor: "pointer" }}
                  onClick={() => openStock(x.s)}
                  {...mr(x.s, "insider")}
                >
                  <StockLogo sym={x.s} size={26} />
                  <span className="tkr">{x.s}</span>
                  <span className="mid">{x.dir === "buy" ? "Buy" : "Sell"} · {x.role.replace(/ \(.*\)/, "")}</span>
                  <span className={`r ${x.dir === "buy" ? "up" : "down"}`}>
                    {x.dir === "buy" ? "+" : "−"}${x.val}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 11. Live Market Feed ── */}
        <div className="col-4">
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>Live Market Feed</h3>
              <Link className="link" href="/menu/commentary">Commentary →</Link>
            </div>
            <div className="card-b" style={{ paddingTop: 2 }}>
              <LiveFeedList />
            </div>
          </div>
        </div>

        {/* ── 12. Recaps ── */}
        <div className="col-4">
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>Recaps</h3>
              <Link className="link" href="/menu/recap">All →</Link>
            </div>
            <div className="card-b">
              <div style={{ fontSize: ".74rem", color: "var(--text-dim-solid)", marginBottom: 10 }}>
                Structured executive-summary report (PDF).
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <button className="btn" style={{ justifyContent: "flex-start" }} onClick={() => downloadRecap("today")}>
                  <svg viewBox="0 0 24 24" fill="none" style={{ width: 13, height: 13 }}>
                    <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Today (EOD)
                </button>
                <button className="btn" style={{ justifyContent: "flex-start" }} onClick={() => downloadRecap("yesterday")}>
                  <svg viewBox="0 0 24 24" fill="none" style={{ width: 13, height: 13 }}>
                    <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Yesterday
                </button>
                <button className="btn" style={{ justifyContent: "flex-start" }} onClick={() => downloadRecap("week")}>
                  <svg viewBox="0 0 24 24" fill="none" style={{ width: 13, height: 13 }}>
                    <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Last week
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── 13. VIX · Volatility ── */}
        <div className="col-4">
          <div className="card vix" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>VIX · Volatility</h3>
              <span className="pill up">Calm</span>
            </div>
            <div className="card-b">
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span className="big">{liveIndices.find(i => i.id === "VIX")?.value.toFixed(2) ?? "14.18"}</span>
                <span className="mono down" style={{ fontWeight: 600 }}>
                  {liveIndices.find(i => i.id === "VIX") ? sign(liveIndices.find(i => i.id === "VIX")!.pctChange) : "▼ -2.51%"}
                </span>
              </div>
              <div className="pctl" style={{ marginTop: 12 }}><i style={{ width: "22%" }} /></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".66rem", color: "var(--text-dim-solid)", marginBottom: 10 }}>
                <span>12-mo pct: 22nd</span>
                <span>Trend: falling</span>
              </div>
              <div className="note">
                {liveIndices.find(i => i.id === "VIX")
                  ? `Shown via ${liveIndices.find(i => i.id === "VIX")!.proxyTicker} (ETF proxy) — ${liveIndices.find(i => i.id === "VIX")!.note}`
                  : "VIX at 14 is low — a calm, risk-on tape."}
              </div>
            </div>
          </div>
        </div>

        {/* ── 14. Fear & Greed ── */}
        <div className="col-4">
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>Fear &amp; Greed</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button className="link" onClick={() => setDrawer("fg-history")}>History →</button>
                <ExpandBtn title="Fear & Greed Index" node={<SemiGauge val={fgVal} label={fgLabel} id="fg-modal" />} />
              </div>
            </div>
            <div className="card-b gauge-wrap">
              <SemiGauge val={fgVal} label={fgLabel} id="fg" />
              <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)", marginTop: 2 }}>
                Previous close: <b style={{ color: "var(--text)" }}>58</b>
              </div>
            </div>
          </div>
        </div>


      </div>

      {/* ── Sliding drawer ── */}
      {drawer && (
        <>
          <div className="scrim" onClick={() => setDrawer(null)} />
          <div className="side-drawer">
            <div className="drawer-h">
              <div style={{ flex: 1 }}>
                <div className="drawer-title">
                  {drawer === "earnings"    && "Earnings Calendar"}
                  {drawer === "movers"      && "Movers"}
                  {drawer === "analyst"     && "Analyst Consensus"}
                  {drawer === "earn-movers" && "Biggest Earnings Movers"}
                  {drawer === "internals"   && "Market Internals"}
                  {drawer === "watchlist"   && "Watchlist"}
                  {drawer === "portfolio"   && "Portfolio Pulse"}
                  {drawer === "insider"     && "Insider & Institutional"}
                  {drawer === "fg-history"  && "Fear & Greed · History"}
                </div>
              </div>
              <button className="closebtn" onClick={() => setDrawer(null)}>&#x2715;</button>
            </div>
            <div className="drawer-b">

              {/* Earnings */}
              {drawer === "earnings" && earnings.map(e => (
                <div key={e.ticker} className="minirow" style={{ cursor: "pointer", padding: "8px 0" }}
                  onClick={() => { openEarnings(e.ticker); setDrawer(null); }}>
                  <StockLogo sym={e.ticker} size={22} />
                  <span className="tkr">{e.ticker}<small>{e.name}</small></span>
                  <span className="mid">
                    <span className={`pill ${e.session.includes("pre") ? "bmo" : "amc"}`}>{e.session}</span>
                  </span>
                  <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
                    EPS est <span className="mono">{e.epsEstimate != null ? `$${e.epsEstimate}` : "—"}</span>
                    {e.epsActual != null && e.epsEstimate != null && <> &rarr; <span className={`mono ${e.epsActual >= e.epsEstimate ? "up" : "down"}`}>${e.epsActual}</span></>}
                  </span>
                  <span className={`r ${e.priceReaction != null ? cls(e.priceReaction) : ""}`}>
                    {e.priceReaction != null ? sign(e.priceReaction) : <span style={{ color: "var(--text-dim-solid)" }}>pending</span>}
                  </span>
                </div>
              ))}

              {/* Movers */}
              {drawer === "movers" && (
                <>
                  <div className="up" style={{ fontSize: ".6rem", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", margin: "0 0 6px" }}>&#x25B2; Top gainers</div>
                  {movers.filter(m => m.pctChange > 0).sort((a,b) => b.pctChange - a.pctChange).map(m => (
                    <div key={m.ticker} className="minirow" style={{ cursor: "pointer", padding: "7px 0" }}
                      onClick={() => { openMoverModal(m.ticker); setDrawer(null); }}>
                      <StockLogo sym={m.ticker} size={22} />
                      <span className="tkr">{m.ticker}<small>{m.name}</small></span>
                      <span className="mid">{m.catalystLabel}</span>
                      <span className={`r mono ${cls(m.pctChange)}`}>{sign(m.pctChange)}</span>
                    </div>
                  ))}
                  <div className="down" style={{ fontSize: ".6rem", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", margin: "14px 0 6px" }}>&#x25BC; Top losers</div>
                  {movers.filter(m => m.pctChange < 0).sort((a,b) => a.pctChange - b.pctChange).map(m => (
                    <div key={m.ticker} className="minirow" style={{ cursor: "pointer", padding: "7px 0" }}
                      onClick={() => { openMoverModal(m.ticker); setDrawer(null); }}>
                      <StockLogo sym={m.ticker} size={22} />
                      <span className="tkr">{m.ticker}<small>{m.name}</small></span>
                      <span className="mid">{m.catalystLabel}</span>
                      <span className={`r mono ${cls(m.pctChange)}`}>{sign(m.pctChange)}</span>
                    </div>
                  ))}
                </>
              )}

              {/* Analyst consensus — per-firm actions retired (no live source; see ../screens/analyst.tsx) */}
              {drawer === "analyst" && (
                liveConsensusRows.length === 0 ? (
                  <div className="ec-none" style={{ padding: "12px 0" }}>No live analyst consensus data available.</div>
                ) : liveConsensusRows.map(c => (
                  <div key={c.ticker} className="minirow" style={{ cursor: "pointer", padding: "7px 0" }}
                    onClick={() => { openStock(c.ticker); setDrawer(null); }}>
                    <StockLogo sym={c.ticker} size={22} />
                    <span className="tkr">{c.ticker}</span>
                    <span className="mid" style={{ fontSize: ".74rem" }}>{c.strongBuy + c.buy}B / {c.hold}H / {c.sell + c.strongSell}S</span>
                    <span className="r" style={{ color: "var(--up)" }}>{c.consensus}</span>
                  </div>
                ))
              )}

              {/* Earn movers */}
              {drawer === "earn-movers" && EARN_MOVERS.map(e => (
                <div key={e.ticker} className="minirow" style={{ cursor: "pointer", padding: "8px 0" }}
                  onClick={() => { openEarnings(e.ticker); setDrawer(null); }}>
                  <StockLogo sym={e.ticker} size={22} />
                  <span className="tkr">{e.ticker}<small>{e.name}</small></span>
                  <span className="mid">
                    <span className={`pill ${e.priceReaction! >= 0 ? "beat" : "miss"}`}>{e.priceReaction! >= 0 ? "Beat" : "Miss"}</span>
                    {e.guidanceStatus && e.guidanceStatus !== "In-line" && (
                      <span className={`pill ${e.guidanceStatus === "Raised" ? "beat" : "miss"}`} style={{ marginLeft: 4 }}>{e.guidanceStatus}</span>
                    )}
                    <span style={{ marginLeft: 6, fontSize: ".7rem", color: "var(--text-dim-solid)" }}>EPS: ${e.epsEstimate} &rarr; ${e.epsActual}</span>
                  </span>
                  <span className={`r mono ${e.priceReaction! >= 0 ? "up" : "down"}`} style={{ fontWeight: 700 }}>
                    {e.priceReaction! >= 0 ? "+" : ""}{e.priceReaction}%
                  </span>
                </div>
              ))}

              {/* Market internals */}
              {drawer === "internals" && (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".8rem", marginBottom: 5 }}>
                      <span className="up mono" style={{ fontWeight: 700 }}>&#x25B2; 2,186 advancing</span>
                      <span className="down mono" style={{ fontWeight: 700 }}>&#x25BC; 1,247 declining</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, background: "var(--surface-3)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: "63.7%", background: "var(--up)", borderRadius: 4 }} />
                    </div>
                    <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 4 }}>
                      A/D Ratio: 1.75 &middot; 89 unchanged &middot; NYSE + NASDAQ composite
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {MARKET_INTERNALS.filter(x => !["Advancing","Declining"].includes(x.k)).map(x => (
                      <div key={x.k} style={{
                        background: "var(--surface-1)", border: "1px solid var(--border)",
                        borderRadius: 10, padding: "11px 13px",
                      }}>
                        <div style={{ fontSize: ".64rem", color: "var(--text-dim-solid)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>{x.k}</div>
                        <div className={`mono ${x.up === true ? "up" : x.up === false ? "down" : ""}`}
                          style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: 3 }}>{x.v}</div>
                        {x.note && <div style={{ fontSize: ".62rem", color: "var(--text-dim-solid)", marginTop: 1 }}>{x.note}</div>}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Watchlist */}
              {drawer === "watchlist" && watchMini.map(w => (
                <div key={w.ticker} className="minirow" style={{ cursor: "pointer", padding: "7px 0" }}
                  onClick={() => { openStock(w.ticker); setDrawer(null); }}>
                  <StockLogo sym={w.ticker} size={22} />
                  <span className="tkr">{w.ticker}<small>{w.name}</small></span>
                  <span className="mid">
                    {isRealWatch ? (companyByTicker.get(w.ticker) ? "live" : "not synced") : <>ER {w.nextEarningsDate}{w.hasOptions ? <span className="pill opt" style={{ marginLeft: 4 }}>&#x26A1;</span> : null}</>}
                  </span>
                  <span className={`r ${cls(w.pctChange)}`}>{sign(w.pctChange)}</span>
                </div>
              ))}

              {/* Portfolio */}
              {drawer === "portfolio" && folioMini.map(f => {
                const dayC = movers.find(m => m.ticker === f.ticker)?.pctChange ?? f.pctChange;
                return (
                  <div key={f.ticker} className="minirow" style={{ cursor: "pointer", padding: "7px 0" }}
                    onClick={() => { openStock(f.ticker); setDrawer(null); }}>
                    <StockLogo sym={f.ticker} size={22} />
                    <span className="tkr">{f.ticker}</span>
                    <span className="mid">{f.positionSize} &middot; {f.conviction} conv.</span>
                    <span className={`r ${cls(dayC)}`}>{sign(dayC)}</span>
                    <span className={`mono ${cls(f.gainLossPct)}`} style={{ fontSize: ".74rem", marginLeft: 6 }}>
                      {f.gainLossPct > 0 ? "+" : ""}{f.gainLossPct.toFixed(1)}% total
                    </span>
                  </div>
                );
              })}

              {/* Insider */}
              {drawer === "insider" && INSIDER_MINI.map(x => (
                <div key={x.key} className="minirow" style={{ cursor: "pointer", padding: "7px 0" }}
                  onClick={() => { openStock(x.s); setDrawer(null); }}>
                  <StockLogo sym={x.s} size={22} />
                  <span className="tkr">{x.s}</span>
                  <span className="mid">{x.dir === "buy" ? "Buy" : "Sell"} &middot; {x.role}</span>
                  <span className={`r ${x.dir === "buy" ? "up" : "down"}`}>
                    {x.dir === "buy" ? "+" : "−"}${x.val}
                  </span>
                </div>
              ))}

              {/* Fear & Greed History */}
              {drawer === "fg-history" && (
                <>
                  {/* Sparkline */}
                  <div style={{ marginBottom: 16 }}>
                    <svg viewBox="0 0 440 90" style={{ width: "100%", display: "block" }}>
                      {/* Zone bands */}
                      <rect x="0" y="0"  width="440" height="18" fill="rgba(208,52,76,.12)" />
                      <rect x="0" y="18" width="440" height="18" fill="rgba(208,52,76,.06)" />
                      <rect x="0" y="36" width="440" height="18" fill="rgba(169,181,198,.04)" />
                      <rect x="0" y="54" width="440" height="18" fill="rgba(47,230,166,.06)" />
                      <rect x="0" y="72" width="440" height="18" fill="rgba(47,230,166,.12)" />
                      {/* Zone labels */}
                      <text x="4" y="12"  fill="rgba(208,52,76,.7)"  fontSize="7" fontFamily="JetBrains Mono,monospace">Extreme Fear</text>
                      <text x="4" y="30"  fill="rgba(208,52,76,.5)"  fontSize="7" fontFamily="JetBrains Mono,monospace">Fear</text>
                      <text x="4" y="48"  fill="rgba(169,181,198,.6)" fontSize="7" fontFamily="JetBrains Mono,monospace">Neutral</text>
                      <text x="4" y="66"  fill="rgba(47,230,166,.6)" fontSize="7" fontFamily="JetBrains Mono,monospace">Greed</text>
                      <text x="4" y="84"  fill="rgba(47,230,166,.8)" fontSize="7" fontFamily="JetBrains Mono,monospace">Extreme Greed</text>
                      {/* Line */}
                      {(() => {
                        const pts = [...FG_HISTORY].reverse();
                        const n = pts.length;
                        const toY = (v: number) => 90 - (v / 100) * 90;
                        const toX = (i: number) => 60 + i * ((440 - 70) / (n - 1));
                        const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)} ${toY(p.val).toFixed(1)}`).join(" ");
                        return (
                          <>
                            <path d={d} fill="none" stroke="var(--brand-2)" strokeWidth="2" strokeLinejoin="round" />
                            {pts.map((p, i) => (
                              <circle key={i} cx={toX(i).toFixed(1)} cy={toY(p.val).toFixed(1)} r="3"
                                fill={p.val >= 60 ? "var(--up)" : p.val >= 40 ? "var(--warn)" : "var(--down)"} />
                            ))}
                          </>
                        );
                      })()}
                    </svg>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".62rem", color: "var(--text-dim-solid)", marginTop: 2, paddingLeft: 60 }}>
                      <span>{FG_HISTORY[FG_HISTORY.length - 1].date}</span>
                      <span>Today</span>
                    </div>
                  </div>

                  {/* History rows */}
                  {FG_HISTORY.map((h, i) => {
                    const col = h.val >= 60 ? "var(--up)" : h.val >= 40 ? "var(--warn)" : "var(--down)";
                    const prev = FG_HISTORY[i + 1];
                    const delta = prev ? h.val - prev.val : 0;
                    return (
                      <div key={h.date} style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "9px 14px", marginBottom: 4,
                        background: i === 0 ? "color-mix(in srgb, var(--brand) 8%, var(--surface-1))" : "var(--surface-1)",
                        border: `1px solid ${i === 0 ? "var(--brand)" : "var(--border)"}`,
                        borderRadius: 10,
                      }}>
                        {/* Bar */}
                        <div style={{ width: 48, height: 6, background: "var(--surface-3)", borderRadius: 3, overflow: "hidden", flexShrink: 0 }}>
                          <div style={{ height: "100%", width: `${h.val}%`, background: col, borderRadius: 3 }} />
                        </div>
                        {/* Date */}
                        <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", width: 48, flexShrink: 0 }}>
                          {i === 0 ? <b style={{ color: "var(--text-hi)" }}>Today</b> : h.date}
                        </span>
                        {/* Label */}
                        <span style={{ flex: 1, fontSize: ".8rem", fontWeight: 600, color: col }}>{h.label}</span>
                        {/* Value */}
                        <span className="mono" style={{ fontWeight: 700, color: col, fontSize: ".9rem" }}>{h.val}</span>
                        {/* Delta */}
                        {delta !== 0 && (
                          <span className={`mono ${delta > 0 ? "up" : "down"}`} style={{ fontSize: ".72rem", width: 36, textAlign: "right" }}>
                            {delta > 0 ? "+" : ""}{delta}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </>
              )}

            </div>
          </div>
        </>
      )}

      {/* ── Heatmap hover popup ── */}
      {heatPop && (
        <div
          className="heat-pop"
          style={{
            left: Math.min(heatPop.x, (typeof window !== "undefined" ? window.innerWidth : 1400) - 260),
            top: heatPop.y,
            padding: "11px 13px",
          }}
          onMouseEnter={cancelHideHeat}
          onMouseLeave={hideHeatPop}
        >
          <div className="heat-pop-h">
            <span>{heatPop.sd.name}</span>
            <span className={`pill ${heatPop.sd.pctChange >= 0 ? "up" : "dn"}`}>{sign(heatPop.sd.pctChange)}</span>
          </div>
          <div className="heat-pop-trend">{heatPop.sd.trend}</div>
          {heatPop.sd.items.slice(0, 4).map(([sym, mcap, chg]) => {
            const mv  = movers.find(m => m.ticker === sym);
            const scr = screenerUniverse.find(s => s.ticker === sym);
            const cap = mcap >= 1000 ? `$${(mcap / 1000).toFixed(1)}T` : `$${Math.round(mcap)}B`;
            const isActive = heatSym === sym;
            return (
              <div key={sym} className={`heat-pop-stock${isActive ? " active" : ""}`}
                onMouseEnter={() => { cancelHideHeat(); setHeatSym(sym); }}
                onMouseLeave={() => setHeatSym(null)}
                onClick={() => { openStock(sym); setHeatPop(null); }}
              >
                <div className="heat-pop-row">
                  <StockLogo sym={sym} size={20} />
                  <span className="tkr">{sym}</span>
                  <span className={`r ${cls(chg)}`}>{sign(chg)}</span>
                </div>
                {isActive && (
                  <div className="heat-pop-detail">
                    <span>Mkt Cap <b>{cap}</b></span>
                    {mv  ? <span>Price <b>${fmt(mv.price)}</b></span> : null}
                    {mv  ? <span>RVOL <b>{mv.rvolRatio}×</b></span>   : null}
                    {scr ? <span>RS <b>{scr.relativeStrength}/99</b></span>     : null}
                    {mv  ? <span className={mv.maPosture.startsWith("Above") ? "up" : "down"} style={{ fontSize: ".6rem" }}>{mv.maPosture}</span> : null}
                  </div>
                )}
              </div>
            );
          })}
          <div className="heat-pop-foot">
            <button className="btn" onClick={() => { openSector(heatPop.sd.name); setHeatPop(null); }}>
              Open Sector
            </button>
            <Link className="btn" href="/menu/heatmap" onClick={() => setHeatPop(null)}>
              Full Heatmap →
            </Link>
          </div>
        </div>
      )}

      {/* ── Dash hover popup ── */}
      {pop && (
        <div
          className="dash-pop"
          style={{ left: pop.x, top: pop.y }}
          onMouseEnter={cancelHide}
          onMouseLeave={hidePop}
          onClick={() => {
            setPop(null);
            if (pop.block === "earnings") openEarnings(pop.sym);
            else if (pop.block === "movers") openMoverModal(pop.sym);
            else openStock(pop.sym);
          }}
        >
          <DashPopContent sym={pop.sym} block={pop.block} movers={movers} earnings={earnings} watchlist={watchMini} portfolio={folioMini} screener={screenerUniverse} consensusByTicker={consensusByTicker} />
        </div>
      )}
    </div>
  );
}

/** Live Market Feed — real synced news, falling back to the original mock items if none are synced yet. */
function LiveFeedList() {
  const { data: news } = useApiList<NewsArticleDoc>("/market-data/news");
  const recent = [...news].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()).slice(0, 5);

  const MOCK_LIVE_FEED = [
    {
      cat: "Earnings", col: "var(--up)", time: "9:31a",
      t: '<b style="color:var(--text-hi)">NVDA</b> beats EPS 18%, raises FY25',
      why: "AI data-center demand still accelerating.",
    },
    {
      cat: "Analyst", col: "var(--brand-2)", time: "9:18a",
      t: 'MS upgrades <b style="color:var(--text-hi)">CRM</b> to Overweight, PT $340',
      why: "Sell-side turning constructive on margins.",
    },
    {
      cat: "Macro", col: "var(--warn)", time: "8:30a",
      t: 'May core CPI <b style="color:var(--text-hi)">+0.2%</b> m/m, below est.',
      why: "Lifts September rate-cut odds; yields fell.",
    },
  ];

  if (recent.length === 0) {
    return <>
      {MOCK_LIVE_FEED.map((f, i) => (
        <div key={i} style={{
          display: "flex", gap: 10, padding: "9px 0",
          borderBottom: i < MOCK_LIVE_FEED.length - 1 ? "1px solid var(--border-soft)" : undefined,
        }}>
          <div style={{ flexShrink: 0, width: 62 }}>
            <span className="pill" style={{ background: "var(--surface-3)", color: f.col }}>{f.cat}</span>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: ".6rem", color: "var(--text-dim-solid)", marginTop: 5 }}>
              {f.time}
            </div>
          </div>
          <div>
            <div style={{ fontSize: ".8rem", color: "var(--text)" }} dangerouslySetInnerHTML={{ __html: f.t }} />
            <div style={{
              fontSize: ".72rem", color: "var(--text-dim-solid)",
              borderLeft: `2px solid ${f.col}55`, paddingLeft: 8, marginTop: 4,
            }}>
              <b style={{ color: "var(--ai)", fontWeight: 600 }}>Why · </b>{f.why}
            </div>
          </div>
        </div>
      ))}
    </>;
  }

  return <>
    {recent.map((f, i) => (
      <div key={f.id} style={{
        display: "flex", gap: 10, padding: "9px 0",
        borderBottom: i < recent.length - 1 ? "1px solid var(--border-soft)" : undefined,
      }}>
        <div style={{ flexShrink: 0, width: 62 }}>
          <span className="pill" style={{ background: "var(--surface-3)", color: "var(--brand-2)" }}>{f.category}</span>
          <div style={{ fontFamily: "var(--f-mono)", fontSize: ".6rem", color: "var(--text-dim-solid)", marginTop: 5 }}>
            {new Date(f.publishedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </div>
        </div>
        <div>
          <div style={{ fontSize: ".8rem", color: "var(--text)" }}><b style={{ color: "var(--text-hi)" }}>{f.ticker}</b> · {f.headline}</div>
          <div style={{
            fontSize: ".72rem", color: "var(--text-dim-solid)",
            borderLeft: "2px solid var(--brand-2)55", paddingLeft: 8, marginTop: 4,
          }}>
            {f.source}
          </div>
        </div>
      </div>
    ))}
  </>;
}
