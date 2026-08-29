"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { type Mover, maPostureLabel, isLeveragedProduct } from "../data";
import { fmt, sign, arr, Spark, StockLogo, DataState, VendorTag, titleCaseLabel} from "../utils";
import { apiGet } from "../backend";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import { useLiveQuotes } from "../live-quotes-context";
import { useWatchlistsContext } from "../hooks/useWatchlists";
import type { LiveMoverDoc, CompanyDoc, NewsArticleDoc, AnalystConsensusDoc, AnalystRatingChange } from "../types";
import { sectorFilterOptions, matchesSector } from "../sector-filter";

const StockScreenEmbed = dynamic<{ initialSym?: string }>(
  () => import("./stock").then(m => ({ default: m.StockScreen })),
  { ssr: false, loading: () => <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim-solid)" }}>Loading…</div> }
);

const TABS = [
  ["win",      "Top Gainers"],
  ["lose",     "Top Losers"],
  ["vol",      "Unusual Volume"],
  ["weekwin",  "Weekly Gainers"],
  ["weeklose", "Weekly Losers"],
] as const;
type TabKey = "win" | "lose" | "vol" | "weekwin" | "weeklose";
/** True for the two 5-day tabs, which rank on weekPct rather than today's move. */
const isWeekTab = (t: TabKey) => t === "weekwin" || t === "weeklose";

/**
 * Cap tier from a raw USD market cap — same thresholds the Live Feed uses.
 * Needed because the weekly tabs are built from `companies` (which carry
 * marketCap) rather than the movers feed (which carries a pre-bucketed `cap`).
 */
function capFromMarketCap(mc: number | null | undefined): string {
  if (mc == null) return "Mid";
  if (mc >= 200e9) return "Mega";
  if (mc >= 10e9) return "Large";
  if (mc >= 2e9) return "Mid";
  if (mc >= 300e6) return "Small";
  return "Micro";
}
/** Compact USD market cap for the table cell — "$1.24T" / "$12.5B" / "$340M".
 *  null/≤0 → "—" so an un-synced or out-of-universe ticker reads as unknown. */
function fmtMcap(mc: number | null | undefined): string {
  if (mc == null || mc <= 0) return "—";
  if (mc >= 1e12) return `$${(mc / 1e12).toFixed(2)}T`;
  if (mc >= 1e9)  return `$${(mc / 1e9).toFixed(1)}B`;
  if (mc >= 1e6)  return `$${(mc / 1e6).toFixed(0)}M`;
  return `$${Math.round(mc).toLocaleString()}`;
}
// Largest → smallest. The dropdown only offers tiers that actually have movers
// right now — the day's top movers are almost never mega-caps, so "Mega" would
// otherwise sit there returning nothing; "Micro" (which the feed does produce)
// was missing entirely before.
const CAP_ORDER = ["Mega", "Large", "Mid", "Small", "Micro"];

/** Sortable columns. `cap` orders by the tier's rank (Mega→Micro), not the
 *  label's alphabet, so the sort reads as a real size ordering. */
type MoverSortKey = "company" | "price" | "change" | "rvol" | "mcap" | "cap";
/** Direction a column starts in on first click — text ascends (A→Z), numbers
 *  descend (biggest first), which is what you almost always want. */
const SORT_FIRST_DIR: Record<MoverSortKey, "asc" | "desc"> = {
  company: "asc", price: "desc", change: "desc", rvol: "desc", mcap: "desc", cap: "asc",
};

/**
 * Live-only: a row exists here only if a real `market_movers` doc exists for
 * it. RVOL comes from `companies.rvol` (technical-indicators.job) when
 * synced. MA posture is derived from `companies.aboveSma50/aboveSma200`
 * (technical-indicators.job), "—" until synced. (Catalyst was removed — Polygon
 * has no catalyst feed, so it only ever showed "—".)
 */

