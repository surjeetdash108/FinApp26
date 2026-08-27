"use client";

import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { useIQActions, ExpandBtn } from "../shell";
import { useWatchlistsContext } from "../hooks/useWatchlists";
import { WatchlistPicker } from "../watchlist-picker";
import { fmt, cls, arr, sign, CandleChart, ChartSelect, TF_OPTIONS, CHART_TYPE_OPTIONS, RsiPane, TrGauge, RATING_VAL, EarnQ, EarningsGrowthChart, DataState, NotAvailable, StockLogo, VendorTag, titleCaseLabel, type ChartEarnings } from "../utils";
import { buildChartEarnings } from "../chart-earnings";
import { firebaseAuth } from "../../firebase";
import { apiGet, apiPost, apiDelete } from "../backend";
import { useApiResource } from "../hooks/useApiResource";
import { useApiList } from "../hooks/useApiList";
import { useBackendBars } from "../hooks/useBackendBars";
import { useLiveTick } from "../hooks/useLiveTick";
import { useLiveQuotes } from "../live-quotes-context";
import { EarningsPlaybook } from "./EarningsPlaybook";
import type {
  CompanyDoc, AnalystConsensusDoc, InsiderTxDoc,
  DividendHistoryDoc, SplitsDoc, FinancialsDoc, QuarterFinancials, AnnualFinancials, EpsHistoryRow, NewsArticleDoc, LiveEarningsDoc, SectorApiDoc, AiAnalysisDoc,
} from "../types";
import { reportedQuarterEps, quarterEpsSurprisePct, reportedAnnualEps } from "../types";
import { pctChangeStr, epsSalesSeries, annualEpsSalesRows, quarterlyEpsSalesRows, type EpsSalesPt } from "../eps-sales-data";
import { surprisePct } from "../types";

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
// Classic (floor-trader) pivot support/resistance from a prior period's H/L/C.
// Computed client-side from the OHLC bars the chart already loads, so every
// opened ticker shows levels regardless of the backend technicals sweep.
type Pivots = { pivot: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number };
/** Polygon's SIC industry strings are ALL-CAPS ("PERFUMES, COSMETICS…"); title-
 *  case them for display. FMP industries are already clean mixed-case, so a
 *  string that isn't all-uppercase passes through unchanged. */
function pivotsFrom(h: number, l: number, c: number): Pivots {
  const p = (h + l + c) / 3, range = h - l;
  return { pivot: p, r1: 2 * p - l, s1: 2 * p - h, r2: p + range, s2: p - range, r3: h + 2 * (p - l), s3: l - 2 * (h - p) };
}
// H/L/C of the last COMPLETE week (excludes the current, partial week).
function priorWeekHLC(bars: { t: number; h: number; l: number; c: number }[]): { h: number; l: number; c: number } | null {
  const weeks = new Map<string, { h: number; l: number; c: number; t: number }>();
  for (const b of bars) {
    const d = new Date(b.t);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
    const key = d.toISOString().slice(0, 10);
    const cur = weeks.get(key);
    if (!cur) weeks.set(key, { h: b.h, l: b.l, c: b.c, t: b.t });
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); if (b.t >= cur.t) { cur.c = b.c; cur.t = b.t; } }
  }
  const keys = [...weeks.keys()].sort();
  if (keys.length < 2) return null;
  const w = weeks.get(keys[keys.length - 2])!;
  return { h: w.h, l: w.l, c: w.c };
}
// Drop a still-forming current-day bar from a daily series so client-side pivot
// fallbacks use the last FULLY-COMPLETED session — mirrors the backend keyLevels
// basis (technical-indicators.job `marketTimeEt`). A bar dated for today's ET
// session is complete only once 16:00 ET (the regular-session close) has passed;
// before that it is a partial intraday aggregate. Tradeoff: early-close half-days
// read as open until 16:00 ET — conservative (falls back to the prior completed
// session, never a partial bar).
function completedSessions<T extends { t: number }>(bars: T[]): T[] {
  if (!bars.length) return bars;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  const etDate = `${g("year")}-${g("month")}-${g("day")}`;
  const regularSessionClosed = (Number(g("hour")) % 24) >= 16; // 16:00 ET close
  const last = bars[bars.length - 1];
  const lastDate = new Date(last.t).toISOString().slice(0, 10);
  const lastIsCurrentOpenSession = lastDate === etDate && !regularSessionClosed;
  return lastIsCurrentOpenSession ? bars.slice(0, -1) : bars;
}
function lastCompletedSessionBar<T extends { t: number }>(bars: T[]): T | null {
  const done = completedSessions(bars);
  return done.length ? done[done.length - 1] : null;
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

/**
 * Vendor name for display. The backend tags a quote's source with the code path
 * that served it — "polygon-ondemand", "fmp-ondemand" (ondemand.service.ts) —
 * which is a backend concern; the reader of the pill only wants to know whose
 * price this is. Strips that suffix and keeps FMP an initialism rather than
 * "Fmp". The stored `source` value itself is untouched.
 */
function vendorLabel(source: string | null | undefined): string {
  const base = (source ?? "polygon").replace(/-ondemand$/i, "").trim();
  if (!base) return "Polygon";
  return base.toLowerCase() === "fmp" ? "FMP" : base[0].toUpperCase() + base.slice(1);
}

const EXCHANGE: Record<string, string> = {
  AAPL: "NASDAQ", NVDA: "NASDAQ", MSFT: "NASDAQ", GOOGL: "NASDAQ", META: "NASDAQ",
  AMZN: "NASDAQ", TSLA: "NASDAQ", JPM: "NYSE", V: "NYSE", UNH: "NYSE",
  AVGO: "NASDAQ", CRM: "NYSE", PLTR: "NYSE", INTC: "NASDAQ", WBA: "NASDAQ",
  DELL: "NYSE", ZIM: "NYSE", AMD: "NASDAQ", MU: "NASDAQ", SMCI: "NASDAQ",
};

const ac = (a: string) => a === "Buy" ? "var(--up)" : a === "Sell" ? "var(--down)" : "var(--text-dim-solid)";

/**
 * Colour for an ANALYST consensus label.
 *
 * This exists because the consensus label used to be painted with `tone`, which
 * is the TECHNICAL gauge's colour. The two are different readings — technicals
 * are oscillators and moving averages, consensus is analyst votes — and they
 * disagree often and legitimately. Pairing them meant IREN's "Buy" consensus
 * (10 buy / 3 hold / 1 sell) rendered in the Sell red, because its technicals
 * read Sell: the word and its colour said opposite things.
 *
 * Three levels, matching the Sell/Hold/Buy counts rendered directly beneath it.
 * Deliberately NOT ac() above, which grades oscillator verdicts where "Strong"
 * and "Weak" describe signal strength rather than direction.
 */
const consensusTone = (c: string | null | undefined): string => {
  const k = (c ?? "").trim().toLowerCase();
  if (k === "buy" || k === "strong buy" || k === "outperform") return "var(--up)";
  if (k === "sell" || k === "strong sell" || k === "underperform") return "var(--down)";
  return "var(--text-dim-solid)";
};

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








/** One single-series bar chart (EPS or Sales), zero-baselined so a negative
 * period reads correctly, with the value labelled on top of each bar and the
 * period label angled underneath — matching the reference layout. */
function MetricBars({
  title, data, fmt,
}: {
  title: string;
  data: Array<{ label: string; v: number | null }>;
  fmt: (v: number) => string;
}) {
  const gid = "gb-" + title.replace(/\W/g, "");
  const vals = data.map(d => d.v).filter((v): v is number => v != null);
  // PADB/label baseline give the -45°-rotated period labels room to extend
  // down-left without clipping at the viewBox bottom (they used to lose their
  // first 1-2 chars, e.g. "Jan-24" → "n-24"). ih is unchanged so bars keep size.
  const W = 340, H = 222, PADT = 22, PADB = 46, PADX = 6;
  const LABEL_Y = H - 30;
  const iw = W - PADX * 2, ih = H - PADT - PADB;
  const maxV = Math.max(0, ...vals);
  const minV = Math.min(0, ...vals);
  const span = (maxV - minV) || 1;
  const yOf = (v: number) => PADT + ((maxV - v) / span) * ih;
  const zeroY = yOf(0);
  const gw = iw / Math.max(1, data.length);
  const bw = Math.min(gw * 0.6, 26);
  return (
    <div>
      <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-dim-solid)", marginBottom: 2 }}>{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand-2)" />
            <stop offset="100%" stopColor="var(--brand)" />
          </linearGradient>
        </defs>
        {data.map((d, i) => {
          if (d.v == null) return null;
          const cx = PADX + gw * i + gw / 2;
          const yv = yOf(d.v);
          const y = Math.min(zeroY, yv);
          const h = Math.max(2, Math.abs(yv - zeroY));
          const above = d.v >= 0;
          return (
            <g key={d.label + i}>
              <rect x={(cx - bw / 2).toFixed(1)} y={y.toFixed(1)}
                width={bw.toFixed(1)} height={h.toFixed(1)} rx="2.5" fill={`url(#${gid})`} />
              <text x={cx.toFixed(1)} y={(above ? y - 4 : y + h + 9).toFixed(1)}
                textAnchor="middle" fontSize="8" fontFamily="JetBrains Mono,monospace"
                fill="var(--text-hi)">{fmt(d.v)}</text>
              <text x={cx.toFixed(1)} y={LABEL_Y.toFixed(1)} textAnchor="end"
                fontSize="7.5" fill="var(--text-dim-solid)"
                transform={`rotate(-45 ${cx.toFixed(1)} ${LABEL_Y.toFixed(1)})`}>{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** The reference layout's headline: EPS and Sales($Mil) bars side by side,
 * driven by the same Quarterly/Annual toggle as the rest of the card. */
function EpsSalesBars({ data }: { data: EpsSalesPt[] }) {
  // EPS and Sales in SEPARATE bordered boxes so each is identified on its own
  // (matches the Earnings Hub's split EPS / Sales cards).
  const box = { border: "1px solid var(--border-soft)", borderRadius: 10, background: "var(--surface-2)", padding: "10px 12px" };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <div style={box}>
        <MetricBars title="EPS" data={data.map(d => ({ label: d.label, v: d.eps }))}
          fmt={v => v.toFixed(2)} />
      </div>
      <div style={box}>
        <MetricBars title="Sales ($Mil)" data={data.map(d => ({ label: d.label, v: d.sales }))}
          fmt={v => Math.round(v).toLocaleString()} />
      </div>
    </div>
  );
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
            <rect x={(cx - bw - 2).toFixed(1)} y={(PADT + ih - eh).toFixed(1)} width={bw.toFixed(1)} height={eh.toFixed(1)} rx="2" style={{ fill: "var(--text-dim-solid)" }} />
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
  // Fill the card's full width instead of capping at a fixed 380px. The viewBox
  // width tracks the measured container width so the chart stretches edge to
  // edge at a fixed height — bars spread out, and text/bar sizes stay natural
  // (a plain maxWidth removal would scale the whole SVG up and distort both).
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => { const cw = el.clientWidth; if (cw > 0) setW(cw); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const d = [...inc].reverse();
  const H = 200, PADL = 8, PADR = 8, PADT = 14, PADB = 26;
  const iw = W - PADL - PADR, ih = H - PADT - PADB;
  const max = Math.max(...d.map(x => x.rev)) * 1.12 || 1;
  const gw = iw / d.length, bw = Math.min(gw * 0.2, 26);
  const series: Array<{ key: "rev" | "gp" | "ni"; color: string }> = [
    { key: "rev", color: "var(--brand)" },
    { key: "gp",  color: "var(--ai)" },
    { key: "ni",  color: "var(--up)" },
  ];
  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }}>
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
    </div>
  );
}

function EarnPane({ hist10 }: { hist10: EarnQ[] }) {
  const hist = hist10.slice(0, 8).reverse();
  const W = 720, H = 80, PADL = 40, PADR = 20, PADT = 10, PADB = 18;
  const iw = W - PADL - PADR;
  const ih = H - PADT - PADB;
  const mid = PADT + ih / 2;
  const gw = iw / hist.length;
  // Same bar width as the EPS history / Earnings-Growth charts (gw * 0.28) so
  // every earnings histogram reads consistently across the app.
  const bw = gw * 0.28;
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
              fill="var(--text-dim-solid)" fontSize="7.5" fontFamily="JetBrains Mono,monospace">
              {q.q.replace(" ", "'")}
            </text>
          </g>
        );
      })}

      {/* Beat/miss labels on Y axis */}
      <text x={PADL - 4} y={(mid - 2).toFixed(1)} textAnchor="end"
        fill="var(--text-dim-solid)" fontSize="7" fontFamily="JetBrains Mono,monospace">BEAT</text>
      <text x={PADL - 4} y={(mid + 10).toFixed(1)} textAnchor="end"
        fill="var(--text-dim-solid)" fontSize="7" fontFamily="JetBrains Mono,monospace">MISS</text>
    </svg>
  );
}

