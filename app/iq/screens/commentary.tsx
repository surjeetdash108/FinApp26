"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useIQActions } from "../shell";
import { commentary, watch, folio, movers, analyst, screenerStocks, stockInfo, sectorByName } from "../data";
import { sign, fmt, hashStr, earnHistory, StockLogo } from "../utils";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import type { NewsArticleDoc } from "../types";

const TABS = ["Live", "Premarket", "After Hours", "My names", "Macro"];

const PREMARKET = [
  { cat: "Futures",   accent: "var(--brand-2)", time: "6:14a", text: "S&P futures <b>+0.4%</b>, Nasdaq futures <b>+0.7%</b> pre-open",                    why: "Risk-on sentiment building ahead of the open; CPI catalyst overnight." },
  { cat: "Macro",     accent: "var(--warn)",    time: "5:55a", text: "10-year Treasury yield drops to <b>4.32%</b> from 4.41% close",                      why: "Bond market front-running a rate-cut repricing on the inflation miss." },
  { cat: "Earnings",  accent: "var(--up)",      time: "6:01a", text: "<b>NVDA</b> Q1 results: EPS $6.12 vs $5.18 est. (+18% beat)",                         why: "Revenue guidance of $28B vs $26.7B consensus — the number the market was watching most." },
  { cat: "Analyst",   accent: "var(--brand-2)", time: "5:30a", text: "Wedbush raises <b>AAPL</b> PT to $250, Outperform reiterated",                        why: "Services momentum is reaccelerating; AI device cycle could lift upgrade rates." },
  { cat: "Overnight", accent: "var(--ai)",      time: "4:47a", text: "Asian markets: Nikkei <b>+1.2%</b>, Hang Seng <b>+0.8%</b>",                          why: "NVDA's AI print lifted semiconductor names globally; tech-led rally." },
  { cat: "Pre-open",  accent: "var(--up)",      time: "8:12a", text: "BMO reporters: <b>HD</b> (8:30a), <b>DELL</b> (8:30a) · Watch guidance language",     why: "HD margins sensitive to housing slowdown; DELL AI server demand is the key read." },
];

const AFTERHOURS = [
  { cat: "Earnings",  accent: "var(--up)",      time: "4:01p", text: "<b>AAPL</b> Q2 results: EPS $1.53 vs $1.50 est; services rev +14% YoY",               why: "Beat is narrow but services reacceleration is the real story — highest multiple business." },
  { cat: "Earnings",  accent: "var(--up)",      time: "4:05p", text: "<b>NVDA</b> extended hours <b>+7.1%</b> after the close",                              why: "Market still pricing in further data-center capex acceleration into H2." },
  { cat: "Analyst",   accent: "var(--brand-2)", time: "4:18p", text: "GS raises <b>NVDA</b> PT to $1,200 following blowout quarter",                        why: "Blackwell shipments ahead of schedule — raises confidence in FY26 estimates." },
  { cat: "Macro",     accent: "var(--warn)",    time: "4:30p", text: "Markets close: S&P +0.73%, Nasdaq +1.02%, Dow +0.41%",                                 why: "Broad advance on cool inflation + NVDA; defensive sectors lagged as risk appetite returned." },
  { cat: "AMC",       accent: "var(--ai)",      time: "4:45p", text: "Reporting after-close: <b>SNOW</b>, <b>WDAY</b>, <b>PANW</b>",                        why: "Enterprise software results will test whether AI spending trickles into SaaS growth." },
  { cat: "AH Move",   accent: "var(--down)",    time: "5:10p", text: "<b>WDAY</b> AH −4.2% after subscription rev in-line but FY guidance light",            why: "Growth stock held to a high bar post-CPI; anything not materially above estimates sold off." },
];

/* ── Date helper: n days before May 21 2026 ── */
function nd(days: number): string {
  const MQ = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dt = new Date(2026, 4, 21);
  dt.setDate(dt.getDate() - days);
  return MQ[dt.getMonth()] + " " + dt.getDate();
}

/* ── Ticker search suggestion list ── */
const SEARCH_SYMS = [
  ...Object.keys(stockInfo),
  ...screenerStocks.map(s => s.ticker),
  ...movers.map(m => m.ticker),
].filter((v, i, a) => a.indexOf(v) === i).sort();

