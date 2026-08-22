"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StockLogo, DataState, VendorTag, cls, sign } from "../utils";
import { useLiveQuotes } from "../live-quotes-context";
import { useApiList } from "../hooks/useApiList";
import { firebaseAuth } from "../../firebase";
import { apiGet } from "../backend";
import type { NewsArticleDoc, CompanyDoc, WatchlistDoc, HoldingDoc, FilingsWireDoc, MacroRegimeDoc } from "../types";
import { sectorFilterOptions, matchesSector } from "../sector-filter";

const TABS = ["Live", "Premarket", "After Hours", "My names", "Macro"];

// Market-cap tiers derived from companies.marketCap (raw USD). Used to filter
// the feed by the size of the company each news item is about.
const CAP_TIERS = ["All", "Mega", "Large", "Mid", "Small", "Micro"];
/** Compact market cap for the feed's left column — $1.2T / $340B / $8.4B / $720M. */
function fmtMcap(mc: number): string {
  if (mc >= 1e12) return `$${(mc / 1e12).toFixed(1)}T`;
  if (mc >= 1e9) return `$${(mc / 1e9).toFixed(mc >= 10e9 ? 0 : 1)}B`;
  if (mc >= 1e6) return `$${(mc / 1e6).toFixed(0)}M`;
  return `$${Math.round(mc).toLocaleString()}`;
}

function capTier(mc: number | null | undefined): string | null {
  if (mc == null) return null;
  if (mc >= 200e9) return "Mega";
  if (mc >= 10e9) return "Large";
  if (mc >= 2e9) return "Mid";
  if (mc >= 300e6) return "Small";
  return "Micro";
}

function catCol(c: string | null): string {
  if (c === "earnings") return "var(--warn)";
  if (c === "merger") return "var(--ai)";
  if (c === "company") return "var(--brand-2)";
  return "var(--text-dim-solid)";
}
function catLabel(c: string | null): string {
  if (c === "earnings") return "Earnings";
  if (c === "merger") return "M&A";
  if (c === "company") return "Company";
  return "Macro";
}