function StockChartExpanded({
  sym, px, initialTf, initialChartType, initialMaStep, initialEmaStep,
  initialShowVol, initialShowRsi, initialShowEarnings, hist10, rsi, rsiLoading, erDate,
  earnings,
}: {
  sym: string; px: number; initialTf: string;
  initialChartType: "Candles" | "Hollow" | "Bars" | "Line" | "Area";
  initialMaStep: number; initialEmaStep: number;
  initialShowVol: boolean; initialShowRsi: boolean; initialShowEarnings: boolean;
  hist10: EarnQ[]; rsi: number | null; rsiLoading: boolean; erDate: string;
  /** Reported quarters for the dots. Without this the Earnings toggle below
   *  was inert: it flipped state that nothing read, so the expanded chart never
   *  drew a dot and its timeframe dropdown had no earnings to re-filter. */
  earnings: ChartEarnings[];
}) {
  const [tf, setTf] = useState(initialTf);
  const [chartType, setChartType] = useState(initialChartType);
  const [maStep, setMaStep] = useState(initialMaStep);
  const [emaStep, setEmaStep] = useState(initialEmaStep);
  const [showVol, setShowVol] = useState(initialShowVol);
  const [showRsi, setShowRsi] = useState(initialShowRsi);
  const [showEarnings, setShowEarnings] = useState(initialShowEarnings);
  const { bars: realBars } = useBackendBars(sym, tf);
  const live = useLiveTick(sym);
  const isUp = px > 0;
  return (
    <div>
      <div className="chart-toolbar" style={{ flexWrap: "wrap", gap: "4px 0", paddingBottom: 8 }}>
        <ChartSelect value={tf} options={TF_OPTIONS} onChange={v => setTf(v as typeof tf)} title="Timeframe" />
        <ChartSelect value={chartType} options={CHART_TYPE_OPTIONS} onChange={v => setChartType(v as typeof chartType)} title="Chart type" />
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
      <CandleChart sym={sym} tf={tf} px={px} maStep={maStep} emaStep={emaStep} showVol={showVol} chartType={chartType.toLowerCase()} realBars={realBars}
        live={live.tick ? { price: live.tick.price, high: live.tick.high, low: live.tick.low } : null}
        earnings={showEarnings ? earnings : []} />
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

  // Switch immediately when the global search picks a ticker, even if this
  // screen is already mounted (router-cached) and doesn't re-read localStorage.
  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<string>).detail;
      if (next) setSym(next);
    };
    window.addEventListener("iq-stock-change", onChange);
    return () => window.removeEventListener("iq-stock-change", onChange);
  }, []);
  const [search, setSearch] = useState("");
  const [tfActive, setTfActive] = useState("3M");
  const [showVol, setShowVol] = useState(true);
  const [showRsi, setShowRsi] = useState(false);
  // Default ON: the earnings dots are the chart's main annotation, and behind a
  // default-off toggle they were invisible unless you knew to look for the
  // button. The toggle still turns them off for a clean price-only chart.
  const [showEarnings, setShowEarnings] = useState(true);
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
  const { bars: realBars, asOf: barsAsOf } = useBackendBars(sym, tfActive);
  // Live (delayed) price stream for the header + chart overlay: SSE push with a
  // /live/quotes poll fallback (Firebase Hosting doesn't proxy the SSE stream).
  const live = useLiveTick(sym);

  // Per-ticker profile + dividend/split/financials history — cache-aside via
  // GET /live/company|/live/dividend-history|/live/splits|/live/financials
  // (replacing the direct companies Firestore listener this screen used to
  // hold open). Re-fetches whenever `sym` changes since it's part of the path.
  const { data: liveCompany, loading: liveCompanyLoading } = useApiResource<CompanyDoc>(`/live/company?ticker=${encodeURIComponent(sym)}`);
  // Which symbol's "no data" popup the user has dismissed (so it doesn't reopen).
  const [dismissedNoData, setDismissedNoData] = useState("");
  const { data: dividendHistory, loading: dividendLoading } = useApiResource<DividendHistoryDoc>(`/live/dividend-history?ticker=${encodeURIComponent(sym)}`);
  const { data: splitsDoc } = useApiResource<SplitsDoc>(`/live/splits?ticker=${encodeURIComponent(sym)}`);
  const { data: financialsDoc, loading: financialsLoading } = useApiResource<FinancialsDoc>(`/live/financials?ticker=${encodeURIComponent(sym)}`);
  const { data: tickerNews } = useApiResource<NewsArticleDoc[]>(`/live/news?ticker=${encodeURIComponent(sym)}`);
  // On-demand AI read (technicals + news synthesised by OpenRouter), cached 30
  // min server-side. Appended below the deterministic rows + news list.
  const { data: aiAnalysis, loading: aiLoading, error: aiError } = useApiResource<AiAnalysisDoc>(`/live/ai-analysis?ticker=${encodeURIComponent(sym)}`);

  // ── Notes (Firebase stock_comments) ──────────────────────────────────────
  const [notes, setNotes]       = useState<StockNote[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [noteOpen, setNoteOpen]  = useState(false);
  const [ctxMenu, setCtxMenu]    = useState<{ x: number; y: number } | null>(null);

  type InnerDrawer = "techrating" | "peers" | "industry" | "insider" | "keylevels" | "earnings" | "financials" | "dividend" | null;
  const [innerDrawer, setInnerDrawer] = useState<InnerDrawer>(null);
  // Peers list sort by session % change; default desc (best performers first).
  const [peerSort, setPeerSort] = useState<"desc" | "asc">("desc");
  const [finPeriod,   setFinPeriod]   = useState<"Q" | "A">("Q");

  // Watchlists are backend-synced (multiple named lists). The star is "filled"
  // when the ticker is in ANY list; clicking it opens the which-list picker.
  const { watchlists, addTicker, removeTicker, createList } = useWatchlistsContext();
  const watchedSet = useMemo(() => new Set(watchlists.flatMap(w => w.tickers)), [watchlists]);
  const [wlPicker, setWlPicker] = useState<{ sym: string; x: number; y: number } | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  // Cross-column height match (generic — works for any stock, any peer count):
  // pin the RIGHT column to the LEFT column's natural height and let the Peers
  // card scroll inside it, so Key levels always lands at the base of the right
  // column, aligned with the bottom of Financials. Measuring is the only robust
  // way — a long Peers list (e.g. 89 peers) would otherwise balloon the grid row
  // and push Key levels far below Financials. Disabled below 901px, where
  // .sd-grid collapses to a single stacked column.
  const leftColRef = useRef<HTMLDivElement>(null);
  const [rightColH, setRightColH] = useState<number | undefined>(undefined);
  // Read the left column's height synchronously (offsetHeight forces a fresh
  // layout) and pin the right column to it. Called from useEffects (which run
  // after the DOM is committed) so charts / earnings tables that render when data
  // arrives are already measured — no requestAnimationFrame, which the browser
  // throttles when the tab isn't painting. The <2px guard prevents redundant
  // updates and any ResizeObserver feedback loop.
  const measureCols = useCallback(() => {
    const el = leftColRef.current;
    if (!el || typeof window === "undefined") return;
    const next = window.matchMedia("(min-width: 901px)").matches ? el.offsetHeight : undefined;
    setRightColH(prev => (prev != null && next != null && Math.abs(prev - next) < 2 ? prev : next));
  }, []);
  useEffect(() => {
    const el = leftColRef.current;
    if (!el || typeof window === "undefined") return;
    const ro = new ResizeObserver(() => measureCols());
    ro.observe(el);
    window.addEventListener("resize", measureCols);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measureCols);
    };
  }, [measureCols]);
  // The LEFT column keeps growing after mount as async content lands (financials
  // charts, the earnings table, web-font reflow) — and a single measure or even
  // the ResizeObserver can miss the final jump. Poll briefly whenever the stock
  // (or Q↔A toggle) changes and stop once the height has settled. Generic: works
  // for any stock and any peer count. Re-keyed on sym/finPeriod.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let last = -1, stable = 0, n = 0;
    measureCols();
    const id = window.setInterval(() => {
      const el = leftColRef.current;
      const h = el ? el.offsetHeight : -1;
      measureCols();
      if (h === last) stable++; else { stable = 0; last = h; }
      if (stable >= 3 || ++n >= 24) window.clearInterval(id); // settled ~750ms, hard cap ~6s
    }, 250);
    return () => window.clearInterval(id);
  }, [measureCols, sym, finPeriod]);

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
  const symbolList = [...companies].filter(c => !!c.ticker).sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)).map(c => c.ticker);
  // Match by ticker prefix OR company name (so "apple" finds AAPL), largest first.
  const suggestions: { ticker: string; name: string }[] = search
    ? (() => {
        const q = search.toLowerCase();
        const qUpper = search.toUpperCase();
        // Rank by match quality (exact ticker → ticker-prefix → name-prefix →
        // name-substring) so an exact-ticker match always wins over a larger-cap
        // company that merely CONTAINS the query in its name. Prevents a short
        // foreign/ambiguous query (e.g. "ITC"/"TCS"/"RELIANCE") from surfacing an
        // unrelated US security above the exact match; market cap only breaks ties
        // within a tier. The company name is shown per row for disambiguation.
        const rank = (c: (typeof companies)[number]) => {
          const tk = (c.ticker ?? "").toUpperCase();
          if (tk === qUpper) return 0;
          if (tk.startsWith(qUpper)) return 1;
          if ((c.name ?? "").toLowerCase().startsWith(q)) return 2;
          return 3;
        };
        return [...companies]
          .filter(c => {
            if (!c.ticker) return false;
            return c.ticker.toLowerCase().startsWith(q) || (c.name ?? "").toLowerCase().includes(q);
          })
          .sort((a, b) => rank(a) - rank(b) || (b.marketCap ?? 0) - (a.marketCap ?? 0))
          .slice(0, 8)
          .map(c => ({ ticker: c.ticker, name: c.name ?? c.ticker }));
      })()
    : [];

  const isLiveStock = !!liveCompany && liveCompany.price != null;
  // No usable market data for the searched ticker (delisted, brand-new, or
  // non-US listing) — nothing priced came back after the fetch settled.
  const noData = !liveCompanyLoading && !!liveCompany && liveCompany.price == null && liveCompany.marketCap == null;
  const showNoDataPopup = noData && dismissedNoData !== sym;

  // Real 52-week high/low and average volume from a year of daily bars.
  const yr = yearBars ?? [];
  // Support/resistance pivots. PREFER the backend keyLevels (technical-indicators
  // job) — the single corrected source of truth: it derives classic pivots from
  // the last FULLY-COMPLETED session's finalized OHLC. The 1Y chart series (`yr`,
  // from /live/bars) can trail the official close by a session and/or carry a
  // partial current-day bar, so recomputing from it client-side is a FALLBACK only
  // when keyLevels is absent — and even then we use the last COMPLETED session bar
  // (never a still-forming current-day bar) to match the backend basis.
  const basisBar = lastCompletedSessionBar(yr);
  const priorWk = priorWeekHLC(completedSessions(yr));
  const klDaily: Pivots | { pivot: number | null; r1: number | null; r2: number | null; r3: number | null; s1: number | null; s2: number | null; s3: number | null } | null =
    (liveCompany?.keyLevels?.daily ?? null)
    ?? (basisBar ? pivotsFrom(basisBar.h, basisBar.l, basisBar.c) : null);
  const klWeekly =
    (liveCompany?.keyLevels?.weekly ?? null)
    ?? (priorWk ? pivotsFrom(priorWk.h, priorWk.l, priorWk.c) : null);
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
    description: liveCompany?.description ?? null,
    homepageUrl: liveCompany?.homepageUrl ?? null,
    // Null (not 0) when the company doc has no price yet, so the header renders a
    // loading dash instead of a fabricated $0.00 / +0.00% (BUG-DATA-007).
    price: liveCompany?.price ?? null,
    pctChange: liveCompany?.pctChange ?? null,
    peRatio: liveCompany?.peRatio ?? null,
    dividendYield: liveCompany?.dividendYield ?? null,
    beta: liveCompany?.beta ?? null,
    sector: liveCompany?.sector ?? null,
    industry: liveCompany?.industry ?? null,
    insiderActivity: symInsider,
    week52High: week52?.high ?? null,
    week52Low: week52?.low ?? null,
  };
  const isUp = (data.pctChange ?? 0) >= 0;
  // `p` keeps a 0 fallback purely as the numeric baseline for the derived
  // technical stats and the chart below (which have always assumed a number).
  // The header quote uses the nullable `data.price` / `dispPrice` directly, so a
  // genuinely-missing price shows a dash rather than $0.00 (BUG-DATA-007).
  const p = data.price ?? 0;

  // Cross-column height match: the LEFT column ends at Financials (Dividend &
  // Insider moved to a full-width row below the two-column section). The RIGHT
  // column is pinned to leftColRef's measured height (see measureCols above) so
  // Peers scrolls inside it and Key levels sits at the base, level with
  // Financials' bottom border — regardless of peer count.

  const rating = ratingLabel(liveCompany?.techRating ?? null);
  const rs = liveCompany?.rsRating ?? null;
  const rv = liveCompany?.rvol ?? null;
  const mc = liveCompany?.marketCap != null ? liveCompany.marketCap / 1e9 : null;
  const gv = RATING_VAL[rating] ?? 0;
  // (The technical `tone` that used to live here is gone: TrGauge already
  // colours its own label from `rating`, and its only other consumer was the
  // analyst-consensus label, which now derives its colour from the consensus
  // itself via consensusTone.)
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
  // Earnings dots for both charts on this screen. Shared derivation (see
  // chart-earnings.ts) so the panel charts on watchlist / portfolio / screener /
  // movers / IPOs place the same reports at the same points. Called with the
  // financials doc this screen already fetched, rather than via
  // useChartEarnings, to avoid fetching it a second time.
  const chartEarnings: ChartEarnings[] = buildChartEarnings(financialsDoc, symEvents, todayStr);

  // EPS (TTM): the stored trailing-twelve-month EPS from the company doc, shown
  // as-is — NOT reconstructed as price ÷ P/E (circular: the sync-time P/E was
  // itself derived from EPS, so live-price ÷ stale-P/E drifts). N/A when unstored
  // (BUG-DATA-006). `epsTtm`/`eps` are written by the /live/company backend
  // (ondemand.service) and are now declared on the shared CompanyDoc mirror.
  const eps = liveCompany?.epsTtm ?? liveCompany?.eps ?? null;
  // Real RSI(14)/MACD from technical-indicators.job — "not available" (never
  // a seeded formula) until that job has run for this ticker.
  const rsi = liveCompany?.rsi14 ?? null;
  const macd = liveCompany?.macd ?? null;
  const macdBuy = macd != null ? macd >= (liveCompany?.macdSignal ?? 0) : null;
  const stochKv = liveCompany?.stochK ?? null;
  const adx14 = liveCompany?.adx14 ?? null;
  // technical-indicators.job also writes these; they were being rendered as
  // "N/A" in the Technical Rating drawer even though the values were present.
  const vwapV = liveCompany?.vwap ?? null;
  const offHigh52 = liveCompany?.pctFromHigh52 ?? null;
  const offLow52 = liveCompany?.pctFromLow52 ?? null;
  const rsiSeries = liveCompany?.rsi14Series ?? null;
  const divPerShare = liveCompany?.dividendPerShare ?? null;
  const dollar = data.pctChange != null ? Math.abs((data.pctChange / 100) * p) : null;

  // Live overlay values for the header. Kept separate from `p`/`dollar` so the
  // many derived stats below (EPS, 52w positioning, chart baseline) stay pinned
  // to the company snapshot and don't churn on every tick.
  // Headline price/%: prefer the SHARED app-wide quote so this drawer shows the
  // exact same number as the heatmap tile / movers row for the same ticker.
  // useLiveTick still drives the intraday chart overlay below.
  const sharedQuote = useLiveQuotes([sym]).get(sym);
  const livePrice = sharedQuote?.price ?? live.tick?.price ?? null;
  // Nullable: live tick, then the company snapshot — but NOT `p`'s 0 fallback, so
  // an entirely-unknown quote stays null and the header renders a dash instead of
  // $0.00 (BUG-DATA-007).
  const dispPrice = livePrice ?? data.price;
  const dispPct = sharedQuote?.pctChange ?? live.pct ?? data.pctChange;
  // Derive the $ move from whichever feed supplied the price and % above, so the
  // three numbers in the header always describe the same tick. Taking it from
  // live.change while price/% came from sharedQuote mixed two independent polls:
  // $6.10 could sit beside a price and % captured seconds apart.
  //   prevClose = price / (1 + pct/100)  =>  change = price - prevClose
  const sharedDollar =
    sharedQuote?.price != null && sharedQuote.pctChange != null
      ? Math.abs(
          sharedQuote.price - sharedQuote.price / (1 + sharedQuote.pctChange / 100),
        )
      : null;
  const dispDollar =
    sharedDollar ?? (live.change != null ? Math.abs(live.change) : dollar);
  // Freshness stamp for the price-chart bars (backend createdAt), surfaced by the
  // chart toolbar in the same muted style as the header's delayed-quote marker
  // (BUG-DATA-008).
  const barsAsOfLabel = (() => {
    if (!barsAsOf) return null;
    const d = new Date(barsAsOf);
    return isNaN(d.getTime())
      ? barsAsOf
      : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  })();

  // v is in $B. Below $1B, show millions so micro-caps (e.g. GAUZ ≈ $9M) read
  // "$9.1M" rather than rounding to a meaningless "$0.0B".
  const cap = (v: number) =>
    v >= 1000 ? `$${(v / 1000).toFixed(2)}T`
    : v >= 10 ? `$${Math.round(v)}B`
    : v >= 1  ? `$${v.toFixed(1)}B`
    : v > 0   ? `$${(v * 1000).toFixed(v < 0.1 ? 1 : 0)}M`
    : "—";
  const nf = (x: number) => Math.round(x).toLocaleString("en-US");
  // 52-week range, guarded against reverse-split artifacts. The high/low come
  // from SPLIT-ADJUSTED bars, so a serial reverse-splitter's adjusted history
  // explodes: SXTC (150:1 in Feb + 80:1 in Aug 2026) shows a $83,758 "52-week
  // high" against a $3.63 price. Arithmetically the adjusted equivalent, but as
  // a headline it is nonsense — 20 tickers in the live universe were affected.
  // A genuine 52-week range practically never exceeds ~20x, so beyond that we
  // show nothing rather than a fabricated number (this one guard covers the
  // range, the Off-High/Off-Low stats and the drawer, which all read lo/hi).
  const MAX_52W_RATIO = 20;
  const rawLo = data.week52Low, rawHi = data.week52High;
  const range52Reliable =
    rawLo == null || rawHi == null || rawLo <= 0 ? true : rawHi / rawLo <= MAX_52W_RATIO;
  let lo = range52Reliable ? rawLo : null;
  let hi = range52Reliable ? rawHi : null;
  // Foreign / on-demand tickers often lack a stored week52High/Low but DO carry
  // pctFromHigh52 / pctFromLow52 — derive the range from those + the price so the
  // 52W-Range tile stays consistent with the Off-52W-High/Low stats (which read
  // those percentages) instead of showing N/A next to real off-high/low values.
  // Only when the RAW values were missing — never resurrect a ratio-suppressed
  // (reverse-split-artifact) range.
  if ((rawLo == null || rawHi == null) && p > 0) {
    if (hi == null && offHigh52 != null && 1 + offHigh52 / 100 > 0) hi = p / (1 + offHigh52 / 100);
    if (lo == null && offLow52 != null && 1 + offLow52 / 100 > 0) lo = p / (1 + offLow52 / 100);
  }

  // Trend / MA posture. When the ticker is ranked in the synced universe we use
  // the RS-rank read; otherwise (on-demand tickers with no RS rank) we derive it
  // from price vs its 50-day EMA and 200-day SMA — both computed client-side from
  // the year of daily bars — so the read still shows for every stock, not just
  // ranked ones.
  const aboveEma50 = ema50 != null ? p > ema50 : null;
  const above200   = sma200 != null ? p > sma200 : null;
  const haveMA     = aboveEma50 != null || above200 != null;
  // Built as JSX, not as a string containing <b> tags. These rows render through
  // {l[1]}, which escapes strings — so markup embedded in one reached the reader
  // as literal "<b>Range / consolidation.</b>" on the stock page.
  const lead = (bold: string, rest: string) => (<><b>{bold}</b> {rest}</>);
  const trendTxt: ReactNode = rs != null
    ? (isUp && rs >= 70
        ? lead("Strong uptrend.", "Higher highs and higher lows; momentum confirmed by recent strength.")
        : rs < 40
        ? lead("Downtrend.", "Lower highs and lower lows; price is below key moving averages.")
        : lead("Range / consolidation.", "Choppy two-way action with no decisive trend yet."))
    : haveMA
    ? (aboveEma50 && above200
        ? lead("Uptrend.", "Price is trading above both its 50-day and 200-day moving averages.")
        : aboveEma50 === false && above200 === false
        ? lead("Downtrend.", "Price is below both its 50-day and 200-day moving averages.")
        : lead("Range / consolidation.", "Price is mixed around its moving averages."))
    : "Trend read not available yet — no price history synced.";
  const maTxt = rs != null
    ? (rs >= 60 ? "Above the 20, 50 and 200-day — bullish alignment."
        : rs < 40 ? "Below the 50 and 200-day — bearish alignment."
        : "Mixed: hugging the 50-day with a flat 200-day.")
    : haveMA
    ? (aboveEma50 && above200
        ? "Above the 50-day and 200-day — bullish alignment."
        : aboveEma50 === false && above200 === false
        ? "Below the 50-day and 200-day — bearish alignment."
        : `${aboveEma50 ? "Above" : "Below"} the 50-day, ${above200 ? "above" : "below"} the 200-day — mixed.`)
    : "Moving-average posture not available yet.";

  const indRows: [string, string | null, string][] = [
    ["RSI (14)", rsi != null ? rsi.toFixed(2) : null, rsi == null ? "" : rsi > 70 ? "Sell" : rsi < 40 ? "Buy" : "Neutral"],
    ["MACD (12,26)", macd != null ? macd.toFixed(1) : null, macdBuy == null ? "" : macdBuy ? "Buy" : "Sell"],
    // Stoch %K and Wilder ADX(14) now computed by technical-indicators.job.
    ["Stoch %K", stochKv != null ? stochKv.toFixed(1) : null, stochKv == null ? "" : stochKv > 80 ? "Sell" : stochKv < 20 ? "Buy" : "Neutral"],
    ["ADX (14)", adx14 != null ? adx14.toFixed(1) : null, adx14 == null ? "" : adx14 > 25 ? "Strong" : adx14 < 20 ? "Weak" : "Neutral"],
    ["EMA 50", ema50 != null ? nf(ema50) : null, ema50 != null ? (isUp ? "Buy" : "Sell") : ""],
    ["SMA 200", sma200 != null ? nf(sma200) : null, sma200 != null ? (p > sma200 ? "Buy" : "Sell") : ""],
  ];

  // Real 10-quarter EPS history from the per-ticker financials feed
  // (/live/financials) — reported EPS is always present; the estimate/%surp
  // fill in where the FMP estimate feed has it. (The market-wide earnings
  // calendar carries estimates for only a few names, so it left this empty.)
  // Foreign private issuers / ADRs (e.g. GAUZ, a 20-F filer) commonly have NO
  // Polygon/FMP statement `quarters` synced yet DO carry a deep FMP `epsHistory`.
  // Fall back to that so the EPS-growth chart shows reported EPS instead of an
  // empty state when statements simply don't exist for the ticker.
  type EpsSrc = {
    endDate: string | null; fiscalPeriod: string | null; fiscalYear: string | number | null;
    epsActual: number | null; epsEstimate: number | null;
    epsActualReported?: number | null; epsEstimateReported?: number | null;
  };
  const qRows: EpsSrc[] = financialsDoc?.quarters ?? [];
  const epsSrc: EpsSrc[] = qRows.some(q => q.epsActual != null)
    ? qRows
    : (financialsDoc?.epsHistory ?? []).map(h => ({
        endDate: h.date ?? null, fiscalPeriod: h.fiscalPeriod, fiscalYear: h.fiscalYear,
        epsActual: h.epsActual, epsEstimate: h.epsEstimate,
      }));
  const hist10: EarnQ[] = epsSrc
    .filter(q => q.epsActual != null)
    .slice()
    .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""))
    .slice(0, 10)
    .map(q => {
      // Beat/miss + the shown actual/estimate use the FMP matched pair
      // (epsActualReported/epsEstimateReported — same basis, split-normalized),
      // never Polygon GAAP actual vs a non-GAAP estimate. GAAP is a display-only
      // fallback for the actual; e=0 (→ "—") when there's no matched pair.
      const repAct = q.epsActualReported ?? null;
      const repEst = q.epsEstimateReported ?? null;
      const pairedSurp = surprisePct(repAct, repEst);
      const paired = pairedSurp != null;
      const act = repAct ?? (q.epsActual as number);
      const surp = pairedSurp ?? 0;
      return {
        q: q.endDate
          ? new Date(q.endDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" })
          : `${q.fiscalPeriod ?? ""} ${q.fiscalYear ?? ""}`.trim(),
        e: paired && repEst != null ? repEst : 0, a: act, surp: parseFloat(surp.toFixed(1)), mv: 0,
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

  // Real peers from Polygon /v1/related-companies (stored on liveCompany.peers),
  // looked up in the live companies for price/RS. Falls back to same-sector RS
  // leaders only if none of the related tickers are in the synced universe.
  // Raw related-tickers Polygon returned for this symbol. This is "how many
  // peers are in the response".
  type PeerRow = { t: string; c: number; rsRating: number | null; name: string | null };
  const rawPeerTickers = (liveCompany?.peers ?? []).filter(t => t !== sym);
  const inUniverse = new Set(companies.map(c => c.ticker));
  // Peers not in the synced universe are priced on demand (one snapshot call),
  // so EVERY peer Polygon returned can be shown — not just the synced ones.
  const missingPeers = rawPeerTickers.filter(t => !inUniverse.has(t));
  const quoteByTicker = useLiveQuotes(missingPeers);

  const relatedPeersAll: PeerRow[] = rawPeerTickers.map(t => {
    const c = companies.find(x => x.ticker === t);
    if (c && c.pctChange != null) return { t: c.ticker, c: c.pctChange as number, rsRating: c.rsRating, name: c.name };
    const q = quoteByTicker.get(t);
    if (q && q.pctChange != null) return { t, c: q.pctChange, rsRating: null, name: null };
    return null;
  }).filter((x): x is PeerRow => !!x);
  // Fallback to same-sector RS leaders only if none of the related tickers resolve.
  const peersAll: PeerRow[] = relatedPeersAll.length
    ? relatedPeersAll
    : companies
        .filter(c => c.sector === group && c.ticker !== sym && c.pctChange != null)
        .sort((a, b) => (b.rsRating ?? 0) - (a.rsRating ?? 0))
        .map(c => ({ t: c.ticker, c: c.pctChange as number, rsRating: c.rsRating, name: c.name }));
  const peers = peersAll;                    // card shows ALL peers (scrolls within the card body when they overflow)
  const peersTotal = peersAll.length;
  const pcs = peersAll.map(x => x.c);
  const pmx = pcs.length ? Math.max(...pcs) : 0;
  const pmn = pcs.length ? Math.min(...pcs) : 0;
  // User-controlled ordering by session % change (asc/desc). Leader/Laggard
  // tags still key off pmx/pmn, so they stay correct regardless of sort.
  const sortedPeers = [...peersAll].sort((a, b) => (peerSort === "asc" ? a.c - b.c : b.c - a.c));

  function selectSym(s: string) {
    setSym(s);
    setSearch("");
    if (typeof window !== "undefined") localStorage.setItem("iq-stock", s);
  }

  function openWatchlistPicker(s: string, e: React.MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setWlPicker({ sym: s, x: r.right - 250, y: r.bottom });
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
                padding: "5px 10px", fontSize: "0.7812rem", color: "var(--text-hi)", outline: "none", width: "18rem",
                fontFamily: "var(--f-mono)",
              }}
            />
            {suggestions.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, background: "var(--surface-1)",
                border: "1px solid var(--border)", borderRadius: "var(--r-sm)", zIndex: 20,
                minWidth: 180, marginTop: 2,
              }}>
                {suggestions.map(s => (
                  <div key={s.ticker} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 8px 6px 12px" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}>
                    <div onMouseDown={() => selectSym(s.ticker)}
                      style={{ flex: 1, cursor: "pointer", minWidth: 0, overflow: "hidden" }}>
                      <span style={{ fontSize: "0.7812rem", color: "var(--text-hi)", fontFamily: "var(--f-mono)" }}>{s.ticker}</span>
                      <span style={{ fontSize: "0.68rem", color: "var(--text-dim-solid)", marginLeft: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
                    </div>
                    <button
                      onMouseDown={e => { e.preventDefault(); openWatchlistPicker(s.ticker, e); }}
                      title={watchedSet.has(s.ticker) ? "Edit watchlists" : "Add to a watchlist"}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1rem", padding: "0 4px",
                        color: watchedSet.has(s.ticker) ? "var(--warn)" : "var(--text-dim-solid)", lineHeight: 1 }}>
                      {watchedSet.has(s.ticker) ? "★" : "☆"}
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
          {/* Header row: identity/quote on the left, the About blurb in the dead
              space to its right. The blurb used to sit on its own line BELOW the
              header, pushing the chart ~90px down the page for no informational
              gain — the header never used its right half. */}
          <div className="sd-headwrap">
          <div className="sd-head">
            <StockLogo sym={sym} size={46} />
            <div className="sd-name">
              {/* ONE line for the whole identity: symbol, quote, market cap,
                  then name / exchange / sector and the pills. Name-and-sector
                  used to be a second line under the price; folding it up here
                  makes the header a single line, which is what lets the chart
                  start higher. It still wraps rather than clips on a narrow
                  window — flex-wrap with a small row-gap, so a wrapped header
                  degrades to the old two-line look instead of losing text. */}
              <div className="sd-headline">
                <h1>{sym}</h1>
                <div className="sd-px" style={{ margin: 0, display: "flex", alignItems: "baseline", gap: 10 }}>
                  {dispPrice != null
                    ? <span className="p">${fmt(dispPrice, 2)}</span>
                    : <span className="p" style={{ color: "var(--text-dim-solid)" }}>—</span>}
                  {dispPct != null && (
                    <span className={`c ${cls(dispPct)}`}>{arr(dispPct)} {dispPct >= 0 ? "+" : ""}${fmt(dispDollar ?? 0, 2)} ({sign(dispPct)})</span>
                  )}
                </div>
              </div>
              {/* Second line, under the price: market cap, exchange/sector and
                  the provenance pills. These used to share the identity line
                  with the symbol and quote, which left the header wide and the
                  About box squeezed into a 30% column. Dropping them one row
                  narrows what the header needs and lets About take the width. */}
              <div className="sd-meta">
                {mc != null && (
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: ".72rem", fontWeight: 600,
                    color: "var(--text-dim-solid)", letterSpacing: ".02em", whiteSpace: "nowrap" }}>
                    Mkt cap {cap(mc)}
                  </span>
                )}
                {/* The company name is dropped here only when the About box is
                    showing, because its own heading already reads "About <full
                    name>" to the right — repeating it is pure duplication. With
                    no About box the name has nowhere else to appear, so it stays. */}
                <span className="sub" title={`${data.name} · ${ex} · ${group}`}>
                  {data.description ? "" : `${data.name} · `}{ex} · {group}
                </span>
                {inSectorRank != null && inSectorTotal != null && (
                  <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-hi)", fontSize: ".62rem" }}>
                    #{inSectorRank} of {inSectorTotal} in sector
                  </span>
                )}
                {isLiveStock && (
                  <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", fontSize: ".62rem" }}>
                    live quote · {vendorLabel(liveCompany?.source)}
                  </span>
                )}
              </div>
            </div>
            {/* The About box now sits 16px to the right and carries its own
                Polygon tag, so a second identical badge here is just noise.
                Without a description there is no neighbouring tag, and the
                header keeps its own — attribution is never dropped. */}
            {!data.description && (
              <span style={{ marginLeft: "auto", alignSelf: "flex-start" }}><VendorTag v="polygon" /></span>
            )}
          </div>

          {/* About the company — Polygon /v3/reference/tickers description, wired
              via /live/company. Shown in full (no clamp / no toggle); it scrolls
              inside its box, which is now the header's right-hand half. */}
          {data.description && (
            <div className="sd-about">
              <div className="sd-about-lbl" style={{ display: "flex", alignItems: "center", gap: 8 }}>About {data.name} <VendorTag v="polygon" /></div>
              <p style={{ margin: "4px 0 0", fontSize: ".82rem", lineHeight: 1.6, color: "var(--text-dim-solid)" }}>
                {data.description}
              </p>
              {data.homepageUrl && (
                <div style={{ marginTop: 6 }}>
                  <a href={data.homepageUrl} target="_blank" rel="noreferrer"
                    style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--brand-2)", textDecoration: "none" }}>
                    Company website ↗
                  </a>
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      )}

      <div className="sd-grid" style={hideHeader ? { paddingTop: 0 } : undefined}>

        {/* Full-width chart */}
        {!hideChart && <div style={{ gridColumn: "1 / -1" }}>
          {/* Chart card */}
          <div className="card">
            <div className="chart-toolbar">
              <ChartSelect value={tfActive} options={TF_OPTIONS} onChange={setTfActive} title="Timeframe" />
              <ChartSelect value={chartType} options={CHART_TYPE_OPTIONS} onChange={v => setChartType(v as typeof chartType)} title="Chart type" />
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
              <span style={{ marginRight: 6 }}><VendorTag v="polygon" /></span>
              {realBars && (
                <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", fontSize: ".62rem", marginRight: 6 }}>
                  live · Polygon
                </span>
              )}
              {barsAsOfLabel && (
                <span style={{ fontSize: ".62rem", color: "var(--text-dim-solid)", letterSpacing: ".02em", marginRight: 6 }}>
                  as of {barsAsOfLabel}
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
                    earnings={chartEarnings}
                  />
                }
              />
            </div>
            <div id="chartHost" style={{ padding: "0 14px 0" }} ref={chartRef}
              onContextMenu={handleChartRightClick}>
              <CandleChart sym={sym} tf={tfActive} px={p}
                maStep={maStep} emaStep={emaStep}
                showVol={showVol} chartType={chartType.toLowerCase()} realBars={realBars}
                live={live.tick ? { price: live.tick.price, high: live.tick.high, low: live.tick.low } : null}
                earnings={showEarnings ? chartEarnings : []} />
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

        {/* LEFT COLUMN — natural height (no stretch) so leftColRef measures the
            true content bottom (Financials); the right column is pinned to it. */}
        <div ref={leftColRef} style={{ display: "flex", flexDirection: "column", gap: 14, alignSelf: "start" }}>

          {/* Keystats */}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px 0" }}><VendorTag v="polygon" /></div>
            <div className="keystats">
              {([
                ["Mkt Cap",        mc != null ? cap(mc) : null],
                ["P/E",            data.peRatio != null ? data.peRatio.toFixed(1) : null],
                ["EPS (TTM)",      eps != null ? "$" + eps.toFixed(2) : null],
                ["Next ER",        erDate],
                ["52W Range",      hi != null && lo != null ? "$" + nf(lo) + " – $" + nf(hi) : null],
                // Distance from the 52-week extremes. Both are computed nightly
                // and were sitting unused while the range they refer to was
                // already on screen. "% off high" is the IBD-style read.
                ["Off 52W High",   offHigh52 != null ? offHigh52.toFixed(1) + "%" : null],
                ["Off 52W Low",    offLow52 != null ? "+" + offLow52.toFixed(1) + "%" : null],
                ["Avg Vol (20d)",  avgVol20 != null ? nf(avgVol20 / 1e6) + "M" : null],
                ["Sector",         titleCaseLabel(data.sector)],
                ["Industry",       titleCaseLabel(data.industry)],
                // Forward-annualized yield (latest declared rate × frequency ÷
                // price), per the backend methodology change — the "(fwd)" tag
                // tells users it's forward, not trailing-twelve-month.
                ["Div Yield",      data.dividendYield != null ? data.dividendYield.toFixed(2) + "% (fwd)" : null],
                ["Div / Share",    divPerShare != null ? "$" + divPerShare.toFixed(2) + " (fwd)" : null],
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
              <VendorTag v="polygon" />
            </div>
            <div className="card-b" style={{ maxHeight: "none" }}>
              {([
                ["Trend",            trendTxt],
                ["Support / Resist.", hi != null
                  ? (<>52-week high <b>${nf(hi)}</b>{lo != null ? <>; 52-week low <b>${nf(lo)}</b></> : null}.</>)
                  : "Support/resistance levels not available."],
                ["MA posture",       maTxt],
                ["Rel. strength",    rs != null
                  ? (<>Relative-strength rank <b className={rs >= 70 ? "up" : rs < 40 ? "down" : ""}>{rs}/99</b> vs the market — {rs >= 70 ? "group leader." : rs < 40 ? "lagging the tape." : "roughly in line."}</>)
                  : "Not ranked yet — this ticker isn't in the synced RS universe."],
                ["Volume",           rv != null ? (<>Relative volume <b>{rv.toFixed(1)}×</b> — {rv > 2 ? "well above average (event-driven)." : "near normal."}</>) : "Relative volume not available."],
                ["Event risk",       erDate !== "—" ? `Next earnings ${erDate}.` : "No upcoming earnings date on record."],
              ] as [string, ReactNode][]).map(l => (
                <div key={l[0]} className="ai-line">
                  <span className="k">{l[0]}</span>
                  <span className="v">{l[1]}</span>
                </div>
              ))}
              <div style={{ marginTop: 10, fontSize: ".7rem", color: "var(--text-dim-solid)" }}>
                Source: rs-rating.job, technical-indicators.job, a year of daily bars · informational purposes only, not investment advice.
              </div>

              {/* ── AI read — technicals + news synthesised by OpenRouter,
                  appended below the deterministic rows. The raw headline list
                  that used to sit here was removed: this read already covers the
                  news, and the full list lives in the News card further down. AI
                  output is rendered as PLAIN TEXT (never dangerouslySetInnerHTML)
                  since it's model-generated / untrusted. ── */}
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-soft)" }}>
                <div style={{ fontSize: ".66rem", fontWeight: 700, color: "var(--ai)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span>◆ AI read · {sym}</span>
                  {aiAnalysis?.ok && (
                    <span className="pill" style={{ fontSize: ".54rem", background: "var(--surface-3)", color: "var(--text-dim-solid)", textTransform: "none", letterSpacing: 0 }}>
                      {aiAnalysis.model}{aiAnalysis.usedWebSearch ? " · web" : ""}
                    </span>
                  )}
                </div>
                {aiLoading && <DataState loading label="Generating AI analysis…" />}
                {!aiLoading && (!!aiError || aiAnalysis?.ok === false) && (
                  <div style={{ fontSize: ".76rem", color: "var(--text-dim-solid)", padding: "2px 0" }}>AI analysis unavailable right now.</div>
                )}
                {!aiLoading && aiAnalysis?.ok && aiAnalysis.analysis && (() => {
                  const a = aiAnalysis.analysis!;
                  return (
                    <>
                      {a.headline && <div style={{ fontSize: ".82rem", fontWeight: 600, color: "var(--text-hi)", marginBottom: 8 }}>{a.headline}</div>}
                      {a.volatility && (
                        <div className="ai-line"><span className="k">Volatility</span><span className="v"><b style={{ color: "var(--text-hi)", textTransform: "capitalize" }}>{a.volatility.flag}</b> — {a.volatility.note}</span></div>
                      )}
                      {a.momentum && (
                        <div className="ai-line"><span className="k">Momentum</span><span className="v"><b style={{ color: "var(--text-hi)", textTransform: "capitalize" }}>{a.momentum.state}</b> — {a.momentum.note}</span></div>
                      )}
                      {a.newsSummary && (
                        <div className="ai-line"><span className="k">News</span><span className="v">{a.newsSummary}</span></div>
                      )}
                      {a.technicalSummary && (
                        <div className="ai-line"><span className="k">Setup</span><span className="v">{a.technicalSummary}</span></div>
                      )}
                      <div style={{ marginTop: 8, fontSize: ".64rem", color: "var(--text-dim-solid)" }}>
                        AI-generated · informational only, not investment advice.
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Financials — grouped bar chart */}
          {(() => {
            const inc     = incRowsFromFinancials(finPeriod, financialsDoc, () => []);
            const epsSales = epsSalesSeries(finPeriod, financialsDoc);
            const histEps = hist10.slice(0, 10);
            const beatsOf = histEps.filter(h => h.surp >= 0).length;
            const latestA = histEps[0]?.a ?? 0;
            const prevA   = histEps[4]?.a;
            // Suppress a YoY built on a ~0 base (spin-off / first period), which
            // otherwise prints an absurd four-digit percentage.
            const yoyRaw  = prevA != null && Math.abs(prevA) >= 0.05 ? ((latestA - prevA) / Math.abs(prevA)) * 100 : null;
            const yoy     = yoyRaw != null && Math.abs(yoyRaw) <= 1000 ? yoyRaw : null;
            return (
              <div className="card">
                <div className="card-h">
                  <h3>Financials</h3>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <VendorTag v="polygon" />
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
                  {epsSales.length > 0 && (
                    <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid var(--border-soft)" }}>
                      <EpsSalesBars data={epsSales} />
                      <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 2 }}>
                        {finPeriod === "Q" ? "Reported quarters" : "Reported fiscal years"} · actuals only
                      </div>
                    </div>
                  )}
                  {inc.length === 0 ? (
                    <DataState loading={financialsLoading} label={
                      // Not "not synced yet" — for a foreign private issuer filing
                      // 20-F/6-K there is no SEC quarterly series to sync and there
                      // never will be. Saying "yet" sent people looking for a sync bug.
                      financialsDoc && (financialsDoc.epsHistory?.length ?? 0) > 0
                        ? `No ${finPeriod === "Q" ? "quarterly" : "annual"} income statement is published for ${sym} — reported EPS is shown above where available.`
                        : `No ${finPeriod === "Q" ? "quarterly" : "annual"} financials on file for ${sym}.`
                    } />
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

                  {/* Earnings Playbook — how the stock trades when it reports.
                      Derived from the live earnings feed (report dates + EPS)
                      and the Polygon daily bars already fetched here. */}
                  <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border-soft)" }}>
                    <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                      <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--text-hi)" }}>Earnings Playbook</div>
                      <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>how {sym} trades when it reports</div>
                    </div>
                    <EarningsPlaybook
                      sym={sym}
                      reports={(financialsDoc?.quarters ?? [])
                        .filter((q) => q.filingDate)
                        .map((q) => ({ date: q.filingDate as string, epsActual: q.epsActual, epsEstimate: q.epsEstimate, epsReported: q.epsActualReported ?? null, epsEstimateReported: q.epsEstimateReported ?? null }))}
                    />
                  </div>
                </div>
              </div>
            );
          })()}

        </div>

        {/* RIGHT COLUMN — pinned to the LEFT column's height (rightColH) with
            overflow hidden, so Peers flex-fills/scrolls and Key levels sits at
            the base, level with Financials' bottom. Falls back to natural height
            (undefined) when stacked on narrow screens. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, alignSelf: "start", height: rightColH, minHeight: 0, overflow: rightColH ? "hidden" : undefined }}>

          {/* Technical Rating */}
          <div className="card">
            <div className="card-h">
              <h3>Technical Rating</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <VendorTag v={["polygon", "fmp"]} />
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
                  <div className="rate" style={{ color: consensusTone(consensusDoc.consensus) }}>{consensusDoc.consensus}</div>
                  <div className="counts">
                    <span style={{ color: "var(--down)" }}>Sell<b>{consensusDoc.sell + consensusDoc.strongSell}</b></span>
                    <span style={{ color: "var(--text-dim-solid)" }}>Hold<b>{consensusDoc.hold}</b></span>
                    <span style={{ color: "var(--up)" }}>Buy<b>{consensusDoc.strongBuy + consensusDoc.buy}</b></span>
                  </div>
                  {consensusDoc.priceTargetConsensus != null && (
                    <div className="counts" style={{ marginTop: 8, borderTop: "1px solid var(--border-soft)", paddingTop: 8 }}>
                      <span style={{ color: "var(--text-dim-solid)" }}>Target<b style={{ color: "var(--text-hi)" }}>${consensusDoc.priceTargetConsensus.toFixed(0)}</b></span>
                      {dispPrice != null && dispPrice > 0 && (
                        <span style={{ color: consensusDoc.priceTargetConsensus >= dispPrice ? "var(--up)" : "var(--down)" }}>
                          Upside<b>{consensusDoc.priceTargetConsensus >= dispPrice ? "+" : ""}{(((consensusDoc.priceTargetConsensus - dispPrice) / dispPrice) * 100).toFixed(1)}%</b>
                        </span>
                      )}
                      {consensusDoc.priceTargetLow != null && consensusDoc.priceTargetHigh != null && (
                        <span style={{ color: "var(--text-dim-solid)" }}>Range<b>${consensusDoc.priceTargetLow.toFixed(0)}–${consensusDoc.priceTargetHigh.toFixed(0)}</b></span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {consensusDoc?.recentGrades && consensusDoc.recentGrades.length > 0 && (
                <div className="trgroup" style={{ marginBottom: 12, textAlign: "left" }}>
                  <div className="gl">Recent analyst actions</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>
                    {consensusDoc.recentGrades.slice(0, 6).map((g, i) => {
                      const a = (g.action ?? "").toLowerCase();
                      const col = a.includes("upgrade") ? "var(--up)" : a.includes("downgrade") ? "var(--down)" : "var(--text-dim-solid)";
                      return (
                        // 3 left-aligned columns on a shared grid template, so
                        // action / firm / grade line up across every row (the
                        // parent .trgroup centres text — overridden to left here).
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "64px minmax(0, 1fr) minmax(0, 1.35fr)", alignItems: "center", gap: 10, fontSize: ".72rem", textAlign: "left" }}>
                          <span style={{ color: col, fontWeight: 700, textTransform: "capitalize" }}>{g.action ?? "—"}</span>
                          <span style={{ color: "var(--text-hi)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.firm ?? "—"}</span>
                          <span style={{ color: "var(--text-dim-solid)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {(g.previousGrade || g.newGrade) ? `${g.previousGrade ?? "—"} → ${g.newGrade ?? "—"}` : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <table className="ind-tbl" style={{ marginTop: 12 }}>
                <tbody>
                  {indRows.map(r => (
                    <tr key={r[0]}>
                      <td>
                        {r[0]}
                        {/* RSI(14) history is already computed nightly and shipped
                            on the company doc; it was unused. Drawn inline on a
                            fixed 0-100 scale with the 30/70 bands marked, so the
                            number reads in context instead of as a bare value. */}
                        {r[0] === "RSI (14)" && rsiSeries && rsiSeries.length > 1 && (() => {
                          const pts = rsiSeries.slice(-40);
                          const W = 62, H = 16;
                          const d = pts
                            .map((v, i) => `${(i / (pts.length - 1)) * W},${H - (Math.min(100, Math.max(0, v)) / 100) * H}`)
                            .join(" ");
                          return (
                            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginLeft: 8, verticalAlign: "middle", overflow: "visible" }} aria-hidden="true">
                              <line x1="0" y1={H - 0.7 * H} x2={W} y2={H - 0.7 * H} stroke="var(--border-soft)" strokeWidth="1" />
                              <line x1="0" y1={H - 0.3 * H} x2={W} y2={H - 0.3 * H} stroke="var(--border-soft)" strokeWidth="1" />
                              <polyline points={d} fill="none" stroke="var(--ai)" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
                            </svg>
                          );
                        })()}
                      </td>
                      <td className="v">{r[1] ?? <NotAvailable />}</td>
                      <td className="a" style={{ color: ac(r[2]) }}>{r[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                RSI/MACD/Stoch %K/ADX from technical-indicators.job · RSI sparkline is the last 40 sessions on a 0-100 scale with the 30/70 bands marked · EMA/SMA computed from a year of daily bars. Indicators only — not investment advice.
              </div>
            </div>
          </div>

          {/* Peers — flex-grows to fill the RIGHT column (the prominent card
              here); a long list scrolls inside it. minHeight:0 lets it shrink
              within the pinned column so Key levels below stays visible. */}
          <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="card-h">
              <h3>Peers</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {peersTotal > 1 && (
                  <button
                    onClick={() => setPeerSort(s => (s === "desc" ? "asc" : "desc"))}
                    title={`Sort by % change — ${peerSort === "desc" ? "highest first" : "lowest first"}`}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: ".62rem", fontWeight: 700, letterSpacing: ".02em",
                      color: "var(--text-dim-solid)", background: "var(--surface-3)",
                      border: "1px solid var(--border-soft)", borderRadius: 6,
                      padding: "3px 7px", cursor: "pointer",
                    }}
                  >
                    % <span style={{ color: "var(--brand-2)" }}>{peerSort === "desc" ? "▼" : "▲"}</span>
                  </button>
                )}
                <VendorTag v="polygon" />
                {peersTotal > peers.length && <span className="link" onClick={() => setInnerDrawer("peers")}>View all →</span>}
              </div>
            </div>
            <div className="card-b" style={{ paddingTop: 6, flex: 1, minHeight: 0, overflowY: "auto" }}>
              {sortedPeers.length ? sortedPeers.map(peer => {
                const tag = peer.c === pmx ? "Leader" : peer.c === pmn ? "Laggard" : "";
                return (
                  <div key={peer.t} className="minirow"
                    style={{ cursor: "pointer" }} onClick={() => openStock(peer.t)}>
                    <StockLogo sym={peer.t} size={22} />
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

          {/* Key levels (pivots) — content-sized, sits at the base of the RIGHT
              column below the flex-grown Peers. */}
          <div className="card">
            <div className="card-h">
              <h3>Key levels (pivots)</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <VendorTag v="polygon" />
                <span className="link" onClick={() => setInnerDrawer("keylevels")}>View all →</span>
              </div>
            </div>
            <div className="card-b" style={{ paddingTop: 6 }}>
              <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-dim-solid)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>
                Weekly pivots
              </div>
              {(["R2", "R1", "Pivot", "S1", "S2"] as const).map(label => {
                const wk = klWeekly;
                const v = wk ? ({ R2: wk.r2, R1: wk.r1, Pivot: wk.pivot, S1: wk.s1, S2: wk.s2 } as Record<string, number | null>)[label] : null;
                const tone = label.startsWith("R") ? "var(--down)" : label.startsWith("S") ? "var(--up)" : "var(--text-hi)";
                return (
                  <div key={label} className="minirow">
                    <span className="tkr" style={{ width: 50, color: tone }}>{label}</span>
                    <span className="mid" />
                    <span className="r mono">{v != null ? `$${v.toFixed(2)}` : <NotAvailable />}</span>
                  </div>
                );
              })}
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

        </div>

        {/* Dividend & split history + Insider & institutional — full-width row
            BELOW the two-column section, so the left column ends at Financials
            and Key levels (base of the right column) aligns with Financials'
            bottom border. Side-by-side pair, each with its own scroll. */}
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 14, alignItems: "stretch" }}>
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
              <div className="card" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <div className="card-h">
                  <h3>Dividend &amp; split history</h3>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <VendorTag v="polygon" />
                    {dh && (yieldPct != null
                      ? <span className="pill up">{yieldPct.toFixed(2)}% yield</span>
                      : <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>No dividend</span>)}
                    {hasReal && <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", fontSize: ".62rem" }}>live · Polygon</span>}
                    <span className="link" onClick={() => setInnerDrawer("dividend")}>View all →</span>
                  </div>
                </div>
                <div className="card-b" style={{ paddingTop: 6, flex: 1, minHeight: 0, overflowY: "auto" }}>
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
                          <span className="tkr" style={{ width: 82, flexShrink: 0, whiteSpace: "nowrap" }}>{q.label}</span>
                          <span className="mid mono">{q.perShare != null ? `$${q.perShare.toFixed(4)}/sh` : "—"}</span>
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

          {/* Insider & institutional — right half of the side-by-side pair; own scroll. */}
          <div className="card" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div className="card-h">
              <h3>Insider &amp; institutional</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <VendorTag v="sec" />
                <span className="link" onClick={() => setInnerDrawer("insider")}>View all →</span>
              </div>
            </div>
            <div className="card-b" style={{ paddingTop: 6, flex: 1, minHeight: 0, overflowY: "auto" }}>
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
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-dim-solid)", textTransform: "uppercase", letterSpacing: ".05em" }}>
                  Institutional
                </span>
                <VendorTag v="fmp" />
              </div>
              {(() => {
                const io = liveCompany?.instOwnershipPct;
                const holders = liveCompany?.inst13FHolders;
                const chg = liveCompany?.inst13FHoldersChange;
                const rows: [string, ReactNode][] = [
                  ["Inst. ownership", io != null ? `${io.toFixed(1)}%` : null],
                  // Short interest has no Polygon (404) or FMP source — needs FINRA.
                  ["Short interest", null],
                  // "filers", NOT "funds": FMP's investorsHolding counts 13F
                  // FILERS, and one filer (BlackRock Inc.) files a single report
                  // covering hundreds of individual funds. Labelling it "funds"
                  // invited comparison with fund-count screens that report ~10.9K
                  // for MSFT where we report ~6.4K — different populations.
                  ["13F filers holding", holders != null ? (
                    <>
                      {holders.toLocaleString()}
                      {chg != null && chg !== 0 && (
                        <span className={chg > 0 ? "up" : "down"} style={{ marginLeft: 6, fontSize: ".7rem" }}>
                          {chg > 0 ? "+" : ""}{chg} QoQ
                        </span>
                      )}
                    </>
                  ) : null],
                ];
                return rows.map(([label, val]) => (
                  <div key={label} className="minirow">
                    <span className="mid">{label}</span>
                    <span className="r">{val ?? <NotAvailable />}</span>
                  </div>
                ));
              })()}
              {liveCompany?.instAsOf && (
                <div style={{ fontSize: ".64rem", color: "var(--text-dim-solid)", marginTop: 6 }}>
                  13F rollup · {liveCompany.instAsOf}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Industry Group rank + Earnings history — full-width row, 50/50, equal
            height (grid align-items: stretch + flex-column cards). */}
        <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "stretch" }}>
          {/* Industry Group rank */}
          <div className="card" style={{ display: "flex", flexDirection: "column" }}>
            <div className="card-h">
              <h3>Industry Group rank</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <VendorTag v="polygon" />
                <span className="link" onClick={() => setInnerDrawer("industry")}>View all →</span>
              </div>
            </div>
            <div className="card-b" style={{ flex: 1 }}>
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

          {/* Earnings history */}
          <div className="card" style={{ display: "flex", flexDirection: "column" }}>
            <div className="card-h">
              <h3>Earnings history</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <VendorTag v={["polygon", "fmp"]} />
                {hist10.length > 0 && (
                  <span className={`pill ${beatStreak >= 0 ? "up" : "dn"}`}>{Math.abs(beatStreak)}-qtr {beatStreak >= 0 ? "beat" : "miss"} streak</span>
                )}
                <span className="link" onClick={() => setInnerDrawer("earnings")}>View all →</span>
              </div>
            </div>
            <div className="card-b" style={{ paddingTop: 6, flex: 1, display: "flex", flexDirection: "column" }}>
              {hist10.length === 0 ? (
                <DataState loading={earningsLoading} label={`No live earnings-estimate history synced for ${sym} yet.`} height="100%" />
              ) : (
                <>
                  <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginBottom: 8 }}>Next report: {erDate}</div>
                  {hist10.slice(0, 5).map(q => (
                    <div key={q.q} className="minirow">
                      <span className="tkr" style={{ width: 60 }}>{q.q}</span>
                      <span className="mid mono">
                        {q.e !== 0 && <span style={{ color: "var(--text-dim-solid)" }}>est ${fmt(q.e, 2)} → </span>}
                        ${fmt(q.a, 2)} act
                      </span>
                      {q.e !== 0
                        ? <span className={`r ${q.surp >= 0 ? "up" : "down"}`}>{q.surp >= 0 ? "beat" : "miss"} {Math.abs(q.surp)}%</span>
                        : <span className="r" style={{ color: "var(--text-dim-solid)" }}>—</span>}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>

        {/* News — last card, alone in its row: span both grid columns so it
            fills the full width instead of leaving the 400px right column
            empty beside it. */}
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-h">
            <h3>News</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <VendorTag v={["polygon", "fmp"]} />
              {tickerNews && tickerNews.length > 0 && (
                <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", fontSize: ".62rem" }}>live</span>
              )}
            </div>
          </div>
          <div className="card-b" style={{ paddingTop: 6 }}>
            {tickerNews && tickerNews.length > 0 ? (
              tickerNews.slice(0, 6).map(n => (
                <a key={n.id} href={n.url} target="_blank" rel="noreferrer"
                  className="minirow" style={{ alignItems: "flex-start", gap: 10, textDecoration: "none", cursor: "pointer" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: ".8rem", color: "var(--text)" }}>{n.headline}</div>
                    <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 3, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span>{n.source} · {new Date(n.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      {n.vendor && <span className="pill" style={{ fontSize: ".54rem", background: "var(--surface-3)", textTransform: "uppercase", letterSpacing: ".03em" }}>{n.vendor}</span>}
                      {n.sentiment && <span className="pill" style={{ fontSize: ".54rem", textTransform: "capitalize", background: "var(--surface-3)", color: n.sentiment === "positive" ? "var(--up)" : n.sentiment === "negative" ? "var(--down)" : "var(--text-dim-solid)" }}>{n.sentiment}</span>}
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
                <StockLogo sym={sym} size={34} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Technical Rating · {sym}</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>11 oscillators · 15 moving averages</div>
                </div>
                <VendorTag v="polygon" />
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
                      ["Stoch %K", stochKv != null ? stochKv.toFixed(1) : null, stochKv == null ? "" : stochKv > 80 ? "Sell" : stochKv < 20 ? "Buy" : "Neutral"],
                      ["CCI (14)", null, ""],
                      ["MACD (12,26)", macd != null ? macd.toFixed(1) : null, macdBuy == null ? "" : macdBuy ? "Buy" : "Sell"],
                      ["Williams %R", null, ""],
                      ["Bull/Bear Power", null, ""],
                      ["ADX (14)", adx14 != null ? adx14.toFixed(1) : null, adx14 == null ? "" : adx14 > 25 ? "Strong" : adx14 < 20 ? "Weak" : "Neutral"],
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
                      ["VWAP", vwapV],
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
                  RSI/MACD/Stoch %K/ADX/VWAP from technical-indicators.job · SMA/EMA/Ichimoku computed from a year of daily bars — real. CCI/Williams %R/Bull-Bear/Ultimate Osc/ROC/Stoch RSI/ATR/Hull MA need a fuller technicals vendor and aren&apos;t wired up yet. Not investment advice.
                </div>
              </div>
            </div>
          )}

          {/* Peers */}
          {innerDrawer === "peers" && (
            <div className="side-drawer" style={{ zIndex: 52 }}>
              <div className="drawer-h">
                <StockLogo sym={sym} size={34} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Peers · {sym}</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>
                    {peersTotal} peer{peersTotal === 1 ? "" : "s"} with live data
                    {rawPeerTickers.length > peersTotal ? ` · ${rawPeerTickers.length} returned by Polygon` : ""}
                  </div>
                </div>
                <VendorTag v="polygon" />
                <button className="closebtn" onClick={() => setInnerDrawer(null)}>✕</button>
              </div>
              <div className="drawer-b">
                {sortedPeers.length === 0 ? (
                  <DataState loading={companiesLoading || liveCompanyLoading} label={`No live peers found for ${sym}.`} />
                ) : sortedPeers.map(peer => {
                  return (
                      <div key={peer.t} className="minirow" style={{ cursor: "pointer" }}
                        onClick={() => { setInnerDrawer(null); openStock(peer.t); }}>
                        <StockLogo sym={peer.t} size={22} />
                        <span className="mono" style={{
                          fontWeight: 700, minWidth: 52,
                          color: peer.t === sym ? "var(--brand-2)" : "var(--text-hi)",
                        }}>{peer.t}</span>
                        <span className="mid" style={{ fontSize: ".76rem" }}>{peer.name ?? peer.t}</span>
                        {peer.rsRating != null && <span className="pill" style={{ fontSize: ".66rem", background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>RS {peer.rsRating}</span>}
                        <span className={`mono ${cls(peer.c)}`} style={{ fontSize: ".82rem" }}>{sign(peer.c)}</span>
                      </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Industry Group rank */}
          {innerDrawer === "industry" && (
            <div className="side-drawer" style={{ zIndex: 52 }}>
              <div className="drawer-h">
                <StockLogo sym={sym} size={34} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Industry Group Rank</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>All sectors by today&apos;s performance</div>
                </div>
                <VendorTag v="polygon" />
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
                <StockLogo sym={sym} size={34} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Insider &amp; Institutional · {sym}</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Form 4 filings · 13F institutional data</div>
                </div>
                <VendorTag v="sec" />
                <button className="closebtn" onClick={() => setInnerDrawer(null)}>✕</button>
              </div>
              <div className="drawer-b">
                <div className="metric-grid" style={{ marginBottom: 14 }}>
                  <div className="m"><div className="k">Inst. ownership</div><div className="v"><NotAvailable /></div></div>
                  <div className="m"><div className="k">Short interest</div><div className="v"><NotAvailable /></div></div>
                  <div className="m"><div className="k">13F filers</div><div className="v"><NotAvailable /></div></div>
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
                <StockLogo sym={sym} size={34} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Key Levels · {sym}</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Pivot points · support &amp; resistance</div>
                </div>
                <VendorTag v="polygon" />
                <button className="closebtn" onClick={() => setInnerDrawer(null)}>✕</button>
              </div>
              <div className="drawer-b">
                {([["Classic pivot (daily)", klDaily], ["Weekly pivot", klWeekly]] as const).map(([title, lv]) => (
                  <div key={title} style={{ marginBottom: 14 }}>
                    <div className="ai-sec"><div className="h">{title}</div></div>
                    {lv ? (["R3", "R2", "R1", "Pivot", "S1", "S2", "S3"] as const).map(label => {
                      const v = ({ R3: lv.r3, R2: lv.r2, R1: lv.r1, Pivot: lv.pivot, S1: lv.s1, S2: lv.s2, S3: lv.s3 } as Record<string, number | null>)[label];
                      const tone = label === "Pivot" ? "var(--text-hi)" : label.startsWith("R") ? "var(--down)" : "var(--up)";
                      return (
                        <div key={label} className="minirow">
                          <span className="tkr" style={{ width: 50, color: tone }}>{label}</span>
                          <span className="mid" style={{ fontSize: ".76rem", color: "var(--text-dim-solid)" }}>
                            {label === "Pivot" ? "Pivot point" : label.startsWith("R") ? `Resistance ${label[1]}` : `Support ${label[1]}`}
                          </span>
                          <span className="r mono">{v != null ? `$${v.toFixed(2)}` : <NotAvailable />}</span>
                        </div>
                      );
                    }) : (
                      <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", margin: "6px 0" }}>
                        No pivot levels synced for this ticker yet.
                      </div>
                    )}
                  </div>
                ))}

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
                <StockLogo sym={sym} size={34} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>{sym}</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Earnings history · last 10 quarters</div>
                </div>
                <VendorTag v={["polygon", "fmp"]} />
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
                      <span><i style={{ background: "var(--text-dim-solid)" }} />EPS estimate</span>
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
            const annualRows = annualEpsSalesRows(financialsDoc?.annual ?? [], financialsDoc?.epsHistory ?? []);
            const quarterlyRows = quarterlyEpsSalesRows(financialsDoc?.quarters ?? [], financialsDoc?.epsHistory ?? []);
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
                  <VendorTag v={["polygon", "fmp"]} />
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
                            <span><i style={{ background: "var(--text-dim-solid)" }} />EPS estimate</span>
                            <span><i style={{ background: "var(--up)" }} />Beat</span>
                            <span><i style={{ background: "var(--down)" }} />Miss</span>
                          </div>
                          <EarnEpsChart hist={hist10} />
                        </>
                      )}
                    </div>
                  </div>
                  {/* Annual EPS & Sales */}
                  <div className="card" style={{ marginBottom: 14 }}>
                    <div className="card-h">
                      <h3>Fiscal year</h3>
                      <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>EPS &amp; sales</span>
                    </div>
                    <div className="card-b" style={{ paddingTop: 4 }}>
                      {annualRows.length === 0 ? (
                        <DataState loading={financialsLoading} label={`No live annual financials synced for ${sym} yet.`} />
                      ) : (
                        <div style={{ overflowX: "auto" }}>
                          <table className="tbl">
                            <thead>
                              <tr>
                                <th>Fiscal year</th>
                                <th className="num">EPS</th>
                                <th className="num">%chg</th>
                                <th className="num">Sales (mil)</th>
                                <th className="num">%chg</th>
                              </tr>
                            </thead>
                            <tbody>
                              {annualRows.map(r => (
                                <tr key={r.year}>
                                  <td style={{ fontWeight: 700, color: "var(--text-hi)" }}>{r.year}</td>
                                  <td className="num">{r.eps != null ? `$${r.eps.toFixed(2)}` : <NotAvailable />}</td>
                                  <td className={`num${r.epsChg.startsWith("+") ? " up" : r.epsChg.startsWith("-") ? " down" : ""}`}>{r.epsChg}</td>
                                  <td className="num">{r.sales != null ? r.sales.toFixed(1) : <NotAvailable />}</td>
                                  <td className={`num${r.salesChg.startsWith("+") ? " up" : r.salesChg.startsWith("-") ? " down" : ""}`}>{r.salesChg}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                        Reported fiscal years only — %chg is year-over-year. Forward analyst estimates aren&apos;t wired yet.
                      </div>
                    </div>
                  </div>

                  {/* Quarterly EPS & Sales */}
                  <div className="card" style={{ marginBottom: 14 }}>
                    <div className="card-h">
                      <h3>Quarter</h3>
                      <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>EPS &amp; sales</span>
                    </div>
                    <div className="card-b" style={{ paddingTop: 4 }}>
                      {quarterlyRows.length === 0 ? (
                        <DataState loading={financialsLoading} label={`No live quarterly financials synced for ${sym} yet.`} />
                      ) : (
                        <div style={{ overflowX: "auto" }}>
                          <table className="tbl">
                            <thead>
                              <tr>
                                <th>Quarter</th>
                                <th className="num">EPS</th>
                                <th className="num">%chg</th>
                                <th className="num">%surp</th>
                                <th className="num">Sales (mil)</th>
                                <th className="num">%chg</th>
                                <th className="num">%surp</th>
                              </tr>
                            </thead>
                            <tbody>
                              {quarterlyRows.map((r, i) => (
                                <tr key={`${r.label}-${i}`}>
                                  <td style={{ fontWeight: 700, color: "var(--text-hi)" }}>{r.label}</td>
                                  <td className="num">{r.eps != null ? `$${r.eps.toFixed(2)}` : <NotAvailable />}</td>
                                  <td className={`num${r.epsChg.startsWith("+") ? " up" : r.epsChg.startsWith("-") ? " down" : ""}`}>{r.epsChg}</td>
                                  <td className={`num${r.epsSurp.startsWith("+") ? " up" : r.epsSurp.startsWith("-") ? " down" : ""}`}>{r.epsSurp}</td>
                                  <td className="num">{r.sales != null ? r.sales.toFixed(1) : <NotAvailable />}</td>
                                  <td className={`num${r.salesChg.startsWith("+") ? " up" : r.salesChg.startsWith("-") ? " down" : ""}`}>{r.salesChg}</td>
                                  <td className="num">{r.salesSurp}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                        %chg is year-over-year (same quarter, prior year). %surp is actual vs analyst estimate — sales surprise needs a revenue-estimate feed, not available yet.
                      </div>
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
            const maxAmt = barSource.length ? Math.max(...barSource.map(b => b.amt ?? 0)) * 1.15 || 1 : 1;
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
                  <VendorTag v="polygon" />
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
                              const bh = ((b.amt ?? 0) / maxAmt) * (H - PADT - PADB);
                              const bx = gap * i + (gap - bw) / 2;
                              const by = PADT + (H - PADT - PADB) - bh;
                              const isLast = i === barSource.length - 1;
                              return (
                                <g key={i}>
                                  <rect x={bx} y={by} width={bw} height={bh} rx={2}
                                    style={{ fill: isLast ? "var(--brand-2)" : "var(--surface-3)" }} />
                                  <text x={bx + bw / 2} y={by - 3} textAnchor="middle"
                                    style={{ fill: isLast ? "var(--brand-2)" : "var(--text-dim-solid)", fontSize: "0.4375rem" }}>
                                    {b.amt != null ? `$${b.amt.toFixed(2)}` : "—"}
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

      {/* Which-watchlist picker (opened from a search-result star) */}
      {wlPicker && (
        <WatchlistPicker
          sym={wlPicker.sym}
          watchlists={watchlists}
          onAdd={id => addTicker(id, wlPicker.sym)}
          onRemove={id => removeTicker(id, wlPicker.sym)}
          onCreate={name => createList(name)}
          onClose={() => setWlPicker(null)}
          anchor={{ x: wlPicker.x, y: wlPicker.y }}
        />
      )}

      {/* ── No-data popup — the searched ticker has no market data ── */}
      {showNoDataPopup && (
        <div onClick={() => setDismissedNoData(sym)}
          style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(4,7,14,.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 14, width: "min(400px,100%)", padding: "26px 24px", textAlign: "center", boxShadow: "0 24px 64px rgba(0,0,0,.5)" }}>
            <div style={{ fontSize: "1.9rem", marginBottom: 8 }}>🔍</div>
            <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text-hi)", marginBottom: 6, fontFamily: "var(--f-display)" }}>Data not available</div>
            <div style={{ fontSize: ".82rem", color: "var(--text-dim-solid)", lineHeight: 1.55, marginBottom: 18 }}>
              No market data is available for <b style={{ color: "var(--text-hi)" }}>{sym}</b> yet. It may be a newly listed, delisted, or non-US-listed ticker. Try another symbol.
            </div>
            <button className="btn primary" onClick={() => setDismissedNoData(sym)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