// symbol → company name, so search can match by name too (e.g. "apple" → AAPL)
const SEARCH_NAMES: Record<string, string> = {};
for (const s of screenerStocks) if (s.name) SEARCH_NAMES[s.ticker] = s.name;
for (const sym of Object.keys(stockInfo)) {
  const n = (stockInfo as Record<string, { name?: string }>)[sym]?.name;
  if (n && !SEARCH_NAMES[sym]) SEARCH_NAMES[sym] = n;
}

function catCol(c: string): string {
  if (c === "Catalyst") return "var(--brand-2)";
  if (c === "Analyst" || c === "Coverage") return "var(--ai)";
  if (c === "Earnings") return "var(--warn)";
  if (c === "Technical") return "var(--up)";
  return "var(--text-dim-solid)";
}

/* ── Live news helpers ── */
type CommentaryItem = { cat: string; accent: string; time: string; text: string; why: string; live?: boolean };

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

function liveCatAccent(c: string | null): string {
  if (c === "earnings") return "var(--warn)";
  if (c === "merger") return "var(--ai)";
  if (c === "company") return "var(--brand-2)";
  return "var(--text-dim-solid)";
}
function liveCatLabel(c: string | null): string {
  if (c === "earnings") return "Earnings";
  if (c === "merger") return "M&A";
  if (c === "company") return "Company";
  return "Macro";
}

function liveToCommentaryItem(n: NewsArticleDoc): CommentaryItem {
  return {
    cat: liveCatLabel(n.category),
    accent: liveCatAccent(n.category),
    time: etTimeLabel(n.publishedAt),
    text: `<b>${n.ticker}</b> ${n.headline}`,
    why: n.summary || `via ${n.source}`,
    live: true,
  };
}

/* ── Build the news-history items for a ticker ── */
type NewsItem = { daysAgo: number; cat: string; source: string; html: string };

function buildNewsHistory(sym: string): NewsItem[] {
  const H: NewsItem[] = [];
  const ss = screenerStocks.find(x => x.ticker === sym);
  const info = stockInfo[sym];
  const nm = info?.name ?? ss?.name ?? sym;
  const mv = movers.find(m => m.ticker === sym);
  const sec = ss ? sectorByName[ss.sector] : null;
  const sd = hashStr(sym + "news");
  const rs = ss?.relativeStrength ?? 55;
  const p = mv?.price ?? info?.price ?? 100;
  const c = mv?.pctChange ?? info?.pctChange ?? 0;

  // Catalyst
  if (mv?.newsContext) H.push({ daysAgo: 0, cat: "Catalyst", source: mv.catalystLabel ?? "Market", html: mv.newsContext });
  // Technical
  if (mv) {
    H.push({
      daysAgo: 0, cat: "Technical", source: mv.maPosture ?? "Trend",
      html: `${nm} is ${c >= 0 ? `<b class="up">up ${sign(c)}</b>` : `<b class="down">down ${sign(c)}</b>`} today on <b>${(mv.rvolRatio ?? 1).toFixed(1)}×</b> volume. ${mv.techContext ?? ""}`,
    });
  }
  // Sector
  if (sec) {
    H.push({
      daysAgo: 1, cat: "Sector", source: ss?.sector ?? "Group",
      html: `The ${ss?.sector ?? "group"} is ${sec.pctChange >= 0 ? `<b class="up">${sign(sec.pctChange)}</b>` : `<b class="down">${sign(sec.pctChange)}</b>`} (${(sec.trend ?? "flat").toLowerCase()}).`,
    });
  }
  // Analyst actions
  analyst.filter(a => a.ticker === sym).slice(0, 3).forEach((a, i) => {
    const verb = a.actionType === "up" ? "raised to" : a.actionType === "down" ? "cut to" : a.actionType === "init" ? "initiated at" : "reiterated";
    H.push({
      daysAgo: 3 + i * 4, cat: "Analyst", source: a.firm,
      html: `<b>${a.firm}</b> ${verb} <b style="color:var(--text-hi)">${a.newRating}</b>${a.newPriceTarget ? `, PT $${a.newPriceTarget}` : ""}.`,
    });
  });
  // Last earnings
  const qeps = p / ((info?.peRatio ?? ss?.peRatio ?? 25) || 25) / 4;
  const hist = earnHistory(sym, qeps);
  if (hist.length) {
    const q = hist[0];
    H.push({
      daysAgo: 6, cat: "Earnings", source: "Report",
      html: `${nm} posted ${q.q} EPS $${fmt(q.a)} vs $${fmt(q.e)} est (${q.surp >= 0 ? "beat" : "miss"}); shares ${q.mv >= 0 ? `<b class="up">${sign(q.mv)}</b>` : `<b class="down">${sign(q.mv)}</b>`} on the print.`,
    });
  }
  // Next ER (from watch data)
  const wEntry = watch.find(w => w.ticker === sym);
  if (wEntry?.nextEarningsDate && wEntry.nextEarningsDate !== "—") {
    const streak = Math.abs(sd % 7) + 2;
    const beatStreak = (sd % 3) !== 0;
    H.push({
      daysAgo: 0, cat: "Earnings", source: "Calendar",
      html: `${nm} next reports <b style="color:var(--text-hi)">${wEntry.nextEarningsDate}</b>. Riding a ${streak}-qtr ${beatStreak ? "beat" : "miss"} streak.`,
    });
  }
  // Coverage (deterministic)
  H.push({
    daysAgo: (sd % 6) + 10, cat: "Coverage", source: "Desk",
    html: `${nm} added to a sell-side ${(sd % 2) ? "best ideas" : "conviction"} list; analysts cite ${rs >= 60 ? "durable demand" : "a turnaround setup"}.`,
  });
  // Product
  H.push({
    daysAgo: (sd % 7) + 16, cat: "Product", source: "Company",
    html: `${nm} unveiled a new ${(ss?.sector ?? "").toLowerCase().includes("semi") ? "product line" : "initiative"}; the Street called it ${(sd % 2) ? "incremental" : "a needle-mover"}.`,
  });
  // Guidance
  H.push({
    daysAgo: (sd % 5) + 23, cat: "Guidance", source: "IR",
    html: `${nm} ${c >= 0 ? "reaffirmed" : "tempered"} full-year guidance at an investor event.`,
  });

  H.sort((a, b) => a.daysAgo - b.daysAgo);
  return H;
}

