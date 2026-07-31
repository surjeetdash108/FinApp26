"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useIQActions } from "../shell";
import { StockLogo, DataState } from "../utils";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import { firebaseAuth } from "../../firebase";
import { apiGet } from "../backend";
import type { NewsArticleDoc, CompanyDoc, WatchlistDoc, HoldingDoc } from "../types";

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
function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

/* ── Feed item component ── */
function FeedItem({ item, i, total, onClick }: {
  item: NewsArticleDoc; i: number; total: number; onClick: (ticker: string) => void;
}) {
  return (
    <div
      onClick={() => onClick(item.ticker)}
      style={{
        display: "flex", gap: 12, padding: "12px 0",
        borderBottom: i < total - 1 ? "1px solid var(--border-soft)" : "none",
        cursor: "pointer", borderRadius: 8, transition: "background .14s",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "var(--surface-1)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      <div style={{ flexShrink: 0, width: 90, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5 }}>
        <StockLogo sym={item.ticker} size={28} />
        <span className="pill" style={{ background: "var(--surface-3)", color: catCol(item.category) }}>{catLabel(item.category)}</span>
        <div className="mono" style={{ fontSize: ".66rem", color: "var(--text-dim-solid)" }}>{etTimeLabel(item.publishedAt)}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: ".88rem", color: "var(--text)" }}><b>{item.ticker}</b> {item.headline}</div>
        {item.summary && (
          <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)", borderLeft: `2px solid ${catCol(item.category)}55`, paddingLeft: 9, marginTop: 5 }}>
            {item.summary}
          </div>
        )}
        <div style={{ marginTop: 6, fontSize: ".68rem", color: "var(--brand-2)", fontWeight: 600 }}>
          View {item.ticker} news history →
        </div>
      </div>
    </div>
  );
}

/* ── News Drawer ── */
function NewsDrawer({ sym, onClose }: { sym: string; onClose: () => void }) {
  const { openStockFull } = useIQActions();
  const { data: tickerNews, loading: tickerNewsLoading } = useApiResource<NewsArticleDoc[]>(`/live/news?ticker=${encodeURIComponent(sym)}`);
  const liveItems = [...(tickerNews ?? [])].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="side-drawer">
        <div className="drawer-h">
          <StockLogo sym={sym} size={38} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)" }}>{sym}</div>
            <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", marginTop: 2 }}>News history</div>
          </div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-b">
          {liveItems.length === 0 ? (
            <DataState loading={tickerNewsLoading} label={`No live news synced for ${sym} yet.`} />
          ) : (
            liveItems.map(item => (
              <a key={item.id} href={item.url} target="_blank" rel="noreferrer"
                className="minirow" style={{ alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 12, textDecoration: "none" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ lineHeight: 1.5 }}>
                    <span className="pill" style={{ background: "var(--surface-3)", color: catCol(item.category), marginRight: 6, fontSize: ".66rem" }}>
                      {catLabel(item.category)}
                    </span>
                    <span style={{ fontSize: ".84rem", color: "var(--text)" }}>{item.headline}</span>
                  </div>
                  <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 3 }}>
                    {item.source} · {timeAgo(item.publishedAt)}
                  </div>
                </div>
              </a>
            ))
          )}

          <button className="btn primary" style={{ width: "100%", marginTop: 14 }}
            onClick={() => { onClose(); openStockFull(sym); }}>
            Open full stock page →
          </button>
        </div>
      </div>
    </>
  );
}

