"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { firebaseAuth } from "../../firebase";
import { useIQActions, ExpandBtn } from "../shell";
import { type Mover, type SectorRow, type Earning, type FolioItem, type WatchItem } from "../data";
import { fmt, sign, cls, arr, Spark, SemiGauge, StockLogo, heatCol, DataState, NotAvailable } from "../utils";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import { useTapeStream } from "../hooks/useTapeStream";
import { pulseFromLive, buildSectorList, tapeItemsToIndexDocs } from "../live-market-indices";
import type {
  LiveMoverDoc, LiveEarningsDoc, CompanyDoc, SectorApiDoc,
  InsiderTxDoc, AnalystConsensusDoc, MarketSentimentDoc, MarketSentimentHistoryDoc, EarningsAnnouncementDoc,
  WatchlistDoc, HoldingDoc, NewsArticleDoc,
} from "../types";

// Insider mini-list, market internals and F&G history all had hardcoded mock
// arrays here. None have a reachable live source today: insider transactions
// use the real `insider_transactions` feed exclusively now (no mock
// fallback); market internals (advance/decline, TICK, TRIN, McClellan,
// put/call) and F&G composite history have no `/market-data/*` route at all
// yet (the backend jobs that could feed them write to Firestore directly,
// with no REST endpoint), so those two render DataState instead of inventing
// numbers.

// "View all" widgets now navigate to /menu/{screen} (see the <Link> controls);
// the only remaining in-page drawer is Fear & Greed history. The removed drawer
// branches are archived in Doc/ARCHIVED-dashboard-viewall-drawers.md.
type DrawerKey = "fg-history" | null;

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
 * Live-only: a mover row exists here only if a real `market_movers` doc
 * exists for it. `rvolRatio`/`relativeStrength` come from `companies.rvol`/
 * `rsRating` when synced; `maPosture` has no live source yet, so it renders a
 * neutral "—" rather than an invented label. (Catalyst was removed — Polygon
 * has no catalyst feed, so it only ever showed "—".)
 */
function mergeMoversData(live: LiveMoverDoc[], companies: CompanyDoc[]): Mover[] {
  const companyByTicker = new Map(companies.map(c => [c.ticker, c]));
  return live.map(l => {
    const c = companyByTicker.get(l.ticker);
    return {
      ticker: l.ticker, name: l.name ?? l.ticker, price: l.price, pctChange: l.pctChange,
      rvolRatio: c?.rvol ?? 0, relativeStrength: c?.rsRating ?? 0,
      maPosture: "—", owned: false,
      sector: l.sector ?? c?.sector ?? "—", cap: (l.cap as Mover["cap"]) ?? "Mid", weekPct: l.pctChange,
      techContext: `Live EOD data as of ${l.asOfDate}.`, newsContext: "",
    };
  });
}

/** Live-only: an earnings row exists here only if a real `earnings_events` doc
 *  exists. session/guidance/reaction/impliedMove have no live source. */
// Polygon earnings_events are reported filings (keyed by SEC filing date), so
// "Earnings Today" shows the most recently reported companies — real names and
// reported EPS/revenue. No session/estimate/reaction exists on this feed.
function mergeEarningsData(live: LiveEarningsDoc[]): Earning[] {
  return [...live]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(l => ({
      ticker: l.ticker, name: l.companyName ?? l.ticker, session: "", marketCap: "", sector: "",
      epsEstimate: l.epsEstimate, epsActual: l.epsActual,
      revenueEstimate: null, revenueActual: l.revenueActual ?? null,
      guidanceStatus: null, priceReaction: null, impliedMove: null,
      tags: [], owned: false,
    }));
}