/* ── Feed item component ── */
function FeedItem({ item, i, total, onItemClick }: {
  item: CommentaryItem;
  i: number;
  total: number;
  onItemClick: (ticker: string | null) => void;
}) {
  const tickerM = item.text.match(/<b>([A-Z]{2,5})<\/b>/);
  const ticker  = tickerM ? tickerM[1] : null;
  return (
    <div
      onClick={() => onItemClick(ticker)}
      style={{
        display: "flex", gap: 12,
        padding: "12px 0",
        borderBottom: i < total - 1 ? "1px solid var(--border-soft)" : "none",
        cursor: "pointer",
        borderRadius: 8,
        transition: "background .14s",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "var(--surface-1)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      <div style={{ flexShrink: 0, width: 90, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5 }}>
        {ticker ? (
          <StockLogo sym={ticker} size={28} />
        ) : (
          <div style={{ width: 28, height: 28, borderRadius: 7, background: `${item.accent}22`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontSize: ".65rem", fontWeight: 800, color: item.accent }}>◆</span>
          </div>
        )}
        <span className="pill" style={{ background: "var(--surface-3)", color: item.accent, marginTop: 1 }}>{item.cat}</span>
        <div className="mono" style={{ fontSize: ".66rem", color: "var(--text-dim-solid)" }}>{item.time}</div>
        {item.live && <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", fontSize: ".58rem" }}>live</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: ".88rem", color: "var(--text)" }} dangerouslySetInnerHTML={{ __html: item.text }} />
        <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)", borderLeft: `2px solid ${item.accent}55`, paddingLeft: 9, marginTop: 5 }}>
          <b style={{ color: "var(--ai)", fontWeight: 600 }}>Why it matters · </b>
          {item.why}
        </div>
        {ticker && (
          <div style={{ marginTop: 6, fontSize: ".68rem", color: "var(--brand-2)", fontWeight: 600 }}>
            View {ticker} news history →
          </div>
        )}
      </div>
    </div>
  );
}

/* ── News Drawer ── */
function NewsDrawer({ sym, onClose }: { sym: string; onClose: () => void }) {
  const { openStockFull } = useIQActions();
  const info = stockInfo[sym];
  const ss   = screenerStocks.find(x => x.ticker === sym);
  const nm   = info?.name ?? ss?.name ?? sym;
  const items = buildNewsHistory(sym);
  // Per-ticker cache-aside fill (GET /live/news?ticker=X) — independent of the
  // main screen's bounded top-60 global feed, so a quiet ticker not in that
  // window still gets its own recent headlines here.
  const { data: tickerNews } = useApiResource<NewsArticleDoc[]>(`/live/news?ticker=${encodeURIComponent(sym)}`);
  const liveItems = [...(tickerNews ?? [])].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="side-drawer">
        <div className="drawer-h">
          <StockLogo sym={sym} size={38} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)" }}>
              {sym} · {nm}
            </div>
            <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", marginTop: 2 }}>
              News history
            </div>
          </div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-b">
          {liveItems.length > 0 && (
            <>
              <div className="ai-sec"><div className="h">{sym} · live synced headlines</div></div>
              {liveItems.map(item => (
                <a key={item.id} href={item.url} target="_blank" rel="noreferrer"
                  className="minirow" style={{ alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 12, textDecoration: "none" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ lineHeight: 1.5 }}>
                      <span className="pill" style={{ background: "var(--surface-3)", color: liveCatAccent(item.category), marginRight: 6, fontSize: ".66rem" }}>
                        {liveCatLabel(item.category)}
                      </span>
                      <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", marginRight: 6, fontSize: ".58rem" }}>live</span>
                      <span style={{ fontSize: ".84rem", color: "var(--text)" }}>{item.headline}</span>
                    </div>
                    <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 3 }}>
                      {item.source} · {timeAgo(item.publishedAt)}
                    </div>
                  </div>
                </a>
              ))}
            </>
          )}

          <div className="ai-sec"><div className="h">{sym} · recent headlines</div></div>

          {items.map((item, i) => (
            <div key={i} className="minirow" style={{ alignItems: "flex-start", gap: 10, cursor: "default", marginBottom: 12 }}>
              <StockLogo sym={sym} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ lineHeight: 1.5 }}>
                  <span className="pill" style={{ background: "var(--surface-3)", color: catCol(item.cat), marginRight: 6, fontSize: ".66rem" }}>
                    {item.cat}
                  </span>
                  <span style={{ fontSize: ".84rem", color: "var(--text)" }} dangerouslySetInnerHTML={{ __html: item.html }} />
                </div>
                <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 3 }}>
                  {item.source} · {item.daysAgo === 0 ? "Today" : nd(item.daysAgo)}
                </div>
              </div>
            </div>
          ))}

          <button className="btn primary" style={{ width: "100%", marginTop: 14 }}
            onClick={() => { onClose(); openStockFull(sym); }}>
            Open full stock page →
          </button>
          <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 8, textAlign: "center" }}>
            Aggregated news history · illustrative context plus live synced headlines where available · not investment advice.
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Main commentary screen ── */
export function CommentaryScreen() {
  const router = useRouter();
  const { data: liveNews } = useApiList<NewsArticleDoc>("/market-data/news");
  const [activeTab,     setActiveTab]     = useState(0);
  const [search,        setSearch]        = useState("");
  const [newsDrawer,    setNewsDrawer]    = useState<string | null>(null);
  const [noCompanyOpen, setNoCompanyOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [suggOpen, setSuggOpen] = useState(false);

  const mySymbols = new Set([
    ...watch.map(w => w.ticker),
    ...folio.map(f => f.ticker),
  ]);

  const liveConverted: CommentaryItem[] = [...liveNews]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .map(liveToCommentaryItem);

  const livePremarket  = liveNews.filter(n => etHour(n.publishedAt) < 9.5).map(liveToCommentaryItem);
  const liveAfterHours = liveNews.filter(n => etHour(n.publishedAt) >= 16).map(liveToCommentaryItem);
  const liveMacro       = liveNews.filter(n => n.category !== "company").map(liveToCommentaryItem);
  const liveMyFeed       = liveNews.filter(n => mySymbols.has(n.ticker)).map(liveToCommentaryItem);

  const myFeed = commentary.filter(item =>
    [...mySymbols].some(sym => item.text.includes(`>${sym}<`) || item.text.includes(`<b>${sym}</b>`))
  );

  const macroFeed = commentary.filter(item =>
    ["Macro", "Fed/Rates"].includes(item.cat)
  );

  const tabFeed: CommentaryItem[] = (() => {
    if (activeTab === 0) return [...liveConverted, ...commentary];
    if (activeTab === 1) return [...livePremarket, ...PREMARKET];
    if (activeTab === 2) return [...liveAfterHours, ...AFTERHOURS];
    if (activeTab === 3) {
      const combined = [...liveMyFeed, ...myFeed];
      return combined.length > 0 ? combined : commentary;
    }
    if (activeTab === 4) {
      const combined = [...liveMacro, ...macroFeed];
      return combined.length > 0 ? combined : commentary;
    }
    return commentary;
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
    ? SEARCH_SYMS.filter(s => s.includes(q) || (SEARCH_NAMES[s] ?? "").toLowerCase().includes(ql)).slice(0, 8)
    : [];

  function openNews(sym: string) {
    setSearch("");
    setSuggOpen(false);
    setNewsDrawer(sym);
  }

  function handleItemClick(ticker: string | null) {
    if (ticker) {
      setNewsDrawer(ticker);
    } else {
      setNoCompanyOpen(true);
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
                {suggestions.map(sym => {
                  const ss  = screenerStocks.find(x => x.ticker === sym);
                  const inf = stockInfo[sym];
                  const nm  = inf?.name ?? ss?.name ?? "";
                  return (
                    <div
                      key={sym}
                      className="sugg-row"
                      onMouseDown={() => openNews(sym)}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer" }}
                    >
                      <b style={{ fontFamily: "var(--f-mono)", color: "var(--text-hi)", minWidth: 52 }}>{sym}</b>
                      <span style={{ fontSize: ".78rem", color: "var(--text-dim-solid)", flex: 1 }}>{nm}</span>
                    </div>
                  );
                })}
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
                  <div style={{ padding: "18px 0", color: "var(--text-dim-solid)", fontSize: ".84rem" }}>
                    {activeTab === 3
                      ? "No commentary items match your portfolio or watchlist names right now."
                      : "No items in this category right now."}
                  </div>
                ) : tabFeed.map((item, i) => (
                  <FeedItem key={i} item={item} i={i} total={tabFeed.length} onItemClick={handleItemClick} />
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
                {(activeTab === 3 ? [...mySymbols] : ["NVDA","AAPL","TSLA","META","MSFT","AMZN","AMD","AVGO"]).map(sym => (
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
              <ul className="wmn-body" style={{ columns: 1, padding: "6px 18px 14px" }}>
                <li><span className="bullet" /><span>Futures point higher after a <b>cooler CPI</b> print; rate-cut odds for September rose.</span></li>
                <li><span className="bullet" /><span>Overnight: Asian semis rallied on NVDA; European luxury slipped on China demand.</span></li>
                <li><span className="bullet" /><span>Before open: <b>HD</b>, <b>DELL</b> report; watch guidance commentary.</span></li>
              </ul>
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
                <div className="note">
                  Regime reads <b style={{ color: "var(--text-hi)" }}>Risk-On Rally</b>: breadth strong, yields easing, cyclicals leading defensives. Cheap-hedging environment with VIX at 14.
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* No company associated — sliding drawer */}
      {noCompanyOpen && (
        <>
          <div className="scrim" onClick={() => setNoCompanyOpen(false)} />
          <div className="side-drawer">
            <div className="drawer-h">
              <div style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                background: "var(--surface-3)", border: "1px solid var(--border-soft)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: ".9rem", color: "var(--text-dim-solid)", fontWeight: 700,
              }}>
                ◆
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)" }}>
                  Macro / Market news
                </div>
                <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", marginTop: 2 }}>
                  No company associated with this item
                </div>
              </div>
              <button className="closebtn" onClick={() => setNoCompanyOpen(false)}>✕</button>
            </div>

            <div className="drawer-b">
              <div className="ai-sec"><div className="h">No company associated</div></div>

              <div style={{
                background: "var(--surface-1)", border: "1px solid var(--border-soft)",
                borderRadius: 10, padding: 16, marginBottom: 18,
                fontSize: ".85rem", color: "var(--text-dim-solid)", lineHeight: 1.65,
              }}>
                This news item covers <b style={{ color: "var(--text-hi)" }}>macro conditions</b>,
                {" "}market-wide price action, or rates — it is not tied to a specific public company.
                News in this category includes Fed commentary, index moves, sector rotations, and economic data releases.
              </div>

              <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-dim-solid)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
                Browse a stock&apos;s news history instead
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
                {["NVDA","AAPL","MSFT","META","AMZN","TSLA","AMD","GOOGL"].map(sym => (
                  <button
                    key={sym}
                    className="chip"
                    onClick={() => { setNoCompanyOpen(false); setNewsDrawer(sym); }}
                  >
                    {sym}
                  </button>
                ))}
              </div>

              <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", marginTop: 4 }}>
                Or use the search bar at the top to look up any ticker.
              </div>
            </div>
          </div>
        </>
      )}

      {/* News history sliding drawer */}
      {newsDrawer && (
        <NewsDrawer sym={newsDrawer} onClose={() => setNewsDrawer(null)} />
      )}
    </>
  );
}
