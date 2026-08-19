"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { type Mover, maPostureLabel } from "../data";
import { fmt, sign, arr, Spark, StockLogo, DataState, VendorTag } from "../utils";
import { apiGet } from "../backend";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import { useWatchlistsContext } from "../hooks/useWatchlists";
import type { LiveMoverDoc, CompanyDoc, NewsArticleDoc, AnalystConsensusDoc, AnalystRatingChange } from "../types";
import { sectorFilterOptions, matchesSector } from "../sector-filter";

const StockScreenEmbed = dynamic<{ initialSym?: string }>(
  () => import("./stock").then(m => ({ default: m.StockScreen })),
  { ssr: false, loading: () => <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim-solid)" }}>Loading…</div> }
);

const TABS = [
  ["win",  "Top Gainers"],
  ["lose", "Top Losers"],
  ["vol",  "Unusual Volume"],
] as const;
type TabKey = "win" | "lose" | "vol" | "week";
// Largest → smallest. The dropdown only offers tiers that actually have movers
// right now — the day's top movers are almost never mega-caps, so "Mega" would
// otherwise sit there returning nothing; "Micro" (which the feed does produce)
// was missing entirely before.
const CAP_ORDER = ["Mega", "Large", "Mid", "Small", "Micro"];

/**
 * Live-only: a row exists here only if a real `market_movers` doc exists for
 * it. RVOL comes from `companies.rvol` (technical-indicators.job) when
 * synced. MA posture is derived from `companies.aboveSma50/aboveSma200`
 * (technical-indicators.job), "—" until synced. (Catalyst was removed — Polygon
 * has no catalyst feed, so it only ever showed "—".)
 */
