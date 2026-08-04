"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useIQActions } from "../shell";
import { cls, arr, sign, StockLogo, heatCol } from "../utils";
import { useApiList } from "../hooks/useApiList";
import type { SectorApiDoc } from "../types";

const SEC_PAGE = 10;

// ---- backend doc shape (see MarketCatalystBackEnd src/sync/recaps.job.ts,
// src/market-data/recaps.controller.ts — GET /market-data/recaps) ----
interface RecapMover { ticker: string; name: string; price: number | null; pctChange: number | null; sector: string | null; cap: string | null; }
interface RecapIndex { id: string; label: string; value: number | null; pctChange: number | null; }
interface RecapSector { sector: string; pctChange: number | null; }
interface RecapInternals {
  date: string; advancers: number | null; decliners: number | null; netAdvancers: number | null;
  breadthPct: number | null; trin: number | null; upVolume: number | null; downVolume: number | null;
}
interface RecapDoc {
  date: string;
  indices: RecapIndex[];
  topGainers: RecapMover[];
  topLosers: RecapMover[];
  sectorLeaders: RecapSector[];
  sectorLaggards: RecapSector[];
  internals: RecapInternals | null;
  // Narrative prose isn't produced by any backend job yet — headline/stories
  // below are derived from the numeric fields instead of fabricated copy.
  narrative: string | null;
}

function buildHeadline(r: RecapDoc | null): string {
  if (!r) return "Recap unavailable";
  const spx = r.indices.find(i => i.label === "S&P 500" && i.pctChange != null);
  if (!spx) return `Market recap · ${r.date}`;
  return `Markets closed ${spx.pctChange! >= 0 ? "higher" : "lower"}, S&P 500 ${sign(spx.pctChange!)}`;
}

function buildStories(r: RecapDoc | null): string[] {
  if (!r) return [];
  const out: string[] = [];
  const g = r.topGainers[0], l = r.topLosers[0], sl = r.sectorLeaders[0], lg = r.sectorLaggards[0];
  if (g?.pctChange != null) out.push(`${g.name} led gainers, ${sign(g.pctChange)} on the day.`);
  if (l?.pctChange != null) out.push(`${l.name} led decliners, ${sign(l.pctChange)}.`);
  if (sl?.pctChange != null) out.push(`${sl.sector} was the strongest sector, ${sign(sl.pctChange)}.`);
  if (lg?.pctChange != null) out.push(`${lg.sector} lagged, ${sign(lg.pctChange)}.`);
  return out;
}

function buildInternals(internals: RecapInternals | null): { label: string; value: string; direction: number }[] {
  if (!internals) return [];
  const rows: { label: string; value: string; direction: number }[] = [];
  if (internals.advancers != null && internals.decliners != null) {
    rows.push({ label: "Advancers / Decliners", value: `${internals.advancers} / ${internals.decliners}`, direction: internals.advancers >= internals.decliners ? 1 : -1 });
  }
  if (internals.breadthPct != null) {
    rows.push({ label: "Breadth", value: `${internals.breadthPct.toFixed(0)}%`, direction: internals.breadthPct >= 50 ? 1 : -1 });
  }
  if (internals.upVolume != null && internals.downVolume != null && (internals.upVolume + internals.downVolume) > 0) {
    const pct = Math.round((internals.upVolume / (internals.upVolume + internals.downVolume)) * 100);
    rows.push({ label: "Up volume", value: `${pct}%`, direction: pct >= 50 ? 1 : -1 });
  }
  if (internals.trin != null) {
    rows.push({ label: "TRIN", value: internals.trin.toFixed(2), direction: internals.trin <= 1 ? 1 : -1 });
  }
  return rows;
}

const TABS = ["Today (EOD)", "This Week"];

