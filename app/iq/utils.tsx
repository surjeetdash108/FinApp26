"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { backendUrl } from "./backend";

// ---- TEMPORARY data-source attribution tag ----
// Shows which upstream vendor supplies a widget's data (Polygon / FMP / FRED /
// SEC EDGAR), so anyone can visually identify the source. This is a temporary
// diagnostic aid — remove every <VendorTag .../> usage (and this block) later.
// Search the codebase for "VendorTag" to find them all.
export type VendorKey = "polygon" | "fmp" | "fred" | "sec" | "firebase";

const VENDOR_META: Record<VendorKey, { label: string; bg: string; fg: string }> = {
  polygon: { label: "POLYGON", bg: "#1e3a8a", fg: "#dbeafe" }, // blue
  fmp: { label: "FMP", bg: "#5b21b6", fg: "#ede9fe" }, // violet
  fred: { label: "FRED", bg: "#065f46", fg: "#d1fae5" }, // green
  sec: { label: "SEC EDGAR", bg: "#9a3412", fg: "#ffedd5" }, // amber
  // Not a market-data vendor — the app's own Firestore data (e.g. search counts).
  firebase: { label: "FIREBASE", bg: "#475569", fg: "#e2e8f0" }, // slate
};

/**
 * Temporary vendor-source badge. Pass one vendor or several (for a widget that
 * blends sources). Renders small uppercase pills, colour-coded per vendor.
 *   <VendorTag v="polygon" />
 *   <VendorTag v={["polygon", "fmp"]} />
 */
export function VendorTag({ v }: { v: VendorKey | VendorKey[] }) {
  const list = Array.isArray(v) ? v : [v];
  return (
    <span
      style={{ display: "inline-flex", gap: 3, verticalAlign: "middle", flexWrap: "wrap" }}
      title="Data source (temporary attribution tag)"
    >
      {list.map((k) => {
        const m = VENDOR_META[k];
        return (
          <span
            key={k}
            style={{
              fontSize: ".54rem",
              fontWeight: 700,
              letterSpacing: ".04em",
              lineHeight: 1,
              padding: "2px 5px",
              borderRadius: 4,
              background: m.bg,
              color: m.fg,
              whiteSpace: "nowrap",
            }}
          >
            {m.label}
          </span>
        );
      })}
    </span>
  );
}

// ---- "Not available" / loading placeholders ----
// The single reusable primitive for "we removed the mock value here and there
// is no live source yet" — used instead of either (a) silently rendering
// nothing, which reads as broken, or (b) inventing a plausible-looking number.

/** Inline placeholder for a single removed field (a table cell, a stat, a pill). */
export function NotAvailable({ label = "N/A" }: { label?: string }) {
  return (
    <span className="not-avail" title="No live data source for this yet">
      {label}
    </span>
  );
}

/** Block-level placeholder for an entire missing list/section/panel. */
export function DataState({
  loading, label, height,
}: { loading?: boolean; label: string; height?: number | string }) {
  return (
    <div className="data-state" style={height != null ? { minHeight: height } : undefined}>
      {loading ? (
        <>
          <span className="data-state-spinner" aria-hidden />
          <span>Loading…</span>
        </>
      ) : (
        <>
          <span className="data-state-icon" aria-hidden>—</span>
          <span>{label}</span>
        </>
      )}
    </div>
  );
}