// Leveraged / inverse ETF products (e.g. "T-REX 2X Long AXTI Daily ETF",
// "ProShares UltraPro …") routinely top the raw grouped-daily gainers but aren't
// stock movers. A normal operating company never carries both a multiplier
// ("2X"/"3X") and an ETF/ETN/Shares suffix, nor "leveraged/inverse/ultrapro/
// ultrashort", so the false-positive risk is negligible.
function isLeveragedProduct(name: string | null | undefined): boolean {
  const n = name ?? "";
  if (/\b(leveraged?|inverse|ultrapro|ultrashort)\b/i.test(n)) return true;
  if (/\b[1-9](?:\.\d)?x\b/i.test(n) && /\b(etf|etn|shares)\b/i.test(n)) return true;
  return false;
}

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
  const liveCount = movers.length;

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
  const [sector,       setSector]       = useState("All");
  const [cap,          setCap]          = useState("All");
  const [query,        setQuery]        = useState("");
  const [page,         setPage]         = useState(0);
  const [selectedSym,  setSelectedSym]  = useState<string | null>(null);
  const PAGE_SIZE = 25;
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
  const availableCaps = ["All", ...CAP_ORDER.filter(c => movers.some(m => m.cap === c))];
  const effCap = availableCaps.includes(cap) ? cap : "All";

  // Rows matching the current tab + cap, before the sector filter is applied.
  const tabCapRows = movers.filter(m => {
    if (effCap !== "All" && m.cap !== effCap) return false;
    if (tab === "win")  return m.pctChange > 0;
    if (tab === "lose") return m.pctChange < 0;
    return true;
  });

  const filtered = tabCapRows
    .filter(m => matchesSector(sector, m.ticker, m.sector))
    .filter(m => !q || m.ticker.toUpperCase().includes(q) || (m.name ?? "").toUpperCase().includes(q))
    .sort((a, b) => {
      if (tab === "win")  return b.pctChange    - a.pctChange;
      if (tab === "lose") return a.pctChange    - b.pctChange;
      if (tab === "vol")  return b.rvolRatio - a.rvolRatio;
      return Math.abs(b.weekPct ?? 0) - Math.abs(a.weekPct ?? 0);
    });

  // Paginate the full ranked list (up to 100 gainers / 100 losers per tab).
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE);

  // Live price/%-overlay so the table matches the stock drawer (same
  // universal-snapshot quote). Fetched for the CURRENT PAGE only — PAGE_SIZE is
  // 25, exactly /live/quotes' cap, so it's one call. Ranking stays EOD-based
  // (sort above); only the shown price/change go live. Polls every 30s and
  // refetches when the visible page changes (tab/sector/cap/search/page).
  const shownTickers = pageRows.map(m => m.ticker);
  const qpath = shownTickers.length ? `/live/quotes?tickers=${encodeURIComponent(shownTickers.join(","))}` : null;
  type QuoteRow = { ticker: string; price: number | null; pctChange: number | null };
  const { data: liveQuotes } = useApiResource<QuoteRow[]>(qpath, 30000);
  const quoteByTicker = new Map((liveQuotes ?? []).map(qr => [qr.ticker, qr]));

  return (
    <>
      <div className="page-head">
        <div className="tabs">
          {TABS.map(([k, l]) => (
            <button key={k} className={`tab${k === tab ? " on" : ""}`} onClick={() => { setTab(k as TabKey); setPage(0); }}>{l}</button>
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
        <select className="mv-sel" style={{ textTransform: "lowercase" }} value={sector} onChange={e => { setSector(e.target.value); setPage(0); }}>
          {sectors.map(s => <option key={s} value={s} style={{ textTransform: "lowercase" }}>{s.toLowerCase()}</option>)}
        </select>
        <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", alignSelf: "center", marginLeft: 10 }}>Market cap</span>
        <select className="mv-sel" style={{ textTransform: "lowercase" }} value={effCap} onChange={e => { setCap(e.target.value); setPage(0); }}>
          {availableCaps.map(c => <option key={c} value={c}>{c.toLowerCase()}</option>)}
        </select>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value.toUpperCase()); setPage(0); }}
          placeholder="Search ticker…"
          style={{ marginLeft: 10, width: 230, boxSizing: "border-box", background: "var(--surface-3)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: "5px 9px", fontSize: ".74rem", color: "var(--text-hi)", outline: "none", fontFamily: "var(--f-mono)", textAlign: "left" }}
        />
        <div className="spacer" />
        <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{filtered.length} stocks</span>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", padding: "8px 12px 0" }}><VendorTag v="polygon" /></div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Company</th>
              <th className="num">Price</th>
              <th className="num">Change</th>
              <th className="num">RVOL</th>
              <th>Cap · Sector</th>
              <th className="num">Intraday</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 0 }}>
                  {moversLoading && movers.length === 0
                    ? <DataState loading label="Loading movers…" />
                    : <div style={{ padding: 16, color: "var(--text-dim-solid)" }}>No stocks match these filters.</div>}
                </td>
              </tr>
            ) : pageRows.map(m => {
              const lq = quoteByTicker.get(m.ticker);
              const price = lq?.price ?? m.price;
              // Live %-change on the price tabs; the Week tab has no live weekly.
              const v = tab === "week" ? m.weekPct : (lq?.pctChange ?? m.pctChange);
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

      {filtered.length > PAGE_SIZE && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "12px 0" }}>
          <button className="chip" disabled={curPage <= 0} onClick={() => setPage(p => Math.max(0, p - 1))} style={{ opacity: curPage <= 0 ? 0.4 : 1, cursor: curPage <= 0 ? "default" : "pointer" }}>← Prev</button>
          <span style={{ fontSize: ".74rem", color: "var(--text-dim-solid)" }}>
            Page {curPage + 1} of {totalPages} · {curPage * PAGE_SIZE + 1}–{Math.min(filtered.length, (curPage + 1) * PAGE_SIZE)} of {filtered.length}
          </span>
          <button className="chip" disabled={curPage >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} style={{ opacity: curPage >= totalPages - 1 ? 0.4 : 1, cursor: curPage >= totalPages - 1 ? "default" : "pointer" }}>Next →</button>
        </div>
      )}

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
              ) : (
                <div style={{ fontSize: ".82rem", color: "var(--text-dim-solid)" }}>News not available.</div>
              );
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