function DashPopContent({
  sym, block, movers, earnings, watchlist, portfolio, companies, consensus, insiderMini, announcements,
}: {
  sym: string; block: PopBlock; movers: Mover[]; earnings: Earning[]; watchlist: WatchItem[]; portfolio: FolioItem[];
  companies: CompanyDoc[]; consensus: AnalystConsensusDoc[]; insiderMini: { key: string; s: string; role: string; dir: "buy" | "sell"; val: string }[];
  announcements: EarningsAnnouncementDoc[];
}) {
  const mv  = movers.find(x => x.ticker ===sym);
  const er  = earnings.find(x => x.ticker ===sym);
  const an  = consensus.find(x => x.ticker === sym);
  const w   = watchlist.find(x => x.ticker ===sym);
  const pf  = portfolio.find(x => x.ticker ===sym);
  const scr = companies.find(x => x.ticker ===sym);
  const ins = insiderMini.find(x => x.s === sym);
  const ann = announcements
    .filter(a => a.ticker === sym)
    .sort((a, b) => b.announceDate.localeCompare(a.announceDate))[0];
  const name = mv?.name ?? er?.name ?? w?.name ?? scr?.name ?? sym;

  let body: React.ReactNode;

  if (block === "earnings") {
    if (er) {
      body = <>
        <DpRow label="EPS est → act">
          {er.epsEstimate != null ? `$${er.epsEstimate}` : "—"}{er.epsActual != null && er.epsEstimate != null && <> → ${er.epsActual} <span className={er.epsActual >= er.epsEstimate ? "up" : "down"}>({er.epsActual >= er.epsEstimate ? "beat" : "miss"})</span></>}
        </DpRow>
        <DpRow label="Session">{ann?.session ?? <NotAvailable />}</DpRow>
        <DpRow label="Guidance"><NotAvailable /></DpRow>
        <DpRow label="Reaction">{ann?.reactionPct != null ? <span className={cls(ann.reactionPct)}>{sign(ann.reactionPct)}</span> : <NotAvailable />}</DpRow>
        <div className="dp-note">Session &amp; price reaction from the SEC-EDGAR 8-K (item 2.02) announcement. Guidance still needs a filings-text feed.</div>
      </>;
    } else {
      body = <div className="dp-note">On this week&apos;s earnings calendar.</div>;
    }
  } else if (block === "movers" && mv) {
    const c = companies.find(x => x.ticker === sym);
    body = <>
      <DpRow label="Today"><span className={cls(mv.pctChange)}>{sign(mv.pctChange)}</span></DpRow>
      <DpRow label="Rel. volume">{c?.rvol != null ? `${c.rvol.toFixed(1)}×` : <NotAvailable />}</DpRow>
      <DpRow label="RS rank">{c?.rsRating != null ? `${c.rsRating}/99` : <NotAvailable />}</DpRow>
      <div className="dp-note">Why it&apos;s moving: trading with its sector and the broad tape.</div>
    </>;
  } else if (block === "analyst" && an) {
    body = <>
      <DpRow label="Consensus"><b style={{ color: "var(--text-hi)" }}>{an.consensus}</b></DpRow>
      <DpRow label="Strong Buy / Buy">{an.strongBuy} / {an.buy}</DpRow>
      <DpRow label="Hold">{an.hold}</DpRow>
      <DpRow label="Sell / Strong Sell">{an.sell} / {an.strongSell}</DpRow>
      <div className="dp-note">Analyst consensus vote count. Per-firm upgrades/downgrades/price targets need a Benzinga-class feed, not built yet.</div>
    </>;
  } else if (block === "watchlist") {
    const px = w?.price ?? mv?.price;
    body = <>
      {px != null && <DpRow label="Price"><span className="mono">${fmt(px, 2)}</span></DpRow>}
      <DpRow label="Day"><span className={cls(w?.pctChange ?? mv?.pctChange ?? 0)}>{sign(w?.pctChange ?? mv?.pctChange ?? 0)}</span></DpRow>
      <DpRow label="Mkt Cap">{scr?.marketCap != null ? fmt(scr.marketCap) : <NotAvailable />}</DpRow>
      <DpRow label="P/E">{scr?.peRatio != null ? scr.peRatio.toFixed(1) : <NotAvailable />}</DpRow>
      <DpRow label="RS rank">{scr?.rsRating != null ? `${scr.rsRating}/99` : <NotAvailable />}</DpRow>
      <DpRow label="Sector">{scr?.sector ?? <NotAvailable />}</DpRow>
      <DpRow label="Next ER"><NotAvailable /></DpRow>
      {an && <DpRow label="Consensus"><b style={{ color: "var(--text-hi)" }}>{an.consensus}</b></DpRow>}
    </>;
  } else if (block === "portfolio" && pf) {
    body = <>
      <DpRow label="Day"><span className={cls(pf.pctChange)}>{sign(pf.pctChange)}</span></DpRow>
      <DpRow label="Unrealized"><NotAvailable /></DpRow>
      <DpRow label="Conviction">{pf.conviction}</DpRow>
      <div className="dp-note">A position in your book. Unrealized P/L needs a stored cost basis.</div>
    </>;
  } else if (block === "insider" && ins) {
    const buy = ins.dir === "buy";
    body = <>
      <DpRow label="Activity"><span className={buy ? "up" : "down"}>{buy ? "Insider buying" : "Insider selling"}</span></DpRow>
      <DpRow label="Insider">{ins.role}</DpRow>
      <DpRow label="Value"><span className={buy ? "up" : "down"}>{buy ? "+" : "−"}${ins.val}</span></DpRow>
      <div className="dp-note">Real SEC Form 4 filing.</div>
    </>;
  } else if (block === "screener" && scr) {
    body = <>
      <DpRow label="RS rank">{scr.rsRating != null ? `${scr.rsRating}/99` : <NotAvailable />}</DpRow>
      <DpRow label="Sector">{scr.sector ?? <NotAvailable />}</DpRow>
      <DpRow label="Tech rating">{scr.techRating != null ? scr.techRating : <NotAvailable />}</DpRow>
      <DpRow label="Rev growth">{scr.revenueGrowthYoY != null ? <span className={cls(scr.revenueGrowthYoY)}>{sign(scr.revenueGrowthYoY * 100)}</span> : <NotAvailable />}</DpRow>
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
  const { data: companies, loading: companiesLoading } = useApiList<CompanyDoc>("/market-data/companies");
  const { data: sectorsLive } = useApiList<SectorApiDoc>("/market-data/sectors");
  const { data: liveInsiderTx, loading: insiderLoading } = useApiList<InsiderTxDoc>("/market-data/insider-transactions");
  // Live Fear & Greed (fear-greed.job → market_sentiment/fear_greed). No mock
  // fallback: fgVal/fgLabel are null until the job has actually run.
  const { data: marketSentiment, loading: marketSentimentLoading } = useApiList<MarketSentimentDoc>("/market-data/market-sentiment");
  const fearGreed = marketSentiment.find(d => d.id === "fear_greed");
  const fgVal = fearGreed?.value ?? null;
  const fgLabel = fearGreed?.label ?? null;
  // Composite F&G history (market_sentiment_history) — backs the history drawer.
  const { data: fgHistory } = useApiList<MarketSentimentHistoryDoc>("/market-data/market-sentiment-history");
  // EDGAR 8-K earnings announcements (session + price reaction).
  const { data: earningsAnnouncements } = useApiList<EarningsAnnouncementDoc>("/market-data/earnings-announcements");
  const { data: consensusLive, loading: consensusLoading } = useApiList<AnalystConsensusDoc>("/market-data/analyst-actions");
  const { data: mostSearched, loading: mostSearchedLoading } = useApiResource<{ results: Array<{ ticker: string; count: number }> }>("/live/most-searched-tickers?limit=10");

  const pulse = pulseFromLive(liveIndices);
  const movers = mergeMoversData(liveMovers, companies);
  const earnings = mergeEarningsData(liveEarnings);
  const mergedSectorList = buildSectorList(companies, sectorsLive);
  const companyByTicker = new Map(companies.map(c => [c.ticker, c]));

  // key = the Firestore doc id, not ticker+dir: a single ticker can have
  // dozens of insider filings in the same direction (CRWD has 42 disposals),
  // so ticker+dir alone collides on real data.
  const INSIDER_MINI = liveInsiderTx.slice(0, 5).map(x => ({
    key: x.id,
    s: x.ticker,
    role: x.officerTitle ?? x.ownerName ?? "Filer",
    dir: (x.acquiredOrDisposed === "A" ? "buy" : "sell") as "buy" | "sell",
    val: x.pricePerShare ? (x.shares * x.pricePerShare / 1e6).toFixed(2) + "M" : "0",
  }));

  // Real watchlist/portfolio (signed-in user). No demo fallback: an empty
  // list renders DataState instead of a fabricated $128,430 showcase.
  const uid = firebaseAuth.currentUser?.uid ?? null;
  const { data: watchlistDoc, loading: watchlistLoading } = useApiResource<WatchlistDoc>(uid ? "/api/watchlist" : null);
  const { data: portfolioDoc, loading: portfolioLoading } = useApiResource<{ holdings: HoldingDoc[] }>(uid ? "/api/portfolio" : null);
  const realWatchTickers = watchlistDoc?.tickers ?? [];
  const realHoldings = portfolioDoc?.holdings ?? [];

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

  // Leaders/Laggards: real rsRating from `companies`, not the mock screener
  // catalog. Only tickers the rs-rating job has actually scored are ranked.
  const rankedCompanies = companies.filter(c => c.rsRating != null);
  const leaders  = [...rankedCompanies].sort((a, b) => (b.rsRating ?? 0) - (a.rsRating ?? 0)).slice(0, 3);
  const laggards = [...rankedCompanies].sort((a, b) => (a.rsRating ?? 0) - (b.rsRating ?? 0)).slice(0, 3);

  const [drawer, setDrawer] = useState<DrawerKey>(null);
  const [moversTab, setMoversTab] = useState<0 | 1 | 2>(0);
  const [scrTab, setScrTab] = useState<"leaders" | "laggards">("leaders");
  const [wmnOpen, setWmnOpen] = useState(false);

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
          <div className={`wmn${wmnOpen ? " open" : ""}`}>
            <button
              type="button"
              className="wmn-h"
              aria-expanded={wmnOpen}
              onClick={() => setWmnOpen(o => !o)}
            >
              <div className="t">
                <div className="wmn-orb">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9z" fill="currentColor" />
                  </svg>
                </div>
                <div>
                  <h2>What Matters Now</h2>
                  <div className="meta">AI-curated market briefing</div>
                </div>
              </div>
              <svg className="wmn-chev" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="wmn-collapse">
              <div className="wmn-collapse-inner">
                <DataState label="AI features aren't wired yet — Coming soon...." />
              </div>
            </div>
          </div>
        </div>
 {/* ── needs an Anthropic API key ── */}

        {/* ── 2b. Most Searched Tickers ── */}
        <div className="col-12">
          <div className="card">
            <div className="card-h">
              <h3>Most Searched Tickers</h3>
              <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>by user searches</span>
            </div>
            <div className="card-b" style={{ paddingTop: 6 }}>
              {!mostSearched || mostSearched.results.length === 0 ? (
                <DataState loading={mostSearchedLoading} label="No searches recorded yet." />
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {mostSearched.results.map(({ ticker, count }) => {
                    const c = companyByTicker.get(ticker);
                    return (
                      <div key={ticker}
                        onClick={() => openStock(ticker)}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          flex: "1 1 190px", minWidth: 190, maxWidth: 240,
                          background: "var(--surface-1)", border: "1px solid var(--border)",
                          borderRadius: 8, padding: "8px 10px", cursor: "pointer", transition: "border-color .13s",
                        }}
                      >
                        <StockLogo sym={ticker} size={28} />
                        <span className="tkr">{ticker}<small>{c?.name ?? "—"}</small></span>
                        <div style={{ marginLeft: "auto", textAlign: "right" }}>
                          {c?.price != null ? (
                            <>
                              <div className="mono" style={{ fontSize: ".8rem", color: "var(--text-hi)" }}>{fmt(c.price)}</div>
                              {c?.pctChange != null && <div className={`mono ${cls(c.pctChange)}`} style={{ fontSize: ".68rem" }}>{sign(c.pctChange)}</div>}
                            </>
                          ) : <NotAvailable />}
                        </div>
                        <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)", flexShrink: 0 }}>{count}×</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── 3. Earnings Today ── */}
        <div className="col-4">
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>Earnings Today</h3>
              <Link className="link" href="/menu/earnings">View all →</Link>
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
                    {e.epsActual != null
                      ? <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-hi)" }}>EPS ${e.epsActual.toFixed(2)}</span>
                      : <span style={{ color: "var(--text-dim-solid)", fontSize: ".72rem" }}>—</span>}
                  </span>
                  <span className="r" style={{ color: "var(--text-dim-solid)", fontSize: ".72rem", fontFamily: "var(--f-mono)" }}>
                    {e.revenueActual != null ? `$${(e.revenueActual / 1e9).toFixed(1)}B` : ""}
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
              <Link className="link" href="/menu/movers">View all →</Link>
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
                  <span className="mid">{moversTab === 2 ? `${m.rvolRatio}× vol` : m.name}</span>
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
              // Top 30 stocks by market cap across all sectors (deduplicated)
              // — was 16, which left the card looking half-empty next to its
              // taller siblings (Earnings Today / Movers).
              const seen = new Set<string>();
              const top30 = mergedSectorList
                .flatMap(sd => sd.items.map(([sym, mcap, chg]) => ({ sym, mcap, chg, sd })))
                .sort((a, b) => b.mcap - a.mcap)
                .filter(s => { if (seen.has(s.sym)) return false; seen.add(s.sym); return true; })
                .slice(0, 30);

              // Group back by sector, preserving sector order
              const groups = mergedSectorList
                .map(sd => ({ sd, stocks: top30.filter(s => s.sd === sd) }))
                .filter(g => g.stocks.length > 0);

              return (
                <div className="card-b" style={{ paddingTop: 6, maxHeight: 420, overflowY: "auto" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {groups.map(({ sd, stocks }) => {
                      const hcSect = heatCol(sd.pctChange ?? 0);
                      return (
                        <div key={sd.name} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <div
                            onClick={() => openSector(sd.name)}
                            onMouseEnter={e => showHeatPop(e, sd)}
                            onMouseLeave={hideHeatPop}
                            style={{
                              width: 104, flexShrink: 0, cursor: "pointer",
                              background: hcSect.bg, borderRadius: 7,
                              padding: "5px 8px", height: 48,
                              display: "flex", flexDirection: "column", justifyContent: "center", gap: 2,
                            }}
                          >
                            <span style={{ fontSize: ".7rem", fontWeight: 700, color: hcSect.fg, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sd.name}</span>
                            <span style={{ fontFamily: "var(--f-mono)", fontSize: ".64rem", color: hcSect.fg, opacity: .9 }}>{sd.pctChange == null ? <NotAvailable /> : sign(sd.pctChange)}</span>
                          </div>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {stocks.map(({ sym, chg }) => {
                              const hc = heatCol(chg);
                              return (
                                <div key={sym}
                                  onClick={() => openStock(sym)}
                                  title={`${sym}  ${sign(chg)}`}
                                  style={{
                                    background: hc.bg, borderRadius: 7,
                                    width: 64, height: 48, flexShrink: 0,
                                    display: "flex", flexDirection: "column",
                                    alignItems: "center", justifyContent: "center",
                                    cursor: "pointer", transition: "filter .12s",
                                    gap: 2,
                                  }}
                                  onMouseOver={e => (e.currentTarget.style.filter = "brightness(1.3)")}
                                  onMouseOut={e => (e.currentTarget.style.filter = "")}
                                >
                                  <span style={{ fontSize: ".72rem", fontWeight: 800, color: hc.fg, lineHeight: 1 }}>{sym.slice(0, 4)}</span>
                                  <span style={{ fontSize: ".62rem", fontFamily: "var(--f-mono)", color: hc.fg, opacity: .88, lineHeight: 1 }}>{sign(chg)}</span>
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

        {/* ── 6. Analyst Actions ── */}
        <div className="col-4">
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>Analyst Actions</h3>
              <Link className="link" href="/menu/analyst">View all →</Link>
            </div>
            <div className="card-b" style={{ paddingTop: 4 }}>
              {consensusLive.length === 0 ? (
                <DataState loading={consensusLoading} label="No analyst consensus synced yet." height={80} />
              ) : consensusLive.slice(0, 5).map(a => (
                <div key={a.ticker} className="minirow" style={{ cursor: "pointer" }}
                  onClick={() => openStock(a.ticker)}
                  {...mr(a.ticker, "analyst")}
                >
                  <StockLogo sym={a.ticker} size={26} />
                  <span className="tkr">{a.ticker}</span>
                  <span className="mid">
                    {a.strongBuy + a.buy}B / {a.hold}H / {a.sell + a.strongSell}S
                  </span>
                  <span className="r">
                    <b style={{ color: "var(--text-hi)" }}>{a.consensus}</b>
                  </span>
                </div>
              ))}
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
              {rankedCompanies.length < 12 ? (
                <DataState loading={companiesLoading} label={`Rankings build as price history syncs — ${rankedCompanies.length} of ${companies.length} companies scored so far.`} height={80} />
              ) : (scrTab === "leaders" ? leaders : laggards).map(s => {
                const dayC = movers.find(m => m.ticker === s.ticker)?.pctChange ?? 0;
                return (
                  <div key={s.ticker} className="minirow" style={{ cursor: "pointer" }}
                    onClick={() => openStock(s.ticker)}
                    {...mr(s.ticker, "screener")}
                  >
                    <StockLogo sym={s.ticker} size={26} />
                    <span className="tkr">{s.ticker}</span>
                    <span className="mid">RS {s.rsRating} · {s.sector ?? "—"}</span>
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
              <Link className="link" href="/menu/portfolio">View all →</Link>
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
                <DataState loading={portfolioLoading} label="No saved portfolio yet." height={60} />
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
              <Link className="link" href="/menu/watchlist">View all →</Link>
            </div>
            <div className="card-b" style={{ paddingTop: 8 }}>
              {watchMini.length === 0 ? (
                <DataState loading={watchlistLoading} label="No saved watchlist yet." height={80} />
              ) : watchMini.slice(0, 5).map(w => (
                <div key={w.ticker} className="minirow" style={{ cursor: "pointer" }}
                  onClick={() => openStock(w.ticker)}
                  {...mr(w.ticker, "watchlist")}
                >
                  <StockLogo sym={w.ticker} size={26} />
                  <span className="tkr">{w.ticker}</span>
                  <span className="mid">{companyByTicker.get(w.ticker) ? "live" : "not synced"}</span>
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
              <Link className="link" href="/menu/insider">View all →</Link>
            </div>
            <div className="card-b" style={{ paddingTop: 4 }}>
              {INSIDER_MINI.length === 0 ? (
                <DataState loading={insiderLoading} label="No insider filings synced yet." height={80} />
              ) : INSIDER_MINI.map(x => (
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
              <DataState label="Report generation isn't built yet — see the Recaps screen for live data." height={80} />
            </div>
          </div>
        </div>

        {/* ── 13. VIX · Volatility ── */}
        <div className="col-4">
          <div className="card vix" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>VIX · Volatility</h3>
            </div>
            <div className="card-b">
              {(() => {
                const vix = liveIndices.find(i => i.id === "VIX");
                if (!vix) return <DataState loading={!tapeFrame} label="VIX not synced yet." height={100} />;
                return <>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span className="big">{vix.value.toFixed(2)}</span>
                    <span className={`mono ${cls(vix.pctChange)}`} style={{ fontWeight: 600 }}>{sign(vix.pctChange)}</span>
                  </div>
                  <div className="note" style={{ marginTop: 10 }}>
                    Shown via {vix.proxyTicker} (ETF proxy){vix.note ? ` — ${vix.note}` : ""}
                  </div>
                </>;
              })()}
            </div>
          </div>
        </div>

        {/* ── 14. Fear & Greed ── */}
        <div className="col-4">
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>Fear &amp; Greed</h3>
              {fgVal != null && fgLabel != null && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button className="link" onClick={() => setDrawer("fg-history")}>History →</button>
                  <ExpandBtn title="Fear & Greed Index" node={<SemiGauge val={fgVal} label={fgLabel} id="fg-modal" />} />
                </div>
              )}
            </div>
            <div className="card-b gauge-wrap">
              {fgVal != null && fgLabel != null
                ? <SemiGauge val={fgVal} label={fgLabel} id="fg" />
                : <DataState loading={marketSentimentLoading} label="Fear &amp; Greed hasn't synced yet." height={140} />}
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
                  {drawer === "fg-history"  && "Fear & Greed · History"}
                </div>
              </div>
              <button className="closebtn" onClick={() => setDrawer(null)}>&#x2715;</button>
            </div>
            <div className="drawer-b">

              {/* Fear & Greed History — the only remaining in-page drawer.
                  All "View all" widgets now navigate to /menu/{screen}; the
                  removed earnings/movers/analyst/earn-movers/internals/watchlist/
                  portfolio/insider branches are archived in
                  Doc/ARCHIVED-dashboard-viewall-drawers.md. */}
              {drawer === "fg-history" && (() => {
                const rows = [...fgHistory]
                  .filter(d => typeof d.value === "number")
                  .sort((a, b) => a.id.localeCompare(b.id))
                  .slice(-90);
                if (rows.length < 2) {
                  return <DataState label="Fear & Greed history populates once the fear-greed job has run over a backfilled ohlcv_bars." />;
                }
                const vals = rows.map(r => r.value as number);
                const W = 320, H = 90;
                const pts = vals.map((v, i) => {
                  const x = (i / (vals.length - 1)) * W;
                  const y = H - (v / 100) * H;
                  return `${x.toFixed(1)},${y.toFixed(1)}`;
                }).join(" ");
                const latest = rows[rows.length - 1];
                return (
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                      <span className="mono" style={{ fontSize: "1.7rem", fontWeight: 700, color: "var(--text-hi)" }}>{latest.value}</span>
                      <span style={{ fontSize: ".8rem", color: "var(--text-dim-solid)" }}>{latest.label} · {latest.id}</span>
                    </div>
                    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
                      {[0.25, 0.5, 0.75].map(f => (
                        <line key={f} x1="0" y1={H * f} x2={W} y2={H * f} stroke="var(--border)" strokeWidth="0.5" />
                      ))}
                      <polyline points={pts} fill="none" stroke="var(--brand)" strokeWidth="1.5" />
                    </svg>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".64rem", color: "var(--text-dim-solid)", marginTop: 4 }}>
                      <span>{rows[0].id}</span>
                      <span>{rows.length} sessions · 0–100 composite</span>
                      <span>{latest.id}</span>
                    </div>
                  </div>
                );
              })()}

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
            <span className={`pill ${heatPop.sd.pctChange == null ? "" : heatPop.sd.pctChange >= 0 ? "up" : "dn"}`}>
              {heatPop.sd.pctChange == null ? <NotAvailable /> : sign(heatPop.sd.pctChange)}
            </span>
          </div>
          <div className="heat-pop-trend">{heatPop.sd.trend ?? <NotAvailable />}</div>
          {heatPop.sd.items.slice(0, 4).map(([sym, mcap, chg]) => {
            const mv  = movers.find(m => m.ticker === sym);
            const scr = companyByTicker.get(sym);
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
                    {mv?.price  ? <span>Price <b>${fmt(mv.price)}</b></span> : null}
                    {scr?.rvol != null ? <span>RVOL <b>{scr.rvol.toFixed(1)}×</b></span> : null}
                    {scr?.rsRating != null ? <span>RS <b>{scr.rsRating}/99</b></span> : null}
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
          <DashPopContent sym={pop.sym} block={pop.block} movers={movers} earnings={earnings} watchlist={watchMini} portfolio={folioMini} companies={companies} consensus={consensusLive} insiderMini={INSIDER_MINI} announcements={earningsAnnouncements} />
        </div>
      )}
    </div>
  );
}

/** Live Market Feed — real synced news, falling back to the original mock items if none are synced yet. */
function LiveFeedList() {
  const { data: news, loading } = useApiList<NewsArticleDoc>("/market-data/news");
  const recent = [...news].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()).slice(0, 5);

  // No mock fallback: when there's no live news, show an honest empty state
  // rather than fabricated headlines that read as real market events.
  if (recent.length === 0) {
    return <DataState loading={loading} label="No market-moving news right now." />;
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