// ---- Number formatting ----
export function fmt(n: number, d = 2): string {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function sign(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

export function cls(n: number): string {
  return n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
}

export function arr(n: number): string {
  return n >= 0 ? '▲' : '▼';
}

// ---- Sparkline (BUG-DATA-004: fabricated trend shapes removed) ----
// The old sparkline drew a deterministic shape hashed from the ticker symbol
// (via _hash3) — NOT real prices; only the up/down colour was real. These call
// sites (stock-panel / movers / dashboard / watchlist / portfolio / screener
// rows) pass only a seed and an up/down flag, with no real price series, so any
// drawn shape is fabricated. We now render NOTHING instead. Signatures are kept
// byte-for-byte compatible so every consumer keeps compiling and simply shows
// no sparkline. (_hash3 was the fabrication helper and has been removed.)

/** Kept for signature stability; emits no markup — no real price series to plot. */
export function sparkSVG(_seed: number, _up: boolean, _w = 80, _h = 26): string {
  return "";
}

/** Renders nothing: with only a seed (no real price series) any sparkline shape
 *  would be fabricated. Consumers keep passing {seed, up} and get an empty render. */
export function Spark(_props: { seed: number; up: boolean; w?: number; h?: number }) {
  return null;
}

// ---- Stock logo — real logo via Parqet CDN, letter avatar fallback ----
const _LP = ['#6366f1','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f59e0b','#ef4444','#22c55e','#0ea5e9','#f97316'];
/**
 * Global multiplier for every ticker logo in the app.
 *
 * Applied INSIDE the component rather than by editing ~47 call sites, so the
 * 10 different sizes passed around the app all scale together and stay in
 * proportion. Change this one number to resize every ticker icon.
 */
export const TICKER_LOGO_SCALE = 1.5;

export function StockLogo({ sym, size = 22 }: { sym: string; size?: number }) {
  const idx = sym.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % _LP.length;
  const px = Math.round(size * TICKER_LOGO_SCALE);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: px, height: px, borderRadius: Math.round(px * 0.3),
      background: _LP[idx], color: '#fff',
      fontSize: Math.round(px * 0.44), fontWeight: 800,
      fontFamily: 'var(--f-display)', flexShrink: 0, lineHeight: 1,
      position: 'relative', overflow: 'hidden',
    }}>
      {sym[0]}
      <img
        // Logos come from Polygon's ticker `branding`, proxied by the backend
        // (`/live/logo`) so the API key stays server-side — no third-party CDN.
        // A 404 (Polygon has no branding for this ticker) hides the img and the
        // coloured letter tile behind it shows through.
        src={backendUrl(`/live/logo?ticker=${encodeURIComponent(sym)}`)}
        alt=""
        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        style={{
          // Branding logos are opaque, near-square tiles, so they cover the
          // square edge-to-edge. No white backdrop or own radius — both left a
          // 1px white ring at the parent's rounded corners; the parent's
          // overflow:hidden does the rounding. cover avoids any letterbox on a
          // rare non-square logo.
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover',
        }}
      />
    </span>
  );
}

// ---- Semicircular gauge (matches HTML v5 gaugeSVG) ----
export function SemiGauge({ val, label, id = "sg" }: { val: number; label: string; id?: string }) {
  const cx = 70, cy = 66, r = 54;
  const a = Math.PI * (1 - val / 100);
  const nx = cx + r * Math.cos(a);
  const ny = cy - r * Math.sin(a);
  const arcLen = 170;
  const dashOffset = arcLen - arcLen * val / 100;
  const color = val >= 60 ? "var(--up)" : val >= 40 ? "var(--warn)" : "var(--down)";
  const gradId = `${id}-grad`;
  return (
    <svg viewBox="0 0 140 90" width={150} style={{ display: "block" }}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="1">
          <stop offset="0" stopColor="#FF5470" />
          <stop offset=".5" stopColor="#FFB547" />
          <stop offset="1" stopColor="#2FE6A6" />
        </linearGradient>
      </defs>
      <path d="M16 66 A54 54 0 0 1 124 66" fill="none" stroke="var(--surface-3)" strokeWidth="11" strokeLinecap="round" />
      <path d="M16 66 A54 54 0 0 1 124 66" fill="none" stroke={`url(#${gradId})`} strokeWidth="11" strokeLinecap="round"
        strokeDasharray={arcLen} strokeDashoffset={dashOffset} />
      <circle cx={nx} cy={ny} r="6" fill="var(--text-hi)" stroke="var(--bg)" strokeWidth="3" />
      <text x="70" y="53" textAnchor="middle" fontSize="22" fontWeight="700"
        fontFamily="var(--f-mono)" fill={color}>{val}</text>
      <text x="70" y="79" textAnchor="middle" fontSize="8" fontWeight="600"
        letterSpacing="2" fontFamily="var(--f-display)" fill={color}>{label.toUpperCase()}</text>
    </svg>
  );
}