function etHour(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(new Date(iso));
  const h = Number(parts.find(p => p.type === "hour")?.value ?? 12);
  const m = Number(parts.find(p => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}
function etTimeLabel(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(new Date(iso));
  const hour = parts.find(p => p.type === "hour")?.value ?? "12";
  const minute = parts.find(p => p.type === "minute")?.value ?? "00";
  const dayPeriod = (parts.find(p => p.type === "dayPeriod")?.value ?? "AM").toLowerCase()[0];
  return `${hour}:${minute}${dayPeriod}`;
}

/* ── Feed item ── the logo filters the feed by that ticker; the body opens the source article. */
function FeedItem({ item, i, total, onTicker, marketCap, livePct }: {
  item: NewsArticleDoc; i: number; total: number; onTicker: (ticker: string) => void;
  /** Raw USD market cap from the ticker's companies doc; null when unsynced. */
  marketCap?: number | null;
  /** Live %change for the ticker, from the app-wide shared quote poll. */
  livePct?: number | null;
}) {
  return (
    <div
      style={{
        display: "flex", gap: 12, padding: "12px 0",
        borderBottom: i < total - 1 ? "1px solid var(--border-soft)" : "none",
      }}
    >
      <div style={{ flexShrink: 0, width: 90, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5 }}>
        <button
          onClick={() => onTicker(item.ticker)}
          title={`Filter the feed by ${item.ticker}`}
          style={{ all: "unset", cursor: "pointer", borderRadius: 6 }}
        >
          <StockLogo sym={item.ticker} size={28} />
        </button>
        <span className="pill" style={{ background: "var(--surface-3)", color: catCol(item.category) }}>{catLabel(item.category)}</span>
        <div className="mono" style={{ fontSize: ".66rem", color: "var(--text-dim-solid)" }}>{etTimeLabel(item.publishedAt)}</div>
        {/* Market cap + LIVE %change for the story's ticker, under the time.
            Both are omitted rather than shown as "—" when unavailable, so the
            column stays compact for tickers the universe hasn't synced. */}
        {marketCap != null && (
          <div className="mono" style={{ fontSize: ".64rem", color: "var(--text-dim-solid)" }}>
            {fmtMcap(marketCap)}
          </div>
        )}
        {livePct != null && (
          <div className={`mono ${cls(livePct)}`} style={{ fontSize: ".66rem", fontWeight: 700 }}>
            {sign(livePct)}
          </div>
        )}
      </div>
      <a
        href={item.url} target="_blank" rel="noreferrer"
        style={{ flex: 1, minWidth: 0, textDecoration: "none", color: "inherit", borderRadius: 8, display: "flex", gap: 10 }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: ".88rem", color: "var(--text)" }}>
          <b
            onClick={e => { e.preventDefault(); onTicker(item.ticker); }}
            style={{ cursor: "pointer" }}
            title={`Filter the feed by ${item.ticker}`}
          >{item.ticker}</b> {item.headline}
        </div>
        {item.summary && (
          <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)", borderLeft: `2px solid ${catCol(item.category)}55`, paddingLeft: 9, marginTop: 5 }}>
            {item.summary}
          </div>
        )}
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <span style={{ fontSize: ".68rem", color: "var(--brand-2)", fontWeight: 600 }}>
            {item.source ? `Read at ${item.source}` : "Read source"} →
          </span>
          {item.vendor && (
            <span className="pill" style={{ fontSize: ".56rem", background: "var(--surface-3)", color: "var(--text-dim-solid)", textTransform: "uppercase", letterSpacing: ".03em" }}>
              via {item.vendor}
            </span>
          )}
          {item.sentiment && (
            <span className="pill" style={{ fontSize: ".56rem", textTransform: "capitalize", background: "var(--surface-3)", color: item.sentiment === "positive" ? "var(--up)" : item.sentiment === "negative" ? "var(--down)" : "var(--text-dim-solid)" }}>
              {item.sentiment}
            </span>
          )}
        </div>
        </div>
        {item.imageUrl && (
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            style={{ flexShrink: 0, width: 84, height: 84, objectFit: "cover", borderRadius: 8, background: "var(--surface-3)" }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        )}
      </a>
    </div>
  );
}

/* ── Main commentary / Live Feed screen ── */
export function CommentaryScreen() {
  const router = useRouter();
  const uid = firebaseAuth.currentUser?.uid ?? null;
  const { data: liveNews, loading: liveNewsLoading } = useApiList<NewsArticleDoc>("/market-data/news");
  const { data: companies, loading: companiesLoading } = useApiList<CompanyDoc>("/market-data/companies");
  const { data: filingsWire } = useApiList<FilingsWireDoc>("/market-data/filings-wire");
  const filingsSorted = [...filingsWire].sort((a, b) => b.filingDate.localeCompare(a.filingDate));
  const { data: regimeList } = useApiList<MacroRegimeDoc>("/market-data/macro-regime");
  const regime = regimeList.find(r => r.id === "current") ?? regimeList[0] ?? null;
  const [activeTab,     setActiveTab]     = useState(0);
  const [search,        setSearch]        = useState("");
  const [secFilter,     setSecFilter]     = useState("All");
  const [capFilter,     setCapFilter]     = useState("All");
  const searchRef = useRef<HTMLInputElement>(null);

  const companyByTicker = new Map(companies.map(c => [c.ticker, c]));

  const [mySymbols, setMySymbols] = useState<Set<string>>(new Set());
  useEffect(() => {
    (async () => {
      if (!uid) return new Set<string>();
      const [w, p] = await Promise.all([
        apiGet<WatchlistDoc>("/api/watchlist").catch(() => ({ tickers: [] as string[] })),
        apiGet<{ holdings: HoldingDoc[] }>("/api/portfolio").catch(() => ({ holdings: [] as HoldingDoc[] })),
      ]);
      return new Set([...w.tickers, ...p.holdings.map(h => h.ticker)]);
    })().then(setMySymbols);
  }, [uid]);

  const symbolList = [...companies].filter(c => !!c.ticker).sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)).map(c => ({ s: c.ticker, n: c.name ?? c.ticker }));
  const topSymbols = symbolList.slice(0, 8).map(x => x.s);
  /* Plain free-text search — matches anywhere in the message (ticker / headline / summary). */
  const q = search.trim().toLowerCase();

  const sorted = [...liveNews].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  const premarket  = sorted.filter(n => etHour(n.publishedAt) < 9.5);
  const afterHours = sorted.filter(n => etHour(n.publishedAt) >= 16);
  const macro      = sorted.filter(n => n.category !== "company");
  const myFeed     = sorted.filter(n => mySymbols.has(n.ticker));

  const tabFeed: NewsArticleDoc[] = (() => {
    if (activeTab === 1) return premarket;
    if (activeTab === 2) return afterHours;
    if (activeTab === 3) return myFeed;
    if (activeTab === 4) return macro;
    return sorted;
  })();

  // Sector dropdown uses the SAME unified option set as every other screen —
  // "All" + live GICS sectors + curated theme baskets — so filtering the feed
  // by company.sector (or by theme ticker membership) is uniform app-wide.
  const feedSectors = sectorFilterOptions(companies);
  const effSec = feedSectors.includes(secFilter) ? secFilter : "All";

  /* Filter the feed by the typed text + sector + market-cap (on top of the tab).
     Sector/cap are resolved from the companies doc for each item's ticker; an
     item whose ticker isn't in the companies collection is excluded once either
     of those filters is active (it can't be classified). */
  const displayFeed = tabFeed.filter(n => {
    if (q &&
      !((n.ticker ?? "").toLowerCase().includes(q) ||
        (n.headline ?? "").toLowerCase().includes(q) ||
        (n.summary ?? "").toLowerCase().includes(q))) return false;
    if (effSec !== "All" || capFilter !== "All") {
      const c = companyByTicker.get(n.ticker);
      if (effSec !== "All" && !matchesSector(effSec, n.ticker, c?.sector)) return false;
      if (capFilter !== "All" && capTier(c?.marketCap) !== capFilter) return false;
    }
    return true;
  });

  /* Collapse multi-ticker duplicates. Polygon tags one article to EVERY ticker
     it mentions, so the same story arrives once per ticker (an Alphabet piece
     gets tagged both GOOG and MSFT). In this aggregated feed we show it ONCE,
     keeping the ticker whose company name actually appears in the headline
     (so the Alphabet story keeps GOOG, not the incidental MSFT mention). */
  const feed = (() => {
    const byKey = new Map<string, NewsArticleDoc>();
    const order: string[] = [];
    const relevance = (n: NewsArticleDoc) => {
      const nm = companyByTicker.get(n.ticker)?.name?.split(/[\s,.]/)[0]?.toLowerCase();
      return nm && nm.length > 2 && (n.headline ?? "").toLowerCase().includes(nm) ? 1 : 0;
    };
    for (const n of displayFeed) {
      const key = n.url || n.id;
      const cur = byKey.get(key);
      if (!cur) { byKey.set(key, n); order.push(key); }
      else if (relevance(n) > relevance(cur)) byKey.set(key, n);
    }
    return order.map(k => byKey.get(k) as NewsArticleDoc);
  })();

  // LIVE %change for the tickers actually rendered in the feed, via the app-wide
  // shared poll — one timer for the whole app, so a story's %change here matches
  // the same ticker on the heatmap, movers and the stock drawer exactly.
  const feedQuotes = useLiveQuotes(feed.map(n => n.ticker).filter(Boolean));

  const feedLabel = (() => {
    if (activeTab === 0) return { title: "Intraday commentary", badge: <span className="live"><span className="dot" />Live · streaming</span> };
    if (activeTab === 1) return { title: "Pre-market · before 9:30a ET", badge: <span className="pill" style={{ background: "var(--surface-3)", color: "var(--brand-2)" }}>Pre-market</span> };
    if (activeTab === 2) return { title: "After hours · post 4:00p ET", badge: <span className="pill amc">After hours</span> };
    if (activeTab === 3) return { title: `My names · ${mySymbols.size} tracked`, badge: <span className="pill ai">Portfolio + Watchlist</span> };
    if (activeTab === 4) return { title: "Macro & rates", badge: <span className="pill" style={{ background: "var(--surface-3)", color: "var(--warn)" }}>Macro</span> };
    return { title: "Commentary", badge: null };
  })();


  return (
    <>
      <div className="page-head">
        <div className="tabs">
          {TABS.map((t, i) => (
            <button key={t} className={`tab${i === activeTab ? " on" : ""}`}
              onClick={() => setActiveTab(i)}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "0 18px 18px" }}>

        {/* Free-text search — filters the feed by anything typed */}
        <div className="fbar" style={{ marginBottom: 12, position: "relative", flexWrap: "wrap", gap: 8 }}>
          <div style={{ position: "relative", minWidth: "16.25rem" }}>
            <input
              ref={searchRef}
              className="mv-sel"
              placeholder="Search the feed — ticker, company or keyword…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoComplete="off"
              style={{ width: "100%" }}
            />
          </div>
          {search.trim() && (
            <button className="chip ghost" onClick={() => setSearch("")} title="Clear search">Clear</button>
          )}

          {/* Sector + market-cap filters — narrow the feed to news about
              companies in a given sector and/or size tier. */}
          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", alignSelf: "center", marginLeft: 4 }}>Sector</span>
          <select className="mv-sel" style={{ textTransform: "lowercase" }} value={effSec} onChange={e => setSecFilter(e.target.value)}>
            {feedSectors.map(s => <option key={s} value={s}>{s.toLowerCase()}</option>)}
          </select>
          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", alignSelf: "center" }}>Market cap</span>
          <select className="mv-sel" value={capFilter} onChange={e => setCapFilter(e.target.value)}>
            {CAP_TIERS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <div style={{ flex: 1 }} />
          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
            {search.trim() || effSec !== "All" || capFilter !== "All"
              ? `Showing ${feed.length} item${feed.length === 1 ? "" : "s"}`
              : "Filter the feed — search text, sector or market cap"}
          </span>
        </div>

        <div className="dash">

          {/* col-8: Feed — a flex column so the feed card grows to fill the
              grid row (which the right rail sizes), squaring off the layout
              instead of leaving an empty L below a short feed. */}
          <div className="col-8" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Quick lookup — tap a ticker to add it to the feed filter. Sits
                at the TOP of the column; the feed card below flex-fills. */}
            <div className="card" style={{ flexShrink: 0 }}>
              <div className="card-h">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>{activeTab === 3 ? "Tracked names" : "Quick filter"}</h3><VendorTag v="polygon" /></div>
                <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>tap to add to filter</span>
              </div>
              <div className="card-b" style={{ paddingTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(activeTab === 3 ? [...mySymbols] : topSymbols).length === 0 ? (
                  <DataState loading={activeTab === 3 ? false : companiesLoading} label={activeTab === 3 ? "No tracked names yet." : "No live companies synced yet."} />
                ) : (activeTab === 3 ? [...mySymbols] : topSymbols).map(sym => (
                  <button
                    key={sym}
                    className={`chip${search.trim().toUpperCase() === sym.toUpperCase() ? " on" : ""}`}
                    onClick={() => setSearch(search.trim().toUpperCase() === sym.toUpperCase() ? "" : sym)}
                  >{sym}</button>
                ))}
              </div>
            </div>

            <div className="card" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <div className="card-h">
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}><h3>{feedLabel.title}{q ? ` · “${search.trim()}”` : ""}</h3><VendorTag v={["polygon", "fmp"]} /></div>
                {feedLabel.badge}
              </div>
              <div className="card-b" style={{ paddingTop: 2, flex: 1, minHeight: 0, overflowY: "auto" }}>
                {feed.length === 0 ? (
                  <DataState loading={liveNewsLoading} label={
                    q
                      ? `No matches for “${search.trim()}” in this tab.`
                      : activeTab === 3
                        ? (uid ? "No live news matches your portfolio or watchlist names right now." : "Sign in and add names to your watchlist or portfolio to see this feed.")
                        : "No live news items in this category right now."} />
                ) : feed.map((item, i) => (
                  <FeedItem
                    key={item.id}
                    item={item}
                    i={i}
                    total={feed.length}
                    onTicker={sym => setSearch(sym)}
                    marketCap={companyByTicker.get(item.ticker)?.marketCap ?? null}
                    livePct={feedQuotes.get(item.ticker)?.pctChange ?? companyByTicker.get(item.ticker)?.pctChange ?? null}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* col-4: side cards */}
          <div className="col-4" style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            <div className="wmn">
              <div className="wmn-h">
                <div className="t">
                  <div className="wmn-orb">
                    <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16 }}>
                      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9z" fill="currentColor" />
                    </svg>
                  </div>
                  <div>
                    <h2 style={{ fontSize: ".92rem", display: "flex", alignItems: "center", gap: 6 }}>Before the Bell <VendorTag v={["polygon", "fmp"]} /></h2>
                    <div className="meta">pre-market headlines</div>
                  </div>
                </div>
              </div>
              <div className="wmn-body" style={{ padding: "6px 18px 14px" }}>
                {premarket.length === 0 ? (
                  <DataState label="No pre-market headlines yet this session. Live news for any ticker is available via the feed and filter above." />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    {premarket.slice(0, 5).map((n, i) => (
                      <a
                        key={n.id ?? `${n.ticker}-${i}`}
                        href={n.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ textDecoration: "none", color: "inherit", display: "block" }}
                      >
                        <div style={{ fontSize: ".8rem", color: "var(--text)", lineHeight: 1.4 }}>
                          <b style={{ color: "var(--text-hi)" }}>{n.ticker}</b> {n.headline}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3, flexWrap: "wrap" }}>
                          <span style={{ fontSize: ".64rem", color: "var(--text-dim-solid)" }}>{n.source}</span>
                          {n.vendor && (
                            <span className="pill" style={{ fontSize: ".54rem", background: "var(--surface-3)", color: "var(--text-dim-solid)", textTransform: "uppercase", letterSpacing: ".03em" }}>via {n.vendor}</span>
                          )}
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-h">
                <h3>After the Close</h3>
                <span className="pill amc">within 30 min</span>
              </div>
              <div className="card-b">
                <p style={{ fontSize: ".82rem", lineHeight: 1.55, color: "var(--text-dim-solid)" }}>
                  A pushed summary of final index performance, the day&apos;s top stories, and what&apos;s scheduled for tomorrow will appear here within 30 minutes of the close.
                </p>
                <button className="btn ai" style={{ marginTop: 10, width: "100%" }} onClick={() => router.push("/menu/recap")}>
                  See today&apos;s EOD recap →
                </button>
              </div>
            </div>

            <div className="card">
              <div className="card-h">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Filings wire</h3><VendorTag v="sec" /></div>
                <span className="pill ai" style={{ fontSize: ".68rem" }}>SEC 8-K</span>
              </div>
              <div className="card-b">
                {filingsSorted.length === 0 ? (
                  <DataState label="No recent 8-K filings synced yet (run the edgar-8k job)." />
                ) : filingsSorted.slice(0, 12).map(f => (
                  <a key={f.id} href={f.url} target="_blank" rel="noreferrer"
                    style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "7px 0", textDecoration: "none", color: "inherit", borderBottom: "1px solid var(--border-soft)" }}>
                    <span className="mono" style={{ fontWeight: 700, color: "var(--text-hi)", minWidth: 52 }}>{f.ticker}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: ".76rem", color: "var(--text-dim-solid)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.isEarnings ? "Earnings (8-K 2.02)" : f.description || "8-K"}
                    </span>
                    {f.session && <span className="pill" style={{ fontSize: ".6rem" }}>{f.session}</span>}
                    <span className="mono" style={{ fontSize: ".64rem", color: "var(--text-dim-solid)" }}>{f.filingDate.slice(5)}</span>
                  </a>
                ))}
              </div>
            </div>

            <div className="card" style={{ flex: 1 }}>
              <div className="card-h">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Market regime</h3><VendorTag v="fred" /></div>
                {regime && (
                  <span className="pill" style={{
                    background: regime.regime === "Risk-On" ? "var(--up-dim, rgba(47,230,166,.18))"
                      : regime.regime === "Risk-Off" ? "var(--down-dim, rgba(255,84,112,.18))" : "var(--surface-3)",
                    color: regime.regime === "Risk-On" ? "var(--up)" : regime.regime === "Risk-Off" ? "var(--down)" : "var(--text)",
                    fontWeight: 700,
                  }}>{regime.regime}</span>
                )}
              </div>
              <div className="card-b">
                {!regime ? (
                  <DataState label="Regime read populates once the macro-regime job has run (FRED-derived: curve, VIX, credit, trend, jobs)." />
                ) : (
                  <>
                    <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", marginBottom: 8 }}>
                      Score {regime.score >= 0 ? "+" : ""}{regime.score} / ±{regime.maxScore} · FRED-derived · as of {regime.asOfDate}
                    </div>
                    {([
                      ["Yield curve", regime.components.yieldCurve],
                      ["Volatility (VIX)", regime.components.volatility],
                      ["Credit spread", regime.components.credit],
                      ["Trend vs 200-DMA", regime.components.trend],
                      ["Employment", regime.components.employment],
                    ] as [string, MacroRegimeDoc["components"]["credit"]][]).map(([label, c]) => (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border-soft)" }}>
                        <span style={{ fontSize: ".78rem", color: "var(--text)" }}>{label}</span>
                        <span style={{
                          fontSize: ".74rem", fontWeight: 600,
                          color: c.signal == null ? "var(--text-dim-solid)" : c.signal > 0 ? "var(--up)" : c.signal < 0 ? "var(--down)" : "var(--text-dim-solid)",
                        }}>
                          {c.signal == null ? "—" : c.signal > 0 ? "▲" : c.signal < 0 ? "▼" : "•"} {c.label}
                          {c.value != null && <span style={{ color: "var(--text-dim-solid)", marginLeft: 5 }}>({c.value})</span>}
                        </span>
                      </div>
                    ))}
                    <div style={{ fontSize: ".64rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                      Rules-based composite of public FRED series — not investment advice.
                    </div>
                  </>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