const WEEKLY = {
  range: "Jun 17 – Jun 21, 2026",
  subtitle: "auto-generated · Fri 5:02 ET",
  headline: "Tech leads a strong week; Fed hold priced in, rate-cut odds firming",
  indices: [
    { label: "S&P 500",    value:  2.14 },
    { label: "Nasdaq",     value:  3.42 },
    { label: "Dow",        value:  1.08 },
    { label: "Russell 2K", value: -0.71 },
  ],
  stories: [
    "NVDA earnings beat powered semiconductors +6.1% for the week — the biggest sector move.",
    "FOMC held rates at 5.50%; dot plot shifted: 2 cuts now expected in 2024 vs 3 previously.",
    "Core CPI +0.2% m/m — first downside surprise in 4 months, lifted rate-cut probability to 58%.",
    "Defensives (Utilities, Staples) underperformed as risk appetite dominated all week.",
  ],
  nextWeek: [
    { time: "Mon", event: "No major macro" },
    { time: "Tue", event: "Consumer Confidence (10:00a)" },
    { time: "Wed", event: "Durable Goods (8:30a)" },
    { time: "Thu", event: "GDP Q1 final (8:30a) · Jobless Claims" },
    { time: "Fri", event: "PCE Deflator (8:30a) — key Fed inflation gauge" },
  ],
  sectorLeaders: [
    { name: "Semiconductors", pctChange:  6.1 },
    { name: "Technology",     pctChange:  4.8 },
    { name: "Consumer Disc.", pctChange:  2.3 },
  ],
  sectorLaggards: [
    { name: "Utilities",      pctChange: -1.4 },
    { name: "Staples",        pctChange: -0.9 },
    { name: "Healthcare",     pctChange:  0.2 },
  ],
  biggestMoves: [
    { ticker: "NVDA", reason: "Earnings beat-and-raise", pctChange:  14.2 },
    { ticker: "PLTR", reason: "Guidance raise",          pctChange:   9.1 },
    { ticker: "ZIM",  reason: "Earnings + dividend",     pctChange:   9.0 },
    { ticker: "WBA",  reason: "Guidance cut",            pctChange:  -9.4 },
    { ticker: "DELL", reason: "Margin miss",             pctChange:  -5.2 },
  ],
};

// ---- News briefing data ----
type NewsItem = { cat: string; time: string; headline: string; tweet: string };

const NEWS_DAILY: NewsItem[] = [
  { cat: 'Macro', time: '8:30a', headline: 'Cooler May CPI revives September rate-cut bets',
    tweet: 'Cooler CPI just changed the math. Core inflation rose only +0.2% vs +0.3% expected — the first clean downside surprise in months. Yields dropped, a September cut is back on the table, and long-duration growth ate it up. $SPY $TLT $QQQ' },
  { cat: 'Earnings', time: '9:31a', headline: 'NVDA beats by 18% and raises full-year guidance',
    tweet: '$NVDA didn\'t just beat — it raised. EPS topped by 18% and management lifted the full-year outlook on data-center demand. The guidance hike, not the beat, is what drove +8.2%. The "AI demand is peaking" fear just got buried. $SMH' },
  { cat: 'Sectors', time: '10:02a', headline: 'Semiconductors lead every group, +3.1%',
    tweet: 'Chips ran the table: +3.1% and the #1 group in the market today. $NVDA lit the match but $AVGO, $MU and $AMD all caught the bid. When leadership spreads like this, it\'s a re-rating — not a one-off. $SMH' },
  { cat: 'Analyst', time: '9:18a', headline: 'Morgan Stanley upgrades CRM to Overweight, $340 PT',
    tweet: 'Third $CRM upgrade this week — Morgan Stanley to Overweight, $340 target. The Street is quietly buying the margin story. When upgrades cluster like this, sentiment is turning. $IGV' },
  { cat: 'Flows', time: '9:05a', headline: '4.2M-share block crosses in XLF above VWAP',
    tweet: 'Someone big wants financials. A 4.2M-share block printed in $XLF above VWAP — institutional money leaning into the risk-on, steeper-curve trade. One block is a hint; watch for the pattern. $JPM $BAC' },
  { cat: 'Earnings', time: '8:58a', headline: 'ZIM jumps 10% on a blowout and reinstated dividend',
    tweet: '$ZIM popped 10% on a blowout quarter and a reinstated dividend as freight rates spiked. Higher rates flow straight to shipper margins — the only question is how long the spike lasts.' },
  { cat: 'Macro', time: '10:18a', headline: '10-year yield slides to 4.32%',
    tweet: 'The 10-year slid to 4.32% as the soft CPI did its work. Lower long-end yields = easier financial conditions = a tailwind for everything risk-on. Watch the next auction for follow-through. $TLT $SPY' },
];