// ---- Technical rating gauge (TradingView-style segmented semicircle) ----
const TR_TONE: Record<string, string> = {
  "Strong Buy": "var(--up)", "Buy": "#7bdcae", "Neutral": "var(--text-dim-solid)",
  "Sell": "#ff9aab", "Strong Sell": "var(--down)",
};
export const RATING_VAL: Record<string, number> = {
  "Strong Buy": 0.9, "Buy": 0.55, "Neutral": 0, "Sell": -0.55, "Strong Sell": -0.9,
};

export function TrGauge({ val, label }: { val: number; label: string }) {
  const cx = 90, cy = 82, r = 66;
  const t = (val + 1) / 2;
  const a = Math.PI * (1 - t);
  const nx = (cx + r * Math.cos(a)).toFixed(1);
  const ny = (cy - r * Math.sin(a)).toFixed(1);
  const arc = (s: number, e: number) => {
    const a0 = Math.PI * (1 - s), a1 = Math.PI * (1 - e);
    return `M ${(cx + r * Math.cos(a0)).toFixed(1)} ${(cy - r * Math.sin(a0)).toFixed(1)} A ${r} ${r} 0 0 1 ${(cx + r * Math.cos(a1)).toFixed(1)} ${(cy - r * Math.sin(a1)).toFixed(1)}`;
  };
  const tone = TR_TONE[label] ?? "var(--text-dim-solid)";
  return (
    <svg viewBox="0 0 180 104" width="190">
      <path d={arc(0, .2)} fill="none" stroke="#FF5470" strokeWidth="13" strokeLinecap="butt" />
      <path d={arc(.2, .4)} fill="none" stroke="#ff9aab" strokeWidth="13" strokeLinecap="butt" />
      <path d={arc(.4, .6)} fill="none" stroke="#697486" strokeWidth="13" strokeLinecap="butt" />
      <path d={arc(.6, .8)} fill="none" stroke="#7bdcae" strokeWidth="13" strokeLinecap="butt" />
      <path d={arc(.8, 1)} fill="none" stroke="#2FE6A6" strokeWidth="13" strokeLinecap="butt" />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--text-hi)" strokeWidth="3" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="6" fill="var(--text-hi)" />
      <text x={cx} y="100" textAnchor="middle" fill={tone} fontFamily="Space Grotesk" fontWeight="700" fontSize="15">{label}</text>
    </svg>
  );
}

// ---- Heatmap color (matches HTML heatCol) ----
export function heatCol(p: number): { bg: string; fg: string } {
  const a = Math.min(Math.abs(p) / 3, 1);
  const L = (x: number, y: number) => Math.round(x + (y - x) * a);
  let r: number, g: number, b: number;
  if (p >= 0) { r = L(206, 8); g = L(240, 120); b = L(220, 62); }
  else         { r = L(250, 168); g = L(214, 12); b = L(222, 32); }
  return { bg: `rgb(${r},${g},${b})`, fg: a > 0.42 ? "#ffffff" : "#0c1a13" };
}

// ---- Shared deterministic hash (used for seeded chart/earnings/news data) ----
export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ---- Shared earnings-history row shape (real data — populated per-caller from live earnings_events) ----
export interface EarnQ { q: string; e: number; a: number; surp: number; mv: number; }

