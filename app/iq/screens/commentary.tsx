"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { StockLogo, DataState } from "../utils";
import { useApiList } from "../hooks/useApiList";
import { firebaseAuth } from "../../firebase";
import { apiGet } from "../backend";
import type { NewsArticleDoc, CompanyDoc, WatchlistDoc, HoldingDoc, FilingsWireDoc } from "../types";

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
  const knownSet = new Set(symbolList.map(x => x.s.toUpperCase()));

  /* Active ticker filters — comma-separated, e.g. "NVDA, AAPL". A token counts
     as a committed filter only once it exactly matches a known ticker, so a
     half-typed symbol never blanks out the feed while you type. */
  const tokens = search.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  const filterTickers = [...new Set(tokens.filter(t => knownSet.size === 0 || knownSet.has(t)))];
  const filterSet = new Set(filterTickers);

  /* The token after the last comma is what you're currently typing → drives suggestions. */
  const currentToken = (search.split(",").pop() ?? "").trim();
  const q = currentToken.toUpperCase();
  const ql = q.toLowerCase();
  const suggestions = q.length >= 1
    ? symbolList.filter(x => !filterSet.has(x.s.toUpperCase()) && (x.s.includes(q) || x.n.toLowerCase().includes(ql))).slice(0, 8)
    : [];

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

  /* Filter the feed by the searched tickers (applied on top of the active tab). */
  const displayFeed = filterSet.size > 0
    ? tabFeed.filter(n => filterSet.has((n.ticker ?? "").toUpperCase()))
    : tabFeed;

  const feedLabel = (() => {
    if (activeTab === 0) return { title: "Intraday commentary", badge: <span className="live"><span className="dot" />Live · streaming</span> };
    if (activeTab === 1) return { title: "Pre-market · before 9:30a ET", badge: <span className="pill" style={{ background: "var(--surface-3)", color: "var(--brand-2)" }}>Pre-market</span> };
    if (activeTab === 2) return { title: "After hours · post 4:00p ET", badge: <span className="pill amc">After hours</span> };
    if (activeTab === 3) return { title: `My names · ${mySymbols.size} tracked`, badge: <span className="pill ai">Portfolio + Watchlist</span> };
    if (activeTab === 4) return { title: "Macro & rates", badge: <span className="pill" style={{ background: "var(--surface-3)", color: "var(--warn)" }}>Macro</span> };
    return { title: "Commentary", badge: null };
  })();

  function addTicker(sym: string) {
    const next = [...new Set([...filterTickers, sym.toUpperCase()])];
    setSearch(next.join(", ") + ", ");
    setSuggOpen(false);
    searchRef.current?.focus();
  }
  function removeTicker(sym: string) {
    const next = filterTickers.filter(t => t !== sym.toUpperCase());
    setSearch(next.length ? next.join(", ") + ", " : "");
  }
  function onSearchKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && suggestions.length > 0) {
      e.preventDefault();
      addTicker(suggestions[0].s);
    } else if (e.key === "Backspace" && currentToken === "" && filterTickers.length > 0) {
      // Backspace on an empty token pops the last committed ticker.
      e.preventDefault();
      removeTicker(filterTickers[filterTickers.length - 1]);
    }
  }

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

        {/* Ticker filter bar — comma-separated multi-ticker filter for the feed */}
        <div className="fbar" style={{ marginBottom: 12, position: "relative", flexWrap: "wrap", gap: 8 }}>
          <div style={{ position: "relative", minWidth: "16.25rem" }}>
            <input
              ref={searchRef}
              className="mv-sel"
              placeholder="Filter feed by ticker(s)…"
              value={search}
              onChange={e => { setSearch(e.target.value); setSuggOpen(true); }}
              onFocus={() => setSuggOpen(true)}
              onBlur={() => setTimeout(() => setSuggOpen(false), 160)}
              onKeyDown={onSearchKeyDown}
              autoComplete="off"
              style={{ width: "100%" }}
            />
            {suggOpen && suggestions.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, zIndex: 30,
                background: "var(--surface-1)", border: "1px solid var(--border)",
                borderRadius: "var(--r-sm)", marginTop: 2,
                minWidth: 220, width: "100%",
              }}>
                {suggestions.map(x => (
                  <div
                    key={x.s}
                    className="sugg-row"
                    onMouseDown={() => addTicker(x.s)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer" }}
                  >
                    <b style={{ fontFamily: "var(--f-mono)", color: "var(--text-hi)", minWidth: 52 }}>{x.s}</b>
                    <span style={{ fontSize: ".78rem", color: "var(--text-dim-solid)", flex: 1 }}>{x.n}</span>
                  </div>
                ))}
              </div>
            )}
            {suggOpen && q.length >= 1 && suggestions.length === 0 && !filterSet.has(q) && (
              <div style={{
                position: "absolute", top: "100%", left: 0, zIndex: 30,
                background: "var(--surface-1)", border: "1px solid var(--border)",
                borderRadius: "var(--r-sm)", marginTop: 2, minWidth: 220, width: "100%",
                padding: "10px 12px", fontSize: ".78rem", color: "var(--text-dim-solid)",
              }}>
                No match for &ldquo;{currentToken.toUpperCase()}&rdquo;
              </div>
            )}
          </div>

          {/* Active filter chips */}
          {filterTickers.map(t => (
            <button
              key={t}
              className="chip"
              onClick={() => removeTicker(t)}
              title={`Remove ${t} from the filter`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {t} <span aria-hidden style={{ color: "var(--text-dim-solid)", fontWeight: 700 }}>✕</span>
            </button>
          ))}
          {filterTickers.length > 0 && (
            <button className="chip ghost" onClick={() => setSearch("")} title="Clear all filters">Clear</button>
          )}

          <div style={{ flex: 1 }} />
          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
            {filterTickers.length > 0
              ? `Showing ${displayFeed.length} item${displayFeed.length === 1 ? "" : "s"} for ${filterTickers.join(", ")}`
              : "Type ticker(s), comma-separated, to filter the feed — e.g. NVDA, AAPL"}
          </span>
        </div>

        <div className="dash">

          {/* col-8: Feed */}
          <div className="col-8">
            <div className="card">
              <div className="card-h">
                <h3>{feedLabel.title}{filterTickers.length > 0 ? ` · ${filterTickers.join(", ")}` : ""}</h3>
                {feedLabel.badge}
              </div>
              <div className="card-b" style={{ paddingTop: 2, maxHeight: 620, overflowY: "auto" }}>
                {displayFeed.length === 0 ? (
                  <DataState loading={liveNewsLoading} label={
                    filterTickers.length > 0
                      ? `No commentary for ${filterTickers.join(", ")} in this tab.`
                      : activeTab === 3
                        ? (uid ? "No live news matches your portfolio or watchlist names right now." : "Sign in and add names to your watchlist or portfolio to see this feed.")
                        : "No live news items in this category right now."} />
                ) : displayFeed.map((item, i) => (
                  <FeedItem key={item.id} item={item} i={i} total={displayFeed.length} onTicker={addTicker} />
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
                    className={`chip${filterSet.has(sym.toUpperCase()) ? " on" : ""}`}
                    onClick={() => (filterSet.has(sym.toUpperCase()) ? removeTicker(sym) : addTicker(sym))}
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
              <div className="card-h"><h3>General perspective</h3></div>
              <div className="card-b">
                <DataState label="A computed market-regime read (breadth, yields, sector rotation) needs a live internals feed — not available yet." />
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