const NEWS_WEEKLY: NewsItem[] = [
  { cat: 'Macro', time: 'Mon–Fri', headline: 'Cooler inflation drove a risk-on week',
    tweet: 'Inflation was THE story this week. A cooler CPI reset rate-cut bets and powered a 4-of-5-day advance. $SPY +1.84%, growth led, and the 10-year fell 14bps. Disinflation is back on track. $QQQ' },
  { cat: 'Sectors', time: 'Wk', headline: 'Semis led — and the leadership broadened',
    tweet: 'Semis led AND broadened. $NVDA ran +12% but the move spread to $AVGO, $MU and $SMCI (+18%) — exactly the kind of participation bulls want to see. Not a one-name rally. $SMH' },
  { cat: 'Earnings', time: 'Wk', headline: 'ZIM ripped +22% on a blowout and a dividend',
    tweet: '$ZIM stole the earnings tape, +22% on a blowout quarter and a reinstated dividend. $SMCI ran too; $WBA lagged on guidance. Freight strength is real — durability is the debate.' },
  { cat: 'Analyst', time: 'Wk', headline: 'The sell-side warmed up on software',
    tweet: 'The Street warmed up on software. $CRM to Overweight ($340) was the third constructive call of the week. A cluster of upgrades usually front-runs a sentiment shift. $IGV' },
  { cat: 'Flows', time: 'Wk', headline: 'Money rotated into cyclicals and financials',
    tweet: 'Money rotated risk-on. Cyclicals and financials ($XLF) drew flows while defensives ($XLU, $XLP) lagged all week. Rotation plus falling vol is a classic risk-on tell.' },
  { cat: 'Macro', time: 'Wk', headline: 'Volatility melted into the weekend',
    tweet: 'Volatility melted. The $VIX fell ~12% to the low end of its range — calm tape, cheap hedging. A sensible window to protect gains rather than chase them.' },
];

const DAILY_LEAD = "Stocks closed broadly higher as a cooler-than-expected May CPI revived September rate-cut hopes. Megacap tech and semiconductors led, NVDA's beat-and-raise was the spark, and breadth was firmly positive while volatility eased.";
const WEEKLY_LEAD = "A decisively risk-on week. Cooler May inflation revived rate-cut bets and drove a broad, four-of-five-session advance led by growth and semis — leadership broadened well beyond $NVDA, while defensives lagged and volatility compressed into Friday.";

// ---- Inline ticker parser ----
function stockifyText(text: string): React.ReactNode {
  const parts = text.split(/(\$[A-Z]{1,6})\b/);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\$([A-Z]{1,6})$/);
        if (m) {
          return <span key={i} className="nb-stk"><b>{m[1]}</b></span>;
        }
        return part;
      })}
    </>
  );
}