export function EarningsGrowthChart({ hist }: { hist: EarnQ[] }) {
  const d = [...hist].slice(0, 12).reverse();
  const W = 560, H = 190, PADL = 36, PADR = 12, PADT = 28, PADB = 26;
  const iw = W - PADL - PADR, ih = H - PADT - PADB;
  const vals = d.map(x => x.a);
  const maxV = Math.max(...vals, 0.01) * 1.25;
  const minV = Math.min(...vals, 0);
  const range = maxV - minV || 1;
  const n = d.length, gw = iw / n, bw = gw * 0.44;
  const cy = (v: number) => PADT + ih - ((v - minV) / range) * ih;
  const pts = d.map((x, i) => `${(PADL + gw * i + gw / 2).toFixed(1)},${cy(x.a).toFixed(1)}`).join(" ");
  const yTicks = [minV, minV + range / 2, maxV].map(v => ({
    v, y: cy(v),
    label: v >= 1 ? `$${v.toFixed(1)}` : `$${v.toFixed(2)}`,
  }));
  const yoyMap: Record<string, number> = {};
  d.forEach((q, i) => {
    if (i >= 4) yoyMap[q.q] = ((q.a - d[i - 4].a) / Math.abs(d[i - 4].a || 1)) * 100;
  });
  return (
    // No maxWidth: let the chart scale to the full width of its box (it was
    // capped at 560px, leaving the right of a wider container empty).
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {minV < 0 && (
        <line x1={PADL} y1={cy(0).toFixed(1)} x2={W - PADR} y2={cy(0).toFixed(1)}
          stroke="var(--border)" strokeDasharray="3 3" />
      )}
      {yTicks.map(t => (
        <g key={t.v}>
          <line x1={PADL} y1={t.y.toFixed(1)} x2={W - PADR} y2={t.y.toFixed(1)}
            stroke="var(--border-soft)" strokeDasharray="2 4" />
          <text x={(PADL - 4).toFixed(1)} y={(t.y + 3.5).toFixed(1)} textAnchor="end"
            style={{ fill: "var(--text-dim-solid)", fontSize: "0.5rem" }}>
            {t.label}
          </text>
        </g>
      ))}
      {d.map((x, i) => {
        const cx = PADL + gw * i + gw / 2;
        const barH = Math.max(2, (Math.abs(x.a - minV) / range) * ih);
        const barY = cy(Math.max(x.a, minV));
        const beat = x.surp >= 0;
        const yoy = yoyMap[x.q];
        return (
          <g key={x.q}>
            <rect x={(cx - bw / 2).toFixed(1)} y={barY.toFixed(1)}
              width={bw.toFixed(1)} height={barH.toFixed(1)} rx="3"
              style={{ fill: beat ? "var(--up)" : "var(--down)", opacity: 0.85 }} />
            <text x={cx.toFixed(1)} y={(barY - 4).toFixed(1)} textAnchor="middle"
              style={{ fill: "var(--text-hi)", fontSize: "0.5312rem", fontWeight: 600 }}>
              ${x.a.toFixed(2)}
            </text>
            {yoy !== undefined && (
              <text x={cx.toFixed(1)} y={(barY - 14).toFixed(1)} textAnchor="middle"
                style={{ fill: yoy >= 0 ? "var(--up)" : "var(--down)", fontSize: "0.4688rem", fontWeight: 700 }}>
                {yoy >= 0 ? "+" : ""}{yoy.toFixed(0)}% YoY
              </text>
            )}
            <text x={cx.toFixed(1)} y={H - 8} textAnchor="middle"
              style={{ fill: "var(--text-dim-solid)", fontSize: "0.5312rem" }}>
              {x.q.replace(" ", "'")}
            </text>
          </g>
        );
      })}
      <polyline points={pts} fill="none" stroke="var(--brand-2)" strokeWidth="1.8"
        strokeLinejoin="round" style={{ opacity: 0.85 }} />
      {d.map((x, i) => (
        <circle key={x.q} cx={(PADL + gw * i + gw / 2).toFixed(1)} cy={cy(x.a).toFixed(1)} r="2.8"
          style={{ fill: "var(--brand-2)" }} />
      ))}
    </svg>
  );
}

