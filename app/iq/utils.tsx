"use client";

import { useState, useRef, useCallback, useMemo, type CSSProperties } from "react";

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

// ---- Sparkline SVG (deterministic from seed) ----
function _hash3(s: number): number { return s * s * s % 7; }

export function sparkSVG(seed: number, up: boolean, w = 80, h = 26): string {
  let p = 50;
  const pts = Array.from({ length: 20 }, (_, i) => {
    p = Math.min(90, Math.max(10, p + (_hash3(seed * (i + 3)) % 11) - 5));
    return p;
  });
  if (up) pts[pts.length - 1] = Math.max(pts[pts.length - 2], pts[pts.length - 1]);
  else pts[pts.length - 1] = Math.min(pts[pts.length - 2], pts[pts.length - 1]);
  const xs = (i: number) => (i / (pts.length - 1)) * w;
  const ys = (v: number) => (1 - v / 100) * h;
  const d = 'M' + pts.map((v, i) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join('L');
  const fill = `${d}L${w},${h}L0,${h}Z`;
  const color = up ? '#2FE6A6' : '#FF5470';
  const id = `sg${seed}w${w}`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".3"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${fill}" fill="url(#${id})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/>
  </svg>`;
}

export function Spark({ seed, up, w = 80, h = 26 }: { seed: number; up: boolean; w?: number; h?: number }) {
  return (
    <div
      className="spark"
      dangerouslySetInnerHTML={{ __html: sparkSVG(seed, up, w, h) }}
    />
  );
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
        src={`https://assets.parqet.com/logos/symbol/${sym}?format=png`}
        alt=""
        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'contain', background: '#fff', borderRadius: 'inherit',
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

// ---- Shared 10-quarter earnings history (deterministic, seed = ticker symbol) ----
export interface EarnQ { q: string; e: number; a: number; surp: number; mv: number; }

export function earnHistory(sym: string, base: number): EarnQ[] {
  const qs = [
    "Q2 25","Q1 25","Q4 24","Q3 24","Q2 24","Q1 24","Q4 23","Q3 23","Q2 23","Q1 23",
    "Q4 22","Q3 22","Q2 22","Q1 22","Q4 21","Q3 21","Q2 21","Q1 21","Q4 20","Q3 20",
    "Q2 20","Q1 20","Q4 19","Q3 19","Q2 19","Q1 19","Q4 18","Q3 18","Q2 18","Q1 18",
    "Q4 17","Q3 17","Q2 17","Q1 17","Q4 16","Q3 16","Q2 16","Q1 16","Q4 15","Q3 15",
  ];
  return qs.map((q, i) => {
    const r    = (Math.abs(sym.charCodeAt(0) * 31 + (sym.charCodeAt(1) || 7) * 17 + i * 13) % 97) / 97;
    const e    = parseFloat((base * (1 - i * 0.03)).toFixed(2));
    const surp = parseFloat(((r - 0.4) * 18).toFixed(1));
    const a    = parseFloat((e * (1 + surp / 100)).toFixed(2));
    const mv   = parseFloat(((r - 0.45) * 22).toFixed(1));
    return { q, e, a, surp, mv };
  });
}

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
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }}>
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

// ---- Candlestick chart (matches HTML genOHLC + candleChart) ----
export type OHLCBar = { o: number; h: number; l: number; c: number; v: number };

function _seed(n: number) {
  let s = n;
  return () => { s = (Math.imul(1664525, s) + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
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

function genOHLC(sym: string, tf: string, px: number): OHLCBar[] {
  const C: Record<string, [number, number]> = {
    "1D": [78, 0.5], "1W": [65, 0.9], "1M": [44, 1.5],
    "3M": [64, 1.1], "6M": [120, 1.3], "1Y": [252, 1.8], "5Y": [260, 2.6],
  };
  const [n, volat] = C[tf] ?? [64, 1.1];
  const rnd = _seed(hashStr(sym + tf) + 7);
  let price = px * (tf === "5Y" ? 0.32 : tf === "1Y" ? 0.6 : 0.86);
  const out: OHLCBar[] = [];
  const bias = 0.08;
  for (let i = 0; i < n; i++) {
    const o = price;
    const ch = (rnd() - 0.5) * volat * 2 + bias * volat * 0.9;
    const c = Math.max(0.5, o * (1 + ch / 100));
    const h = Math.max(o, c) * (1 + rnd() * volat / 160);
    const l = Math.min(o, c) * (1 - rnd() * volat / 160);
    const v = 0.5 + rnd() * 0.7 + (Math.abs(ch) > volat ? 0.9 : 0);
    out.push({ o, h, l, c, v });
    price = c;
  }
  const k = px / out[out.length - 1].c;
  out.forEach(d => { d.o *= k; d.h *= k; d.l *= k; d.c *= k; });
  return out;
}

export function CandleChart({
  sym, tf, px, maStep = 0, emaStep = 0, showVol = true, chartType = "candles", realBars,
}: {
  sym: string; tf: string; px: number;
  maStep?: number; emaStep?: number;
  showVol?: boolean; chartType?: string;
  /** Real OHLCV bars for this ticker/timeframe, oldest-first — falls back to the simulated generator when omitted or too short to plot. */
  realBars?: OHLCBar[];
}) {
  const [tip, setTip] = useState<{ html: string; left: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const data = useMemo(
    () => {
      // No fabricated fallback: undefined realBars = the on-demand fetch is in
      // flight (spinner below); an empty/short array = genuinely no data.
      if (!(realBars && realBars.length > 1)) return null;
      // Reflect the live (delayed) current price on the last bar so the chart's
      // right edge tracks the header quote instead of freezing at the last
      // synced close. px comes from the shared live-price subscription; when it
      // ticks (~every 15s) the closing candle moves with it.
      if (px > 0 && Number.isFinite(px)) {
        const last = realBars[realBars.length - 1];
        const merged = { ...last, c: px, h: Math.max(last.h, px), l: Math.min(last.l, px) };
        return [...realBars.slice(0, -1), merged];
      }
      return realBars;
    },
    [px, realBars],
  );

  // All hooks above — safe to early-return. Loading: bars are being fetched on
  // demand (first user of a ticker pays ~1-2 s); Empty: fetch resolved, no bars.
  if (data === null) {
    const loading = realBars === undefined;
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 10, minHeight: 260, color: "var(--text-dim-solid)",
      }}>
        {loading ? (
          <>
            <span style={{
              width: 26, height: 26, borderRadius: "50%",
              border: "2.5px solid var(--border)", borderTopColor: "var(--ai)",
              animation: "spin .7s linear infinite", display: "inline-block",
            }} />
            <span style={{ fontSize: ".78rem" }}>Loading {sym} · {tf} chart…</span>
          </>
        ) : (
          <span style={{ fontSize: ".8rem" }}>No chart data available for {sym} ({tf}).</span>
        )}
      </div>
    );
  }
  const n = data.length;
  const W = 720, PH = 224, VH = showVol ? 54 : 0, GAP = showVol ? 10 : 0, PADT = 12, PADB = 18, axisW = 46;
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
        {/* Invisible hover rect */}
        <rect x="6" y={PADT} width={plotW} height={PH + GAP + VH} fill="transparent"
          onMouseMove={handleMove} onMouseLeave={() => setTip(null)} />
      </svg>
    </div>
  );
}

export function RsiPane({
  sym, tf, series,
}: {
  sym: string; tf: string;
  /** Real rolling RSI(14) from companies.rsi14Series — falls back to the simulated walk when absent. */
  series?: number[];
}) {
  const w = 720, h = 72;
  // The fallback below is a seeded sine-plus-noise walk, NOT an RSI. It stays
  // only for tickers outside the synced universe, where the alternative is an
  // empty pane; technical-indicators.job.ts now computes the real line from the
  // same bars the chart plots.
  const r: number[] = useMemo(() => {
    if (series && series.length > 1) return series;
    const rnd = _seed(hashStr(sym + tf + "rsi"));
    let v = 52;
    const out: number[] = [];
    for (let i = 0; i < 90; i++) {
      v += Math.sin(i * 0.22) * 4 + (rnd() - 0.5) * 6 + (i > 72 ? 2.2 : 0);
      v = Math.max(22, Math.min(86, v));
      out.push(v);
    }
    return out;
  }, [series, sym, tf]);
  const X = (i: number) => 40 + i * ((w - 60) / Math.max(1, r.length - 1));
  const Yp = (p: number) => 8 + (h - 16) * (1 - p / 100);
  const line = r.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Yp(p).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", display: "block" }}>
      <line x1="40" x2={w - 20} y1={Yp(70)} y2={Yp(70)} stroke="#FF547055" strokeWidth="1" strokeDasharray="3 3" />
      <line x1="40" x2={w - 20} y1={Yp(30)} y2={Yp(30)} stroke="#2FE6A655" strokeWidth="1" strokeDasharray="3 3" />
      <text x={w - 16} y={Yp(70) + 3} fill="#69748680" fontSize="8" fontFamily="JetBrains Mono">70</text>
      <text x={w - 16} y={Yp(30) + 3} fill="#69748680" fontSize="8" fontFamily="JetBrains Mono">30</text>
      <path d={line} fill="none" stroke="#FFB547" strokeWidth="1.6" />
    </svg>
  );
}