// ---- News briefing newspaper ----
function NewsBriefing({ mode, dateLabel, onDownload, headline }: { mode: 'today' | 'week'; dateLabel: string; onDownload: () => void; headline?: string }) {
  const data = mode === 'week' ? NEWS_WEEKLY : NEWS_DAILY;
  const lead = mode === 'week' ? WEEKLY_LEAD : DAILY_LEAD;
  const half = Math.ceil(data.length / 2);
  const page1 = data.slice(0, half);
  const page2 = data.slice(half);

  function share(net: string) {
    const text = mode === 'week'
      ? 'Market News Briefing — This Week: Risk-on tape, semis broadened, VIX fell. Full briefing:'
      : 'Market News Briefing — Today: Cooler CPI sparked a risk-on rally. NVDA beat and raised (+8.2%), chips led +3.1%. Full briefing:';
    const url = 'https://finapp26.com/briefing';
    const eT = encodeURIComponent(text);
    const eU = encodeURIComponent(url);
    const eTU = encodeURIComponent(text + ' ' + url);
    const dest: Record<string, string> = {
      x:  `https://twitter.com/intent/tweet?text=${eT}&url=${eU}`,
      li: `https://www.linkedin.com/feed/?shareActive=true&text=${eTU}`,
      wa: `https://wa.me/?text=${eTU}`,
      fb: `https://www.facebook.com/sharer/sharer.php?u=${eU}&quote=${eT}`,
      tg: `https://t.me/share/url?url=${eU}&text=${eT}`,
    };
    if (dest[net]) window.open(dest[net], '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="rcp-carousel-wrap">
      {headline && (
        <div style={{
          fontSize: "1.35rem", fontWeight: 700, color: "var(--text-hi)",
          fontFamily: "var(--f-display)", letterSpacing: "-.3px", lineHeight: 1.25,
          marginBottom: 16,
        }}>
          {headline}
        </div>
      )}
      <div className="nb-head">
        <div>
          <div className="eyebrow">{mode === 'week' ? 'This week' : 'Today'} · news briefing</div>
          <span style={{ fontSize: '.72rem', color: 'var(--text-dim-solid)' }}>
            {dateLabel} · plain-text market briefing you can download or share
          </span>
        </div>
        <div className="nb-actions">
          <button className="btn primary" onClick={onDownload}>
            {DL_ICON} Download PDF
          </button>
          <div className="nb-socials">
            <button className="nb-soc x" title="Share on X" onClick={() => share('x')}>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2H21.5l-7.5 8.57L23 22h-6.844l-5.36-6.94L4.66 22H1.4l8.02-9.17L1 2h7.02l4.84 6.32L18.244 2Zm-1.2 18h1.9L7.04 3.9H5.0L17.044 20Z" /></svg>
            </button>
            <button className="nb-soc li" title="Share on LinkedIn" onClick={() => share('li')}>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5A2.5 2.5 0 1 1 0 3.5a2.5 2.5 0 0 1 4.98 0ZM.5 8h4V24h-4V8Zm7 0h3.84v2.18h.05c.54-1.02 1.85-2.1 3.8-2.1 4.06 0 4.81 2.67 4.81 6.14V24h-4v-7.1c0-1.7-.03-3.88-2.36-3.88-2.36 0-2.72 1.84-2.72 3.75V24h-4V8Z" /></svg>
            </button>
            <button className="nb-soc wa" title="Share on WhatsApp" onClick={() => share('wa')}>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2a9.93 9.93 0 0 0-8.43 15.2L2 22l4.9-1.28A9.93 9.93 0 1 0 12.04 2Zm5.8 14.06c-.24.68-1.4 1.3-1.94 1.34-.5.05-.97.23-3.26-.68-2.74-1.08-4.48-3.88-4.62-4.06-.13-.18-1.1-1.46-1.1-2.78s.7-1.98.94-2.25c.24-.27.53-.34.7-.34l.5.01c.16.01.38-.06.6.46.23.55.77 1.9.84 2.03.07.14.11.3.02.48-.09.18-.13.3-.27.46l-.4.46c-.13.13-.27.28-.12.54.16.27.7 1.14 1.5 1.85 1.03.92 1.9 1.2 2.17 1.34.27.13.42.11.58-.07.16-.18.66-.77.84-1.04.18-.27.36-.22.6-.13.25.09 1.57.74 1.84.88.27.13.45.2.52.31.07.11.07.65-.17 1.33Z" /></svg>
            </button>
            <button className="nb-soc fb" title="Share on Facebook" onClick={() => share('fb')}>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z" /></svg>
            </button>
            <button className="nb-soc tg" title="Share on Telegram" onClick={() => share('tg')}>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 3 2.5 10.6c-.9.36-.9.86-.16 1.08l4.98 1.55 1.9 5.9c.24.66.43.92.88.92.45 0 .64-.2.88-.45l2.4-2.33 4.98 3.68c.92.5 1.57.24 1.8-.85L22.9 4.4c.33-1.34-.5-1.95-1.38-1.55Zm-3.1 3.1-8.6 7.78-.34 3.6-1.7-5.3 10.3-6.46c.46-.28.88-.13.34.38Z" /></svg>
            </button>
          </div>
        </div>
      </div>

      <div className="nb-spread">
        <div className="nb-page">
          <span className="nb-pageno">1 / 2</span>
          <div className="nb-doctitle">{mode === 'week' ? 'Weekly' : 'Daily'} Market News Briefing</div>
          <div className="nb-docdate">{dateLabel}</div>
          <p className="nb-lead">{stockifyText(lead)}</p>
          {page1.map((item, i) => (
            <p key={i} className="nb-p">{stockifyText(item.tweet)}</p>
          ))}
        </div>
        <div className="nb-page">
          <span className="nb-pageno">2 / 2</span>
          {page2.map((item, i) => (
            <p key={i} className="nb-p">{stockifyText(item.tweet)}</p>
          ))}
          <div className="nb-foot">AI-generated market briefing · informational only, not investment advice.</div>
        </div>
      </div>
    </div>
  );
}

// ---- Schedule & share card ----

// ---- Utilities ----
function heatColor(v: number): string {
  const a = Math.min(Math.abs(v) / 2.2, 1);
  if (v >= 0) return `rgba(47,230,166,${(0.15 + a * 0.6).toFixed(2)})`;
  return `rgba(255,84,112,${(0.15 + a * 0.6).toFixed(2)})`;
}

const DL_ICON = (
  <svg viewBox="0 0 24 24" fill="none" style={{ width: 13, height: 13 }}>
    <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const STAR_SVG = (
  <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16 }}>
    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9z" fill="currentColor" />
  </svg>
);

