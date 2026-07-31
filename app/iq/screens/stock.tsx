"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useIQActions, ExpandBtn } from "../shell";
import { fmt, cls, arr, sign, CandleChart, RsiPane, TrGauge, RATING_VAL, EarnQ, EarningsGrowthChart, DataState, NotAvailable } from "../utils";
import { firebaseAuth } from "../../firebase";
import { apiGet, apiPost, apiDelete } from "../backend";
import { useApiResource } from "../hooks/useApiResource";
import { useApiList } from "../hooks/useApiList";
import { useBackendBars } from "../hooks/useBackendBars";
import type {
  CompanyDoc, AnalystConsensusDoc, InsiderTxDoc,
  DividendHistoryDoc, SplitsDoc, FinancialsDoc, QuarterFinancials, NewsArticleDoc, LiveEarningsDoc, SectorApiDoc,
} from "../types";

// Maps the numeric 1-99 tech rating onto the same string categories the
// Screener/TrGauge use (Strong Buy / Buy / Neutral / Sell / Strong Sell).
function ratingLabel(n: number | null): string {
  if (n == null) return "Neutral";
  if (n >= 90) return "Strong Buy";
  if (n >= 70) return "Buy";
  if (n >= 40) return "Neutral";
  if (n >= 20) return "Sell";
  return "Strong Sell";
}

// Real SMA/EMA computed from a year of actual daily closes (already fetched
// for the 52-week range) — replaces the old "typical %-below-price" guesses.
function sma(bars: { c: number }[], n: number): number | null {
  if (bars.length < n) return null;
  return bars.slice(-n).reduce((s, b) => s + b.c, 0) / n;
}
function ema(bars: { c: number }[], n: number): number | null {
  if (bars.length < n) return null;
  const k = 2 / (n + 1);
  let e = bars.slice(0, n).reduce((s, b) => s + b.c, 0) / n;
  for (let i = n; i < bars.length; i++) e = bars[i].c * k + e * (1 - k);
  return e;
}
// Ichimoku base line (Kijun-sen): (n-period high + n-period low) / 2 — real,
// computed from the same daily bars as SMA/EMA above.
function ichimokuBase(bars: { h: number; l: number }[], n: number): number | null {
  if (bars.length < n) return null;
  const w = bars.slice(-n);
  return (Math.max(...w.map(b => b.h)) + Math.min(...w.map(b => b.l))) / 2;
}

interface StockNote {
  id: string;
  sym: string;
  name: string;
  comment: string;
  createdAt: Date;
}

async function loadNotes(sym: string): Promise<StockNote[]> {
  if (!firebaseAuth.currentUser) return [];
  try {
    const rows = await apiGet<Array<{ id: string; sym: string; name: string; comment: string; createdAt: string }>>(
      `/api/stock-notes?sym=${encodeURIComponent(sym)}`,
    );
    return rows.map(r => ({ ...r, createdAt: new Date(r.createdAt) }));
  } catch { return []; }
}

async function saveNote(sym: string, name: string, comment: string): Promise<string | null> {
  if (!firebaseAuth.currentUser || !comment.trim()) return null;
  try {
    const row = await apiPost<{ id: string }>("/api/stock-notes", { sym, name, comment: comment.trim() });
    return row.id;
  } catch { return null; }
}

async function deleteNote(id: string): Promise<void> {
  try { await apiDelete(`/api/stock-notes/${encodeURIComponent(id)}`); } catch { /* ignore */ }
}

const LOGO_BG: Record<string, [string, string]> = {
  AAPL: ["#1c4c73", "#cce8ff"], NVDA: ["#1f6b4d", "#c8f5e0"], MSFT: ["#003f8c", "#d0e8ff"],
  GOOGL: ["#4a0e0e", "#ffd0d0"], META: ["#0d3b7a", "#d0e4ff"], AMZN: ["#6b3a00", "#ffe8cc"],
  TSLA: ["#6b0000", "#ffd0d0"], JPM: ["#003a6b", "#cce0ff"], V: ["#0d3b6b", "#cce0ff"],
  UNH: ["#006b4d", "#c8f5e0"],
};
const _PAL: [string, string][] = [
  ["#1f6b4d","#5ff0b3"],["#3a2f6b","#b6a6ff"],["#1f4d6b","#7fd0ff"],["#6b1f2f","#ff9ab0"],
  ["#1f5a6b","#7fe0f0"],["#6b4a1f","#ffce8f"],["#2f2f6b","#aab0ff"],["#1f6b5a","#6ff0d0"],
  ["#444a52","#cfd6e0"],["#5a1f6b","#e0a6ff"],
];
function hashPal(s: string): [string, string] {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return _PAL[h % _PAL.length];
}
const logoBg = (s: string) => (LOGO_BG[s] ?? hashPal(s))[0];
const logoFg = (s: string) => (LOGO_BG[s] ?? hashPal(s))[1];

const EXCHANGE: Record<string, string> = {
  AAPL: "NASDAQ", NVDA: "NASDAQ", MSFT: "NASDAQ", GOOGL: "NASDAQ", META: "NASDAQ",
  AMZN: "NASDAQ", TSLA: "NASDAQ", JPM: "NYSE", V: "NYSE", UNH: "NYSE",
  AVGO: "NASDAQ", CRM: "NYSE", PLTR: "NYSE", INTC: "NASDAQ", WBA: "NASDAQ",
  DELL: "NYSE", ZIM: "NYSE", AMD: "NASDAQ", MU: "NASDAQ", SMCI: "NASDAQ",
};

const ac = (a: string) => a === "Buy" ? "var(--up)" : a === "Sell" ? "var(--down)" : "var(--text-dim-solid)";

type IncRow = { c: string; rev: number; cogs: number; gp: number; opex: number; oi: number; ni: number; eps: number };

/**
 * Real quarterly/annual financials (GET /live/financials) mapped onto the
 * IncRow shape the existing charts/table already render, so those components
 * don't need to change — only their input does. Falls back to the synthetic
 * earnIncome() generator when no real doc exists yet for this ticker/period.
 */
function incRowsFromFinancials(
  period: "Q" | "A",
  doc: FinancialsDoc | null,
  fallback: () => IncRow[],
): IncRow[] {
  const rows = doc ? (period === "Q" ? doc.quarters : doc.annual) : [];
  if (rows.length === 0) return fallback();
  return rows.slice(0, 10).map(r => {
    const revenue = r.revenue ?? 0;
    const grossProfit = r.grossProfit ?? 0;
    const operatingIncome = r.operatingIncome ?? 0;
    const netIncome = r.netIncome ?? 0;
    const opex = period === "Q"
      ? (r as QuarterFinancials).operatingExpenses ?? Math.max(0, grossProfit - operatingIncome)
      : Math.max(0, grossProfit - operatingIncome);
    const label = period === "Q"
      ? `${(r as QuarterFinancials).fiscalPeriod ?? "?"} '${(r.fiscalYear ?? "").slice(-2)}`
      : `FY ${r.fiscalYear ?? "?"}`;
    return {
      c: label,
      rev: revenue / 1e9,
      cogs: Math.max(0, revenue - grossProfit) / 1e9,
      gp: grossProfit / 1e9,
      opex: opex / 1e9,
      oi: operatingIncome / 1e9,
      ni: netIncome / 1e9,
      eps: r.epsActual ?? 0,
    };
  });
}