// ---- Tag chip helper ----
export function tagClass(tag: string): string {
  const t = tag.toLowerCase();
  if (t === 'beat') return 'beat';
  if (t === 'miss') return 'miss';
  if (t === 'raised') return 'raised';
  if (t === 'lowered') return 'lowered';
  if (t === 'owned') return 'owned';
  return '';
}

// ---- Analyst action color ----
export function actionColor(type: string): string {
  if (type === 'upgrade') return 'var(--up)';
  if (type === 'downgrade') return 'var(--down)';
  return 'var(--brand-2)';
}

/**
 * Small honesty label for data that is sample/illustrative rather than live.
 * Standardises the ipos.tsx "· sample data" pattern so screens stop presenting
 * fallback/mock content as if it were live (delivery-plan R21).
 */
export function SampleBadge({ text = "Sample data", title }: { text?: string; title?: string }) {
  return (
    <span
      title={title ?? "Illustrative data — not a live feed"}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 8px", borderRadius: 999, fontSize: ".62rem", fontWeight: 700,
        letterSpacing: ".04em", textTransform: "uppercase",
        background: "rgba(255,186,0,.15)", color: "var(--warn, #ffba00)",
        verticalAlign: "middle",
      }}
    >
      ⚠ {text}
    </span>
  );
}