// ---- Main screen ----
export function RecapScreen() {
  const router = useRouter();
  const { openStock, openSector } = useIQActions();
  const [activeTab, setActiveTab] = useState(0);
  const [recapPage, setRecapPage] = useState(0);
  const [drawer, setDrawer] = useState<"earn-movers" | "internals" | null>(null);

  const { data: recaps } = useApiList<RecapDoc>("/market-data/recaps");
  const recap = [...recaps].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const { data: sectorsLive } = useApiList<SectorApiDoc>("/market-data/sectors");
  const sectorRows = sectorsLive.filter(s => s.pctChange != null);
  const SEC_PAGES = Math.max(1, Math.ceil(sectorRows.length / SEC_PAGE));
  const recapMovers = recap
    ? [...recap.topGainers.map(m => ({ ...m, reason: "Top gainer" })), ...recap.topLosers.map(m => ({ ...m, reason: "Top loser" }))]
        .filter(m => m.pctChange != null)
    : [];
  const recapInternals = buildInternals(recap?.internals ?? null);

  const pageStart = recapPage * SEC_PAGE;
  const pageSectors = sectorRows.slice(pageStart, pageStart + SEC_PAGE);

  function downloadRecap(which: string) {
    const blob = new Blob([`MarketCatalyst ${which} Recap — ${recap?.date ?? ""}`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `MarketCatalyst-Recap-${which}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Reusable cards ----

  const SectorHeatCard = (_paginated: boolean, weeklyScale: boolean) => (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <h3>{weeklyScale ? "Sector heatmap · weekly performance" : "Sector heatmap"}</h3>
        <span className="link" onClick={() => router.push("/menu/heatmap")}>View all →</span>
      </div>
      <div className="card-b">
        <div className="heat">
          {pageSectors.map(s => (
            <div key={s.sector} className="s"
              style={{ background: heatColor(weeklyScale ? (s.pctChange ?? 0) * 5 : (s.pctChange ?? 0)), cursor: "pointer" }}
              onClick={() => openSector(s.sector)}>
              <div className="nm">{s.sector}</div>
              <div className="v">{weeklyScale ? `${arr(s.pctChange ?? 0)}${sign(s.pctChange ?? 0)}` : sign(s.pctChange ?? 0)}</div>
            </div>
          ))}
          {pageSectors.length === 0 && (
            <div style={{ fontSize: ".82rem", color: "var(--text-dim-solid)", padding: "8px 0" }}>No sector data available yet.</div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 9, fontSize: ".74rem" }}>
          <span style={{ color: "var(--text-dim-solid)" }}>
            Sectors {pageStart + 1}–{Math.min(pageStart + SEC_PAGE, sectorRows.length)} of {sectorRows.length} · click one to open it in the heatmap
          </span>
          <span style={{ display: "flex", gap: 14 }}>
            {recapPage > 0 && (
              <span className="link" onClick={() => setRecapPage(p => p - 1)}>← Previous 10</span>
            )}
            <span className="link" onClick={() => setRecapPage(p => (p + 1) % SEC_PAGES)}>
              {recapPage < SEC_PAGES - 1 ? "Show next 10 →" : "Back to first 10 ↺"}
            </span>
          </span>
        </div>
      </div>
    </div>
  );

  const BottomDash = (
    <div className="dash" style={{ marginTop: 14, padding: "0 0 14px" }}>
      <div className="col-6">
        <div className="card">
          <div className="card-h">
            <h3>Biggest earnings movers</h3>
            <button className="link" onClick={() => router.push("/menu/earnings")}>View all →</button>
          </div>
          <div className="card-b" style={{ paddingTop: 6 }}>
            {recapMovers.map(m => (
              <div key={m.ticker} className="minirow" style={{ cursor: "pointer" }} onClick={() => openStock(m.ticker)}>
                <StockLogo sym={m.ticker} size={20} />
                <span className="tkr">{m.ticker}</span>
                <span className="mid">{m.reason}</span>
                <span className={`r ${cls(m.pctChange ?? 0)}`}>{sign(m.pctChange ?? 0)}</span>
              </div>
            ))}
            {recapMovers.length === 0 && (
              <div style={{ fontSize: ".82rem", color: "var(--text-dim-solid)" }}>No mover data available yet.</div>
            )}
          </div>
        </div>
      </div>
      <div className="col-6">
        <div className="card">
          <div className="card-h">
            <h3>Market internals</h3>
            <button className="link" onClick={() => router.push("/menu/movers")}>View all →</button>
          </div>
          <div className="card-b" style={{ paddingTop: 6 }}>
            {recapInternals.map(r => (
              <div key={r.label} className="minirow">
                <span className="mid">{r.label}</span>
                <span className={`r ${r.direction > 0 ? "up" : r.direction < 0 ? "down" : ""}`}>{r.value}</span>
              </div>
            ))}
            {recapInternals.length === 0 && (
              <div style={{ fontSize: ".82rem", color: "var(--text-dim-solid)" }}>No internals data available yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* ── Page head ── */}
      <div className="page-head">
        <div>
          <h1 className="page-title">{activeTab === 1 ? "Weekly Recap" : "End-of-Day Recap"}</h1>
        </div>
        <div className="tabs">
          {TABS.map((t, i) => (
            <button key={t} className={`tab${i === activeTab ? " active" : ""}`}
              onClick={() => setActiveTab(i)}>{t}</button>
          ))}
        </div>
      </div>

      {/* ── Today (EOD) ── */}
      {activeTab === 0 && (
        <div style={{ padding: "14px 18px 18px" }}>
         <div className="recap-hero">
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14 }}>
              <div className="wmn-orb">{STAR_SVG}</div>
              <div onClick={() => downloadRecap("today")}
                title="Open the full executive summary (PDF)"
                style={{ cursor: "pointer", fontFamily: "var(--f-display)", fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>
                {buildHeadline(recap)}{" "}
                <span style={{ fontSize: ".7rem", color: "var(--brand-2)", fontWeight: 600 }}>→ open PDF</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
              {(recap?.indices ?? []).filter(idx => idx.pctChange != null).map(idx => {
                const { bg, fg } = heatCol(idx.pctChange!);
                return (
                  <div key={idx.label} style={{
                    background: bg, borderRadius: 10, padding: "8px 14px", minWidth: 90,
                  }}>
                    <div style={{ fontSize: ".68rem", color: fg, opacity: 0.8, marginBottom: 3 }}>{idx.label}</div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700, fontFamily: "var(--f-mono)", color: fg }}>
                      {arr(idx.pctChange!)}{sign(idx.pctChange!)}
                    </div>
                  </div>
                );
              })}
              <div style={{ marginLeft: "auto" }}>
                <button className="btn ai">
                  <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
                    <path d="M8 5v14l11-7z" fill="currentColor" />
                  </svg>
                  60-sec audio recap
                </button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", fontWeight: 600, letterSpacing: ".03em" }}>
                DOWNLOAD PDF:
              </span>
              <button className="btn" onClick={() => downloadRecap("today")}>{DL_ICON} Today (EOD)</button>
              <button className="btn" onClick={() => downloadRecap("yesterday")}>{DL_ICON} Yesterday</button>
              <button className="btn" onClick={() => downloadRecap("week")}>{DL_ICON} Last week</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 14 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div className="eyebrow">Key stories</div>
                  <span className="link" onClick={() => router.push("/menu/commentary")}>View all →</span>
                </div>
                {buildStories(recap).map((s, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, padding: "6px 0", fontSize: ".84rem" }}>
                    <span className="bullet" style={{ marginTop: 6, flexShrink: 0 }} />
                    <span>{s}</span>
                  </div>
                ))}
                {buildStories(recap).length === 0 && (
                  <div style={{ fontSize: ".82rem", color: "var(--text-dim-solid)" }}>No stories available yet.</div>
                )}
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div className="eyebrow">Up next · tomorrow</div>
                  <span className="link" onClick={() => router.push("/menu/macro")}>View all →</span>
                </div>
                <div style={{ fontSize: ".82rem", color: "var(--text-dim-solid)" }}>
                  Economic calendar isn&apos;t available from the live data feed yet — check the Macro tab.
                </div>
              </div>
            </div>
          </div>
 <NewsBriefing
            mode="today"
            dateLabel={recap?.date ?? "—"}
            onDownload={() => downloadRecap("today")}
            />
          {SectorHeatCard(true, false)}
          {BottomDash}
        </div>
      )}

      {/* ── This Week ── */}
      {activeTab === 1 && (
        <div style={{ padding: "14px 18px 18px" }}>
          <div className="recap-hero">
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14 }}>
              <div className="wmn-orb">{STAR_SVG}</div>
              <div onClick={() => downloadRecap("this-week")}
                title="Open the full executive summary (PDF)"
                style={{ cursor: "pointer", fontFamily: "var(--f-display)", fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>
                {WEEKLY.headline}{" "}
                <span style={{ fontSize: ".7rem", color: "var(--brand-2)", fontWeight: 600 }}>→ open PDF</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
              {WEEKLY.indices.map(idx => {
                const { bg, fg } = heatCol(idx.value);
                return (
                  <div key={idx.label} style={{
                    background: bg, borderRadius: 10, padding: "8px 14px", minWidth: 90,
                  }}>
                    <div style={{ fontSize: ".68rem", color: fg, opacity: 0.8, marginBottom: 3 }}>{idx.label}</div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700, fontFamily: "var(--f-mono)", color: fg }}>
                      {arr(idx.value)}{sign(idx.value)}
                    </div>
                  </div>
                );
              })}
              <div style={{ marginLeft: "auto" }}>
                <button className="btn ai">
                  <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
                    <path d="M8 5v14l11-7z" fill="currentColor" />
                  </svg>
                  60-sec audio recap
                </button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", fontWeight: 600, letterSpacing: ".03em" }}>
                DOWNLOAD PDF:
              </span>
              <button className="btn" onClick={() => downloadRecap("this-week")}>{DL_ICON} This Week</button>
              <button className="btn" onClick={() => downloadRecap("last-week")}>{DL_ICON} Last Week</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 14 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div className="eyebrow">Key stories</div>
                  <span className="link" onClick={() => router.push("/menu/commentary")}>View all →</span>
                </div>
                {WEEKLY.stories.map((s, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, padding: "6px 0", fontSize: ".84rem" }}>
                    <span className="bullet" style={{ marginTop: 6, flexShrink: 0 }} />
                    <span>{s}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div className="eyebrow">Up next · next week</div>
                  <span className="link" onClick={() => router.push("/menu/macro")}>View all →</span>
                </div>
                {WEEKLY.nextWeek.map((t, i) => (
                  <div key={i} className="minirow">
                    <span className="mono" style={{ width: 36, color: "var(--warn)" }}>{t.time}</span>
                    <span className="mid">{t.event}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>


          <div className="dash" style={{ marginTop: 14, padding: 0 }}>
            <div className="col-6">
              <div className="card">
                <div className="card-h"><h3>Sector leaders</h3><span className="pill up">Week</span></div>
                <div className="card-b" style={{ paddingTop: 6 }}>
                  {WEEKLY.sectorLeaders.map(s => (
                    <div key={s.name} className="minirow" style={{ cursor: "pointer" }} onClick={() => openSector(s.name)}>
                      <span className="mid">{s.name}</span>
                      <span className={`r ${cls(s.pctChange)}`}>{sign(s.pctChange)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="col-6">
              <div className="card">
                <div className="card-h"><h3>Sector laggards</h3><span className="pill dn">Week</span></div>
                <div className="card-b" style={{ paddingTop: 6 }}>
                  {WEEKLY.sectorLaggards.map(s => (
                    <div key={s.name} className="minirow" style={{ cursor: "pointer" }} onClick={() => openSector(s.name)}>
                      <span className="mid">{s.name}</span>
                      <span className={`r ${cls(s.pctChange)}`}>{sign(s.pctChange)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <h3>Biggest movers this week</h3>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>5-day</span>
            </div>
            <div className="card-b" style={{ paddingTop: 6 }}>
              {WEEKLY.biggestMoves.map(m => (
                <div key={m.ticker} className="minirow" style={{ cursor: "pointer" }} onClick={() => openStock(m.ticker)}>
                  <StockLogo sym={m.ticker} size={20} />
                  <span className="tkr">{m.ticker}</span>
                  <span className="mid" style={{ fontSize: ".75rem" }}>{m.reason}</span>
                  <span className={`r ${cls(m.pctChange)}`}>{sign(m.pctChange)}</span>
                </div>
              ))}
            </div>
          </div>
   <NewsBriefing
            mode="week"
            dateLabel={`Week of ${WEEKLY.range}`}
            onDownload={() => downloadRecap("this-week")}
          />
          {SectorHeatCard(true, true)}
          {BottomDash}
        </div>
      )}

      {/* ── Sliding drawer ── */}
      {drawer && (
        <>
          <div className="scrim" onClick={() => setDrawer(null)} />
          <div className="side-drawer">
            <div className="drawer-h">
              <div style={{ flex: 1 }}>
                <div className="drawer-title">
                  {drawer === "earn-movers" ? "Biggest Earnings Movers" : "Market Internals"}
                </div>
                <div className="drawer-sub">
                  {drawer === "earn-movers"
                    ? "Post-earnings reactions ranked by magnitude"
                    : "Breadth, volume & sentiment indicators"}
                </div>
              </div>
              <button className="closebtn" onClick={() => setDrawer(null)}>✕</button>
            </div>
            <div className="drawer-b">
              {drawer === "earn-movers" && (
                <>
                  {recapMovers.map(m => (
                    <div key={m.ticker} className="minirow" style={{ cursor: "pointer", padding: "8px 0" }}
                      onClick={() => { openStock(m.ticker); setDrawer(null); }}>
                      <StockLogo sym={m.ticker} size={22} />
                      <span className="tkr">{m.ticker}</span>
                      <span className="mid">{m.reason}</span>
                      <span className={`r mono ${cls(m.pctChange ?? 0)}`} style={{ fontWeight: 700 }}>{sign(m.pctChange ?? 0)}</span>
                    </div>
                  ))}
                  {recapMovers.length === 0 && (
                    <div style={{ fontSize: ".82rem", color: "var(--text-dim-solid)", padding: "8px 0" }}>No mover data available yet.</div>
                  )}
                </>
              )}
              {drawer === "internals" && (
                <>
                  {recap?.internals?.advancers != null && recap.internals.decliners != null && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".8rem", marginBottom: 6 }}>
                        <span className="up mono" style={{ fontWeight: 700 }}>▲ {recap.internals.advancers} advancing</span>
                        <span className="down mono" style={{ fontWeight: 700 }}>▼ {recap.internals.decliners} declining</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 4, background: "var(--surface-3)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.round((recap.internals.advancers / (recap.internals.advancers + recap.internals.decliners || 1)) * 100)}%`, background: "var(--up)", borderRadius: 4 }} />
                      </div>
                      {recap.internals.decliners > 0 && (
                        <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 4 }}>
                          A/D Ratio: {(recap.internals.advancers / recap.internals.decliners).toFixed(2)} · NYSE + NASDAQ composite
                        </div>
                      )}
                    </div>
                  )}
                  {recapInternals.map(r => (
                    <div key={r.label} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "10px 14px", marginBottom: 6,
                      background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 10,
                    }}>
                      <span style={{ fontSize: ".82rem", color: "var(--text)" }}>{r.label}</span>
                      <span className={`mono ${r.direction > 0 ? "up" : r.direction < 0 ? "down" : ""}`}
                        style={{ fontWeight: 700, fontSize: ".9rem" }}>{r.value}</span>
                    </div>
                  ))}
                  <div style={{ height: 1, background: "var(--border)", margin: "12px 0 10px" }} />
                  <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
                    Extended breadth data
                  </div>
                  {[
                    { label: "NYSE TICK",      value: "+420",  direction:  1 },
                    { label: "TRIN (Arms)",    value: "0.74",  direction:  1 },
                    { label: "McClellan Osc",  value: "+38.5", direction:  1 },
                    { label: "Put/Call Ratio", value: "0.82",  direction:  0 },
                    { label: "New 52W Highs",  value: "184",   direction:  1 },
                    { label: "New 52W Lows",   value: "39",    direction: -1 },
                  ].map(r => (
                    <div key={r.label} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "10px 14px", marginBottom: 6,
                      background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 10,
                    }}>
                      <span style={{ fontSize: ".82rem", color: "var(--text)" }}>{r.label}</span>
                      <span className={`mono ${r.direction > 0 ? "up" : r.direction < 0 ? "down" : ""}`}
                        style={{ fontWeight: 700, fontSize: ".9rem" }}>{r.value}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
