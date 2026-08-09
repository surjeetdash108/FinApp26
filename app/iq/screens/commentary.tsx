"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { StockLogo, DataState } from "../utils";
import { useApiList } from "../hooks/useApiList";
import { firebaseAuth } from "../../firebase";
import { apiGet } from "../backend";
import type { NewsArticleDoc, CompanyDoc, WatchlistDoc, HoldingDoc, FilingsWireDoc, MacroRegimeDoc } from "../types";

const TABS = ["Live", "Premarket", "After Hours", "My names", "Macro"];

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
function FeedItem({ item, i, total, onTicker }: {
  item: NewsArticleDoc; i: number; total: number; onTicker: (ticker: string) => void;
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
      </div>
      <a
        href={item.url} target="_blank" rel="noreferrer"
        style={{ flex: 1, minWidth: 0, textDecoration: "none", color: "inherit", borderRadius: 8 }}
      >
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
        <div style={{ marginTop: 6, fontSize: ".68rem", color: "var(--brand-2)", fontWeight: 600 }}>
          {item.source ? `Read at ${item.source}` : "Read source"} →
        </div>
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
  const searchRef = useRef<HTMLInputElement>(null);
  const [suggOpen, setSuggOpen] = useState(false);

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

  /* Filter the feed by the typed text (applied on top of the active tab). */
  const displayFeed = q
    ? tabFeed.filter(n =>
        (n.ticker ?? "").toLowerCase().includes(q) ||
        (n.headline ?? "").toLowerCase().includes(q) ||
        (n.summary ?? "").toLowerCase().includes(q))
    : tabFeed;

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

          <div style={{ flex: 1 }} />
          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
            {search.trim()
              ? `Showing ${displayFeed.length} item${displayFeed.length === 1 ? "" : "s"} for “${search.trim()}”`
              : "Type anything to filter the feed — ticker, company or keyword"}
          </span>
        </div>

        <div className="dash">

          {/* col-8: Feed */}
          <div className="col-8">
            <div className="card">
              <div className="card-h">
                <h3>{feedLabel.title}{q ? ` · “${search.trim()}”` : ""}</h3>
                {feedLabel.badge}
              </div>
              <div className="card-b" style={{ paddingTop: 2, maxHeight: 620, overflowY: "auto" }}>
                {displayFeed.length === 0 ? (
                  <DataState loading={liveNewsLoading} label={
                    q
                      ? `No matches for “${search.trim()}” in this tab.`
                      : activeTab === 3
                        ? (uid ? "No live news matches your portfolio or watchlist names right now." : "Sign in and add names to your watchlist or portfolio to see this feed.")
                        : "No live news items in this category right now."} />
                ) : displayFeed.map((item, i) => (
                  <FeedItem key={item.id} item={item} i={i} total={displayFeed.length} onTicker={sym => setSearch(sym)} />
                ))}
              </div>
            </div>

            {/* Quick lookup — tap a ticker to add it to the feed filter */}
            <div className="card" style={{ marginTop: 14 }}>
              <div className="card-h">
                <h3>{activeTab === 3 ? "Tracked names" : "Quick filter"}</h3>
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
                    <h2 style={{ fontSize: ".92rem" }}>Before the Bell</h2>
                    <div className="meta">pushed 8:30a ET</div>
                  </div>
                </div>
              </div>
              <div className="wmn-body" style={{ padding: "6px 18px 14px" }}>
                <DataState label="A pushed pre-market summary (futures, overnight moves, names reporting before the open) needs a scheduled digest job — not built yet. Live news for any ticker is available via the feed and filter above." />
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
                <h3>Filings wire</h3>
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
                <h3>Market regime</h3>
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