// Chart timeframe + type option lists, shared by every chart toolbar.
export const TF_OPTIONS = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y"] as const;
export const CHART_TYPE_OPTIONS = ["Candles", "Hollow", "Bars", "Line", "Area"] as const;

/** Compact styled <select> that replaces the old inline button rows for the
 *  chart timeframe (1D–5Y) and chart type (Candles–Area) pickers. */
export function ChartSelect({ value, options, onChange, title }: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  title?: string;
}) {
  return (
    <select className="chart-select" value={value} title={title} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ---- Candlestick chart (matches HTML genOHLC + candleChart) ----
export type OHLCBar = { t: number; o: number; h: number; l: number; c: number; v: number };

/** X-axis tick label for one bar, in ET — intraday timeframes show a clock time, longer ones a date. */
function xAxisLabel(t: number, tf: string): string {
  const d = new Date(t);
  if (tf === "1H" || tf === "1D") {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  }
  if (tf === "1W") {
    return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
  }
  if (tf === "1M" || tf === "3M") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  }
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "America/New_York" });
}

function _sma(data: OHLCBar[], p: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < p - 1) return null;
    let sum = 0;
    for (let j = i - p + 1; j <= i; j++) sum += data[j].c;
    return sum / p;
  });
}

function _ema(data: OHLCBar[], p: number): (number | null)[] {
  const k = 2 / (p + 1);
  let prev: number | null = null;
  return data.map((d, i) => {
    if (prev === null) {
      if (i < p - 1) return null;
      let sum = 0;
      for (let j = 0; j < p; j++) sum += data[j].c;
      prev = sum / p;
      return prev;
    }
    prev = d.c * k + prev * (1 - k);
    return prev;
  });
}

const MA_PERS = [9, 21, 50, 200];
const MA_COLS = ['#f5b14c', '#34E2F0', '#7C6CF5', '#ff79c6'];
const EMA_COLS = ['#5ff0b3', '#22b8d6', '#a78bfa', '#ff9aab'];

type CandleChartProps = {
  sym: string; tf: string; px: number;
  maStep?: number; emaStep?: number;
  showVol?: boolean; chartType?: string;
  /** Real OHLCV bars for this ticker/timeframe, oldest-first. */
  realBars?: OHLCBar[];
  /** Latest live (delayed) price, folded onto the most recent real bar so the chart updates in place. */
  live?: { price: number; high: number | null; low: number | null } | null;
};

/**
 * BUG-DATA-002: never fabricate a chart. When the backend returns fewer than
 * two real bars for this ticker/timeframe there is nothing honest to plot, so
 * we show an explicit empty state instead of the old seeded genOHLC series
 * (which rendered a fully synthetic candlestick chart scaled to the real price,
 * with no "simulated" label). Export name and props are unchanged, so callers
 * in stock.tsx / stock-panel.tsx need no edits.
 */
export function CandleChart(props: CandleChartProps) {
  if (!props.realBars || props.realBars.length < 2) {
    return <DataState label="Not enough price history to plot a chart yet." height={264} />;
  }
  return <CandleChartInner {...props} />;
}