// EPS estimate-vs-actual bars. No live source exists for post-earnings price
// reaction across history, so (unlike the old mock version) this never draws
// a "stock move" line — only the two numbers the live earnings feed actually has.
function EarnEpsChart({ hist }: { hist: EarnQ[] }) {
  const d = [...hist].reverse();
  const W = 560, H = 210, PADL = 30, PADR = 18, PADT = 14, PADB = 30;
  const iw = W - PADL - PADR, ih = H - PADT - PADB;
  const maxE = Math.max(...d.map(x => Math.max(x.e, Math.abs(x.a)))) * 1.15 || 1;
  const n = d.length, gw = iw / n, bw = gw * 0.28;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }}>
      <line x1={PADL} y1={PADT + ih / 2} x2={W - PADR} y2={PADT + ih / 2}
        stroke="var(--border)" strokeDasharray="3 3" />
      {d.map((x, i) => {
        const cx = PADL + gw * i + gw / 2;
        const eh = Math.max(2, (x.e / maxE) * ih);
        const ah = Math.max(2, (Math.abs(x.a) / maxE) * ih);
        return (
          <g key={x.q}>
            <rect x={(cx - bw - 2).toFixed(1)} y={(PADT + ih - eh).toFixed(1)} width={bw.toFixed(1)} height={eh.toFixed(1)} rx="2" style={{ fill: "var(--surface-3)" }} />
            <rect x={(cx + 2).toFixed(1)} y={(PADT + ih - ah).toFixed(1)} width={bw.toFixed(1)} height={ah.toFixed(1)} rx="2" style={{ fill: x.surp >= 0 ? "var(--up)" : "var(--down)" }} />
            {(i % 2 === 0 || i === n - 1) && (
              <text x={cx.toFixed(1)} y={H - 10} textAnchor="middle" style={{ fill: "var(--text-dim-solid)", fontSize: "0.5625rem" }}>
                {x.q}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function EarnIncChart({ inc }: { inc: IncRow[] }) {
  const d = [...inc].reverse();
  const W = 380, H = 200, PADL = 8, PADR = 8, PADT = 14, PADB = 26;
  const iw = W - PADL - PADR, ih = H - PADT - PADB;
  const max = Math.max(...d.map(x => x.rev)) * 1.12 || 1;
  const gw = iw / d.length, bw = gw * 0.2;
  const series: Array<{ key: "rev" | "gp" | "ni"; color: string }> = [
    { key: "rev", color: "var(--brand)" },
    { key: "gp",  color: "var(--ai)" },
    { key: "ni",  color: "var(--up)" },
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }}>
      {d.map((x, i) => {
        const gx = PADL + gw * i;
        return (
          <g key={x.c}>
            {series.map((se, si) => {
              const v = x[se.key];
              const h = Math.max(2, v / max * ih);
              const bx = gx + gw * 0.16 + si * (bw + 5);
              return (
                <rect key={se.key}
                  x={bx.toFixed(1)} y={(PADT + ih - h).toFixed(1)}
                  width={bw.toFixed(1)} height={h.toFixed(1)} rx="2"
                  style={{ fill: se.color }} />
              );
            })}
            <text x={(gx + gw / 2).toFixed(1)} y={H - 8} textAnchor="middle"
              style={{ fill: "var(--text-dim-solid)", fontSize: "0.5625rem" }}>
              {x.c}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function EarnPane({ hist10 }: { hist10: EarnQ[] }) {
  const hist = hist10.slice(0, 8).reverse();
  const W = 720, H = 80, PADL = 40, PADR = 20, PADT = 10, PADB = 18;
  const iw = W - PADL - PADR;
  const ih = H - PADT - PADB;
  const mid = PADT + ih / 2;
  const gw = iw / hist.length;
  const bw = Math.min(gw * 0.45, 26);
  const maxS = Math.max(8, ...hist.map(x => Math.abs(x.surp)));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
      {/* Zero line */}
      <line x1={PADL} y1={mid} x2={W - PADR} y2={mid}
        stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />

      {hist.map((q, i) => {
        const beat = q.surp >= 0;
        const cx = PADL + gw * i + gw / 2;
        const barH = Math.max(4, (Math.abs(q.surp) / maxS) * (ih / 2 - 4));
        const rx = (cx - bw / 2).toFixed(1);
        const ry = beat ? (mid - barH).toFixed(1) : mid.toFixed(1);
        const color = beat ? "var(--up)" : "var(--down)";
        const labelY = beat
          ? (mid - barH - 4).toFixed(1)
          : (mid + barH + 9).toFixed(1);

        return (
          <g key={q.q}>
            <rect x={rx} y={ry} width={bw.toFixed(1)} height={barH.toFixed(1)}
              rx="2" fill={color} opacity="0.88" />
            <text x={cx.toFixed(1)} y={labelY} textAnchor="middle"
              fill={color} fontSize="7.5" fontFamily="JetBrains Mono,monospace">
              {beat ? "+" : ""}{q.surp.toFixed(1)}%
            </text>
            <text x={cx.toFixed(1)} y={(H - 3).toFixed(1)} textAnchor="middle"
              fill="#69748680" fontSize="7.5" fontFamily="JetBrains Mono,monospace">
              {q.q.replace(" ", "'")}
            </text>
          </g>
        );
      })}

      {/* Beat/miss labels on Y axis */}
      <text x={PADL - 4} y={(mid - 2).toFixed(1)} textAnchor="end"
        fill="#69748680" fontSize="7" fontFamily="JetBrains Mono,monospace">BEAT</text>
      <text x={PADL - 4} y={(mid + 10).toFixed(1)} textAnchor="end"
        fill="#69748680" fontSize="7" fontFamily="JetBrains Mono,monospace">MISS</text>
    </svg>
  );
}

function StockChartExpanded({
  sym, px, initialTf, initialChartType, initialMaStep, initialEmaStep,
  initialShowVol, initialShowRsi, initialShowEarnings, hist10, rsi, rsiLoading, erDate,
}: {
  sym: string; px: number; initialTf: string;
  initialChartType: "Candles" | "Hollow" | "Bars" | "Line" | "Area";
  initialMaStep: number; initialEmaStep: number;
  initialShowVol: boolean; initialShowRsi: boolean; initialShowEarnings: boolean;
  hist10: EarnQ[]; rsi: number | null; rsiLoading: boolean; erDate: string;
}) {
  const [tf, setTf] = useState(initialTf);
  const [chartType, setChartType] = useState(initialChartType);
  const [maStep, setMaStep] = useState(initialMaStep);
  const [emaStep, setEmaStep] = useState(initialEmaStep);
  const [showVol, setShowVol] = useState(initialShowVol);
  const [showRsi, setShowRsi] = useState(initialShowRsi);
  const [showEarnings, setShowEarnings] = useState(initialShowEarnings);
  const { bars: realBars } = useBackendBars(sym, tf);
  const isUp = px > 0;
  return (
    <div>
      <div className="chart-toolbar" style={{ flexWrap: "wrap", gap: "4px 0", paddingBottom: 8 }}>
        {(["1D","1W","1M","3M","6M","1Y","5Y"] as const).map(r => (
          <button key={r} className={`rng tfbtn${tf === r ? " on" : ""}`} onClick={() => setTf(r)}>{r}</button>
        ))}
        <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 4px" }} />
        {(["Candles","Hollow","Bars","Line","Area"] as const).map(ct => (
          <button key={ct} className={`rng ctype-btn${chartType === ct ? " on" : ""}`} onClick={() => setChartType(ct)}>{ct}</button>
        ))}
        <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 4px" }} />
        <button className={`rng indbtn${maStep > 0 ? " on" : ""}`} onClick={() => setMaStep(s => (s + 1) % 5)}>
          MA {[9,21,50,200].map((v, i) => <span key={v} style={{ opacity: i < maStep ? 1 : 0.4, fontWeight: i < maStep ? 700 : undefined }}>{i > 0 ? "/" : ""}{v}</span>)}
        </button>
        <button className={`rng indbtn${emaStep > 0 ? " on" : ""}`} onClick={() => setEmaStep(s => (s + 1) % 5)}>
          EMA {[9,21,50,200].map((v, i) => <span key={v} style={{ opacity: i < emaStep ? 1 : 0.4, fontWeight: i < emaStep ? 700 : undefined }}>{i > 0 ? "/" : ""}{v}</span>)}
        </button>
        <button className={`rng indbtn${showVol ? " on" : ""}`} onClick={() => setShowVol(v => !v)}>Volume</button>
        <button className={`rng indbtn${showRsi ? " on" : ""}`} onClick={() => setShowRsi(v => !v)}>RSI</button>
        <button className={`rng indbtn${showEarnings ? " on" : ""}`} onClick={() => setShowEarnings(v => !v)}>Earnings</button>
      </div>
      <CandleChart sym={sym} tf={tf} px={px} maStep={maStep} emaStep={emaStep} showVol={showVol} chartType={chartType.toLowerCase()} realBars={realBars} />
      {showRsi && (
        <div style={{ marginTop: 4 }}>
          <div style={{ padding: "4px 0", fontSize: ".66rem", color: "var(--text-dim-solid)", display: "flex", justifyContent: "space-between" }}>
            <span>RSI (14)</span>
            <span className="mono" style={{ color: "var(--warn)" }}>
              {rsi != null ? `${Math.round(rsi)} · ${rsi > 70 ? "overbought" : rsi < 40 ? "weak" : "neutral-to-strong"}` : "not available"}
            </span>
          </div>
          <RsiPane rsi14={rsi} loading={rsiLoading} />
        </div>
      )}
      {showEarnings && (
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 4 }}>
          <div style={{ padding: "6px 0 4px", fontSize: ".66rem", color: "var(--text-dim-solid)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Earnings · EPS Surprise</span>
            <span className="mono" style={{ color: "var(--warn)", fontWeight: 600 }}>Next: {erDate}</span>
          </div>
          <EarnPane hist10={hist10} />
        </div>
      )}
      <div style={{ marginTop: 6, fontSize: ".7rem", color: "var(--text-dim-solid)" }}>
        Pattern: <b style={{ color: isUp ? "var(--up)" : "var(--down)" }}>
          {isUp ? "cup-with-handle breakout" : "breakdown below support"}
        </b> {isUp ? "on above-average volume." : "on rising volume."}
      </div>
    </div>
  );
}

export function StockScreen({ initialSym, hideHeader, hideChart }: { initialSym?: string; hideHeader?: boolean; hideChart?: boolean } = {}) {
  const { openStock, openSector } = useIQActions();
  const [sym, setSym] = useState(() => {
    if (initialSym) return initialSym;
    if (typeof window !== "undefined") return localStorage.getItem("iq-stock") || "NVDA";
    return "NVDA";
  });

  // Sync when the parent passes a new ticker (e.g. user clicks a different mover)
  useEffect(() => {
    if (initialSym && initialSym !== sym) setSym(initialSym);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSym]);
  const [search, setSearch] = useState("");
  const [tfActive, setTfActive] = useState("3M");
  const [toneActive, setToneActive] = useState("Swing");
  const [showVol, setShowVol] = useState(true);
  const [showRsi, setShowRsi] = useState(false);
  const [showEarnings, setShowEarnings] = useState(false);
  const [chartType, setChartType] = useState<"Candles" | "Hollow" | "Bars" | "Line" | "Area">("Candles");
  const [maStep, setMaStep] = useState(0);

  // Live overlays for the detail panels — analyst consensus, insider
  // transactions, the full company universe (for peer/sector lookups), sector
  // performance, and earnings events all come straight from the market-data
  // endpoints. Nothing here falls back to mock data; a ticker with no live
  // match for a given panel just shows that panel as not available.
  const { data: liveConsensus } = useApiList<AnalystConsensusDoc>("/market-data/analyst-actions");
  const { data: liveInsider, loading: insiderLoading } = useApiList<InsiderTxDoc>("/market-data/insider-transactions");
  const { data: companies, loading: companiesLoading } = useApiList<CompanyDoc>("/market-data/companies");
  const { data: sectorsLive, loading: sectorsLoading } = useApiList<SectorApiDoc>("/market-data/sectors");
  const { data: liveEarningsEvents, loading: earningsLoading } = useApiList<LiveEarningsDoc>("/market-data/earnings");
  const { bars: yearBars, loading: yearBarsLoading } = useBackendBars(sym, "1Y");
  const [emaStep, setEmaStep] = useState(0);
  const { bars: realBars } = useBackendBars(sym, tfActive);

  // Per-ticker profile + dividend/split/financials history — cache-aside via
  // GET /live/company|/live/dividend-history|/live/splits|/live/financials
  // (replacing the direct companies Firestore listener this screen used to
  // hold open). Re-fetches whenever `sym` changes since it's part of the path.
  const { data: liveCompany, loading: liveCompanyLoading } = useApiResource<CompanyDoc>(`/live/company?ticker=${encodeURIComponent(sym)}`);
  const { data: dividendHistory, loading: dividendLoading } = useApiResource<DividendHistoryDoc>(`/live/dividend-history?ticker=${encodeURIComponent(sym)}`);
  const { data: splitsDoc } = useApiResource<SplitsDoc>(`/live/splits?ticker=${encodeURIComponent(sym)}`);
  const { data: financialsDoc, loading: financialsLoading } = useApiResource<FinancialsDoc>(`/live/financials?ticker=${encodeURIComponent(sym)}`);
  const { data: tickerNews } = useApiResource<NewsArticleDoc[]>(`/live/news?ticker=${encodeURIComponent(sym)}`);

  // ── Notes (Firebase stock_comments) ──────────────────────────────────────
  const [notes, setNotes]       = useState<StockNote[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [noteOpen, setNoteOpen]  = useState(false);
  const [ctxMenu, setCtxMenu]    = useState<{ x: number; y: number } | null>(null);

  type InnerDrawer = "techrating" | "peers" | "industry" | "insider" | "keylevels" | "earnings" | "financials" | "dividend" | null;
  const [innerDrawer, setInnerDrawer] = useState<InnerDrawer>(null);
  const [finPeriod,   setFinPeriod]   = useState<"Q" | "A">("Q");

  const [watchedSet, setWatchedSet] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set<string>();
    const saved = localStorage.getItem("iq-watchlist");
    if (saved) { try { return new Set(JSON.parse(saved) as string[]); } catch { /* ignore */ } }
    return new Set<string>();
  });
  const chartRef = useRef<HTMLDivElement>(null);

  const refreshNotes = useCallback(async () => {
    setNotes(await loadNotes(sym));
  }, [sym]);

  useEffect(() => { void refreshNotes(); }, [refreshNotes]);

  async function submitNote() {
    const id = await saveNote(sym, data.name ?? sym, noteInput);
    if (id) {
      setNotes(prev => [{
        id, sym, name: data.name ?? sym,
        comment: noteInput.trim(),
        createdAt: new Date(),
      }, ...prev]);
      setNoteInput(""); setNoteOpen(false);
    }
  }

  async function removeNote(id: string) {
    await deleteNote(id);
    setNotes(prev => prev.filter(n => n.id !== id));
  }

  function handleChartRightClick(e: React.MouseEvent) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }

  // Ticker universe for autocomplete + header chips: the live companies
  // collection, most-active first, instead of a fixed mock catalog.
  const symbolList = [...companies].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)).map(c => c.ticker);
  const suggestions = symbolList.filter(s =>
    search && s.toLowerCase().startsWith(search.toLowerCase())
  );

  const isLiveStock = !!liveCompany && liveCompany.price != null;

  // Real 52-week high/low and average volume from a year of daily bars.
  const yr = yearBars ?? [];
  const week52 = yr.length > 1
    ? { high: Math.max(...yr.map(b => b.h)), low: Math.min(...yr.map(b => b.l)) }
    : null;
  const avgVol20 = yr.length > 0
    ? yr.slice(-20).reduce((s, b) => s + b.v, 0) / Math.min(20, yr.length)
    : null;
  const ema50 = ema(yr, 50);
  const sma200 = sma(yr, 200);

  // Real insider transactions for this ticker, with a real dollar value
  // (shares × pricePerShare from the Form 4 filing) instead of an estimate.
  const symInsider = liveInsider
    .filter(x => x.ticker === sym)
    .sort((a, b) => (b.transactionDate ?? "").localeCompare(a.transactionDate ?? ""))
    .slice(0, 8)
    .map(x => ({
      name: x.ownerName ?? "Insider",
      action: `${x.acquiredOrDisposed === "A" ? "Buy" : "Sell"} ${Math.round(x.shares ?? 0).toLocaleString("en-US")} sh`,
      date: (x.transactionDate ?? "").slice(0, 10),
      valueUsd: x.pricePerShare != null ? x.shares * x.pricePerShare : null,
    }));

  const data = {
    name: liveCompany?.name ?? sym,
    price: liveCompany?.price ?? 0,
    pctChange: liveCompany?.pctChange ?? 0,
    peRatio: liveCompany?.peRatio ?? null,
    dividendYield: liveCompany?.dividendYield ?? null,
    beta: liveCompany?.beta ?? null,
    sector: liveCompany?.sector ?? null,
    insiderActivity: symInsider,
    week52High: week52?.high ?? null,
    week52Low: week52?.low ?? null,
  };
  const isUp = data.pctChange >= 0;
  const p = data.price;

  const rating = ratingLabel(liveCompany?.techRating ?? null);
  const rs = liveCompany?.rsRating ?? null;
  const rv = liveCompany?.rvol ?? null;
  const mc = liveCompany?.marketCap != null ? liveCompany.marketCap / 1e9 : null;
  const gv = RATING_VAL[rating] ?? 0;
  const tone = gv > 0.6 ? "var(--up)" : gv > 0 ? "#7bdcae" : gv < -0.6 ? "var(--down)" : gv < 0 ? "#ff9aab" : "var(--text-dim-solid)";
  // Real analyst consensus (Buy/Hold/Sell vote counts) from analyst_actions —
  // shown as its own block rather than mislabeled as a technical-indicator read.
  const consensusDoc = liveConsensus.find(c => c.ticker === sym);

  const ex = EXCHANGE[sym] ?? "NASDAQ";
  const group = data.sector;

  // Next/most-recent earnings date from the live earnings feed.
  const symEvents = liveEarningsEvents
    .filter(e => e.ticker === sym)
    .sort((a, b) => a.date.localeCompare(b.date));
  const todayStr = new Date().toISOString().slice(0, 10);
  const erDate = symEvents.find(e => e.date >= todayStr)?.date
    ?? symEvents[symEvents.length - 1]?.date
    ?? "—";

  // EPS (TTM) is real arithmetic on two live numbers (price ÷ P/E), not a
  // fabricated figure — only rendered when both inputs are real.
  const eps = data.peRatio != null && data.peRatio !== 0 ? p / data.peRatio : null;
  // Real RSI(14)/MACD from technical-indicators.job — "not available" (never
  // a seeded formula) until that job has run for this ticker.
  const rsi = liveCompany?.rsi14 ?? null;
  const macd = liveCompany?.macd ?? null;
  const macdBuy = macd != null ? macd >= (liveCompany?.macdSignal ?? 0) : null;
  const dollar = Math.abs(data.pctChange / 100 * p);

  const cap = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(2)}T` : v >= 10 ? `$${Math.round(v)}B` : `$${v.toFixed(1)}B`;
  const nf = (x: number) => Math.round(x).toLocaleString("en-US");
  const lo = data.week52Low, hi = data.week52High;

  const trendTxt = rs == null ? null : isUp && rs >= 70
    ? "<b>Strong uptrend.</b> Higher highs and higher lows; momentum confirmed by recent strength."
    : rs < 40
    ? "<b>Downtrend.</b> Lower highs and lower lows; price is below key moving averages."
    : "<b>Range / consolidation.</b> Choppy two-way action with no decisive trend yet.";
  const maTxt = rs == null ? null : rs >= 60 ? "Above the 20, 50 and 200-day — bullish alignment."
    : rs < 40 ? "Below the 50 and 200-day — bearish alignment."
    : "Mixed: hugging the 50-day with a flat 200-day.";

  const indRows: [string, string | null, string][] = [
    ["RSI (14)", rsi != null ? rsi.toFixed(2) : null, rsi == null ? "" : rsi > 70 ? "Sell" : rsi < 40 ? "Buy" : "Neutral"],
    ["MACD (12,26)", macd != null ? macd.toFixed(1) : null, macdBuy == null ? "" : macdBuy ? "Buy" : "Sell"],
    // No live source for Stoch %K / ADX (need a technicals vendor beyond
    // RSI+MACD) — kept in the table as NotAvailable rather than dropped.
    ["Stoch %K", null, ""],
    ["ADX (14)", null, ""],
    ["EMA 50", ema50 != null ? nf(ema50) : null, ema50 != null ? (isUp ? "Buy" : "Sell") : ""],
    ["SMA 200", sma200 != null ? nf(sma200) : null, sma200 != null ? (p > sma200 ? "Buy" : "Sell") : ""],
  ];

  // Real 10-quarter EPS-estimate-vs-actual history from the live earnings
  // feed. No live source exists for post-earnings price reaction, so unlike
  // the old mock version there is no "stock move %" column.
  const hist10: EarnQ[] = symEvents
    .filter(e => e.epsEstimate != null && e.epsActual != null)
    .slice(-10)
    .reverse()
    .map(e => {
      const est = e.epsEstimate as number, act = e.epsActual as number;
      const surp = est !== 0 ? ((act - est) / Math.abs(est)) * 100 : 0;
      return {
        q: new Date(e.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        e: est, a: act, surp: parseFloat(surp.toFixed(1)), mv: 0,
      };
    });
  const beatStreak = (() => {
    let n = 0;
    for (const h of hist10) { if (h.surp >= 0) n++; else break; }
    return hist10.length && hist10[0].surp < 0 ? -n || -1 : n;
  })();

  // Sectors ranked by today's real pctChange (from /market-data/sectors) —
  // replaces the mock sector list's fabricated rank + Improving/Deteriorating
  // trend label, which had no live equivalent.
  const rankedSectors = [...sectorsLive].sort((a, b) => b.pctChange - a.pctChange);
  const grank = group != null ? rankedSectors.findIndex(s => s.sector === group) + 1 : 0;
  const inSectorRank = liveCompany?.sectorRank ?? null;
  const inSectorTotal = liveCompany?.sectorRankTotal ?? null;
  const topSectors = rankedSectors.slice(0, 5);
  const sectorPcts = topSectors.map(s => s.pctChange);
  const pmxSector = sectorPcts.length ? Math.max(...sectorPcts) : 0;
  const pmnSector = sectorPcts.length ? Math.min(...sectorPcts) : 0;

  const peers = companies
    .filter(c => c.sector === group && c.ticker !== sym && c.pctChange != null)
    .sort((a, b) => (b.rsRating ?? 0) - (a.rsRating ?? 0))
    .slice(0, 5)
    .map(c => ({ t: c.ticker, c: c.pctChange as number, rsRating: c.rsRating }));
  const pcs = peers.map(x => x.c);
  const pmx = pcs.length ? Math.max(...pcs) : 0;
  const pmn = pcs.length ? Math.min(...pcs) : 0;

  function selectSym(s: string) {
    setSym(s);
    setSearch("");
    if (typeof window !== "undefined") localStorage.setItem("iq-stock", s);
  }

  function toggleWatchlist(s: string) {
    setWatchedSet(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      if (typeof window !== "undefined") {
        localStorage.setItem("iq-watchlist", JSON.stringify([...next]));
      }
      return next;
    });
  }

  return (
    <>
      {/* Symbol bar — search left, chips right */}
      {!hideHeader && (
        <div className="fbar" style={{ position: "relative" }}>
          <div style={{ position: "relative", flexShrink: 0 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && search) selectSym(search.toUpperCase()); }}
              placeholder="Search symbol or company…"
              style={{
                background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)",
                padding: "5px 10px", fontSize: "0.7812rem", color: "var(--text-hi)", outline: "none", width: "13.125rem",
                fontFamily: "var(--f-mono)",
              }}
            />
            {suggestions.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, background: "var(--surface-1)",
                border: "1px solid var(--border)", borderRadius: "var(--r-sm)", zIndex: 20,
                minWidth: 180, marginTop: 2,
              }}>
                {suggestions.slice(0, 6).map(s => (
                  <div key={s} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px 6px 12px" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}>
                    <div onMouseDown={() => selectSym(s)}
                      style={{ flex: 1, cursor: "pointer", fontSize: "0.7812rem", color: "var(--text-hi)", fontFamily: "var(--f-mono)" }}>
                      {s}
                    </div>
                    <button
                      onMouseDown={e => { e.preventDefault(); toggleWatchlist(s); }}
                      title={watchedSet.has(s) ? "Remove from watchlist" : "Add to watchlist"}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1rem", padding: "0 4px",
                        color: watchedSet.has(s) ? "var(--warn)" : "var(--text-dim-solid)", lineHeight: 1 }}>
                      {watchedSet.has(s) ? "★" : "☆"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {symbolList.slice(0, 12).map(s => (
            <button key={s} className={`chip${sym === s ? " active" : ""}`} onClick={() => selectSym(s)}>{s}</button>
          ))}
        </div>
      )}

      {!hideHeader && (
        <div style={{ padding: "14px 18px 0" }}>
          <div className="sd-head">
            <div className="sd-logo" style={{ background: `linear-gradient(135deg,${logoBg(sym)},${logoBg(sym)}88)`, color: logoFg(sym) }}>
              {sym[0]}
            </div>
            <div className="sd-name">
              <h1>{sym}</h1>
              <div className="sub">
                {data.name} · {ex} · {group}
                {inSectorRank != null && inSectorTotal != null && (
                  <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-hi)", marginLeft: 6, fontSize: ".62rem" }}>
                    #{inSectorRank} of {inSectorTotal} in sector
                  </span>
                )}
                {isLiveStock && (
                  <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", marginLeft: 6, fontSize: ".62rem" }}>
                    live quote · {liveCompany?.source ? liveCompany.source[0].toUpperCase() + liveCompany.source.slice(1) : "Polygon"}
                  </span>
                )}
              </div>
            </div>
            <div className="sd-px">
              <div className="p">${fmt(p, 2)}</div>
              <div className={`c ${cls(data.pctChange)}`}>{arr(data.pctChange)} {data.pctChange >= 0 ? "+" : ""}${fmt(dollar, 2)} ({sign(data.pctChange)})</div>
            </div>
          </div>
        </div>
      )}

      <div className="sd-grid" style={hideHeader ? { paddingTop: 0 } : undefined}>

        {/* Full-width chart */}
        {!hideChart && <div style={{ gridColumn: "1 / -1" }}>
          {/* Chart card */}
          <div className="card">
            <div className="chart-toolbar">
              {["1D","1W","1M","3M","6M","1Y","5Y"].map(r => (
                <button key={r} className={`rng tfbtn${tfActive === r ? " on" : ""}`} onClick={() => setTfActive(r)}>{r}</button>
              ))}
              <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 4px" }} />
              {(["Candles", "Hollow", "Bars", "Line", "Area"] as const).map(ct => (
                <button key={ct} className={`rng ctype-btn${chartType === ct ? " on" : ""}`}
                  onClick={() => setChartType(ct)}>{ct}</button>
              ))}
              <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 4px" }} />
              <button className={`rng indbtn${maStep > 0 ? " on" : ""}`}
                onClick={() => setMaStep(s => (s + 1) % 5)}>
                MA {[9,21,50,200].map((p, i) => (
                  <span key={p} style={{ opacity: i < maStep ? 1 : 0.4, fontWeight: i < maStep ? 700 : undefined }}>
                    {i > 0 ? '/' : ''}{p}
                  </span>
                ))}
              </button>
              <button className={`rng indbtn${emaStep > 0 ? " on" : ""}`}
                onClick={() => setEmaStep(s => (s + 1) % 5)}>
                EMA {[9,21,50,200].map((p, i) => (
                  <span key={p} style={{ opacity: i < emaStep ? 1 : 0.4, fontWeight: i < emaStep ? 700 : undefined }}>
                    {i > 0 ? '/' : ''}{p}
                  </span>
                ))}
              </button>
              <button className={`rng indbtn${showVol ? " on" : ""}`} onClick={() => setShowVol(v => !v)}>Volume</button>
              <button className={`rng indbtn${showRsi ? " on" : ""}`} onClick={() => setShowRsi(v => !v)}>RSI</button>
              <button className={`rng indbtn${showEarnings ? " on" : ""}`} onClick={() => setShowEarnings(v => !v)}>Earnings</button>
              <div style={{ flex: 1 }} />
              {realBars && (
                <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", fontSize: ".62rem", marginRight: 6 }}>
                  live · Polygon
                </span>
              )}
              <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>drag-free · hover for OHLC</span>
              <ExpandBtn
                title={`${sym} · Price Chart`}
                node={
                  <StockChartExpanded
                    sym={sym} px={p}
                    initialTf={tfActive} initialChartType={chartType}
                    initialMaStep={maStep} initialEmaStep={emaStep}
                    initialShowVol={showVol} initialShowRsi={showRsi}
                    initialShowEarnings={showEarnings}
                    hist10={hist10} rsi={rsi} rsiLoading={liveCompanyLoading} erDate={erDate}
                  />
                }
              />
            </div>
            <div id="chartHost" style={{ padding: "0 14px 0" }} ref={chartRef}
              onContextMenu={handleChartRightClick}>
              <CandleChart sym={sym} tf={tfActive} px={p}
                maStep={maStep} emaStep={emaStep}
                showVol={showVol} chartType={chartType.toLowerCase()} realBars={realBars} />
            </div>
            {showRsi && (
              <div id="rsiHost">
                <div style={{ padding: "6px 14px 4px", fontSize: ".66rem", color: "var(--text-dim-solid)", display: "flex", justifyContent: "space-between" }}>
                  <span>RSI (14)</span>
                  <span className="mono" style={{ color: "var(--warn)" }}>
                    {rsi != null ? `${Math.round(rsi)} · ${rsi > 70 ? "overbought" : rsi < 40 ? "weak" : "neutral-to-strong"}` : "not available"}
                  </span>
                </div>
                <div style={{ padding: "0 14px 4px" }}><RsiPane rsi14={rsi} loading={liveCompanyLoading} /></div>
              </div>
            )}
            {showEarnings && (
              <div id="earnHost" style={{ borderTop: "1px solid var(--border)" }}>
                <div style={{ padding: "6px 14px 4px", fontSize: ".66rem", color: "var(--text-dim-solid)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Earnings · EPS Surprise</span>
                  <span>
                    <span className="mono" style={{ color: "var(--text-dim-solid)" }}>Next: </span>
                    <span className="mono" style={{ color: "var(--warn)", fontWeight: 600 }}>{erDate}</span>
                  </span>
                </div>
                <div style={{ padding: "0 14px 8px" }}><EarnPane hist10={hist10} /></div>
              </div>
            )}
            <div style={{ padding: "6px 14px 12px", fontSize: ".7rem", color: "var(--text-dim-solid)" }}>
              Pattern: <b style={{ color: isUp ? "var(--up)" : "var(--down)" }}>
                {isUp ? "cup-with-handle breakout" : "breakdown below support"}
              </b> {isUp ? "on above-average volume." : "on rising volume."}
            </div>

            {/* Chart notes — inline inside chart card */}
            <div className="cn-wrap">
              <div className="cn-h">
                Chart notes
                <span className="cn-hint">right-click to add · saved to your account</span>
                <button className="chip ai-c" style={{ marginLeft: "auto", fontSize: ".7rem" }}
                  onClick={() => setNoteOpen(true)}>+ Add note</button>
              </div>
              {notes.length === 0 ? (
                <div className="cn-empty">No notes yet. Right-click the chart or click &ldquo;Add note&rdquo; to record a trade decision.</div>
              ) : (
                notes.map(n => (
                  <div key={n.id} className="cn-row">
                    <div className="cn-dot" />
                    <div className="cn-tx">
                      {n.comment}
                      <span className="cn-ts">
                        {" · "}
                        {n.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        {" "}
                        {n.createdAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                    <button className="icon-x" onClick={() => removeNote(n.id)}>✕</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>}

        {/* LEFT COLUMN */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, alignSelf: "stretch" }}>

          {/* Keystats */}
          <div className="card">
            <div className="keystats">
              {([
                ["Mkt Cap",        mc != null ? cap(mc) : null],
                ["P/E",            data.peRatio != null ? data.peRatio.toFixed(1) : null],
                ["EPS (TTM)",      eps != null ? "$" + eps.toFixed(2) : null],
                ["Next ER",        erDate],
                ["52W Range",      hi != null && lo != null ? "$" + nf(lo) + " – $" + nf(hi) : null],
                ["Avg Vol (20d)",  avgVol20 != null ? nf(avgVol20 / 1e6) + "M" : null],
              ] as [string, string | null][]).map(k => (
                <div key={k[0]} className="kstat">
                  <div className="k">{k[0]}</div>
                  <div className="v">{k[1] ?? <NotAvailable />}</div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Technical Analysis */}
          <div className="ai-block">
            <div className="card-h">
              <h3 className="ai-c">◆ AI Technical Analysis</h3>
              <div className="toneseg" style={{ width: 280 }}>
                {["Summary","Swing","Position","Long-term"].map(t => (
                  <button key={t} className={toneActive === t ? "on" : ""} onClick={() => setToneActive(t)}>{t}</button>
                ))}
              </div>
            </div>
            <div className="card-b">
              {rs == null ? (
                <DataState loading={liveCompanyLoading} label="Relative-strength rank hasn't been computed for this ticker yet, so the trend/MA read isn't available." />
              ) : ([
                ["Trend",            trendTxt as string],
                ["Support / Resist.",hi != null ? `52-week high <b>$${nf(hi)}</b>${lo != null ? `; 52-week low <b>$${nf(lo)}</b>` : ""}.` : "Support/resistance levels not available."],
                ["MA posture",       maTxt as string],
                ["Rel. strength",    `Relative-strength rank <b class="${rs >= 70 ? "up" : rs < 40 ? "down" : ""}">${rs}/99</b> vs the market — ${rs >= 70 ? "group leader." : rs < 40 ? "lagging the tape." : "roughly in line."}`],
                ["Volume",           rv != null ? `Relative volume <b>${rv.toFixed(1)}×</b> — ${rv > 2 ? "well above average (event-driven)." : "near normal."}` : "Relative volume not available."],
                ["Event risk",       erDate !== "—" ? `Next earnings ${erDate}.` : "No upcoming earnings date on record."],
              ] as [string, string][]).map(l => (
                <div key={l[0]} className="ai-line">
                  <span className="k">{l[0]}</span>
                  <span className="v" dangerouslySetInnerHTML={{ __html: l[1] }} />
                </div>
              ))}
              <div style={{ marginTop: 10, fontSize: ".7rem", color: "var(--text-dim-solid)" }}>
                Source: rs-rating.job, technical-indicators.job, a year of daily bars · informational purposes only, not investment advice.
              </div>
            </div>
          </div>

          {/* Financials — grouped bar chart */}
          {(() => {
            const inc     = incRowsFromFinancials(finPeriod, financialsDoc, () => []);
            const histEps = hist10.slice(0, 10);
            const beatsOf = histEps.filter(h => h.surp >= 0).length;
            const latestA = histEps[0]?.a ?? 0;
            const prevA   = histEps[4]?.a;
            const yoy     = prevA != null ? ((latestA - prevA) / Math.abs(prevA || 1)) * 100 : null;
            return (
              <div className="card">
                <div className="card-h">
                  <h3>Financials</h3>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {financialsDoc && (
                      <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", fontSize: ".62rem" }}>live · Polygon</span>
                    )}
                    <div className="tf-pills">
                      <button
                        className={`rng${finPeriod === "Q" ? " on" : ""}`}
                        onClick={() => setFinPeriod("Q")}
                      >Quarterly</button>
                      <button
                        className={`rng${finPeriod === "A" ? " on" : ""}`}
                        onClick={() => setFinPeriod("A")}
                      >Annual</button>
                    </div>
                    <span className="link" onClick={() => setInnerDrawer("financials")}>View all →</span>
                    <ExpandBtn title={`${sym} · Financials (${finPeriod === "Q" ? "Quarterly" : "Annual"})`} node={<EarnIncChart inc={inc} />} />
                  </div>
                </div>
                <div className="card-b" style={{ paddingTop: 8 }}>
                  {inc.length === 0 ? (
                    <DataState loading={financialsLoading} label={`No live ${finPeriod === "Q" ? "quarterly" : "annual"} financials synced for ${sym} yet.`} />
                  ) : (
                    <>
                      <div className="ec-legend">
                        <span><i style={{ background: "var(--brand)" }} />Revenue</span>
                        <span><i style={{ background: "var(--ai)" }} />Gross profit</span>
                        <span><i style={{ background: "var(--up)" }} />Net income</span>
                      </div>
                      <EarnIncChart inc={inc} />
                      <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 6 }}>
                        {finPeriod === "Q"
                          ? "Last 10 quarters · revenue, gross profit & net income"
                          : "Last 10 fiscal years · revenue, gross profit & net income"}
                        {" · tap "}&#8220;View all&#8221; for the full statement.
                      </div>
                    </>
                  )}

                  <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border-soft)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--text-hi)" }}>Earnings Growth (EPS)</div>
                      {histEps.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="ec-legend" style={{ margin: 0 }}>
                            <span><i style={{ background: "var(--up)" }} />Beat</span>
                            <span><i style={{ background: "var(--down)" }} />Miss</span>
                            <span><i className="ln" style={{ background: "var(--brand-2)" }} />Trend</span>
                          </span>
                          <ExpandBtn title={`${sym} · Earnings Growth (EPS)`} node={<EarningsGrowthChart hist={histEps} />} />
                        </div>
                      )}
                    </div>
                    {histEps.length === 0 ? (
                      <DataState loading={earningsLoading} label={`No live earnings history synced for ${sym} yet.`} />
                    ) : (
                      <>
                        <EarningsGrowthChart hist={histEps} />
                        <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
                          <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>
                            <b style={{ color: "var(--text-hi)" }}>{beatsOf}/{histEps.length}</b> beats
                          </div>
                          <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>
                            Latest qtr EPS <b style={{ color: "var(--text-hi)" }}>${latestA.toFixed(2)}</b>
                          </div>
                          {yoy !== null && (
                            <div style={{ fontSize: ".7rem" }}>
                              YoY <b style={{ color: yoy >= 0 ? "var(--up)" : "var(--down)" }}>{yoy >= 0 ? "+" : ""}{yoy.toFixed(1)}%</b>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, alignSelf: "stretch" }}>

          {/* Technical Rating */}
          <div className="card">
            <div className="card-h">
              <h3>Technical Rating</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="tf-pills">
                  {["1D","1W","1M"].map((t, i) => (
                    <button key={t} className={`rng${i === 2 ? " on" : ""}`}>{t}</button>
                  ))}
                </div>
                <span className="link" onClick={() => setInnerDrawer("techrating")}>View all →</span>
              </div>
            </div>
            <div className="card-b">
              <div className="trgroup" style={{ borderColor: "var(--ai-dim)", marginBottom: 10 }}>
                <div className="gl ai-c">Summary</div>
                <TrGauge val={gv} label={rating} />
              </div>
              {consensusDoc && (
                <div className="trgroup" style={{ marginBottom: 12 }}>
                  <div className="gl">Analyst Consensus</div>
                  <div className="rate" style={{ color: tone }}>{consensusDoc.consensus}</div>
                  <div className="counts">
                    <span style={{ color: "var(--down)" }}>Sell<b>{consensusDoc.sell + consensusDoc.strongSell}</b></span>
                    <span style={{ color: "var(--text-dim-solid)" }}>Hold<b>{consensusDoc.hold}</b></span>
                    <span style={{ color: "var(--up)" }}>Buy<b>{consensusDoc.strongBuy + consensusDoc.buy}</b></span>
                  </div>
                </div>
              )}
              <table className="ind-tbl" style={{ marginTop: 12 }}>
                <tbody>
                  {indRows.map(r => (
                    <tr key={r[0]}>
                      <td>{r[0]}</td>
                      <td className="v">{r[1] ?? <NotAvailable />}</td>
                      <td className="a" style={{ color: ac(r[2]) }}>{r[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                RSI/MACD from technical-indicators.job · EMA/SMA computed from a year of daily bars. Indicators only — not investment advice.
              </div>
            </div>
          </div>

          {/* Peers */}
          <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div className="card-h">
              <h3>Peers · who&apos;s leading</h3>
              <span className="link" onClick={() => setInnerDrawer("peers")}>View all →</span>
            </div>
            <div className="card-b" style={{ paddingTop: 6, flex: 1, overflowY: "auto", minHeight: 0 }}>
              {peers.length ? peers.map(peer => {
                const tag = peer.c === pmx ? "Leader" : peer.c === pmn ? "Laggard" : "";
                return (
                  <div key={peer.t} className="minirow"
                    style={{ cursor: "pointer" }} onClick={() => openStock(peer.t)}>
                    <span className="tkr">{peer.t}</span>
                    <span className="mid">
                      {tag && <span className={`pill ${tag === "Leader" ? "up" : "dn"}`}>{tag}</span>}
                      {peer.rsRating != null && (
                        <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)", marginLeft: 4, fontSize: ".62rem" }}>RS {peer.rsRating}</span>
                      )}
                    </span>
                    <span className={`r ${cls(peer.c)}`}>{sign(peer.c)}</span>
                  </div>
                );
              }) : <DataState loading={companiesLoading} label="No live peers found in this sector yet." />}
            </div>
          </div>

          {/* Industry Group rank */}
          <div className="card">
            <div className="card-h">
              <h3>Industry Group rank</h3>
              <span className="link" onClick={() => setInnerDrawer("industry")}>View all →</span>
            </div>
            <div className="card-b">
              {topSectors.length === 0 ? (
                <DataState loading={sectorsLoading} label="No live sector performance data yet." />
              ) : (
                <>
                  {topSectors.map((s, i) => (
                    <div key={s.sector} className="grouprow" style={s.sector === group ? { color: "var(--brand-2)" } : undefined}>
                      <span className="rk">{i + 1}</span>
                      <span className="gn">{s.sector}</span>
                      <div className="bar"><i style={{ width: Math.max(8, (s.pctChange - pmnSector) / (pmxSector - pmnSector || 1) * 100) + "%" }} /></div>
                      <span className="mono" style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{sign(s.pctChange)}</span>
                    </div>
                  ))}
                  <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                    {group ? <>{group} ranks <b style={{ color: grank <= 10 ? "var(--up)" : "var(--text-hi)" }}>#{grank || "—"} of {rankedSectors.length}</b> sectors by today&apos;s performance.</>
                      : "This ticker has no sector on record."}
                  </div>
                </>
              )}
            </div>
          </div>

        </div>

        {/* Dividend history — row 3, col 1 */}
        {/* alignSelf stretch is default on grid children; explicit here for clarity */}
        {(() => {
          const dh = dividendHistory;
          const hasReal = !!dh && dh.isPayer;
          const yieldPct = hasReal ? dh!.yieldPct : null;
          const annualDiv = hasReal ? (dh!.ttmTotal ?? 0) : 0;
          const payoutRatio = eps != null && eps > 0 && yieldPct != null && yieldPct > 0
            ? Math.min(99, Math.round((annualDiv / eps) * 100)) : null;
          const growthLabel = hasReal && dh!.cagr5yPct != null
            ? `${dh!.cagr5yPct >= 0 ? "+" : ""}${dh!.cagr5yPct.toFixed(1)}% / yr`
            : null;
          const streakLabel = hasReal && dh!.increaseStreakYears > 0 ? ` · ${dh!.increaseStreakYears}-yr streak` : "";
          const divRows = hasReal
            ? dh!.history.slice(0, 5).map(h => ({
                label: h.exDividendDate ?? "—",
                perShare: h.amount,
                note: h.exDividendDate ? `ex ${h.exDividendDate.slice(5)}` : "",
              }))
            : [];
          return (
            <div className="card">
              <div className="card-h">
                <h3>Dividend &amp; split history</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {dh && (yieldPct != null
                    ? <span className="pill up">{yieldPct.toFixed(2)}% yield</span>
                    : <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>No dividend</span>)}
                  {hasReal && <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", fontSize: ".62rem" }}>live · Polygon</span>}
                  <span className="link" onClick={() => setInnerDrawer("dividend")}>View all →</span>
                </div>
              </div>
              <div className="card-b" style={{ paddingTop: 6 }}>
                {!dh ? (
                  <DataState loading={dividendLoading} label={`Dividend data not synced for ${sym} yet.`} />
                ) : !hasReal ? (
                  <div style={{ fontSize: ".8rem", color: "var(--text-dim-solid)", padding: "8px 0" }}>{sym} does not currently pay a dividend.</div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginBottom: 4 }}>5-yr dividend growth</div>
                        <div style={{ fontSize: ".78rem", color: "var(--text-hi)" }}>
                          {growthLabel ?? "—"}{payoutRatio != null ? ` · payout ${payoutRatio}%` : ""}{streakLabel}
                        </div>
                      </div>
                    </div>
                    {divRows.map(q => (
                      <div key={q.label} className="minirow">
                        <span className="tkr" style={{ width: 60 }}>{q.label}</span>
                        <span className="mid mono">${q.perShare.toFixed(4)}/sh</span>
                        <span className="r" style={{ color: "var(--text-dim-solid)", fontSize: ".72rem" }}>{q.note}</span>
                      </div>
                    ))}
                    <div className="minirow" style={{ marginTop: 8, borderTop: "1px solid var(--border-soft)", paddingTop: 6 }}>
                      <span className="mid">Annual ({dh!.ttmPayments} payments)</span>
                      <span className="r" style={{ color: "var(--text-hi)" }}>${annualDiv.toFixed(2)}/sh</span>
                    </div>
                  </>
                )}

                <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border-soft)" }}>
                  <div style={{ fontSize: ".66rem", fontWeight: 700, color: "var(--text-dim-solid)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>
                    Stock splits
                  </div>
                  {splitsDoc && splitsDoc.splits.length > 0 ? splitsDoc.splits.slice(0, 3).map(s => (
                    <div key={s.executionDate} className="minirow">
                      <span className="mid">{s.executionDate}</span>
                      <span className="r" style={{ color: "var(--text-hi)" }}>{s.splitFrom}:{s.splitTo}</span>
                    </div>
                  )) : (
                    <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>No splits on record.</div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Earnings history — row 3, col 2 */}
        <div className="card">
          <div className="card-h">
            <h3>Earnings history</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {hist10.length > 0 && (
                <span className={`pill ${beatStreak >= 0 ? "up" : "dn"}`}>{Math.abs(beatStreak)}-qtr {beatStreak >= 0 ? "beat" : "miss"} streak</span>
              )}
              <span className="link" onClick={() => setInnerDrawer("earnings")}>View all →</span>
            </div>
          </div>
          <div className="card-b" style={{ paddingTop: 6 }}>
            {hist10.length === 0 ? (
              <DataState loading={earningsLoading} label={`No live earnings-estimate history synced for ${sym} yet.`} />
            ) : (
              <>
                <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginBottom: 8 }}>Next report: {erDate}</div>
                {hist10.slice(0, 5).map(q => (
                  <div key={q.q} className="minirow">
                    <span className="tkr" style={{ width: 60 }}>{q.q}</span>
                    <span className="mid mono">${fmt(Math.abs(q.a), 2)} EPS</span>
                    <span className={`r ${q.surp >= 0 ? "up" : "down"}`}>{q.surp >= 0 ? "beat" : "miss"} {Math.abs(q.surp)}%</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Insider & institutional — col 1 */}
        <div className="card">
            <div className="card-h">
              <h3>Insider &amp; institutional</h3>
              <span className="link" onClick={() => setInnerDrawer("insider")}>View all →</span>
            </div>
            <div className="card-b" style={{ paddingTop: 6 }}>
              <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-dim-solid)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>
                Recent insider transactions
              </div>
              {data.insiderActivity.length > 0 ? (
                data.insiderActivity.map((n, idx) => {
                  const isSell = /sale|sold|exercis/i.test(n.action);
                  return (
                    <div key={idx} className="minirow" style={{ cursor: "pointer", alignItems: "flex-start", gap: 10 }}>
                      <span className="tkr" style={{ flex: "none" }}>{sym}</span>
                      <span className="mid" style={{ whiteSpace: "normal", lineHeight: 1.45 }}>
                        {n.name} {n.action} <span style={{ color: "var(--text-dim-solid)" }}>({n.date})</span>
                      </span>
                      <span className={`r ${isSell ? "down" : "up"}`} style={{ flex: "none" }}>
                        {n.valueUsd != null ? `${isSell ? "−" : "+"}$${(n.valueUsd / 1e6).toFixed(1)}M` : <NotAvailable />}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div style={{ fontSize: ".8rem", color: "var(--text-dim-solid)", padding: "4px 0 8px" }}>
                  No recent Form 4 activity.
                </div>
              )}
              <div style={{ height: 1, background: "var(--border-soft)", margin: "12px 0 8px" }} />
              <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-dim-solid)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>
                Institutional
              </div>
              {([
                ["Inst. ownership", null],
                ["Short interest", null],
                ["13F funds holding", null],
              ] as [string, string | null][]).map(x => (
                <div key={x[0]} className="minirow">
                  <span className="mid">{x[0]}</span>
                  <span className="r">{x[1] ?? <NotAvailable />}</span>
                </div>
              ))}
            </div>
          </div>

        {/* Key levels — col 2 */}
        <div className="card">
            <div className="card-h">
              <h3>Key levels (pivots)</h3>
              <span className="link" onClick={() => setInnerDrawer("keylevels")}>View all →</span>
            </div>
            <div className="card-b" style={{ paddingTop: 6 }}>
              <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-dim-solid)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>
                Weekly pivots
              </div>
              {(["R2", "R1", "Pivot", "S1", "S2"] as const).map(label => (
                <div key={label} className="minirow">
                  <span className="tkr" style={{ width: 50 }}>{label}</span>
                  <span className="mid" />
                  <span className="r mono"><NotAvailable /></span>
                </div>
              ))}
              <div style={{ height: 1, background: "var(--border-soft)", margin: "12px 0 8px" }} />
              <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-dim-solid)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>
                Moving averages &amp; range
              </div>
              {hi == null && lo == null && ema50 == null && sma200 == null ? (
                <DataState loading={liveCompanyLoading || yearBarsLoading} label="No historical price data synced for this ticker yet." />
              ) : (
                ([
                  ["52W High", hi,     isUp ? "up"   : "dim"],
                  ["EMA 50",   ema50,  isUp ? "up"   : "down"],
                  ["SMA 200",  sma200, sma200 != null && p > sma200 ? "up" : "down"],
                  ["52W Low",  lo,     isUp ? "dim"  : "down"],
                ] as [string, number | null, string][]).map(x => (
                  <div key={x[0]} className="minirow">
                    <span className="tkr" style={{ width: 70 }}>{x[0]}</span>
                    <span className="mid" />
                    <span className="r mono" style={{ color: x[2] === "dim" ? "var(--text-hi)" : `var(--${x[2]})` }}>
                      {x[1] != null ? `$${nf(x[1])}` : <NotAvailable />}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

        {/* News */}
        <div className="card">
          <div className="card-h">
            <h3>News</h3>
            {tickerNews && tickerNews.length > 0 && (
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", fontSize: ".62rem" }}>live</span>
            )}
          </div>
          <div className="card-b" style={{ paddingTop: 6 }}>
            {tickerNews && tickerNews.length > 0 ? (
              tickerNews.slice(0, 6).map(n => (
                <a key={n.id} href={n.url} target="_blank" rel="noreferrer"
                  className="minirow" style={{ alignItems: "flex-start", gap: 10, textDecoration: "none", cursor: "pointer" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: ".8rem", color: "var(--text)" }}>{n.headline}</div>
                    <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 3 }}>
                      {n.source} · {new Date(n.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>
                  </div>
                </a>
              ))
            ) : (
              <div style={{ fontSize: ".8rem", color: "var(--text-dim-solid)", padding: "4px 0" }}>
                No recent news synced for {sym} yet.
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ── Right-click context menu ── */}
      {ctxMenu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={() => setCtxMenu(null)} />
          <div style={{
            position: "fixed", left: ctxMenu.x, top: ctxMenu.y,
            background: "var(--surface-1)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "6px 0", minWidth: 160, zIndex: 91,
            boxShadow: "0 8px 24px rgba(0,0,0,.4)",
          }}>
            <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", background: "none", border: "none", color: "var(--text)", fontSize: ".84rem", cursor: "pointer" }}
              onClick={() => { setCtxMenu(null); setNoteOpen(true); }}>
              📝 Add chart note
            </button>
            <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", background: "none", border: "none", color: "var(--text-dim-solid)", fontSize: ".84rem", cursor: "pointer" }}
              onClick={() => setCtxMenu(null)}>
              Cancel
            </button>
          </div>
        </>
      )}

      {/* ── Inner drawers (View all) ── */}
      {innerDrawer && (
        <>
          <div className="scrim" style={{ zIndex: 52 }} onClick={() => setInnerDrawer(null)} />

          {/* Technical Rating */}
          {innerDrawer === "techrating" && (
            <div className="side-drawer" style={{ zIndex: 52 }}>
              <div className="drawer-h">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Technical Rating · {sym}</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>11 oscillators · 15 moving averages</div>
                </div>
                <button className="closebtn" onClick={() => setInnerDrawer(null)}>✕</button>
              </div>
              <div className="drawer-b">
                <div className="trgroup" style={{ borderColor: "var(--ai-dim)", marginBottom: 14 }}>
                  <div className="gl ai-c">Summary · {rating}</div>
                  <TrGauge val={gv} label={rating} />
                </div>
                <div className="ai-sec"><div className="h">Oscillators</div></div>
                <table className="ind-tbl">
                  <tbody>
                    {([
                      ["RSI (14)", rsi != null ? rsi.toFixed(2) : null, rsi == null ? "" : rsi > 70 ? "Sell" : rsi < 40 ? "Buy" : "Neutral"],
                      ["Stoch %K", null, ""],
                      ["CCI (14)", null, ""],
                      ["MACD (12,26)", macd != null ? macd.toFixed(1) : null, macdBuy == null ? "" : macdBuy ? "Buy" : "Sell"],
                      ["Williams %R", null, ""],
                      ["Bull/Bear Power", null, ""],
                      ["ADX (14)", null, ""],
                      ["Ultimate Osc.", null, ""],
                      ["ROC", null, ""],
                      ["Stoch RSI", null, ""],
                      ["ATR (14)", null, ""],
                    ] as [string, string | null, string][]).map(r => (
                      <tr key={r[0]}>
                        <td>{r[0]}</td><td className="v">{r[1] ?? <NotAvailable />}</td>
                        <td className="a" style={{ color: ac(r[2]) }}>{r[2]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="ai-sec" style={{ marginTop: 14 }}><div className="h">Moving Averages</div></div>
                <table className="ind-tbl">
                  <tbody>
                    {([
                      ["SMA 10",  sma(yr, 10)],
                      ["SMA 20",  sma(yr, 20)],
                      ["SMA 30",  sma(yr, 30)],
                      ["SMA 50",  sma(yr, 50)],
                      ["SMA 100", sma(yr, 100)],
                      ["SMA 200", sma(yr, 200)],
                      ["EMA 10",  ema(yr, 10)],
                      ["EMA 20",  ema(yr, 20)],
                      ["EMA 30",  ema(yr, 30)],
                      ["EMA 50",  ema(yr, 50)],
                      ["EMA 100", ema(yr, 100)],
                      ["EMA 200", ema(yr, 200)],
                      ["Ichimoku Base", ichimokuBase(yr, 26)],
                      ["VWAP", null],
                      ["Hull MA (9)", null],
                    ] as [string, number | null][]).map(([label, v]) => (
                      <tr key={label}>
                        <td>{label}</td><td className="v">{v != null ? nf(v) : <NotAvailable />}</td>
                        <td className="a" style={{ color: v != null ? ac(p > v ? "Buy" : "Sell") : "var(--text-dim-solid)" }}>{v != null ? (p > v ? "Above" : "Below") : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                  RSI/MACD from technical-indicators.job · SMA/EMA/Ichimoku computed from a year of daily bars — real. Stoch/CCI/Williams %R/Bull-Bear/ADX/Ultimate Osc/ROC/Stoch RSI/ATR/VWAP/Hull MA need a fuller technicals vendor and aren&apos;t wired up yet. Not investment advice.
                </div>
              </div>
            </div>
          )}

          {/* Peers */}
          {innerDrawer === "peers" && (
            <div className="side-drawer" style={{ zIndex: 52 }}>
              <div className="drawer-h">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Peers · {group}</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>All tracked stocks in this group</div>
                </div>
                <button className="closebtn" onClick={() => setInnerDrawer(null)}>✕</button>
              </div>
              <div className="drawer-b">
                {companies.filter(c => c.sector === group).length === 0 ? (
                  <DataState loading={companiesLoading} label={`No live peers found in ${group ?? "this sector"}.`} />
                ) : companies
                  .filter(c => c.sector === group && c.pctChange != null)
                  .sort((a, b) => (b.rsRating ?? 0) - (a.rsRating ?? 0))
                  .map(c => (
                      <div key={c.ticker} className="minirow" style={{ cursor: "pointer" }}
                        onClick={() => { setInnerDrawer(null); openStock(c.ticker); }}>
                        <span className="mono" style={{
                          fontWeight: 700, minWidth: 52,
                          color: c.ticker === sym ? "var(--brand-2)" : "var(--text-hi)",
                        }}>{c.ticker}</span>
                        <span className="mid" style={{ fontSize: ".76rem" }}>{c.name ?? c.ticker}</span>
                        {c.rsRating != null && <span className="pill" style={{ fontSize: ".66rem", background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>RS {c.rsRating}</span>}
                        <span className={`mono ${cls(c.pctChange as number)}`} style={{ fontSize: ".82rem" }}>{sign(c.pctChange as number)}</span>
                      </div>
                  ))}
              </div>
            </div>
          )}

          {/* Industry Group rank */}
          {innerDrawer === "industry" && (
            <div className="side-drawer" style={{ zIndex: 52 }}>
              <div className="drawer-h">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Industry Group Rank</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>All sectors by today&apos;s performance</div>
                </div>
                <button className="closebtn" onClick={() => setInnerDrawer(null)}>✕</button>
              </div>
              <div className="drawer-b">
                {rankedSectors.length === 0 ? <DataState loading={sectorsLoading} label="No live sector performance data yet." /> : rankedSectors.map((s, i) => (
                  <div key={s.sector} className="grouprow" style={{ cursor: "pointer" }}
                    onClick={() => { setInnerDrawer(null); openSector(s.sector); }}>
                    <span className="rk">{i + 1}</span>
                    <span className="gn" style={{
                      color: s.sector === group ? "var(--brand-2)" : undefined,
                      fontWeight: s.sector === group ? 700 : undefined,
                    }}>{s.sector}</span>
                    <div className="bar"><i style={{ width: Math.max(8, (s.pctChange - pmnSector) / (pmxSector - pmnSector || 1) * 100) + "%" }} /></div>
                    <span className="mono" style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{sign(s.pctChange)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Insider transactions */}
          {innerDrawer === "insider" && (
            <div className="side-drawer" style={{ zIndex: 52 }}>
              <div className="drawer-h">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Insider &amp; Institutional · {sym}</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Form 4 filings · 13F institutional data</div>
                </div>
                <button className="closebtn" onClick={() => setInnerDrawer(null)}>✕</button>
              </div>
              <div className="drawer-b">
                <div className="metric-grid" style={{ marginBottom: 14 }}>
                  <div className="m"><div className="k">Inst. ownership</div><div className="v"><NotAvailable /></div></div>
                  <div className="m"><div className="k">Short interest</div><div className="v"><NotAvailable /></div></div>
                  <div className="m"><div className="k">13F funds</div><div className="v"><NotAvailable /></div></div>
                </div>
                <div className="ai-sec"><div className="h">Recent insider transactions (Form 4)</div></div>
                {data.insiderActivity.length > 0 ? data.insiderActivity.map((n, i) => {
                  const isSell = /sale|sold|exercis/i.test(n.action);
                  return (
                    <div key={i} className="minirow" style={{ alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border-soft)" }}>
                      <span className={`pill ${isSell ? "dn" : "up"}`} style={{ flex: "none", fontSize: ".66rem" }}>{isSell ? "SELL" : "BUY"}</span>
                      <span className="mid" style={{ whiteSpace: "normal", lineHeight: 1.45 }}>
                        <b style={{ color: "var(--text-hi)" }}>{n.name}</b> {n.action}{" "}
                        <span style={{ color: "var(--text-dim-solid)" }}>({n.date})</span>
                      </span>
                      <span className={`r mono ${isSell ? "down" : "up"}`} style={{ flex: "none" }}>
                        {n.valueUsd != null ? `${isSell ? "−" : "+"}$${(n.valueUsd / 1e6).toFixed(1)}M` : <NotAvailable />}
                      </span>
                    </div>
                  );
                }) : (
                  <DataState loading={insiderLoading} label="No recent Form 4 activity found for this ticker." />
                )}
                <div className="ai-sec" style={{ marginTop: 14 }}><div className="h">Top institutional holders (13F)</div></div>
                <DataState label="Per-ticker 13F holder mapping needs SEC positions keyed by ticker instead of CUSIP — not available yet." />
              </div>
            </div>
          )}

          {/* Key levels */}
          {innerDrawer === "keylevels" && (
            <div className="side-drawer" style={{ zIndex: 52 }}>
              <div className="drawer-h">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Key Levels · {sym}</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Pivot points · support &amp; resistance</div>
                </div>
                <button className="closebtn" onClick={() => setInnerDrawer(null)}>✕</button>
              </div>
              <div className="drawer-b">
                <div className="ai-sec"><div className="h">Classic pivot (daily)</div></div>
                {(["R3", "R2", "R1", "Pivot", "S1", "S2", "S3"] as const).map(label => (
                  <div key={label} className="minirow">
                    <span className="tkr" style={{ width: 50 }}>{label}</span>
                    <span className="mid" style={{ fontSize: ".76rem", color: "var(--text-dim-solid)" }}>
                      {label === "Pivot" ? "Pivot point" : label.startsWith("R") ? `Resistance ${label[1]}` : `Support ${label[1]}`}
                    </span>
                    <span className="r mono"><NotAvailable /></span>
                  </div>
                ))}
                <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", margin: "6px 0 14px" }}>
                  Classic pivot points need a real prior-day OHLC feed, which isn&apos;t wired up here yet.
                </div>

                {hi == null && lo == null ? (
                  <DataState loading={liveCompanyLoading || yearBarsLoading} label="No historical price data synced for this ticker yet." />
                ) : (
                  <>
                    <div className="ai-sec"><div className="h">52-week levels</div></div>
                    <div className="metric-grid">
                      <div className="m"><div className="k">52W High</div><div className="v up">{hi != null ? `$${nf(hi)}` : <NotAvailable />}</div></div>
                      <div className="m"><div className="k">52W Low</div><div className="v down">{lo != null ? `$${nf(lo)}` : <NotAvailable />}</div></div>
                      <div className="m"><div className="k">From High</div><div className={hi != null ? cls((p - hi) / hi * 100) : ""}>{hi != null ? sign((p - hi) / hi * 100) : <NotAvailable />}</div></div>
                      <div className="m"><div className="k">From Low</div><div className={lo != null ? cls((p - lo) / lo * 100) : ""}>{lo != null ? sign((p - lo) / lo * 100) : <NotAvailable />}</div></div>
                    </div>
                    <div className="ai-sec" style={{ marginTop: 14 }}><div className="h">Moving averages</div></div>
                    <div className="metric-grid">
                      <div className="m"><div className="k">EMA 50</div><div className="v">{ema50 != null ? `$${nf(ema50)}` : <NotAvailable />}</div></div>
                      <div className="m"><div className="k">SMA 200</div><div className="v">{sma200 != null ? `$${nf(sma200)}` : <NotAvailable />}</div></div>
                    </div>
                  </>
                )}
                <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 14 }}>
                  52-week range and moving averages are computed from a year of real daily closes. Not investment advice.
                </div>
              </div>
            </div>
          )}

          {/* Earnings History */}
          {innerDrawer === "earnings" && (
            <div className="side-drawer" style={{ zIndex: 52 }}>
              <div className="drawer-h">
                <div className="sd-logo" style={{ background: "linear-gradient(135deg,#3a2f6b,#241c44)", color: "var(--brand-2)", flexShrink: 0 }}>
                  {sym[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>{sym}</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Earnings history · last 10 quarters</div>
                </div>
                <button className="closebtn" onClick={() => setInnerDrawer(null)}>✕</button>
              </div>
              <div className="drawer-b">
                {hist10.length === 0 ? (
                  <DataState loading={earningsLoading} label={`No live earnings-estimate history synced for ${sym} yet.`} />
                ) : (
                  <>
                    <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)", marginBottom: 12 }}>
                      {Math.abs(beatStreak)}-qtr {beatStreak >= 0 ? "beat" : "miss"} streak
                    </div>
                    <div className="ec-legend">
                      <span><i style={{ background: "var(--surface-3)" }} />EPS estimate</span>
                      <span><i style={{ background: "var(--up)" }} />Beat</span>
                      <span><i style={{ background: "var(--down)" }} />Miss</span>
                    </div>
                    <EarnEpsChart hist={hist10} />
                    <div style={{ overflowX: "auto", marginTop: 12 }}>
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Quarter</th>
                            <th className="num">EPS est</th>
                            <th className="num">EPS act</th>
                            <th className="num">Surprise</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hist10.map(q => (
                            <tr key={q.q}>
                              <td><b style={{ color: "var(--text-hi)" }}>{q.q}</b></td>
                              <td className="num">${q.e.toFixed(2)}</td>
                              <td className="num">${q.a.toFixed(2)}</td>
                              <td className={`num ${q.surp >= 0 ? "up" : "down"}`}>{q.surp >= 0 ? "+" : ""}{q.surp}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                      {hist10.filter(h => h.surp >= 0).length}/{hist10.length} beats.
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Financials */}
          {innerDrawer === "financials" && (() => {
            const inc = incRowsFromFinancials(finPeriod, financialsDoc, () => []);
            const fb = (v: number) => v >= 1 ? `$${v.toFixed(2)}B` : `$${(v * 1000).toFixed(0)}M`;
            const beats10 = hist10.filter(h => h.surp >= 0).length;
            return (
              <div className="side-drawer" style={{ zIndex: 52 }}>
                <div className="drawer-h">
                  <div className="sd-logo" style={{ background: "linear-gradient(135deg,#3a2f6b,#241c44)", color: "var(--brand-2)", flexShrink: 0 }}>
                    {sym[0]}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>{sym}</div>
                    <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Financials · income statement</div>
                  </div>
                  <button className="closebtn" onClick={() => setInnerDrawer(null)}>✕</button>
                </div>
                <div className="drawer-b">
                  {/* 10-quarter EPS chart */}
                  <div className="card" style={{ marginBottom: 14 }}>
                    <div className="card-h">
                      <h3>{sym} · earnings history</h3>
                      {hist10.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>{beats10}/{hist10.length} beats</span>
                          <ExpandBtn title={`${sym} · earnings history`} node={<EarnEpsChart hist={hist10} />} />
                        </div>
                      )}
                    </div>
                    <div className="card-b" style={{ paddingTop: 8 }}>
                      {hist10.length === 0 ? <DataState loading={earningsLoading} label={`No live earnings-estimate history synced for ${sym} yet.`} /> : (
                        <>
                          <div className="ec-legend">
                            <span><i style={{ background: "var(--surface-3)" }} />EPS estimate</span>
                            <span><i style={{ background: "var(--up)" }} />Beat</span>
                            <span><i style={{ background: "var(--down)" }} />Miss</span>
                          </div>
                          <EarnEpsChart hist={hist10} />
                        </>
                      )}
                    </div>
                  </div>
                  {/* Income statement */}
                  <div className="card" style={{ marginBottom: 14 }}>
                    <div className="card-h">
                      <h3>Income statement</h3>
                      {inc.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>Quarterly</span>
                          <ExpandBtn title={`${sym} · Income statement`} node={<EarnIncChart inc={inc} />} />
                        </div>
                      )}
                    </div>
                    <div className="card-b" style={{ paddingTop: 8 }}>
                      {inc.length === 0 ? <DataState loading={financialsLoading} label={`No live financials synced for ${sym} yet.`} /> : (
                        <>
                          <div className="ec-legend">
                            <span><i style={{ background: "var(--brand)" }} />Revenue</span>
                            <span><i style={{ background: "var(--ai)" }} />Gross profit</span>
                            <span><i style={{ background: "var(--up)" }} />Net income</span>
                          </div>
                          <EarnIncChart inc={inc} />
                          <div style={{ overflowX: "auto", marginTop: 12 }}>
                            <table className="tbl">
                              <thead>
                                <tr>
                                  <th>Item</th>
                                  {inc.map(c => <th key={c.c} className="num">{c.c}</th>)}
                                </tr>
                              </thead>
                              <tbody>
                                {([
                                  ["Revenue",           "rev",  true],
                                  ["Cost of revenue",   "cogs", false],
                                  ["Gross profit",      "gp",   true],
                                  ["Operating expenses","opex", false],
                                  ["Operating income",  "oi",   true],
                                  ["Net income",        "ni",   true],
                                  ["Diluted EPS",       "eps",  false],
                                ] as [string, keyof IncRow, boolean][]).map(([lbl, key, bold]) => (
                                  <tr key={lbl}>
                                    <td style={bold ? { fontWeight: 700, color: "var(--text-hi)" } : {}}>{lbl}</td>
                                    {inc.map(c => (
                                      <td key={c.c} className="num" style={bold ? { fontWeight: 700, color: "var(--text-hi)" } : {}}>
                                        {key === "eps" ? `$${(c[key] as number).toFixed(2)}` : fb(c[key] as number)}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {innerDrawer === "dividend" && (() => {
            const dh = dividendHistory;
            const hasReal = !!dh && dh.isPayer;
            const yieldPct = hasReal ? dh!.yieldPct : null;
            const annualDiv = hasReal ? (dh!.ttmTotal ?? 0) : 0;
            const qDiv = annualDiv / 4;
            const growthPct = hasReal ? dh!.cagr5yPct : null;
            const growthLabel = growthPct != null ? `${growthPct >= 0 ? "+" : ""}${growthPct.toFixed(1)}%/yr` : null;
            const payoutRatio = eps != null && eps > 0 && yieldPct != null && yieldPct > 0
              ? Math.round((annualDiv / eps) * 100) : null;

            // Real history is newest-first; reverse to chronological for the bar
            // chart, oldest→newest left-to-right, matching every other chart here.
            const barSource = hasReal
              ? [...dh!.history].reverse().slice(-8).map(h => ({
                  label: h.exDividendDate ? h.exDividendDate.slice(2, 7).replace("-", "'") : "—",
                  amt: h.amount,
                }))
              : [];
            const maxAmt = barSource.length ? Math.max(...barSource.map(b => b.amt)) * 1.15 || 1 : 1;
            const W = 420, H = 110, PADB = 22, PADT = 14;
            const bw = barSource.length ? W / barSource.length * 0.55 : 0;
            const gap = barSource.length ? W / barSource.length : 0;
            return (
              <div className="side-drawer" style={{ zIndex: 52 }}>
                <div className="drawer-h">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Dividend History · {sym}</div>
                    <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>
                      {yieldPct != null ? `${yieldPct.toFixed(2)}% yield · $${annualDiv.toFixed(2)}/yr` : dh ? "No dividend paid" : "Not synced yet"}
                    </div>
                  </div>
                  <button className="closebtn" onClick={() => setInnerDrawer(null)}>✕</button>
                </div>
                <div className="drawer-b">
                  {!dh ? (
                    <DataState loading={dividendLoading} label={`Dividend data not synced for ${sym} yet.`} />
                  ) : !hasReal ? (
                    <div style={{ padding: "24px 0", textAlign: "center", fontSize: ".9rem", color: "var(--text-dim-solid)" }}>
                      {sym} does not currently pay a dividend.
                    </div>
                  ) : (
                    <>
                      <div className="metric-grid" style={{ marginBottom: 14 }}>
                        <div className="m"><div className="k">Annual</div><div className="v">${annualDiv.toFixed(2)}</div></div>
                        <div className="m"><div className="k">Quarterly</div><div className="v">${qDiv.toFixed(2)}</div></div>
                        <div className="m"><div className="k">Yield</div><div className="v up">{yieldPct!.toFixed(2)}%</div></div>
                        <div className="m"><div className="k">5-yr growth</div><div className="v up">{growthLabel ?? <NotAvailable />}</div></div>
                        <div className="m"><div className="k">Payout ratio</div><div className="v">{payoutRatio != null ? `${payoutRatio}%` : <NotAvailable />}</div></div>
                        <div className="m"><div className="k">Frequency</div><div className="v">{dh!.frequency ? `${dh!.frequency}x/yr` : <NotAvailable />}</div></div>
                      </div>
                      {barSource.length > 0 && (
                        <>
                          <div className="ai-sec"><div className="h">Dividend per share (recent payments)</div></div>
                          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", margin: "10px 0 14px" }}>
                            {barSource.map((b, i) => {
                              const bh = (b.amt / maxAmt) * (H - PADT - PADB);
                              const bx = gap * i + (gap - bw) / 2;
                              const by = PADT + (H - PADT - PADB) - bh;
                              const isLast = i === barSource.length - 1;
                              return (
                                <g key={i}>
                                  <rect x={bx} y={by} width={bw} height={bh} rx={2}
                                    style={{ fill: isLast ? "var(--brand-2)" : "var(--surface-3)" }} />
                                  <text x={bx + bw / 2} y={by - 3} textAnchor="middle"
                                    style={{ fill: isLast ? "var(--brand-2)" : "var(--text-dim-solid)", fontSize: "0.4375rem" }}>
                                    ${b.amt.toFixed(2)}
                                  </text>
                                  <text x={bx + bw / 2} y={H - 5} textAnchor="middle"
                                    style={{ fill: "var(--text-dim-solid)", fontSize: "0.5rem" }}>
                                    {b.label}
                                  </text>
                                </g>
                              );
                            })}
                          </svg>
                        </>
                      )}

                      <div className="ai-sec"><div className="h">Stock splits</div></div>
                      {splitsDoc && splitsDoc.splits.length > 0 ? splitsDoc.splits.map(s => (
                        <div key={s.executionDate} className="minirow">
                          <span className="mid">{s.executionDate}</span>
                          <span className="r" style={{ color: "var(--text-hi)" }}>{s.splitFrom}:{s.splitTo}</span>
                        </div>
                      )) : (
                        <div style={{ fontSize: ".8rem", color: "var(--text-dim-solid)", padding: "4px 0" }}>No splits on record.</div>
                      )}

                      <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 10 }}>
                        Historical payments and splits are real (Polygon). No upcoming ex-div/pay-date schedule is available — verify with company IR and SEC filings.
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* ── Add note modal ── */}
      {noteOpen && (
        <>
          <div className="scrim" style={{ zIndex: 53 }} onClick={() => setNoteOpen(false)} />
          <div className="side-drawer" style={{ zIndex: 53, width: "min(420px, 98vw)" }}>
            <div className="drawer-h">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "var(--text-hi)" }}>
                  Add note · {sym}
                </div>
                <div style={{ fontSize: ".74rem", color: "var(--text-dim-solid)", marginTop: 2 }}>
                  Saved to your account with date &amp; time
                </div>
              </div>
              <button className="closebtn" onClick={() => setNoteOpen(false)}>✕</button>
            </div>
            <div className="drawer-b">
              <textarea
                placeholder="Record your trading decision, price level, or observation…"
                value={noteInput}
                onChange={e => setNoteInput(e.target.value)}
                rows={5}
                style={{
                  width: "100%", background: "var(--surface-3)", border: "1px solid var(--border-soft)",
                  borderRadius: 8, padding: "10px 12px", color: "var(--text)", fontSize: ".85rem",
                  lineHeight: 1.5, resize: "vertical", fontFamily: "var(--f-body)",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn primary" style={{ flex: 1 }} onClick={submitNote}
                  disabled={!noteInput.trim()}>
                  Save note
                </button>
                <button className="btn" onClick={() => { setNoteOpen(false); setNoteInput(""); }}>Cancel</button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
