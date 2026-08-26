"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import { firebaseAuth } from "../../firebase";
import { apiGet } from "../backend";
import { useIQActions, ExpandBtn } from "../shell";
import { type Mover, type SectorRow, type Earning, type FolioItem, type WatchItem, maPostureLabel } from "../data";
import { fmt, sign, cls, arr, Spark, SemiGauge, StockLogo, heatCol, DataState, NotAvailable, VendorTag } from "../utils";
import { isoDay } from "../calendar-range";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import { useTapeStream } from "../hooks/useTapeStream";
import { useLiveQuotes } from "../live-quotes-context";
import { pulseFromLive, buildSectorList, tapeItemsToIndexDocs } from "../live-market-indices";
import type {
  LiveMoverDoc, LiveEarningsDoc, CompanyDoc, SectorApiDoc,
  InsiderTxDoc, AnalystConsensusDoc, MarketSentimentDoc, MarketSentimentHistoryDoc, EarningsAnnouncementDoc,
  HoldingDoc, NewsArticleDoc, RecapDoc,
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
 * `rsRating` when synced; `maPosture` from `companies.aboveSma50/aboveSma200`
 * (technical-indicators.job), "—" until synced. (Catalyst was removed — Polygon
 * has no catalyst feed, so it only ever showed "—".)
 */
function mergeMoversData(live: LiveMoverDoc[], companies: CompanyDoc[]): Mover[] {
  const companyByTicker = new Map(companies.map(c => [c.ticker, c]));
  return live.map(l => {
    const c = companyByTicker.get(l.ticker);
    return {
      ticker: l.ticker, name: l.name ?? l.ticker, price: l.price, pctChange: l.pctChange,
      rvolRatio: c?.rvol ?? 0, relativeStrength: c?.rsRating ?? 0,
      maPosture: maPostureLabel(c?.aboveSma50, c?.aboveSma200), owned: false,
      sector: l.sector ?? c?.sector ?? "—", cap: (l.cap as Mover["cap"]) ?? "Mid", weekPct: c?.week5ChangePct ?? null,
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

/** Diverging red→neutral→green border tint for a %change, saturating at ±3%
 *  (matches the reference scale). Small moves stay near the neutral border. */
function pctBorderColor(pct: number | null | undefined): string {
  if (pct == null) return "var(--border)";
  const neutral: [number, number, number] = [0x2C, 0x38, 0x49];
  const green: [number, number, number] = [0x2F, 0xE6, 0xA6];
  const red: [number, number, number] = [0xFF, 0x54, 0x70];
  const target = pct >= 0 ? green : red;
  const t = Math.min(1, Math.abs(pct) / 3);
  const ch = (i: number) => Math.round(neutral[i] + (target[i] - neutral[i]) * t);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}

function DashPopContent({
  sym, block, movers, earnings, watchlist, portfolio, companies, consensus, insiderMini, announcements, news, onDemandNews,
}: {
  sym: string; block: PopBlock; movers: Mover[]; earnings: Earning[]; watchlist: WatchItem[]; portfolio: FolioItem[];
  companies: CompanyDoc[]; consensus: AnalystConsensusDoc[]; insiderMini: { key: string; s: string; role: string; dir: "buy" | "sell"; val: string }[];
  announcements: EarningsAnnouncementDoc[]; news: NewsArticleDoc[]; onDemandNews: Record<string, NewsArticleDoc | null>;
}) {
  // Latest headline: bulk news first (instant), else the on-demand fetch result
  // (which covers ANY ticker), else still loading.
  const bulkNews = news
    .filter(n => n.ticker === sym)
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))[0] ?? undefined;
  const newsResolved = bulkNews != null || sym in onDemandNews;
  const latestNews = bulkNews ?? onDemandNews[sym] ?? null;
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
      {/* Why it moved: the latest headline, or an honest empty state. */}
      <div className="dp-note">
        {latestNews
          ? <><b style={{ color: "var(--text-hi)" }}>Latest:</b> {latestNews.headline}{latestNews.source ? <span style={{ color: "var(--text-dim-solid)" }}> · {latestNews.source}</span> : null}</>
          : newsResolved ? "News not available." : "Loading news…"}
      </div>
    </>;
  } else if (block === "analyst" && an) {
    const grades = an.recentGrades ?? [];
    body = <>
      <DpRow label="Consensus"><b style={{ color: "var(--text-hi)" }}>{an.consensus}</b></DpRow>
      <DpRow label="Strong Buy / Buy">{an.strongBuy} / {an.buy}</DpRow>
      <DpRow label="Hold">{an.hold}</DpRow>
      <DpRow label="Sell / Strong Sell">{an.sell} / {an.strongSell}</DpRow>
      <DpRow label="PT median">{an.priceTargetMedian != null ? `$${fmt(an.priceTargetMedian, 2)}` : <NotAvailable />}</DpRow>
      <DpRow label="PT low / high">{an.priceTargetLow != null && an.priceTargetHigh != null ? `$${fmt(an.priceTargetLow, 2)} – $${fmt(an.priceTargetHigh, 2)}` : <NotAvailable />}</DpRow>
      <div className="dp-note">{grades.length > 0 ? `${grades.length} recent rating change${grades.length === 1 ? "" : "s"} — open the analyst page for per-firm detail.` : "Analyst consensus vote count and price-target range."}</div>
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
      <DpRow label="Unrealized">{pf.costBasis != null ? <span className={cls(pf.gainLossPct)}>{sign(pf.gainLossPct)}</span> : <NotAvailable />}</DpRow>
      <DpRow label="Conviction">{pf.conviction}</DpRow>
      <div className="dp-note">{pf.costBasis != null ? `Unrealized vs your $${pf.costBasis.toFixed(2)} cost basis.` : "A position in your book. Add a cost basis on the Portfolio screen to see unrealized P/L."}</div>
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
      <VendorTag v={block === "analyst" ? ["fmp", "polygon"] : block === "insider" ? "sec" : "polygon"} />
      <span className="dp-tag">{BLOCK_LABEL[block]}</span>
    </div>
    <div>{body}</div>
    <div className="dp-foot">Click to open {BLOCK_NAV[block]} →</div>
  </>;
}

export function DashboardScreen() {
  const { openStock, openStockDetail, openMoverModal, openEarnings, openSector, openIndex } = useIQActions();
  /* Market-wide AI digest for the What Matters Now card. Read-only from the
     app's side: the endpoint regenerates at most once an hour and shares one
     call across concurrent viewers. */
  const { data: wmn } = useApiResource<{
    summary?: string; overallAssessment?: string; keyDevelopments?: string[];
    generatedAt?: string; sourceCounts?: { news: number; analyses: number };
  }>("/live/what-matters-now");

  // Same shared upstream tape SSE broadcast the shell's ticker strip uses
  // (Phase 1) — not a direct market_indices Firestore listener.
  const { frame: tapeFrame } = useTapeStream();
  const liveIndices = tapeFrame ? tapeItemsToIndexDocs(tapeFrame.items) : [];
  const { data: liveMovers } = useApiList<LiveMoverDoc>("/market-data/movers");
  const { data: liveEarnings } = useApiList<LiveEarningsDoc>("/market-data/earnings");
  const { data: companies, loading: companiesLoading } = useApiList<CompanyDoc>("/market-data/companies");
  const { data: sectorsLive } = useApiList<SectorApiDoc>("/market-data/sectors");
  const { data: liveInsiderTx, loading: insiderLoading } = useApiList<InsiderTxDoc>("/market-data/insider-transactions");
  // Per-ticker news — powers the "why it moved" line in the hover popup AND the
  // latest-headlines list inside the "What Matters Now" card.
  // Still needed by the ticker popovers, but no longer for a loading state —
  // the What Matters Now card stopped rendering the headline list.
  const { data: dashNews } = useApiList<NewsArticleDoc>("/market-data/news");
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
  const { data: recaps, loading: recapsLoading } = useApiList<RecapDoc>("/market-data/recaps");
  const latestRecap = [...recaps].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0] ?? null;
  const { data: mostSearched, loading: mostSearchedLoading } = useApiResource<{ results: Array<{ ticker: string; count: number }> }>("/live/most-searched-tickers?limit=10");
  // Dedupe: merge any repeated ticker and collapse Google's dual class
  // (GOOG → GOOGL) so the same company never appears twice.
  const searchedDeduped = (() => {
    const map = new Map<string, { ticker: string; count: number }>();
    for (const r of mostSearched?.results ?? []) {
      const key = r.ticker === "GOOG" ? "GOOGL" : r.ticker;
      const cur = map.get(key);
      if (cur) cur.count += r.count;
      else map.set(key, { ticker: key, count: r.count });
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  })();
  // Live quotes for the searched names so this widget shows a current price even
  // when the base `companies` doc has a null price (the deep profile sweep hasn't
  // reached that ticker yet) — same overlay every other screen uses.
  const searchedLive = useLiveQuotes(searchedDeduped.map((s) => s.ticker));

  const pulse = pulseFromLive(liveIndices);
  const movers = mergeMoversData(liveMovers, companies);
  const earnings = mergeEarningsData(liveEarnings);
  // "Earnings Today" is exactly today's reported companies — no fallback to the
  // most recent prior day, so when nothing has reported today the widget is
  // empty rather than showing stale rows. (`earnings` above stays the full list
  // for popover name/EPS lookups.)
  const earningsToday = mergeEarningsData(liveEarnings.filter(e => e.date === isoDay(new Date())));
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
  const { data: watchlistsRes, loading: watchlistLoading } = useApiResource<{ watchlists: { id: string; name: string; tickers: string[] }[] }>(uid ? "/api/watchlists" : null);
  const { data: portfolioDoc, loading: portfolioLoading } = useApiResource<{ holdings: HoldingDoc[] }>(uid ? "/api/portfolio" : null);
  // A user can keep several named watchlists (backend GET /api/watchlists). The
  // widget shows one at a time; a dropdown appears in its header only when there
  // is more than one list to switch between.
  const watchlists = watchlistsRes?.watchlists ?? [];
  const [selWatchId, setSelWatchId] = useState<string | null>(null);
  const activeWatchlist = watchlists.find(w => w.id === selWatchId) ?? watchlists[0] ?? null;
  const realHoldings = portfolioDoc?.holdings ?? [];

  const watchMini: WatchItem[] = (activeWatchlist?.tickers ?? []).map(t => {
    const c = companyByTicker.get(t);
    return {
      ticker: t, name: c?.name ?? t, price: c?.price ?? 0, pctChange: c?.pctChange ?? 0,
      nextEarningsDate: "—", lastAnalystAction: null, hasOptions: false, latestHeadline: "—",
    };
  });

  const isRealFolio = realHoldings.length > 0;
  const folioMini: FolioItem[] = realHoldings.map(h => {
    const c = companyByTicker.get(h.ticker);
    const price = c?.price ?? 0;
    // Unrealized return vs the stored cost basis (holdings × live quote is the
    // $ view; this is the per-share %). 0 when no basis has been entered.
    const gainLossPct = h.costBasis != null && h.costBasis > 0 && price > 0
      ? (price - h.costBasis) / h.costBasis * 100 : 0;
    return {
      ticker: h.ticker, name: c?.name ?? h.ticker, price, pctChange: c?.pctChange ?? 0,
      gainLossPct, costBasis: h.costBasis, positionSize: h.positionSize, conviction: h.conviction, eventNote: "—",
    };
  });

  // Leaders/Laggards: real rsRating from `companies`, not the mock screener
  // catalog. Only tickers the rs-rating job has actually scored are ranked.
  // Top / bottom 20 by relative strength — the widget scrolls through them.
  const rankedCompanies = companies.filter(c => c.rsRating != null);
  const leaders  = [...rankedCompanies].sort((a, b) => (b.rsRating ?? 0) - (a.rsRating ?? 0)).slice(0, 20);
  const laggards = [...rankedCompanies].sort((a, b) => (a.rsRating ?? 0) - (b.rsRating ?? 0)).slice(0, 20);

  // Analyst Actions widget: deterministic pick — the 4 names with the strongest
  // BUY lean and the 4 with the strongest SELL lean, measured by the buy−sell
  // vote margin. Not the first rows off the feed.
  const analystLean = (a: AnalystConsensusDoc) => (a.strongBuy + a.buy) - (a.sell + a.strongSell);
  const analystRated = consensusLive.filter(a => (a.strongBuy + a.buy + a.hold + a.sell + a.strongSell) > 0);
  const analystTopBuy  = [...analystRated].sort((a, b) => analystLean(b) - analystLean(a)).slice(0, 4);
  const analystBuyIds  = new Set(analystTopBuy.map(a => a.ticker));
  const analystTopSell = [...analystRated].sort((a, b) => analystLean(a) - analystLean(b)).filter(a => !analystBuyIds.has(a.ticker)).slice(0, 4);

  const [drawer, setDrawer] = useState<DrawerKey>(null);
  const [moversTab, setMoversTab] = useState<0 | 1 | 2>(0);
  const [scrTab, setScrTab] = useState<"leaders" | "laggards">("leaders");
  const [wmnOpen, setWmnOpen] = useState(true);

  // ---- Dash pop hover ----
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pop, setPop] = useState<PopState | null>(null);
  // On-demand news for the hovered ticker (the bulk `news` collection only
  // covers a few large caps). Cached: NewsArticleDoc, or null when none.
  const [popNewsCache, setPopNewsCache] = useState<Record<string, NewsArticleDoc | null>>({});
  useEffect(() => {
    const sym = pop?.sym;
    if (!sym || dashNews.some(n => n.ticker === sym) || sym in popNewsCache) return;
    const id = setTimeout(() => {
      apiGet<NewsArticleDoc[]>(`/live/news?ticker=${encodeURIComponent(sym)}`)
        .then(articles => {
          const latest = [...(articles ?? [])].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))[0] ?? null;
          setPopNewsCache(c => ({ ...c, [sym]: latest }));
        })
        .catch(() => setPopNewsCache(c => ({ ...c, [sym]: null })));
    }, 200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pop?.sym]);

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
          <div className="pulse" style={{ position: "relative" }}>
            <span style={{ position: "absolute", top: 4, right: 6, zIndex: 2, pointerEvents: "none" }}><VendorTag v="polygon" /></span>
            {pulse.slice(0, 9).map((x, i) => (
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
                  <div className="meta">
                    {wmn?.summary ? "AI read of the last few hours · updated hourly" : "Latest market-moving headlines"}
                  </div>
                </div>
              </div>
              <svg className="wmn-chev" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="wmn-collapse">
              <div className="wmn-collapse-inner" style={{ padding: "2px 18px 16px" }}>
                {/* The card's whole content: the AI read, scrolling inside a
                    fixed height so a long digest cannot push the rest of the
                    dashboard down the page. */}
                {wmn?.summary && (
                  <div className="wmn-ai">
                    <p className="wmn-ai-sum">{wmn.summary}</p>
                    {wmn.overallAssessment && (
                      <p className="wmn-ai-assess">{wmn.overallAssessment}</p>
                    )}
                    {!!wmn.keyDevelopments?.length && (
                      <ul className="wmn-ai-list">
                        {wmn.keyDevelopments.slice(0, 4).map((k, i) => <li key={i}>{k}</li>)}
                      </ul>
                    )}
                    <div className="wmn-ai-foot">
                      AI-generated · {wmn.sourceCounts?.news ?? 0} headlines
                      {wmn.sourceCounts?.analyses ? ` · ${wmn.sourceCounts.analyses} analyses` : ""}
                      {wmn.generatedAt ? ` · ${wmn.generatedAt.slice(11, 16)} UTC` : ""}
                    </div>
                  </div>
                )}
                {/* Headline list removed: the card now shows the AI read only.
                    The same stories remain one click away in the Live Feed, and
                    duplicating them here pushed the analysis off-screen. */}
                {!wmn?.summary && (
                  <DataState loading={!wmn} label="No market-moving activity to summarise yet." />
                )}
              </div>
            </div>
          </div>
        </div>
 {/* ── needs an Anthropic API key ── */}

        {/* ── 2b. Most Searched Tickers ── */}
        <div className="col-12">
          <div className="card">
            <div className="card-h">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Most Searched Tickers</h3><VendorTag v={["firebase", "polygon"]} /></div>
              <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>by user searches</span>
            </div>
            <div className="card-b" style={{ paddingTop: 6 }}>
              {searchedDeduped.length === 0 ? (
                <DataState loading={mostSearchedLoading} label="No searches recorded yet." />
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {searchedDeduped.map(({ ticker, count }) => {
                    const c = companyByTicker.get(ticker);
                    // Prefer the live quote; fall back to the base companies doc.
                    const q = searchedLive.get(ticker);
                    const price = q?.price ?? c?.price ?? null;
                    const pct = q?.pctChange ?? c?.pctChange ?? null;
                    return (
                      <div key={ticker}
                        onClick={() => openStockDetail(ticker, searchedDeduped.map(x => x.ticker))}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          flex: "1 1 190px", minWidth: 190, maxWidth: 240,
                          border: "1.5px solid transparent", borderRadius: 10,
                          // Gradient border: the direction colour glows across the
                          // TOP edge and fades to the neutral border down the sides.
                          background: `linear-gradient(var(--surface-1), var(--surface-1)) padding-box, linear-gradient(180deg, ${pctBorderColor(pct)} 0%, var(--border) 55%) border-box`,
                          padding: "9px 11px", cursor: "pointer", transition: "background .13s",
                        }}
                      >
                        <StockLogo sym={ticker} size={28} />
                        <span className="tkr">{ticker}<small>{c?.name ?? "—"}</small></span>
                        <div style={{ marginLeft: "auto", textAlign: "right" }}>
                          {price != null ? (
                            <>
                              <div className="mono" style={{ fontSize: ".8rem", color: "var(--text-hi)" }}>{fmt(price)}</div>
                              {pct != null && <div className={`mono ${cls(pct)}`} style={{ fontSize: ".68rem" }}>{sign(pct)}</div>}
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
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Earnings Today</h3><VendorTag v="polygon" /></div>
              <Link className="link" href="/menu/earnings">View all →</Link>
            </div>
            <div className="card-b" style={{ paddingTop: 4 }}>
              {earningsToday.length === 0
                ? <DataState label="No earnings reported today." height={100} />
                : earningsToday.slice(0, 10).map(e => (
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
          <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div className="card-h">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Movers</h3><VendorTag v="polygon" /></div>
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
            <div className="card-b" style={{ paddingTop: 8, flex: 1, minHeight: 0, overflowY: "auto" }}>
              {(moversTab === 0
                ? [...movers].filter(m => m.pctChange > 0).sort((a, b) => b.pctChange - a.pctChange)
                : moversTab === 1
                ? [...movers].filter(m => m.pctChange < 0).sort((a, b) => a.pctChange - b.pctChange)
                : [...movers].sort((a, b) => b.rvolRatio - a.rvolRatio)
              ).slice(0, 40).map(m => (
                <div key={m.ticker} className="minirow" style={{ cursor: "pointer" }}
                  onClick={() => openMoverModal(m.ticker)}
                  {...mr(m.ticker, "movers")}
                >
                  <StockLogo sym={m.ticker} size={26} />
                  <span className="tkr">{m.ticker}</span>
                  <span className="mid">{moversTab === 2 ? `${m.rvolRatio}× vol` : m.name}</span>
                  <span className={`r ${cls(m.pctChange)}`}>{sign(m.pctChange)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 5. Market Heatmap ── */}
        <div className="col-4">
          <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div className="card-h">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Market Heatmap</h3><VendorTag v="polygon" /></div>
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
                <div className="card-b" style={{ paddingTop: 6, flex: 1, minHeight: 0, overflowY: "auto" }}>
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
          <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div className="card-h">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Analyst Actions</h3><VendorTag v={["fmp", "polygon"]} /></div>
              <Link className="link" href="/menu/analyst">View all →</Link>
            </div>
            <div className="card-b" style={{ paddingTop: 4, flex: 1, minHeight: 0, maxHeight: 440, overflowY: "auto" }}>
              {analystRated.length === 0 ? (
                <DataState loading={consensusLoading} label="No analyst consensus synced yet." height={80} />
              ) : (
                <>
                  <div style={{ fontSize: ".62rem", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--up)", margin: "2px 0 4px" }}>Most buy-rated</div>
                  {analystTopBuy.map(a => (
                    <div key={a.ticker} className="minirow" style={{ cursor: "pointer" }}
                      onClick={() => openStock(a.ticker)}
                      {...mr(a.ticker, "analyst")}
                    >
                      <StockLogo sym={a.ticker} size={26} />
                      <span className="tkr">{a.ticker}</span>
                      <span className="mid">{a.strongBuy + a.buy}B / {a.hold}H / {a.sell + a.strongSell}S</span>
                      <span className="r"><b style={{ color: "var(--text-hi)" }}>{a.consensus}</b></span>
                    </div>
                  ))}
                  {analystTopSell.length > 0 && (
                    <div style={{ fontSize: ".62rem", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--down)", margin: "8px 0 4px" }}>Most sell-rated</div>
                  )}
                  {analystTopSell.map(a => (
                    <div key={a.ticker} className="minirow" style={{ cursor: "pointer" }}
                      onClick={() => openStock(a.ticker)}
                      {...mr(a.ticker, "analyst")}
                    >
                      <StockLogo sym={a.ticker} size={26} />
                      <span className="tkr">{a.ticker}</span>
                      <span className="mid">{a.strongBuy + a.buy}B / {a.hold}H / {a.sell + a.strongSell}S</span>
                      <span className="r"><b style={{ color: "var(--text-hi)" }}>{a.consensus}</b></span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── 7. Screener · Leaders & Laggards ── */}
        <div className="col-4">
          <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div className="card-h">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Screener · Leaders &amp; Laggards</h3><VendorTag v="polygon" /></div>
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
            <div className="card-b" style={{ paddingTop: 8, flex: 1, minHeight: 0, maxHeight: 440, overflowY: "auto" }}>
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
                    <span className="mid">{s.sector ?? "—"}</span>
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
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Portfolio Pulse</h3><VendorTag v="polygon" /></div>
              <Link className="link" href="/menu/portfolio">View all →</Link>
            </div>
            <div className="card-b" style={{ paddingTop: 8 }}>
              {isRealFolio ? (() => {
                // Value only holdings with a real synced price. A holding whose
                // price hasn't synced must NEVER be treated as $0 — that silently
                // understates total value and day P&L. Unpriced holdings are
                // excluded here and the coverage is disclosed below (mirrors the
                // `priced` filter in portfolio.tsx).
                const priced = realHoldings
                  .map(h => ({ h, price: companyByTicker.get(h.ticker)?.price ?? null, pctChange: companyByTicker.get(h.ticker)?.pctChange ?? 0 }))
                  .filter((x): x is { h: HoldingDoc; price: number; pctChange: number } => x.price != null);
                const totalVal = priced.reduce((s, { h, price }) => s + h.shares * price, 0);
                const dayPL = priced.reduce((s, { h, price, pctChange }) => s + h.shares * price * pctChange / 100, 0);
                // Unrealized = Σ (live price − cost basis) × shares, over priced
                // holdings that carry a basis. null when none do → no line shown.
                const withBasis = priced.filter(({ h }) => h.costBasis != null && h.costBasis > 0);
                const unrealized = withBasis.length
                  ? withBasis.reduce((s, { h, price }) => s + h.shares * (price - (h.costBasis as number)), 0)
                  : null;
                return (
                  <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <span className="mono" style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-hi)" }}>${totalVal >= 1000 ? (totalVal / 1000).toFixed(1) + "K" : totalVal.toFixed(2)}</span>
                    <span className={`mono ${cls(dayPL)}`} style={{ fontWeight: 600 }}>{arr(dayPL)} {dayPL >= 0 ? "+" : ""}${Math.abs(dayPL).toFixed(2)}</span>
                  </div>
                  {priced.length < realHoldings.length && (
                    <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)", marginBottom: 6 }}>
                      {priced.length} of {realHoldings.length} priced
                    </div>
                  )}
                  {unrealized != null && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
                      <span>Unrealized{withBasis.length < realHoldings.length ? ` (${withBasis.length}/${realHoldings.length})` : ""}</span>
                      <span className={`mono ${cls(unrealized)}`} style={{ fontWeight: 600 }}>{unrealized >= 0 ? "+" : "−"}${Math.abs(unrealized).toFixed(2)}</span>
                    </div>
                  )}
                  </>
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
          <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div className="card-h">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Watchlist</h3><VendorTag v="polygon" /></div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {watchlists.length > 1 && (
                  <select
                    className="iq-select"
                    value={activeWatchlist?.id ?? ""}
                    onChange={e => setSelWatchId(e.target.value)}
                    style={{ fontSize: ".68rem", padding: "2px 6px", maxWidth: 110, minWidth: 0 }}
                    title="Switch watchlist"
                  >
                    {watchlists.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                )}
                <Link className="link" href="/menu/watchlist" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>View all →</Link>
              </div>
            </div>
            <div className="card-b" style={{ paddingTop: 8, flex: 1, minHeight: 0, maxHeight: 440, overflowY: "auto" }}>
              {watchMini.length === 0 ? (
                <DataState loading={watchlistLoading} label={activeWatchlist ? `“${activeWatchlist.name}” has no names yet.` : "No saved watchlist yet."} height={80} />
              ) : watchMini.map(w => (
                <div key={w.ticker} className="minirow" style={{ cursor: "pointer" }}
                  onClick={() => openStock(w.ticker)}
                  {...mr(w.ticker, "watchlist")}
                >
                  <StockLogo sym={w.ticker} size={26} />
                  <span className="tkr">{w.ticker}</span>
                  <span className="mid">{companyByTicker.get(w.ticker)?.name ?? "not synced"}</span>
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
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Insider &amp; Institutional</h3><VendorTag v="sec" /></div>
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
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Live Market Feed</h3><VendorTag v={["polygon", "fmp"]} /></div>
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
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Recaps</h3><VendorTag v="polygon" /></div>
              <Link className="link" href="/menu/recap">View all →</Link>
            </div>
            <div className="card-b">
              {latestRecap == null ? (
                <DataState loading={recapsLoading} label="No market recap synced yet." height={80} />
              ) : (() => {
                const r = latestRecap;
                const intr = r.internals;
                const wanted = ["Dow", "S&P 500", "Nasdaq"];
                const picked = (r.indices ?? []).filter(i => wanted.includes(i.label));
                const idx = (picked.length ? picked : (r.indices ?? []).slice(0, 3));
                const lead = (r.sectorLeaders ?? [])[0] ?? null;
                const lag = (r.sectorLaggards ?? [])[0] ?? null;
                const gain = (r.topGainers ?? [])[0] ?? null;
                const dateLabel = new Date(`${r.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>Market recap · {dateLabel}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {idx.map(i => (
                        <div key={i.label} className="minirow" style={{ padding: "2px 0" }}>
                          <span className="tkr" style={{ width: 130 }}>{i.label}</span>
                          <span className="mid" />
                          <span className={`r ${cls(i.pctChange ?? 0)}`}>{sign(i.pctChange ?? 0)}</span>
                        </div>
                      ))}
                    </div>
                    {intr && (
                      <div style={{ fontSize: ".74rem", color: "var(--text-dim-solid)", display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <span><b className="up">{intr.advancers ?? "—"}</b> adv</span>
                        <span><b className="down">{intr.decliners ?? "—"}</b> dec</span>
                        {intr.trin != null && <span>TRIN <b style={{ color: "var(--text-hi)" }}>{intr.trin.toFixed(2)}</b></span>}
                        {intr.breadthPct != null && <span>Breadth <b style={{ color: "var(--text-hi)" }}>{Math.round(intr.breadthPct * 100)}%</b></span>}
                      </div>
                    )}
                    {(lead || lag) && (
                      <div style={{ fontSize: ".74rem", display: "flex", gap: 14, flexWrap: "wrap" }}>
                        {lead && <span style={{ color: "var(--text-dim-solid)" }}>Leader <b className="up">{lead.sector} {sign(lead.pctChange)}</b></span>}
                        {lag && <span style={{ color: "var(--text-dim-solid)" }}>Laggard <b className="down">{lag.sector} {sign(lag.pctChange)}</b></span>}
                      </div>
                    )}
                    {gain && (
                      <div style={{ fontSize: ".74rem", color: "var(--text-dim-solid)" }}>
                        Top gainer <b style={{ color: "var(--text-hi)", cursor: "pointer" }} onClick={() => openStock(gain.ticker)}>{gain.ticker}</b> <span className="up">{sign(gain.pctChange ?? 0)}</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* ── 13. VIX · Volatility ── */}
        <div className="col-4">
          <div className="card vix" style={{ height: "100%" }}>
            <div className="card-h">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>VIX · Volatility</h3><VendorTag v="polygon" /></div>
              <Link className="link" href="/menu/macro">View all →</Link>
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
                </>;
              })()}
            </div>
          </div>
        </div>

        {/* ── 14. Fear & Greed ── */}
        <div className="col-4">
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Fear &amp; Greed</h3><VendorTag v="polygon" /></div>
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
            <VendorTag v="polygon" />
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
          <DashPopContent sym={pop.sym} block={pop.block} movers={movers} earnings={earnings} watchlist={watchMini} portfolio={folioMini} companies={companies} consensus={consensusLive} insiderMini={INSIDER_MINI} announcements={earningsAnnouncements} news={dashNews} onDemandNews={popNewsCache} />
        </div>
      )}
    </div>
  );
}

/** Live Market Feed — real synced news only; honest empty state when none are synced. */
function LiveFeedList() {
  const { data: news, loading } = useApiList<NewsArticleDoc>("/market-data/news");
  // Dedupe by article URL: Polygon tags one story to every ticker it mentions,
  // so the same article arrives once per ticker — show each story once.
  const seenUrl = new Set<string>();
  const recent = [...news]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .filter(n => { const k = n.url || n.id; if (seenUrl.has(k)) return false; seenUrl.add(k); return true; })
    .slice(0, 4);

  // No mock fallback: when there's no live news, show an honest empty state
  // rather than fabricated headlines that read as real market events.
  if (recent.length === 0) {
    return <DataState loading={loading} label="No market-moving news right now." />;
  }

  return <>
    {recent.map((f, i) => (
      <div key={f.id} style={{
        display: "flex", gap: 10, padding: "9px 0", alignItems: "flex-start",
        borderBottom: i < recent.length - 1 ? "1px solid var(--border-soft)" : undefined,
      }}>
        <StockLogo sym={f.ticker} size={28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: ".8rem", color: "var(--text)", lineHeight: 1.4 }}>
            <b style={{ color: "var(--text-hi)" }}>{f.ticker}</b> · {f.headline}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, fontSize: ".66rem", color: "var(--text-dim-solid)", flexWrap: "wrap" }}>
            <span className="pill" style={{ background: "var(--surface-3)", color: "var(--brand-2)" }}>{f.category}</span>
            <span className="mono">{new Date(f.publishedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            <span>· {f.source}</span>
          </div>
        </div>
      </div>
    ))}
  </>;
}