/**
 * Honest loading / empty / error state — the replacement for mock fallbacks.
 *
 * Instead of rendering fabricated rows when a Firestore collection or live feed
 * is empty or errored, screens render this. It wires directly to the
 * `{ loading, error }` that `useCollection` already returns (previously unused).
 *
 * Precedence: error > loading > empty. Renders null when none apply, so it can
 * be dropped in as `<DataState .../>` above the real content and self-hides once
 * data arrives.
 */
export function DataState({
  loading,
  error,
  empty,
  label = "data",
  emptyMsg,
  subMsg,
  compact,
}: {
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  /** what this section shows, e.g. "movers", "your watchlist" */
  label?: string;
  /** override the default empty-state headline */
  emptyMsg?: string;
  /** small secondary line under the headline */
  subMsg?: string;
  /** tighter padding for inline/table use */
  compact?: boolean;
}) {
  const wrap: CSSProperties = {
    padding: compact ? "10px 12px" : "18px 14px",
    textAlign: "center",
    fontSize: ".76rem",
    color: "var(--text-dim-solid)",
    border: "1px dashed var(--border)",
    borderRadius: 8,
    margin: compact ? "4px 0" : "8px 0",
  };
  const sub: CSSProperties = { fontSize: ".68rem", marginTop: 4, opacity: 0.8 };

  if (error) {
    return (
      <div style={{ ...wrap, borderColor: "var(--down, #e5484d)", color: "var(--down, #e5484d)" }}>
        Couldn’t load {label}.
        <div style={sub}>The service may be briefly unavailable — it retries automatically.</div>
      </div>
    );
  }
  if (loading) {
    return (
      <div style={{ ...wrap, opacity: 0.85, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <span style={{
          width: 14, height: 14, borderRadius: "50%",
          border: "2px solid var(--border)", borderTopColor: "var(--ai)",
          animation: "spin .7s linear infinite", display: "inline-block", flexShrink: 0,
        }} />
        Loading {label}…
      </div>
    );
  }
  if (empty) {
    return (
      <div style={wrap}>
        {emptyMsg ?? `No live ${label} yet.`}
        {subMsg ? <div style={sub}>{subMsg}</div> : null}
      </div>
    );
  }
  return null;
}

/** True when a collection/feed has resolved with nothing to show (not loading, no error). */
export function isEmptyState(loading: boolean | undefined, error: unknown, count: number): boolean {
  return !loading && !error && count === 0;
}

/**
 * One centered spinner for a whole screen while its first data load is in
 * flight — used in place of rendering empty widgets (which flash as a blank
 * screen). Removed automatically once the caller's loading flag clears.
 * Uses the existing `spin` keyframe from iq.css.
 */
export function CenterSpinner({ label = "Loading…", minHeight = "60vh" }: { label?: string; minHeight?: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 12, width: "100%", minHeight, color: "var(--text-dim-solid)",
    }}>
      <span style={{
        width: 34, height: 34, borderRadius: "50%",
        border: "3px solid var(--border)", borderTopColor: "var(--ai)",
        animation: "spin .7s linear infinite", display: "inline-block",
      }} />
      <span style={{ fontSize: ".82rem" }}>{label}</span>
    </div>
  );
}