function mergeMovers(
  live: LiveMoverDoc[],
  companyByTicker: Map<string, CompanyDoc>,
): Mover[] {
  return live.filter(l => !isLeveragedProduct(l.name)).map(l => {
    const c = companyByTicker.get(l.ticker);
    return {
      ticker: l.ticker,
      name: l.name ?? l.ticker,
      price: l.price,
      pctChange: l.pctChange,
      rvolRatio: c?.rvol ?? 0,
      relativeStrength: 0,
      maPosture: maPostureLabel(c?.aboveSma50, c?.aboveSma200),
      owned: false,
      sector: l.sector ?? "—",
      cap: (l.cap as Mover["cap"]) ?? "Mid",
      // Prefer the mover doc's own market cap (covers micro-caps outside the
      // tracked universe); fall back to the companies doc for tracked names.
      marketCap: l.marketCap ?? c?.marketCap ?? null,
      // Real 5-session change from technical-indicators.job; null → "—".
      weekPct: c?.week5ChangePct ?? null,
      techContext: `Live EOD data as of ${l.asOfDate}.`,
      newsContext: "",
    };
  });
}

export function MoversScreen() {
  const { data: liveMovers, loading: moversLoading } = useApiList<LiveMoverDoc>("/market-data/movers");
  const { data: rvolCompanies } = useApiList<CompanyDoc>("/market-data/companies");
  const companyByTicker = new Map(rvolCompanies.map(c => [c.ticker, c]));
  const movers = mergeMovers(liveMovers, companyByTicker);

  /**
   * 5-day rows, built from the COMPANIES universe rather than the daily movers
   * feed. That feed is the day's top-100 gainers/losers — overwhelmingly
   * micro-caps outside the tracked universe — so only ~46 of its 200 rows carry
   * `week5ChangePct` at all, which would make a weekly board look broken.
   * `companies` has the field for ~565 names, so the weekly ranking is drawn
   * from there and covers the whole tracked market.
   */
  const weeklyRows: Mover[] = rvolCompanies
    .filter(c => c.ticker && typeof c.week5ChangePct === "number")
    .map(c => ({
      ticker: c.ticker,
      name: c.name ?? c.ticker,
      price: c.price ?? 0,
      // pctChange stays TODAY's move (the Price column and live overlay still
      // want it); the weekly number lives in weekPct and is what these tabs
      // rank and display.
      pctChange: c.pctChange ?? 0,
      rvolRatio: c.rvol ?? 0,
      relativeStrength: 0,
      maPosture: maPostureLabel(c.aboveSma50, c.aboveSma200),
      owned: false,
      sector: c.sector ?? "—",
      cap: capFromMarketCap(c.marketCap) as Mover["cap"],
      marketCap: c.marketCap ?? null,
      weekPct: c.week5ChangePct as number,
      techContext: "",
      newsContext: "",
    }));


  // Per-ticker news → the "why it moved" headline shown on row hover. Keep the
  // most recent article per ticker.
  const { data: moverNews } = useApiList<NewsArticleDoc>("/market-data/news");
  const newsByTicker = (() => {
    const m = new Map<string, NewsArticleDoc>();
    for (const n of [...moverNews].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))) {
      if (n.ticker && !m.has(n.ticker)) m.set(n.ticker, n);
    }
    return m;
  })();
  const [newsHover, setNewsHover] = useState<{ sym: string; x: number; y: number } | null>(null);

  // Fallback "why it moved" when there's no article: a RECENT analyst rating
  // change (upgrade/downgrade). Only the last few days count — an old grade
  // isn't why the stock moved today.
  const { data: moverAnalyst } = useApiList<AnalystConsensusDoc>("/market-data/analyst-actions");
  const recentGradeByTicker = (() => {
    const cutoff = new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10);
    const m = new Map<string, AnalystRatingChange>();
    for (const c of moverAnalyst) {
      const latest = [...(c.recentGrades ?? [])].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
      if (latest?.date && latest.date.slice(0, 10) >= cutoff && c.ticker) m.set(c.ticker, latest);
    }
    return m;
  })();
  // The bulk `news` collection only covers a handful of large caps, so for an
  // arbitrary mover we fetch its news on demand (/live/news works for ANY
  // ticker) and cache the latest article: NewsArticleDoc, or null when none.
  const [newsCache, setNewsCache] = useState<Record<string, NewsArticleDoc | null>>({});
  useEffect(() => {
    const sym = newsHover?.sym;
    if (!sym || newsByTicker.has(sym) || sym in newsCache) return;
    // Debounce so sweeping the cursor across rows doesn't fire a burst of calls.
    const id = setTimeout(() => {
      apiGet<NewsArticleDoc[]>(`/live/news?ticker=${encodeURIComponent(sym)}`)
        .then(articles => {
          const latest = [...(articles ?? [])].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))[0] ?? null;
          setNewsCache(c => ({ ...c, [sym]: latest }));
        })
        .catch(() => setNewsCache(c => ({ ...c, [sym]: null })));
    }, 200);
    return () => clearTimeout(id);
    // Only refetch when the hovered ticker changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newsHover?.sym]);

  const [tab,          setTab]          = useState<TabKey>("win");
  /** The row set the active tab draws from — declared AFTER `tab` so it can
   *  read it (a `const` referenced above its declaration is a TDZ crash). */
  const [sector,       setSector]       = useState("All");
  const [cap,          setCap]          = useState("All");
  const [query,        setQuery]        = useState("");
  // Column sort. null = the tab's own ranking (gainers by %chg desc, losers by
  // %chg asc, unusual-volume by RVOL desc). Clicking a header overrides it.
  const [sortKey,      setSortKey]      = useState<MoverSortKey | null>(null);
  const [sortDir,      setSortDir]      = useState<"asc" | "desc">("desc");
  const [selectedSym,  setSelectedSym]  = useState<string | null>(null);
  const sourceRows = isWeekTab(tab) ? weeklyRows : movers;
  const liveCount = sourceRows.length;
  const q = query.trim().toUpperCase();

  // Watchlist: the drawer header's "Add to watchlist" button. A ticker is
  // "watched" if it's in ANY of the user's lists; adding drops it into the first
  // list (creating a default one if the user has none). A small toast confirms
  // the action WITHOUT closing the drawer.
  const { watchlists, addTicker, createList } = useWatchlistsContext();
  const watchedSet = useMemo(() => new Set(watchlists.flatMap(w => w.tickers)), [watchlists]);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  const addToWatchlist = useCallback(async (sym: string) => {
    const s = sym.toUpperCase();
    if (watchedSet.has(s)) { setToast(`${s} is already in your watchlist`); return; }
    let listId: string | undefined = watchlists[0]?.id;
    if (!listId) listId = (await createList("My Watchlist"))?.id;
    if (!listId) { setToast("Couldn't add — please sign in first"); return; }
    await addTicker(listId, s);
    setToast(`${s} added to watchlist`);
  }, [watchedSet, watchlists, addTicker, createList]);

  const sectors = sectorFilterOptions(rvolCompanies);

  // Only the cap tiers present in the current feed are selectable; if the chosen
  // tier is no longer present (data refreshed), behave as "All".
  const availableCaps = ["All", ...CAP_ORDER.filter(c => sourceRows.some(m => m.cap === c))];
  const effCap = availableCaps.includes(cap) ? cap : "All";

  // Rows matching the current tab + cap, before the sector filter is applied.
  const tabCapRows = sourceRows.filter(m => {
    if (effCap !== "All" && m.cap !== effCap) return false;
    if (tab === "win")  return m.pctChange > 0;
    if (tab === "lose") return m.pctChange < 0;
    // Weekly tabs split on the 5-day move. `weekPct` is guaranteed non-null on
    // weeklyRows (they're filtered on it), but the guard keeps this honest if
    // the source ever changes.
    if (tab === "weekwin")  return (m.weekPct ?? 0) > 0;
    if (tab === "weeklose") return (m.weekPct ?? 0) < 0;
    return true;
  });

  const filtered = tabCapRows
    .filter(m => matchesSector(sector, m.ticker, m.sector))
    .filter(m => {
      if (!q) return true;
      // Free-text search across EVERY displayed field — ticker, company name,
      // sector, cap tier and MA posture, plus the numeric columns as text
      // (price, %change, RVOL, 5-day %) — so a user can filter by any of them
      // (e.g. "financial", "large", "169", "+5"). Fields are joined with a
      // separator so a query can't span two adjacent fields.
      const hay = [
        m.ticker,
        m.name,
        m.sector,
        m.cap,
        m.maPosture,
        m.price != null ? String(m.price) : "",
        String(m.pctChange),
        m.rvolRatio ? String(m.rvolRatio) : "",
        m.marketCap != null ? fmtMcap(m.marketCap) : "",
        m.weekPct != null ? String(m.weekPct) : "",
      ].join(" | ").toUpperCase();
      return hay.includes(q);
    })
    .sort((a, b) => {
      // Explicit column sort wins over the tab's default ranking.
      if (sortKey) {
        const dir = sortDir === "asc" ? 1 : -1;
        switch (sortKey) {
          case "company":
            return a.ticker.localeCompare(b.ticker) * dir;
          case "price":
            return ((a.price ?? 0) - (b.price ?? 0)) * dir;
          case "change":
            // The Change column renders the weekly move on the weekly tabs, so
            // clicking its header must sort on the number actually displayed.
            return isWeekTab(tab)
              ? ((a.weekPct ?? 0) - (b.weekPct ?? 0)) * dir
              : (a.pctChange - b.pctChange) * dir;
          case "rvol":
            return ((a.rvolRatio ?? 0) - (b.rvolRatio ?? 0)) * dir;
          case "mcap": {
            // Unknown caps (null) always sort LAST, in either direction — like
            // the `cap` column — so the "—" rows never lead an ascending sort.
            if (a.marketCap == null && b.marketCap == null) return 0;
            if (a.marketCap == null) return 1;
            if (b.marketCap == null) return -1;
            return (a.marketCap - b.marketCap) * dir;
          }
          case "cap": {
            // Unknown tiers sort last in either direction rather than jumping
            // to the top as index -1.
            const rank = (c: string | null) => {
              const i = CAP_ORDER.indexOf(c ?? "");
              return i === -1 ? CAP_ORDER.length : i;
            };
            const d = rank(a.cap) - rank(b.cap);
            return (d !== 0 ? d : (a.sector ?? "").localeCompare(b.sector ?? "")) * dir;
          }
        }
      }
      if (tab === "win")  return b.pctChange    - a.pctChange;
      if (tab === "lose") return a.pctChange    - b.pctChange;
      if (tab === "weekwin")  return (b.weekPct ?? 0) - (a.weekPct ?? 0);
      if (tab === "weeklose") return (a.weekPct ?? 0) - (b.weekPct ?? 0);
      return b.rvolRatio - a.rvolRatio; // "vol"
    });

  // Live price/%-overlay so the table matches the stock drawer (same
  // universal-snapshot quote). Fetched for ALL shown rows — the list is small
  // (top gainers/losers/unusual-volume) and useLiveQuotes is a shared union poll
  // that chunks at 250, so no pagination cap is needed. Ranking stays EOD-based
  // (sort above); only the shown price/change go live. Polls every 30s.
  const shownTickers = filtered.map(m => m.ticker);
  // Shared app-wide poll: one timer + one request for every live surface, so a
  // ticker here always matches the same ticker on the heatmap/drawer exactly.
  const quoteByTicker = useLiveQuotes(shownTickers);

  /** Click a column: first click applies that column's natural direction, further
   *  clicks toggle, and a third state returns to the tab's own ranking. */
  const toggleSort = (k: MoverSortKey) => {
    if (sortKey !== k) { setSortKey(k); setSortDir(SORT_FIRST_DIR[k]); return; }
    if (sortDir === SORT_FIRST_DIR[k]) { setSortDir(sortDir === "asc" ? "desc" : "asc"); return; }
    setSortKey(null); // back to the default ranking
  };
  /** Sortable header cell. A plain render helper (not a nested component) so
   *  React doesn't remount the header on every parent render. */
  const sortTh = (k: MoverSortKey, label: string, num = false) => (
    <th
      key={k}
      className={num ? "num" : undefined}
      onClick={() => toggleSort(k)}
      title={`Sort by ${label}`}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
    >
      {label}
      {/* Matches the sortable header in insider.tsx: always a FILLED glyph in
          brand violet, dimmed when inactive. The hollow "▽" this used to show
          when unsorted was near-invisible — an outline glyph, in grey, at 0.35
          opacity — and being a different character from ▲/▼ it also nudged the
          header width on every toggle. `.82em` tracks the th's own font-size
          rather than fixing a larger absolute size. */}
      <span
        style={{
          color: "var(--brand-2)",
          fontSize: ".82em",
          marginLeft: 4,
          opacity: sortKey === k ? 1 : 0.45,
        }}
      >
        {sortKey === k && sortDir === "asc" ? "▲" : "▼"}
      </span>
    </th>
  );

  return (
    <>
      <div className="page-head">
        <div className="tabs">
          {TABS.map(([k, l]) => (
            <button key={k} className={`tab${k === tab ? " on" : ""}`} onClick={() => setTab(k as TabKey)}>{l}</button>
          ))}
        </div>
        {liveCount > 0 && (
          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
            {liveCount} names · top 100 gainers + 100 losers · ranked by session move · live prices
          </span>
        )}
      </div>

      {/* Filter bar */}
      <div className="fbar">
        <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", alignSelf: "center" }}>Sector</span>
        <select className="mv-sel" value={sector} onChange={e => setSector(e.target.value)}>
          {sectors.map(s => <option key={s} value={s}>{titleCaseLabel(s)}</option>)}
        </select>
        <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", alignSelf: "center", marginLeft: 10 }}>Market cap</span>
        <select className="mv-sel" value={effCap} onChange={e => setCap(e.target.value)}>
          {availableCaps.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          value={query}
          onChange={e => setQuery(e.target.value.toUpperCase())}
          placeholder="Search…"
          style={{ marginLeft: 10, width: 230, boxSizing: "border-box", background: "var(--surface-3)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: "5px 9px", fontSize: ".74rem", color: "var(--text-hi)", outline: "none", fontFamily: "var(--f-mono)", textAlign: "left" }}
        />
        <div className="spacer" />
        <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{filtered.length} stocks</span>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", padding: "8px 12px 0" }}><VendorTag v="polygon" /></div>
        <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              {sortTh("company", "Company")}
              {sortTh("price",   "Price",  true)}
              {sortTh("change",  isWeekTab(tab) ? "5-day" : "Change", true)}
              {sortTh("rvol",    "RVOL",   true)}
              {sortTh("mcap",    "Mkt Cap", true)}
              {sortTh("cap",     "Cap · Sector")}
              <th className="num">Intraday</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 0 }}>
                  {moversLoading && movers.length === 0
                    ? <DataState loading label="Loading movers…" />
                    : <div style={{ padding: 16, color: "var(--text-dim-solid)" }}>No stocks match these filters.</div>}
                </td>
              </tr>
            ) : filtered.map(m => {
              const lq = quoteByTicker.get(m.ticker);
              const price = lq?.price ?? m.price;
              // On the weekly tabs the Change column shows the 5-DAY move, so the
              // live quote (which is today's %) must NOT overwrite it — otherwise
              // a "Weekly Gainers" row could render today's negative number.
              const v = isWeekTab(tab)
                ? m.weekPct
                : (lq?.pctChange ?? m.pctChange);
              return (
                <tr
                  key={m.ticker}
                  className={m.owned ? "owned" : ""}
                  onClick={() => setSelectedSym(m.ticker)}
                  onMouseEnter={e => setNewsHover({ sym: m.ticker, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setNewsHover(h => (h?.sym === m.ticker ? null : h))}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <StockLogo sym={m.ticker} size={26} />
                      <div className="co">
                        <span className="s">
                          {m.owned && <span className="own-dot" />}
                          {m.ticker}
                        </span>
                        <span className="n">{m.name}</span>
                      </div>
                    </div>
                  </td>
                  <td className="num">${fmt(price)}</td>
                  <td className="num" style={{ color: v == null ? undefined : v >= 0 ? "var(--up)" : "var(--down)", fontWeight: 600 }}>{v == null ? "—" : <>{arr(v)} {sign(v)}</>}</td>
                  <td className="num">
                    {m.rvolRatio > 0
                      ? <b style={{ color: m.rvolRatio > 3 ? "var(--warn)" : "var(--text)" }}>{m.rvolRatio.toFixed(1)}×</b>
                      : <span style={{ color: "var(--text-dim-solid)" }}>—</span>}
                  </td>
                  <td className="num">
                    {m.marketCap != null
                      ? <span style={{ color: "var(--text-hi)" }}>{fmtMcap(m.marketCap)}</span>
                      : <span style={{ color: "var(--text-dim-solid)" }}>—</span>}
                  </td>
                  <td>
                    <span style={{ fontSize: ".74rem" }}>
                      <b style={{ color: "var(--text-hi)" }}>{m.cap}</b>
                      {" · "}
                      <span style={{ color: "var(--text-dim-solid)" }}>{m.sector}</span>
                    </span>
                  </td>
                  <td className="num">
                    <Spark seed={m.ticker.charCodeAt(0)} up={(v ?? 0) >= 0} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* Why-it-moved hover: latest headline for the row under the cursor. Bulk
          news first (instant), else the on-demand fetch result, else loading. */}
      {newsHover && (() => {
        const bulk = newsByTicker.get(newsHover.sym);
        const resolved = bulk != null || newsHover.sym in newsCache;
        const n = bulk ?? newsCache[newsHover.sym] ?? null;
        const left = typeof window !== "undefined" ? Math.min(newsHover.x + 16, window.innerWidth - 336) : newsHover.x + 16;
        return (
          <div style={{
            position: "fixed", left, top: newsHover.y + 16, zIndex: 60, width: 320,
            background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 10,
            padding: "10px 12px", boxShadow: "0 10px 34px rgba(0,0,0,.45)", pointerEvents: "none",
          }}>
            <div style={{ fontSize: ".66rem", textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-dim-solid)", marginBottom: 5 }}>
              {newsHover.sym} · why it moved
            </div>
            {n ? (
              <>
                <div style={{ fontSize: ".82rem", color: "var(--text-hi)", lineHeight: 1.4 }}>{n.headline}</div>
                <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 5 }}>
                  {n.source}{n.publishedAt ? ` · ${new Date(n.publishedAt).toLocaleDateString()}` : ""}
                </div>
              </>
            ) : !resolved ? (
              <div style={{ fontSize: ".82rem", color: "var(--text-dim-solid)" }}>Loading news…</div>
            ) : (() => {
              // No article → fall back to a recent analyst rating change, else honest empty.
              const g = recentGradeByTicker.get(newsHover.sym);
              return g ? (
                <>
                  <div style={{ fontSize: ".82rem", color: "var(--text-hi)", lineHeight: 1.4 }}>
                    {g.firm ?? "Analyst"}: {g.previousGrade ?? "—"} → <b>{g.newGrade ?? "—"}</b>
                    {g.action ? <span style={{ color: /down/i.test(g.action) ? "var(--down)" : /up/i.test(g.action) ? "var(--up)" : "var(--text-dim-solid)", textTransform: "capitalize" }}> · {g.action}</span> : null}
                  </div>
                  <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 5 }}>Analyst rating change{g.date ? ` · ${new Date(g.date).toLocaleDateString()}` : ""}</div>
                </>
              ) : (() => {
                // No news and no analyst change → surface the volume signal so the
                // hover is still informative (these are usually momentum/low-float
                // moves with no catalyst). Fall back to plain empty when RVOL is
                // unavailable/normal.
                const rvol = movers.find(x => x.ticker === newsHover.sym)?.rvolRatio ?? 0;
                return rvol > 1.5 ? (
                  <>
                    <div style={{ fontSize: ".82rem", color: "var(--text-hi)", lineHeight: 1.4 }}>No news catalyst found.</div>
                    <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 5 }}>
                      <b style={{ color: rvol > 3 ? "var(--warn)" : "var(--text)" }}>{rvol.toFixed(1)}×</b> relative volume — likely a momentum / low-float move.
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: ".82rem", color: "var(--text-dim-solid)" }}>News not available.</div>
                );
              })();
            })()}
          </div>
        );
      })()}

      {/* Sliding stock detail drawer */}
      {selectedSym && (
        <>
          <div className="scrim" onClick={() => setSelectedSym(null)} />
          <div className="stock-side-drawer">
            <div className="drawer-h" style={{ paddingTop: 14, paddingBottom: 14 }}>
              <StockLogo sym={selectedSym} size={32} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)" }}>
                  {selectedSym} · Stock Details
                </div>
                <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
                  Full analysis · chart · technicals · peers
                </div>
              </div>
              {(() => {
                const sym = selectedSym!;
                const inList = watchedSet.has(sym);
                return (
                  <button
                    onClick={() => addToWatchlist(sym)}
                    title={inList ? "Already in your watchlist" : "Add this stock to your watchlist"}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                      background: inList ? "var(--brand-dim)" : "var(--surface-2)",
                      border: `1px solid ${inList ? "var(--brand)" : "var(--border-soft)"}`,
                      color: inList ? "var(--brand)" : "var(--text-hi)",
                      borderRadius: 8, padding: "7px 13px", cursor: "pointer",
                      fontSize: ".8rem", fontWeight: 600, fontFamily: "var(--f-body)",
                    }}
                  >
                    <span style={{ fontSize: ".95rem", lineHeight: 1 }}>{inList ? "★" : "☆"}</span>
                    {inList ? "In watchlist" : "Add to watchlist"}
                  </button>
                );
              })()}
              <button className="closebtn" onClick={() => setSelectedSym(null)}>✕</button>
            </div>
            <div className="drawer-b">
              <StockScreenEmbed initialSym={selectedSym} />
            </div>
          </div>
        </>
      )}

      {/* Watchlist confirmation toast — floats above the drawer (z-index 999 vs
          the drawer's 51), auto-dismisses after 2.6s; the drawer stays open. */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed", top: 22, left: "50%", transform: "translateX(-50%)",
            zIndex: 999, background: "var(--surface-1)", border: "1px solid var(--brand)",
            color: "var(--text-hi)", borderRadius: 10, padding: "11px 20px",
            fontSize: ".85rem", fontWeight: 600, whiteSpace: "nowrap",
            boxShadow: "0 14px 40px -10px rgba(0,0,0,.6)",
            display: "inline-flex", alignItems: "center", gap: 9,
          }}
        >
          <span style={{ color: "var(--brand)", fontSize: "1rem" }}>★</span>
          {toast}
        </div>
      )}
    </>
  );
}