function CandleChartInner({
  sym, tf, px, maStep = 0, emaStep = 0, showVol = true, chartType = "candles", realBars, live,
}: CandleChartProps) {
  const [tip, setTip] = useState<{ html: string; left: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const data = useMemo(() => {
    // Guaranteed non-empty (>= 2 bars) by the CandleChart wrapper above; the
    // empty fallback is a type-safe no-op that can never fabricate data.
    const base = realBars && realBars.length > 1 ? realBars : [];
    // Overlay the live price onto the current (last) real bar: its close tracks
    // the tick and its high/low stretch to include it.
    if (live && live.price > 0 && realBars && realBars.length > 1) {
      const last = base[base.length - 1];
      const c = live.price;
      const h = Math.max(last.h, live.high ?? c, c);
      const l = Math.min(last.l, live.low ?? c, c);
      return [...base.slice(0, -1), { ...last, c, h, l }];
    }
    return base;
  }, [sym, tf, px, realBars, live]);
  const n = data.length;
  const W = 720, PH = 224, VH = showVol ? 54 : 0, GAP = showVol ? 10 : 0, PADT = 12, PADB = 26, axisW = 46;
  const H = PADT + PH + GAP + VH + PADB;
  const plotW = W - axisW - 8;
  const cw = plotW / n;
  const X = (i: number) => 6 + i * cw + cw / 2;
  const mn = Math.min(...data.map(x => x.l)), mx2 = Math.max(...data.map(x => x.h)), rng = (mx2 - mn) || 1;
  const Y = (v: number) => PADT + PH * (1 - (v - mn) / rng);
  const vmax = Math.max(...data.map(x => x.v)) || 1;
  const VY0 = PADT + PH + GAP, VYb = VY0 + VH;

  const buildPath = (vals: (number | null)[]): string => {
    let d = '', started = false;
    vals.forEach((v, i) => {
      if (v == null) return;
      d += (started ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1) + ' ';
      started = true;
    });
    return d;
  };

  const gridLines = Array.from({ length: 5 }, (_, g) => {
    const yy = PADT + PH * g / 4;
    const val = mx2 - rng * g / 4;
    return { yy, val };
  });

  // X-axis date/time ticks — a handful of evenly spaced bars, deduped so two
  // ticks never land on the same index when n is small.
  const xTickCount = Math.min(6, n);
  const xTickIdx = xTickCount <= 1
    ? [0]
    : [...new Set(Array.from({ length: xTickCount }, (_, i) => Math.round(i * (n - 1) / (xTickCount - 1))))];
  const xAxisY = PADT + PH + GAP + VH + 15;

  const erIdx = Math.round(n * 0.82);
  const ct = chartType.toLowerCase();
  const trendUp = data[n - 1].c >= data[0].c;
  const lineColor = trendUp ? 'var(--up)' : 'var(--down)';
  const linePts = data.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(d.c).toFixed(1)}`).join(' ');
  const areaFill = linePts + ` L${X(n - 1).toFixed(1)} ${(PADT + PH).toFixed(1)} L${X(0).toFixed(1)} ${(PADT + PH).toFixed(1)} Z`;

  const maPaths = MA_PERS.slice(0, maStep).map(p => buildPath(_sma(data, p)));
  const emaPaths = MA_PERS.slice(0, emaStep).map(p => buildPath(_ema(data, p)));

  const handleMove = useCallback((e: React.MouseEvent<SVGRectElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = W / rect.width;
    const mx = (e.clientX - rect.left) * sx;
    let i = Math.round((mx - 6) / cw - 0.5);
    i = Math.max(0, Math.min(n - 1, i));
    const d = data[i];
    const chg = ((d.c - d.o) / d.o * 100);
    const col = chg >= 0 ? "var(--up)" : "var(--down)";
    const hostW = rect.width;
    const px2 = (X(i) / W) * hostW;
    setTip({
      html: `O <b>$${d.o.toFixed(2)}</b>  H <b>$${d.h.toFixed(2)}</b>  L <b>$${d.l.toFixed(2)}</b>  C <b>$${d.c.toFixed(2)}</b> <span style="color:${col}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</span>`,
      left: Math.min(hostW - 200, Math.max(4, px2 + 10)),
    });
  }, [data, cw, n, W]);

  return (
    <div style={{ position: "relative" }}>
      {tip && (
        <div className="chart-tip" style={{ opacity: 1, left: tip.left, top: 14 }}
          dangerouslySetInnerHTML={{ __html: tip.html }} />
      )}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
        {/* Grid */}
        {gridLines.map(({ yy, val }) => (
          <g key={yy}>
            <line x1="6" x2={W - axisW} y1={yy} y2={yy} stroke="var(--border-soft)" strokeWidth="1" />
            <text className="caxis" x={W - axisW + 4} y={yy + 3}>${val > 500 ? Math.round(val) : val.toFixed(2)}</text>
          </g>
        ))}
        {/* Volume bars */}
        {showVol && data.map((d, i) => {
          const bh = Math.max(1, (d.v / vmax) * (VH - 4));
          const bw2 = Math.max(1.2, cw * 0.62);
          return <rect key={`v${i}`} x={X(i) - bw2 / 2} y={VYb - bh} width={bw2} height={bh}
            fill={d.c >= d.o ? "var(--up)" : "var(--down)"} opacity={0.34} />;
        })}
        {showVol && <text className="caxis" x="6" y={VY0 + 10}>Vol</text>}
        {/* Average-volume reference line — helps spot above-average (often
            institutional) volume days at a glance. */}
        {showVol && n > 0 && (() => {
          const avgV = data.reduce((s, d) => s + d.v, 0) / n;
          const ah = Math.max(1, (avgV / vmax) * (VH - 4));
          const ay = VYb - ah;
          return (
            <g>
              <line x1={6} x2={W - axisW} y1={ay} y2={ay} stroke="var(--text-dim-solid)"
                strokeWidth="1" strokeDasharray="3 3" opacity={0.85} />
              <text className="caxis" x={W - axisW - 2} y={ay - 2} textAnchor="end">avg vol</text>
            </g>
          );
        })()}

        {/* Area fill */}
        {ct === 'area' && (
          <>
            <defs>
              <linearGradient id="cArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={lineColor} stopOpacity={0.28} />
                <stop offset="1" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={areaFill} fill="url(#cArea)" stroke="none" />
          </>
        )}
        {/* Line / Area line */}
        {(ct === 'line' || ct === 'area') && (
          <path d={linePts} fill="none" stroke={lineColor} strokeWidth="1.8" />
        )}
        {/* OHLC Bars */}
        {ct === 'bars' && data.map((d, i) => {
          const up2 = d.c >= d.o;
          const col = up2 ? 'var(--up)' : 'var(--down)';
          const tw = Math.max(2, cw * 0.3);
          return (
            <g key={i}>
              <line x1={X(i)} x2={X(i)} y1={Y(d.h)} y2={Y(d.l)} stroke={col} strokeWidth="1.2" />
              <line x1={X(i) - tw} x2={X(i)} y1={Y(d.o)} y2={Y(d.o)} stroke={col} strokeWidth="1.2" />
              <line x1={X(i)} x2={X(i) + tw} y1={Y(d.c)} y2={Y(d.c)} stroke={col} strokeWidth="1.2" />
            </g>
          );
        })}
        {/* Candles + Hollow */}
        {(ct === 'candles' || ct === 'hollow') && data.map((d, i) => {
          const up2 = d.c >= d.o;
          const col = up2 ? 'var(--up)' : 'var(--down)';
          const bt = Y(Math.max(d.o, d.c)), bb = Y(Math.min(d.o, d.c));
          const bw2 = Math.max(1.2, cw * 0.62);
          const fill = ct === 'hollow' && up2 ? 'transparent' : col;
          return (
            <g key={i}>
              <line x1={X(i)} x2={X(i)} y1={Y(d.h)} y2={Y(d.l)} stroke={col} strokeWidth="1" />
              <rect x={X(i) - bw2 / 2} y={bt} width={bw2} height={Math.max(1, bb - bt)}
                fill={fill} stroke={col} strokeWidth={ct === 'hollow' ? 1 : 0} />
            </g>
          );
        })}
        {/* Legend backing panel — keeps the MA/EMA labels legible instead of
            overlapping (interfering with) the candles behind them. */}
        {(maStep + emaStep) > 0 && (
          <rect x={7} y={PADT + 2} width={62} height={(maStep + emaStep) * 12 + 4} rx={5}
            fill="var(--surface-0)" opacity={0.72} />
        )}
        {/* MA overlays */}
        {maPaths.map((d, idx) => d && (
          <g key={`ma${idx}`}>
            <path d={d} fill="none" stroke={MA_COLS[idx]} strokeWidth="1.4" opacity={0.95} />
            <text className="caxis" x={10} y={PADT + 11 + idx * 12} fill={MA_COLS[idx]}>— MA{MA_PERS[idx]}</text>
          </g>
        ))}
        {/* EMA overlays */}
        {emaPaths.map((d, idx) => d && (
          <g key={`ema${idx}`}>
            <path d={d} fill="none" stroke={EMA_COLS[idx]} strokeWidth="1.4" strokeDasharray="4 3" opacity={0.95} />
            <text className="caxis" x={10} y={PADT + 11 + (maStep + idx) * 12} fill={EMA_COLS[idx]}>·· EMA{MA_PERS[idx]}</text>
          </g>
        ))}
        {/* ER event marker */}
        {erIdx < n && (
          <>
            <circle cx={X(erIdx)} cy={Y(data[erIdx].h) - 10} r="4" fill="var(--ai)" />
            <text className="caxis" x={X(erIdx)} y={Y(data[erIdx].h) - 16} textAnchor="middle" fill="var(--ai)">◆ ER</text>
          </>
        )}
        {/* X-axis date/time ticks — edge ticks anchor inward so their text never clips off the plot */}
        {xTickIdx.map((i, k) => (
          <text key={`x${i}`} className="caxis" x={X(i)} y={xAxisY}
            textAnchor={k === 0 ? "start" : k === xTickIdx.length - 1 ? "end" : "middle"}>
            {xAxisLabel(data[i].t, tf)}
          </text>
        ))}
        {/* Invisible hover rect */}
        <rect x="6" y={PADT} width={plotW} height={PH + GAP + VH} fill="transparent"
          onMouseMove={handleMove} onMouseLeave={() => setTip(null)} />
      </svg>
    </div>
  );
}