/* ── Main commentary screen ── */
export function CommentaryScreen() {
  const router = useRouter();
  const uid = firebaseAuth.currentUser?.uid ?? null;
  const { data: liveNews, loading: liveNewsLoading } = useApiList<NewsArticleDoc>("/market-data/news");
  const { data: companies, loading: companiesLoading } = useApiList<CompanyDoc>("/market-data/companies");
  const [activeTab,     setActiveTab]     = useState(0);
  const [search,        setSearch]        = useState("");
  const [newsDrawer,    setNewsDrawer]    = useState<string | null>(null);
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

  const symbolList = [...companies].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)).map(c => ({ s: c.ticker, n: c.name ?? c.ticker }));
  const topSymbols = symbolList.slice(0, 8).map(x => x.s);

  const sorted = [...liveNews].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  const premarket  = sorted.filter(n => etHour(n.publishedAt) < 9.5);
  const afterHours = sorted.filter(n => etHour(n.publishedAt) >= 16);
  const macro      = sorted.filter(n => n.category !== "company");
  const myFeed      = sorted.filter(n => mySymbols.has(n.ticker));

  const tabFeed: NewsArticleDoc[] = (() => {
    if (activeTab === 0) return sorted;
    if (activeTab === 1) return premarket;
    if (activeTab === 2) return afterHours;
    if (activeTab === 3) return myFeed;
    if (activeTab === 4) return macro;
    return sorted;
  })();

  const feedLabel = (() => {
    if (activeTab === 0) return { title: "Intraday commentary", badge: <span className="live"><span className="dot" />Live · streaming</span> };
    if (activeTab === 1) return { title: "Pre-market · before 9:30a ET", badge: <span className="pill" style={{ background: "var(--surface-3)", color: "var(--brand-2)" }}>Pre-market</span> };
    if (activeTab === 2) return { title: "After hours · post 4:00p ET", badge: <span className="pill amc">After hours</span> };
    if (activeTab === 3) return { title: `My names · ${mySymbols.size} tracked`, badge: <span className="pill ai">Portfolio + Watchlist</span> };
    if (activeTab === 4) return { title: "Macro & rates", badge: <span className="pill" style={{ background: "var(--surface-3)", color: "var(--warn)" }}>Macro</span> };
    return { title: "Commentary", badge: null };
  })();

  const q = search.trim().toUpperCase();
  const ql = q.toLowerCase();
  const suggestions = q.length >= 1
    ? symbolList.filter(x => x.s.includes(q) || x.n.toLowerCase().includes(ql)).slice(0, 8)
    : [];

  function openNews(sym: string) {
    setSearch("");
    setSuggOpen(false);
    setNewsDrawer(sym);
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

        {/* Ticker search bar */}
        <div className="fbar" style={{ marginBottom: 12, position: "relative" }}>
          <div style={{ position: "relative", minWidth: "8.125rem" }}>
            <input
              ref={searchRef}
              className="mv-sel"
              placeholder="Search stock…"
              value={search}
              onChange={e => { setSearch(e.target.value); setSuggOpen(true); }}
              onFocus={() => setSuggOpen(true)}
              onBlur={() => setTimeout(() => setSuggOpen(false), 160)}
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
                    onMouseDown={() => openNews(x.s)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer" }}
                  >
                    <b style={{ fontFamily: "var(--f-mono)", color: "var(--text-hi)", minWidth: 52 }}>{x.s}</b>
                    <span style={{ fontSize: ".78rem", color: "var(--text-dim-solid)", flex: 1 }}>{x.n}</span>
                  </div>
                ))}
              </div>
            )}
            {suggOpen && q.length >= 1 && suggestions.length === 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, zIndex: 30,
                background: "var(--surface-1)", border: "1px solid var(--border)",
                borderRadius: "var(--r-sm)", marginTop: 2, minWidth: 220, width: "100%",
                padding: "10px 12px", fontSize: ".78rem", color: "var(--text-dim-solid)",
              }}>
                No match for &ldquo;{search.toUpperCase()}&rdquo;
              </div>
            )}
          </div>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
            Type a ticker, then click it to open a side panel of its news
          </span>
        </div>

        <div className="dash">

          {/* col-8: Feed */}
          <div className="col-8">
            <div className="card">
              <div className="card-h">
                <h3>{feedLabel.title}</h3>
                {feedLabel.badge}
              </div>
              <div className="card-b" style={{ paddingTop: 2, maxHeight: 620, overflowY: "auto" }}>
                {tabFeed.length === 0 ? (
                  <DataState loading={liveNewsLoading} label={activeTab === 3
                    ? (uid ? "No live news matches your portfolio or watchlist names right now." : "Sign in and add names to your watchlist or portfolio to see this feed.")
                    : "No live news items in this category right now."} />
                ) : tabFeed.map((item, i) => (
                  <FeedItem key={item.id} item={item} i={i} total={tabFeed.length} onClick={openNews} />
                ))}
              </div>
            </div>

            {/* Quick news lookup — always visible at the bottom of the feed column */}
            <div className="card" style={{ marginTop: 14 }}>
              <div className="card-h">
                <h3>{activeTab === 3 ? "Tracked names" : "Quick news lookup"}</h3>
                <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>tap to open</span>
              </div>
              <div className="card-b" style={{ paddingTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(activeTab === 3 ? [...mySymbols] : topSymbols).length === 0 ? (
                  <DataState loading={activeTab === 3 ? false : companiesLoading} label={activeTab === 3 ? "No tracked names yet." : "No live companies synced yet."} />
                ) : (activeTab === 3 ? [...mySymbols] : topSymbols).map(sym => (
                  <button key={sym} className="chip" onClick={() => openNews(sym)}>{sym}</button>
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
                <DataState label="A pushed pre-market summary (futures, overnight moves, names reporting before the open) needs a scheduled digest job — not built yet. Live news for any ticker is available via the feed and search above." />
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

            <div className="card" style={{ flex: 1 }}>
              <div className="card-h"><h3>General perspective</h3></div>
              <div className="card-b">
                <DataState label="A computed market-regime read (breadth, yields, sector rotation) needs a live internals feed — not available yet." />
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* News history sliding drawer */}
      {newsDrawer && (
        <NewsDrawer sym={newsDrawer} onClose={() => setNewsDrawer(null)} />
      )}
    </>
  );
}