/**
 * technical-indicators.job only stores the latest RSI(14) reading per ticker
 * (rsi14 on CompanyDoc) — no historical time series exists yet, so unlike the
 * old version this never draws a fabricated 90-point line. It plots the one
 * real value as a marker against the classic 70/30 zones and says so.
 */
export function RsiPane({ rsi14, loading }: { rsi14: number | null; loading?: boolean }) {
  const w = 720, h = 72;
  if (rsi14 == null) {
    return <DataState loading={loading} label="RSI (14) needs the technical-indicators job to have run for this ticker — not available yet." height={h} />;
  }
  const Yp = (p: number) => 8 + (h - 16) * (1 - p / 100);
  const v = Math.max(0, Math.min(100, rsi14));
  const zoneColor = v > 70 ? "#FF5470" : v < 30 ? "#2FE6A6" : "#FFB547";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", display: "block" }}>
      <line x1="40" x2={w - 20} y1={Yp(70)} y2={Yp(70)} stroke="#FF547055" strokeWidth="1" strokeDasharray="3 3" />
      <line x1="40" x2={w - 20} y1={Yp(30)} y2={Yp(30)} stroke="#2FE6A655" strokeWidth="1" strokeDasharray="3 3" />
      <text x={w - 16} y={Yp(70) + 3} fill="var(--text-dim-solid)" fontSize="8" fontFamily="JetBrains Mono">70</text>
      <text x={w - 16} y={Yp(30) + 3} fill="var(--text-dim-solid)" fontSize="8" fontFamily="JetBrains Mono">30</text>
      <line x1="40" x2={w - 20} y1={Yp(v)} y2={Yp(v)} stroke={zoneColor} strokeWidth="2" />
      <text x={44} y={Yp(v) - 5} fill={zoneColor} fontSize="9" fontFamily="JetBrains Mono" fontWeight={700}>
        {v.toFixed(1)} · latest
      </text>
      <text x={44} y={h - 4} fill="var(--text-dim-solid)" fontSize="7" fontFamily="JetBrains Mono">
        Historical RSI line needs a time-series technicals feed — not available yet.
      </text>
    </svg>
  );
}

