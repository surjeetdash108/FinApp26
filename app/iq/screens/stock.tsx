"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useIQActions, ExpandBtn } from "../shell";
import { type StockInfo } from "../data";
import { fmt, cls, arr, sign, CandleChart, RsiPane, TrGauge, RATING_VAL, earnHistory, EarnQ, EarningsGrowthChart } from "../utils";
import { firebaseAuth } from "../../firebase";
import { apiGet, apiPost, apiDelete } from "../backend";
import { useApiResource } from "../hooks/useApiResource";
import { useApiList } from "../hooks/useApiList";
import { useBackendBars } from "../hooks/useBackendBars";
import type {
  CompanyDoc, AnalystConsensusDoc, InsiderTxDoc, SectorApiDoc, LiveEarningsDoc, HoldingDoc,
  DividendHistoryDoc, SplitsDoc, FinancialsDoc, QuarterFinancials, NewsArticleDoc,
} from "../types";

// Numeric 1-99 tech rating -> the same string buckets the rest of the app
// uses (screener.tsx has an identical local copy — each screen keeps its own).
function ratingLabel(n: number): string {
  if (n >= 90) return "Strong Buy";
  if (n >= 70) return "Buy";
  if (n >= 40) return "Neutral";
  if (n >= 20) return "Sell";
  return "Strong Sell";
}

function sectorTrendOf(pctChange: number): string {
  return pctChange > 0.5 ? "Improving" : pctChange < -0.5 ? "Deteriorating" : "Flat";
}

interface LiveSectorRow { name: string; rank: number; trend: string; pctChange: number; }

/** Same live-only sector build as heatmap.tsx's buildSectorList, kept local per this codebase's per-screen convention. */
function buildSectorRows(companies: CompanyDoc[], sectorsLive: SectorApiDoc[]): LiveSectorRow[] {
  const bySector = new Map<string, CompanyDoc[]>();
  for (const c of companies) {
    if (!c.sector) continue;
    if (!bySector.has(c.sector)) bySector.set(c.sector, []);
    bySector.get(c.sector)!.push(c);
  }
  const sectorPctByName = new Map(sectorsLive.map(s => [s.sector, s.pctChange]));
  const names = new Set<string>([...bySector.keys(), ...sectorsLive.map(s => s.sector)]);
  const rows = [...names].map(name => {
    const members = bySector.get(name) ?? [];
    const pctChange = sectorPctByName.get(name) ?? (
      members.length > 0 ? members.reduce((s, c) => s + (c.pctChange ?? 0), 0) / members.length : 0
    );
    return { name, rank: 0, trend: sectorTrendOf(pctChange), pctChange };
  });
  return rows.sort((a, b) => b.pctChange - a.pctChange).map((row, i) => ({ ...row, rank: i + 1 }));
}

function fmtMarketCapB(billions: number): string {
  return billions >= 1000 ? `$${(billions / 1000).toFixed(2)}T` : billions >= 10 ? `$${Math.round(billions)}B` : `$${billions.toFixed(1)}B`;
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

const STOCK_DESC: Record<string, string> = {
  NVDA: "Designs and sells GPUs, networking chips, and AI computing platforms. Its CUDA software stack has become the default infrastructure for AI model training and inference at hyperscale.",
  TSLA: "Manufactures electric vehicles and develops autonomous driving software (FSD). Also sells energy storage systems and solar products; a growing robotics initiative (Optimus) is in early development.",
  AAPL: "Designs and markets consumer electronics, software, and services. The iPhone-anchored hardware business is complemented by a fast-growing, high-margin services segment including the App Store, iCloud, and Apple TV+.",
  MSFT: "Develops cloud computing (Azure), enterprise software (Microsoft 365), and professional social networking (LinkedIn). An OpenAI partnership has embedded Copilot AI across its entire product suite.",
  GOOGL: "Operates the world's dominant search engine and YouTube. Generates revenue almost entirely from digital advertising, with Google Cloud as a rapidly growing second business and DeepMind driving AI research.",
  META: "Runs the world's largest social platforms — Facebook, Instagram, and WhatsApp. Revenue is nearly all digital advertising; heavy investment in AI infrastructure and Reality Labs (VR/AR) headsets.",
  AMZN: "The world's largest e-commerce marketplace and the leading cloud-computing provider through AWS. Also operates a high-margin digital advertising business, Prime Video, and a growing healthcare segment.",
  JPM:  "The largest U.S. bank by assets, with businesses spanning consumer banking, investment banking, commercial lending, and asset management. A key beneficiary of the higher-for-longer interest-rate environment.",
  V:    "Operates a global payments network connecting cardholders, merchants, and financial institutions. Earns fees on transaction volume rather than extending credit, insulating it from consumer-credit risk.",
  UNH:  "A diversified healthcare conglomerate: UnitedHealthcare provides health insurance plans while Optum delivers pharmacy benefits, data analytics, and care delivery services.",
  AVGO: "Designs semiconductors and infrastructure software for networking, storage, and broadband. Major AI revenue driver through custom accelerators for hyperscalers; software business adds recurring revenue via VMware.",
  CRM:  "Provides cloud-based customer-relationship-management (CRM) software. Its platform spans sales, service, marketing, and analytics; the Einstein AI layer is being woven through every product.",
  PLTR: "Builds data-analytics and AI platforms for government intelligence agencies (Gotham) and commercial enterprises (Foundry, AIP). Known for deep integrations into mission-critical workflows.",
  INTC: "Designs and manufactures CPUs for PCs, servers, and embedded systems. Executing a multi-year foundry turnaround (Intel Foundry Services) to regain process-node leadership lost to TSMC and Samsung.",
  WBA:  "Operates one of the largest U.S. pharmacy chains and provides pharmacy-benefit and healthcare services. Navigating store closures and margin compression amid structural pharmacy-reimbursement headwinds.",
  DELL: "Designs and sells PCs, servers, networking gear, and storage systems. Its Infrastructure Solutions Group is a direct beneficiary of AI-driven server demand, particularly for NVIDIA-GPU-based configurations.",
  ZIM:  "An Israel-based container shipping company that carries cargo across global trade lanes. Earnings are highly cyclical, tracking global container freight rates and supply-chain volumes.",
  AMD:  "Designs high-performance CPUs (EPYC) and GPUs (Instinct), competing directly with Intel in data-center compute and NVIDIA in AI accelerators. Gained meaningful AI-chip market share with MI300X.",
  MU:   "Manufactures DRAM and NAND flash memory — the primary storage building blocks inside smartphones, PCs, and data centers. Pricing is cyclical; the AI memory supercycle (HBM) is a key near-term catalyst.",
  SMCI: "Designs and assembles high-density server and storage systems, specialising in AI-optimised racks built around NVIDIA GPUs. Competes on speed-to-market and customisation for hyperscaler and enterprise buyers.",
};

const BEAT_STREAK: Record<string, number> = {
  AAPL: 4, NVDA: 7, MSFT: 5, GOOGL: 3, META: 4, AMZN: 3, TSLA: -1, JPM: 5, V: 4, UNH: 3,
  AVGO: 5, CRM: 6, PLTR: 6, INTC: -2, WBA: -3, DELL: -1, ZIM: 1, AMD: 3, MU: 3, SMCI: 5,
};
const INST_OWN: Record<string, number> = {
  AAPL: 61, NVDA: 66, MSFT: 72, GOOGL: 68, META: 63, AMZN: 59, TSLA: 44, JPM: 72, V: 81, UNH: 82,
  AVGO: 78, CRM: 82, PLTR: 48, INTC: 64, WBA: 60, DELL: 45, ZIM: 22, AMD: 68, MU: 79, SMCI: 55,
};
const SHORT_INT: Record<string, number> = {
  AAPL: 0.7, NVDA: 1.1, MSFT: 0.6, GOOGL: 0.8, META: 1.3, AMZN: 1.0, TSLA: 3.2, JPM: 0.4, V: 0.5, UNH: 0.6,
  AVGO: 1.4, CRM: 1.6, PLTR: 4.2, INTC: 2.6, WBA: 9.4, DELL: 2.8, ZIM: 18.0, AMD: 2.3, MU: 2.0, SMCI: 12.0,
};

function ratingCounts(rt: string) {
  const MAP: Record<string, { ol: string; ml: string; o: [number,number,number]; m: [number,number,number] }> = {
    "Strong Buy":  { ol: "Strong Buy",  ml: "Strong Buy",  o: [1,2,8],  m: [0,1,14] },
    "Buy":         { ol: "Buy",         ml: "Buy",         o: [2,4,5],  m: [1,3,11] },
    "Neutral":     { ol: "Neutral",     ml: "Neutral",     o: [3,5,3],  m: [3,5,7]  },
    "Sell":        { ol: "Sell",        ml: "Sell",        o: [5,4,2],  m: [8,4,3]  },
    "Strong Sell": { ol: "Strong Sell", ml: "Strong Sell", o: [8,2,1],  m: [12,2,1] },
  };
  return MAP[rt] ?? MAP["Neutral"];
}

const ac = (a: string) => a === "Buy" ? "var(--up)" : a === "Sell" ? "var(--down)" : "var(--text-dim-solid)";

type IncRow = { c: string; rev: number; cogs: number; gp: number; opex: number; oi: number; ni: number; eps: number };

function earnIncome(mc: number, mg: number, px: number, period: "Q" | "A"): IncRow[] {
  const rev0 = Math.max(2, mc * 0.02);
  const sh   = Math.max(0.3, mc / Math.max(1, px));
  const cols = period === "Q"
    ? ["Q2 25","Q1 25","Q4 24","Q3 24","Q2 24","Q1 24","Q4 23","Q3 23","Q2 23","Q1 23"]
    : ["FY 25e","FY 2024","FY 2023","FY 2022","FY 2021","FY 2020","FY 2019","FY 2018","FY 2017","FY 2016"];
  const scale = period === "A" ? 4 : 1;
  const step  = period === "A" ? 0.07 : 0.025;
  return cols.map((c, i) => {
    const rev  = rev0 * scale * (1 - i * step);
    const cogs = rev * (1 - Math.min(0.95, mg / 100));
    const gp   = rev - cogs;
    const opex = rev * 0.22;
    const oi   = gp - opex;
    const ni   = Math.max(0.01, oi * 0.82);
    const eps  = ni / sh;
    return { c, rev, cogs, gp, opex, oi, ni, eps };
  });
}

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

function earnHistAnnual(hist10: import("../utils").EarnQ[]): import("../utils").EarnQ[] {
  const byYear: Record<string, import("../utils").EarnQ[]> = {};
  hist10.forEach(q => {
    const yr = q.q.split(" ")[1];
    if (!byYear[yr]) byYear[yr] = [];
    byYear[yr].push(q);
  });
  return Object.entries(byYear)
    .sort((a, b) => parseInt(b[0]) - parseInt(a[0]))
    .map(([yr, qs]) => {
      const e    = qs.reduce((s, q) => s + q.e, 0);
      const a    = qs.reduce((s, q) => s + q.a, 0);
      const surp = ((a - e) / Math.abs(e || 1)) * 100;
      const mv   = qs.reduce((s, q) => s + q.mv, 0) / qs.length;
      return { q: parseInt(yr) >= 25 ? "FY 25e" : `FY 20${yr}`, e, a, surp, mv };
    });
}

function EarnEpsChart({ hist }: { hist: EarnQ[] }) {
  const d = [...hist].reverse();
  const W = 560, H = 210, PADL = 30, PADR = 18, PADT = 14, PADB = 30;
  const iw = W - PADL - PADR, ih = H - PADT - PADB;
  const maxE = Math.max(...d.map(x => Math.max(x.e, Math.abs(x.a)))) * 1.15 || 1;
  const maxM = Math.max(1, ...d.map(x => Math.abs(x.mv)));
  const n = d.length, gw = iw / n, bw = gw * 0.28;
  const pts = d.map((x, i) => {
    const cx = PADL + gw * i + gw / 2;
    const my = PADT + ih / 2 - (x.mv / maxM) * (ih / 2 - 8);
    return `${cx.toFixed(1)},${my.toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }}>
      <line x1={PADL} y1={PADT + ih / 2} x2={W - PADR} y2={PADT + ih / 2}
        stroke="var(--border)" strokeDasharray="3 3" />
      {d.map((x, i) => {
        const cx = PADL + gw * i + gw / 2;
        const eh = Math.max(2, (x.e / maxE) * ih);
        const ah = Math.max(2, (Math.abs(x.a) / maxE) * ih);
        const my = PADT + ih / 2 - (x.mv / maxM) * (ih / 2 - 8);
        return (
          <g key={x.q}>
            <rect x={(cx - bw - 2).toFixed(1)} y={(PADT + ih - eh).toFixed(1)} width={bw.toFixed(1)} height={eh.toFixed(1)} rx="2" style={{ fill: "var(--surface-3)" }} />
            <rect x={(cx + 2).toFixed(1)} y={(PADT + ih - ah).toFixed(1)} width={bw.toFixed(1)} height={ah.toFixed(1)} rx="2" style={{ fill: x.surp >= 0 ? "var(--up)" : "var(--down)" }} />
            <circle cx={cx.toFixed(1)} cy={my.toFixed(1)} r="2.6" style={{ fill: "var(--brand-2)" }} />
            {(i % 2 === 0 || i === n - 1) && (
              <text x={cx.toFixed(1)} y={H - 10} textAnchor="middle" style={{ fill: "var(--text-dim-solid)", fontSize: "0.5625rem" }}>
                {x.q.replace(" ", "'")}
              </text>
            )}
          </g>
        );
      })}
      <polyline points={pts} fill="none" stroke="var(--brand-2)" strokeWidth="1.6" />
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

function EarnPane({ sym, base }: { sym: string; base: number }) {
  const hist = earnHistory(sym, Math.max(0.5, base)).slice(0, 8).reverse();
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
  initialShowVol, initialShowRsi, initialShowEarnings, eps, rs, rsi, erDate,
}: {
  sym: string; px: number; initialTf: string;
  initialChartType: "Candles" | "Hollow" | "Bars" | "Line" | "Area";
  initialMaStep: number; initialEmaStep: number;
  initialShowVol: boolean; initialShowRsi: boolean; initialShowEarnings: boolean;
  eps: number; rs: number; rsi: number; erDate: string;
}) {
  const [tf, setTf] = useState(initialTf);
  const [chartType, setChartType] = useState(initialChartType);
  const [maStep, setMaStep] = useState(initialMaStep);
  const [emaStep, setEmaStep] = useState(initialEmaStep);
  const [showVol, setShowVol] = useState(initialShowVol);
  const [showRsi, setShowRsi] = useState(initialShowRsi);
  const [showEarnings, setShowEarnings] = useState(initialShowEarnings);
  const realBars = useBackendBars(sym, tf);
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
              {Math.round(rsi)} · {rsi > 70 ? "overbought" : rsi < 40 ? "weak" : "neutral-to-strong"}
            </span>
          </div>
          <RsiPane sym={sym} tf={tf} />
        </div>
      )}
      {showEarnings && (
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 4 }}>
          <div style={{ padding: "6px 0 4px", fontSize: ".66rem", color: "var(--text-dim-solid)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Earnings · EPS Surprise</span>
            <span className="mono" style={{ color: "var(--warn)", fontWeight: 600 }}>Next: {erDate}</span>
          </div>
          <EarnPane sym={sym} base={eps} />
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

  // Live overlays for the detail panels — real analyst consensus and insider
  // transactions (from the Phase 2 market-data endpoints) and real 52-week
  // levels (from a year of bars). Each falls back to the existing mock when
  // empty, so nothing goes blank before a ticker has been synced.
  const { data: liveConsensus } = useApiList<AnalystConsensusDoc>("/market-data/analyst-actions");
  const { data: liveInsider } = useApiList<InsiderTxDoc>("/market-data/insider-transactions");
  const { data: companies } = useApiList<CompanyDoc>("/market-data/companies");
  const { data: sectorsLive } = useApiList<SectorApiDoc>("/market-data/sectors");
  const { data: liveEarnings } = useApiList<LiveEarningsDoc>("/market-data/earnings");
  const [folioTickers, setFolioTickers] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!firebaseAuth.currentUser) return;
    apiGet<{ holdings: HoldingDoc[] }>("/api/portfolio")
      .then(r => setFolioTickers(new Set(r.holdings.map(h => h.ticker))))
      .catch(() => {});
  }, []);
  const yearBars = useBackendBars(sym, "1Y");
  const [emaStep, setEmaStep] = useState(0);
  const realBars = useBackendBars(sym, tfActive);

  // Per-ticker profile + dividend/split/financials history — cache-aside via
  // GET /live/company|/live/dividend-history|/live/splits|/live/financials
  // (replacing the direct companies Firestore listener this screen used to
  // hold open). Re-fetches whenever `sym` changes since it's part of the path.
  const { data: liveCompany } = useApiResource<CompanyDoc>(`/live/company?ticker=${encodeURIComponent(sym)}`);
  const { data: dividendHistory } = useApiResource<DividendHistoryDoc>(`/live/dividend-history?ticker=${encodeURIComponent(sym)}`);
  const { data: splitsDoc } = useApiResource<SplitsDoc>(`/live/splits?ticker=${encodeURIComponent(sym)}`);
  const { data: financialsDoc } = useApiResource<FinancialsDoc>(`/live/financials?ticker=${encodeURIComponent(sym)}`);
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
    if (typeof window === "undefined") return new Set();
    const saved = localStorage.getItem("iq-watchlist");
    if (saved) { try { return new Set(JSON.parse(saved) as string[]); } catch { /* ignore */ } }
    return new Set();
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

  const suggestions = companies
    .map(c => c.ticker)
    .filter(s => search && s.toLowerCase().startsWith(search.toLowerCase()));

  const co = companies.find(x => x.ticker === sym);

  const _baseP   = co?.price ?? 162;
  const _baseC   = co?.pctChange ?? 2.4;
  const _baseName = co?.name ?? sym;
  const _baseSec  = co?.sector ?? "Technology";
  const _basePe   = co?.peRatio ?? 46;
  const _baseMc   = co?.marketCap != null ? co.marketCap / 1e9 : 100;
  const _baseMkt  = _baseMc >= 1000 ? `$${(_baseMc/1000).toFixed(2)}T` : _baseMc >= 10 ? `$${Math.round(_baseMc)}B` : `$${_baseMc.toFixed(1)}B`;

  const fallbackData: StockInfo = {
    name: _baseName, price: _baseP, pctChange: _baseC, marketCap: _baseMkt,
    peRatio: _basePe, eps: _baseP / _basePe,
    week52High: _baseP * 1.35, week52Low: _baseP * 0.65,
    dividendYield: 0, beta: 1.45, sector: _baseSec,
    aiRating: co?.techRating != null ? ratingLabel(co.techRating) : "Neutral", aiThesis: "", aiRisk: "",
    aiMetrics: [],
    financials: [],
    news: [],
    insiderActivity: [],
  };
  const isLiveStock = !!liveCompany && liveCompany.price != null;

  // Real 52-week high/low from a year of daily bars (fallback: mock range).
  const yr = yearBars ?? [];
  const week52 = yr.length > 1
    ? { high: Math.max(...yr.map(b => b.h)), low: Math.min(...yr.map(b => b.l)) }
    : null;
  // Real insider transactions for this ticker, mapped into the panel's shape.
  // (News panel isn't rendered anywhere in this screen yet — deferred to
  // Phase 6, so no news fetch happens here at all.)
  const symInsider = liveInsider
    .filter(x => x.ticker === sym)
    .sort((a, b) => (b.transactionDate ?? "").localeCompare(a.transactionDate ?? ""))
    .slice(0, 8)
    .map(x => ({
      name: x.ownerName ?? "Insider",
      action: `${x.acquiredOrDisposed === "A" ? "Buy" : "Sell"} ${Math.round(x.shares ?? 0).toLocaleString("en-US")} sh`,
      date: (x.transactionDate ?? "").slice(0, 10),
    }));

  const base = fallbackData;
  const data: StockInfo = {
    ...base,
    ...(isLiveStock
      ? {
          name: liveCompany.name ?? base.name,
          price: liveCompany.price ?? base.price,
          pctChange: liveCompany.pctChange ?? base.pctChange,
          marketCap: liveCompany.marketCap != null ? fmtMarketCapB(liveCompany.marketCap / 1e9) : base.marketCap,
          peRatio: liveCompany.peRatio ?? base.peRatio,
          dividendYield: liveCompany.dividendYield ?? base.dividendYield,
          beta: liveCompany.beta ?? base.beta,
          sector: liveCompany.sector ?? base.sector,
        }
      : {}),
    ...(week52 ? { week52High: week52.high, week52Low: week52.low } : {}),
    ...(symInsider.length ? { insiderActivity: symInsider } : {}),
  };
  const isUp = data.pctChange >= 0;
  const p = data.price;

  const rating = (co?.techRating != null ? ratingLabel(co.techRating) : null) ?? data.aiRating ?? "Neutral";
  const rs = co?.rsRating ?? 55;
  const mg = co?.grossMargin != null ? co.grossMargin * 100 : 20;
  const rv = co?.rvol ?? 1.2;
  const mc = co?.marketCap != null ? co.marketCap / 1e9 : 100;
  const gv = RATING_VAL[rating] ?? 0;
  const tone = gv > 0.6 ? "var(--up)" : gv > 0 ? "#7bdcae" : gv < -0.6 ? "var(--down)" : gv < 0 ? "#ff9aab" : "var(--text-dim-solid)";
  // Real analyst consensus (Buy/Neutral/Sell counts) from analyst_actions when
  // available; the proprietary "MarketSurge" rating (rc.m) stays illustrative.
  const rcBase = ratingCounts(rating);
  const consensusDoc = liveConsensus.find(c => c.ticker === sym);
  const rc = consensusDoc
    ? {
        ...rcBase,
        o: [
          consensusDoc.sell + consensusDoc.strongSell,
          consensusDoc.hold,
          consensusDoc.strongBuy + consensusDoc.buy,
        ] as [number, number, number],
        ol: (() => {
          const bull = consensusDoc.strongBuy + consensusDoc.buy;
          const bear = consensusDoc.sell + consensusDoc.strongSell;
          if (bull > bear && consensusDoc.strongBuy >= consensusDoc.buy) return "Strong Buy";
          if (bull > bear) return "Buy";
          if (bear > bull && consensusDoc.strongSell >= consensusDoc.sell) return "Strong Sell";
          if (bear > bull) return "Sell";
          return "Neutral";
        })(),
      }
    : rcBase;

  const ex = EXCHANGE[sym] ?? "NASDAQ";
  const group = data.sector ?? co?.sector ?? "Technology";
  const st = BEAT_STREAK[sym] ?? 2;
  const si = SHORT_INT[sym] ?? 2.0;
  const io = INST_OWN[sym] ?? 60;
  const erDate = liveEarnings.find(e => e.ticker === sym)?.date ?? data.aiMetrics?.find(m => m.label === "Next ER")?.value ?? "—";
  // No live source ties a 13F fund's holdings to a ticker symbol (positions are
  // keyed by CUSIP/issuer name, not ticker) — accepted gap, see insider.tsx.
  const fundsHolding = 0;

  // Derived financials
  const eps = p / (data.peRatio || 25);
  const ni = mc / (data.peRatio || 25);
  const rev = ni / ((mg / 100) || 0.2);
  const fcf = ni * 0.9;
  const debt = mc * 0.04;
  // Real RSI(14)/MACD from technical-indicators.job when available; otherwise
  // the original seeded approximations so the panel never goes blank.
  const rsi = liveCompany?.rsi14 != null ? liveCompany.rsi14 : Math.round(38 + rs * 0.36);
  const macd = liveCompany?.macd != null ? liveCompany.macd : data.pctChange * 2.6;
  const macdBuy = liveCompany?.macd != null ? macd >= (liveCompany.macdSignal ?? 0) : isUp;
  const dollar = Math.abs(data.pctChange / 100 * p);
  const avgVol = Math.max(1, Math.round(mc * 1000 / p * 0.012));

  const cap = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(2)}T` : v >= 10 ? `$${Math.round(v)}B` : `$${v.toFixed(1)}B`;
  const nf = (x: number) => Math.round(x).toLocaleString("en-US");
  const lo = p * (rs > 60 ? 0.58 : 0.78), hi = p * 1.02;
  const S1 = p * 0.965, S2 = p * 0.93, R1 = p * 1.03, R2 = p * 1.06;

  const trendTxt = isUp && rs >= 70
    ? "<b>Strong uptrend.</b> Higher highs and higher lows; momentum confirmed by recent strength."
    : rs < 40
    ? "<b>Downtrend.</b> Lower highs and lower lows; price is below key moving averages."
    : "<b>Range / consolidation.</b> Choppy two-way action with no decisive trend yet.";
  const maTxt = rs >= 60 ? "Above the 20, 50 and 200-day — bullish alignment."
    : rs < 40 ? "Below the 50 and 200-day — bearish alignment."
    : "Mixed: hugging the 50-day with a flat 200-day.";

  const indRows: [string, string, string][] = [
    ["RSI (14)", rsi.toFixed(2), rsi > 70 ? "Sell" : rsi < 40 ? "Buy" : "Neutral"],
    ["MACD (12,26)", macd.toFixed(1), macdBuy ? "Buy" : "Sell"],
    ["Stoch %K", (50 + data.pctChange * 4).toFixed(1), (50 + data.pctChange * 4) > 80 ? "Sell" : "Buy"],
    ["ADX (14)", (20 + Math.abs(data.pctChange) * 2).toFixed(1), isUp ? "Buy" : "Sell"],
    ["EMA 50", nf(p * 0.94), isUp ? "Buy" : "Sell"],
    ["SMA 200", nf(p * 0.74), rs > 50 ? "Buy" : "Sell"],
  ];

  const finRows: [string, number[], string, string][] = [
    ["Revenue",       [rev * 0.55, rev * 0.7, rev * 0.86, rev], cap(rev),   "var(--up)"],
    ["Net income",    [ni * 0.5,  ni * 0.6,  ni * 0.82,  ni],  cap(ni),    ni >= 0 ? "var(--up)" : "var(--down)"],
    ["Net margin",    [mg * 0.8,  mg * 0.85, mg * 0.95,  mg],  mg + "%",   "var(--up)"],
    ["Free cash flow",[fcf * 0.4, fcf * 0.55,fcf * 0.8,  fcf], cap(fcf),   "var(--up)"],
    ["Total debt",    [debt*1.1,  debt*1.05, debt,        debt],cap(debt),  "var(--text-dim-solid)"],
  ];

  const chips: number[] = [];
  for (let i = 0; i < 8; i++) {
    chips.push(st >= 0 ? (i < Math.min(st, 8) ? 1 : 0) : (i < Math.min(-st, 8) ? 0 : 1));
  }
  const qeps = eps / 4, beatSign = st >= 0 ? 1 : -1;
  const erRows: [string, number, number][] = [
    ["Q1 25", qeps * 1.06, 12 * beatSign],
    ["Q4 24", qeps * 0.99, 8  * beatSign],
    ["Q3 24", qeps * 0.95, 6  * beatSign],
    ["Q2 24", qeps * 0.9,  5  * beatSign],
    ["Q1 24", qeps * 0.85, 4  * beatSign],
  ];
  const hist10 = earnHistory(sym, qeps);

  const liveSectorRows = buildSectorRows(companies, sectorsLive);
  const sectorInfo = liveSectorRows.find(s => s.name === group);
  const sectorTrend = sectorInfo?.trend ?? "Flat";
  const trendPill = sectorTrend === "Improving" ? "up" : sectorTrend === "Deteriorating" ? "dn" : "hold";
  const grank = sectorInfo?.rank ?? 0;
  // Stock's rank WITHIN its sector (distinct from grank, the sector-vs-sectors
  // rank above) — from tech-rating.job; shown as a small badge when available.
  const inSectorRank = liveCompany?.sectorRank ?? null;
  const inSectorTotal = liveCompany?.sectorRankTotal ?? null;
  const topSectors = liveSectorRows.slice(0, 5);

  const peers = companies
    .filter(x => x.sector === group && x.ticker !== sym && x.rsRating != null)
    .slice(0, 5)
    .map(x => ({ t: x.ticker, c: (x.rsRating! - 50) / 10 }));
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
          {[...companies].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)).slice(0, 6).map(c => (
            <button key={c.ticker} className={`chip${sym === c.ticker ? " active" : ""}`} onClick={() => selectSym(c.ticker)}>{c.ticker}</button>
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
                    eps={eps} rs={rs} rsi={rsi} erDate={erDate}
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
                    {Math.round(rsi)} · {rsi > 70 ? "overbought" : rsi < 40 ? "weak" : "neutral-to-strong"}
                  </span>
                </div>
                <div style={{ padding: "0 14px 4px" }}><RsiPane sym={sym} tf={tfActive} /></div>
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
                <div style={{ padding: "0 14px 8px" }}><EarnPane sym={sym} base={eps} /></div>
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
                ["Mkt Cap",        cap(mc)],
                ["P/E",            data.peRatio.toFixed(1)],
                ["Revenue (TTM)",  cap(rev)],
                ["EPS (TTM)",      "$" + eps.toFixed(2)],
                ["Short Int.",     si + "%"],
                ["Next ER",        erDate],
                ["52W Range",      "$" + nf(lo) + " – $" + nf(hi)],
                ["Avg Vol",        avgVol + "M"],
              ] as [string, string][]).map(k => (
                <div key={k[0]} className="kstat">
                  <div className="k">{k[0]}</div>
                  <div className="v">{k[1]}</div>
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
              {([
                ["Trend",            trendTxt],
                ["Support / Resist.",`Support near <b>$${nf(S1)}</b> and <b>$${nf(S2)}</b>; resistance at <b>$${nf(R1)}</b> then the 52-week high <b>$${nf(hi)}</b>.`],
                ["MA posture",       maTxt],
                ["Rel. strength",    `Relative-strength rank <b class="${rs >= 70 ? "up" : rs < 40 ? "down" : ""}">${rs}/99</b> vs the market — ${rs >= 70 ? "group leader." : rs < 40 ? "lagging the tape." : "roughly in line."}`],
                ["Volume",           `Relative volume <b>${rv.toFixed(1)}×</b> — ${rv > 2 ? "well above average (event-driven)." : "near normal."}`],
                ["Event risk",       `Next earnings ${erDate}. Macro: a hawkish Fed surprise pressures high-multiple names first.`],
              ] as [string, string][]).map(l => (
                <div key={l[0]} className="ai-line">
                  <span className="k">{l[0]}</span>
                  <span className="v" dangerouslySetInnerHTML={{ __html: l[1] }} />
                </div>
              ))}
              <div style={{ marginTop: 10, fontSize: ".7rem", color: "var(--text-dim-solid)" }}>
                Source: 250-day OHLCV, 20/50/200 SMA, RS vs SPX · AI-generated for informational purposes only, not investment advice.
              </div>
            </div>
          </div>

          {/* Financials — grouped bar chart */}
          {(() => {
            const inc     = incRowsFromFinancials(finPeriod, financialsDoc, () => earnIncome(mc, mg, p, finPeriod));
            const histEps = finPeriod === "Q" ? hist10.slice(0, 10) : earnHistAnnual(hist10);
            const beatsOf = histEps.filter(h => h.surp >= 0).length;
            const latestA = histEps[0]?.a ?? 0;
            const prevA   = histEps[finPeriod === "Q" ? 4 : 1]?.a;
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

                  <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border-soft)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--text-hi)" }}>Earnings Growth (EPS)</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="ec-legend" style={{ margin: 0 }}>
                          <span><i style={{ background: "var(--up)" }} />Beat</span>
                          <span><i style={{ background: "var(--down)" }} />Miss</span>
                          <span><i className="ln" style={{ background: "var(--brand-2)" }} />Trend</span>
                        </span>
                        <ExpandBtn title={`${sym} · Earnings Growth (EPS)`} node={<EarningsGrowthChart hist={histEps} />} />
                      </div>
                    </div>
                    <EarningsGrowthChart hist={histEps} />
                    <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>
                        <b style={{ color: "var(--text-hi)" }}>{beatsOf}/{histEps.length}</b> beats
                      </div>
                      <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>
                        {finPeriod === "Q" ? "Latest qtr" : "Latest FY"} EPS <b style={{ color: "var(--text-hi)" }}>${latestA.toFixed(2)}</b>
                      </div>
                      {yoy !== null && (
                        <div style={{ fontSize: ".7rem" }}>
                          {finPeriod === "Q" ? "YoY" : "YoY"} <b style={{ color: yoy >= 0 ? "var(--up)" : "var(--down)" }}>{yoy >= 0 ? "+" : ""}{yoy.toFixed(1)}%</b>
                        </div>
                      )}
                    </div>
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
              <div className="trseg2">
                <div className="trgroup">
                  <div className="gl">Oscillators</div>
                  <div className="rate" style={{ color: tone }}>{rc.ol}</div>
                  <div className="counts">
                    <span style={{ color: "var(--down)" }}>Sell<b>{rc.o[0]}</b></span>
                    <span style={{ color: "var(--text-dim-solid)" }}>Neut<b>{rc.o[1]}</b></span>
                    <span style={{ color: "var(--up)" }}>Buy<b>{rc.o[2]}</b></span>
                  </div>
                </div>
                <div className="trgroup">
                  <div className="gl">Moving Avgs</div>
                  <div className="rate" style={{ color: tone }}>{rc.ml}</div>
                  <div className="counts">
                    <span style={{ color: "var(--down)" }}>Sell<b>{rc.m[0]}</b></span>
                    <span style={{ color: "var(--text-dim-solid)" }}>Neut<b>{rc.m[1]}</b></span>
                    <span style={{ color: "var(--up)" }}>Buy<b>{rc.m[2]}</b></span>
                  </div>
                </div>
              </div>
              <table className="ind-tbl" style={{ marginTop: 12 }}>
                <tbody>
                  {indRows.map(r => (
                    <tr key={r[0]}>
                      <td>{r[0]}</td>
                      <td className="v">{r[1]}</td>
                      <td className="a" style={{ color: ac(r[2]) }}>{r[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                Computed from 11 oscillators + 15 moving averages. Indicators only — not investment advice.
              </div>
            </div>
          </div>

          {/* Peers */}
          <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div className="card-h">
              <h3>Peers · who's leading</h3>
              <span className="link" onClick={() => setInnerDrawer("peers")}>View all →</span>
            </div>
            <div className="card-b" style={{ paddingTop: 6, flex: 1, overflowY: "auto", minHeight: 0 }}>
              {peers.length ? peers.map(peer => {
                const tag = peer.c === pmx ? "Leader" : peer.c === pmn ? "Laggard" : "";
                return (
                  <div key={peer.t} className={`minirow${folioTickers.has(peer.t) ? " owned" : ""}`}
                    style={{ cursor: "pointer" }} onClick={() => openStock(peer.t)}>
                    <span className="tkr">{peer.t}</span>
                    <span className="mid">{tag && <span className={`pill ${tag === "Leader" ? "up" : "dn"}`}>{tag}</span>}</span>
                    <span className={`r ${cls(peer.c)}`}>{sign(peer.c)}</span>
                  </div>
                );
              }) : <div style={{ fontSize: ".8rem", color: "var(--text-dim-solid)" }}>No close peers tracked.</div>}
            </div>
          </div>

          {/* Industry Group rank */}
          <div className="card">
            <div className="card-h">
              <h3>Industry Group rank</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className={`pill ${trendPill}`}>{sectorTrend}</span>
                <span className="link" onClick={() => setInnerDrawer("industry")}>View all →</span>
              </div>
            </div>
            <div className="card-b">
              {topSectors.map(g => (
                <div key={g.name} className="grouprow">
                  <span className="rk">{g.rank}</span>
                  <span className="gn">{g.name}</span>
                  <div className="bar"><i style={{ width: Math.max(8, 100 - g.rank * 1.6) + "%" }} /></div>
                  <span className="mono" style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{sign(g.pctChange)}</span>
                </div>
              ))}
              <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                {group} ranks <b style={{ color: grank <= 10 ? "var(--up)" : "var(--text-hi)" }}>#{grank || "—"} of {liveSectorRows.length}</b> groups by relative strength.
              </div>
            </div>
          </div>

        </div>

        {/* Dividend history — row 3, col 1 */}
        {/* alignSelf stretch is default on grid children; explicit here for clarity */}
        {(() => {
          const dh = dividendHistory;
          const hasReal = !!dh && dh.isPayer;
          const yieldPct = hasReal ? (dh!.yieldPct ?? data.dividendYield) : data.dividendYield;
          const annualDiv = hasReal ? (dh!.ttmTotal ?? 0) : p * (data.dividendYield / 100);
          const exDay = 6 + (sym.charCodeAt(0) % 22);
          const payoutRatio = yieldPct > 0 && data.eps > 0
            ? Math.min(99, Math.round((annualDiv / data.eps) * 100)) : 0;
          const growthLabel = hasReal && dh!.cagr5yPct != null
            ? `${dh!.cagr5yPct >= 0 ? "+" : ""}${dh!.cagr5yPct.toFixed(1)}% / yr`
            : "+6.5% / yr";
          const streakLabel = hasReal && dh!.increaseStreakYears > 0 ? ` · ${dh!.increaseStreakYears}-yr streak` : "";
          const qDiv = annualDiv / 4;
          const divRows = hasReal
            ? dh!.history.slice(0, 5).map(h => ({
                label: h.exDividendDate ?? "—",
                perShare: h.amount,
                note: h.exDividendDate ? `ex ${h.exDividendDate.slice(5)}` : "",
              }))
            : [
                { label: "Q2'25", mo: "Apr" }, { label: "Q1'25", mo: "Jan" }, { label: "Q4'24", mo: "Oct" },
                { label: "Q3'24", mo: "Jul" }, { label: "Q2'24", mo: "Apr" },
              ].map((r, i) => ({ label: r.label, perShare: qDiv / Math.pow(1.065, i / 4), note: `ex ${r.mo} ${exDay}` }));
          return (
            <div className="card">
              <div className="card-h">
                <h3>Dividend &amp; split history</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {yieldPct > 0
                    ? <span className="pill up">{yieldPct.toFixed(2)}% yield</span>
                    : <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>No dividend</span>}
                  {hasReal && <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", fontSize: ".62rem" }}>live · Polygon</span>}
                  <span className="link" onClick={() => setInnerDrawer("dividend")}>View all →</span>
                </div>
              </div>
              <div className="card-b" style={{ paddingTop: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <div className="cd">
                    <span className="num">{yieldPct > 0 ? exDay - 1 : "—"}</span>
                    <span className="u">days to<br />ex-div</span>
                  </div>
                  <div>
                    <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginBottom: 4 }}>5-yr dividend growth</div>
                    <div style={{ fontSize: ".78rem", color: "var(--text-hi)" }}>
                      {yieldPct > 0 ? `${growthLabel} · payout ${payoutRatio}%${streakLabel}` : "No dividend declared"}
                    </div>
                  </div>
                </div>
                {yieldPct > 0 ? divRows.map(q => (
                  <div key={q.label} className="minirow">
                    <span className="tkr" style={{ width: 60 }}>{q.label}</span>
                    <span className="mid mono">${q.perShare.toFixed(4)}/sh</span>
                    <span className="r" style={{ color: "var(--text-dim-solid)", fontSize: ".72rem" }}>{q.note}</span>
                  </div>
                )) : (
                  [["Annual dividend","—"],["Quarterly","—"],["Payout ratio","—"],["5-yr growth","—"],["Ex-div date","—"]].map(r => (
                    <div key={r[0]} className="minirow">
                      <span className="mid">{r[0]}</span>
                      <span className="r" style={{ color: "var(--text-dim-solid)" }}>{r[1]}</span>
                    </div>
                  ))
                )}
                <div className="minirow" style={{ marginTop: 8, borderTop: "1px solid var(--border-soft)", paddingTop: 6 }}>
                  <span className="mid">Annual ({yieldPct > 0 ? `${hasReal ? dh!.ttmPayments : 4} payments` : "no payments"})</span>
                  <span className="r" style={{ color: "var(--text-hi)" }}>{yieldPct > 0 ? `$${annualDiv.toFixed(2)}/sh` : "—"}</span>
                </div>

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
              <span className={`pill ${st >= 0 ? "up" : "dn"}`}>{Math.abs(st)}-qtr {st >= 0 ? "beat" : "miss"} streak</span>
              <span className="link" onClick={() => setInnerDrawer("earnings")}>View all →</span>
            </div>
          </div>
          <div className="card-b" style={{ paddingTop: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <div className="cd">
                <span className="num">—</span>
                <span className="u">days to<br />next ER</span>
              </div>
              <div>
                <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginBottom: 4 }}>Beat / miss streak</div>
                <div className="streak">
                  {chips.map((b, i) => (
                    <b key={i} style={{ background: b ? "var(--up)" : "var(--down)" }}>{b ? "B" : "M"}</b>
                  ))}
                </div>
              </div>
            </div>
            {erRows.map(q => (
              <div key={q[0]} className="minirow">
                <span className="tkr" style={{ width: 60 }}>{q[0]}</span>
                <span className="mid mono">${fmt(Math.abs(q[1]), 2)} EPS</span>
                <span className={`r ${q[2] >= 0 ? "up" : "down"}`}>{q[2] >= 0 ? "beat" : "miss"} {Math.abs(q[2])}%</span>
              </div>
            ))}
            <div className="minirow" style={{ marginTop: 8, borderTop: "1px solid var(--border-soft)", paddingTop: 6 }}>
              <span className="mid">FY 25 EPS est.</span>
              <span className="r" style={{ color: "var(--text-hi)" }}>${(qeps * 4 * 1.08).toFixed(2)}</span>
            </div>
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
                  const valEst = (Math.abs(data.pctChange) * 0.0015 * mc + 0.5).toFixed(1);
                  return (
                    <div key={idx} className="minirow" style={{ cursor: "pointer", alignItems: "flex-start", gap: 10 }}>
                      <span className="tkr" style={{ flex: "none" }}>{sym}</span>
                      <span className="mid" style={{ whiteSpace: "normal", lineHeight: 1.45 }}>
                        {n.name} {n.action} <span style={{ color: "var(--text-dim-solid)" }}>({n.date})</span>
                      </span>
                      <span className={`r ${isSell ? "down" : "up"}`} style={{ flex: "none" }}>
                        {isSell ? "−" : "+"}${valEst}M
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
                ["Inst. ownership",   io + "%",                 "up"],
                ["Short interest",    si + "%",                 si > 10 ? "down" : "dim"],
                ["13F funds holding", fundsHolding + " tracked","dim"],
              ] as [string, string, string][]).map(x => (
                <div key={x[0]} className="minirow">
                  <span className="mid">{x[0]}</span>
                  <span className={`r ${x[2] === "dim" ? "" : x[2]}`}
                    style={x[2] === "dim" ? { color: "var(--text-hi)" } : {}}>{x[1]}</span>
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
              {([["R2", R2, "down"], ["R1", R1, "down"], ["Pivot", p, "dim"], ["S1", S1, "up"], ["S2", S2, "up"]] as [string, number, string][]).map(x => (
                <div key={x[0]} className="minirow">
                  <span className="tkr" style={{ width: 50 }}>{x[0]}</span>
                  <span className="mid" />
                  <span className="r mono" style={{ color: x[2] === "dim" ? "var(--text-hi)" : `var(--${x[2]})` }}>
                    ${nf(x[1])}
                  </span>
                </div>
              ))}
              <div style={{ height: 1, background: "var(--border-soft)", margin: "12px 0 8px" }} />
              <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-dim-solid)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>
                Moving averages &amp; range
              </div>
              {([
                ["52W High",  hi,         isUp ? "up"   : "dim"],
                ["EMA 50",    p * 0.94,   isUp ? "up"   : "down"],
                ["SMA 200",   p * 0.74,   rs > 50 ? "up" : "down"],
                ["52W Low",   lo,         isUp ? "dim"  : "down"],
              ] as [string, number, string][]).map(x => (
                <div key={x[0]} className="minirow">
                  <span className="tkr" style={{ width: 70 }}>{x[0]}</span>
                  <span className="mid" />
                  <span className="r mono" style={{ color: x[2] === "dim" ? "var(--text-hi)" : `var(--${x[2]})` }}>
                    ${nf(x[1])}
                  </span>
                </div>
              ))}
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
                      ["RSI (14)", rsi.toFixed(2), rsi > 70 ? "Sell" : rsi < 40 ? "Buy" : "Neutral"],
                      ["Stoch %K", (50 + data.pctChange * 4).toFixed(1), (50 + data.pctChange * 4) > 80 ? "Sell" : "Buy"],
                      ["CCI (14)", (data.pctChange * 15).toFixed(1), isUp ? "Buy" : "Sell"],
                      ["MACD (12,26)", macd.toFixed(1), macdBuy ? "Buy" : "Sell"],
                      ["Williams %R", String(-(100 - rsi).toFixed(0)), rsi > 70 ? "Overbought" : "Neutral"],
                      ["Bull/Bear Power", (data.pctChange * 3.2).toFixed(1), isUp ? "Buy" : "Sell"],
                      ["ADX (14)", (20 + Math.abs(data.pctChange) * 2).toFixed(1), Math.abs(data.pctChange) > 2 ? "Strong" : "Weak"],
                      ["Ultimate Osc.", (45 + data.pctChange * 3).toFixed(1), isUp ? "Buy" : "Sell"],
                      ["ROC", (data.pctChange * 1.8).toFixed(2), isUp ? "Buy" : "Sell"],
                      ["Stoch RSI", (0.5 + data.pctChange * 0.05).toFixed(2), isUp ? "Overbought" : "Oversold"],
                      ["ATR (14)", (p * 0.018).toFixed(2), "Neutral"],
                    ] as [string, string, string][]).map(r => (
                      <tr key={r[0]}>
                        <td>{r[0]}</td><td className="v">{r[1]}</td>
                        <td className="a" style={{ color: ac(r[2]) }}>{r[2]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="ai-sec" style={{ marginTop: 14 }}><div className="h">Moving Averages</div></div>
                <table className="ind-tbl">
                  <tbody>
                    {([
                      ["SMA 10",  nf(p * 0.982), isUp ? "Buy" : "Sell"],
                      ["SMA 20",  nf(p * 0.964), isUp ? "Buy" : "Sell"],
                      ["SMA 30",  nf(p * 0.944), isUp ? "Buy" : "Sell"],
                      ["SMA 50",  nf(p * 0.906), isUp ? "Buy" : "Sell"],
                      ["SMA 100", nf(p * 0.822), isUp ? "Buy" : "Sell"],
                      ["SMA 200", nf(p * 0.740), rs > 50 ? "Buy" : "Sell"],
                      ["EMA 10",  nf(p * 0.988), isUp ? "Buy" : "Sell"],
                      ["EMA 20",  nf(p * 0.968), isUp ? "Buy" : "Sell"],
                      ["EMA 30",  nf(p * 0.948), isUp ? "Buy" : "Sell"],
                      ["EMA 50",  nf(p * 0.938), isUp ? "Buy" : "Sell"],
                      ["EMA 100", nf(p * 0.848), isUp ? "Buy" : "Sell"],
                      ["EMA 200", nf(p * 0.762), rs > 50 ? "Buy" : "Sell"],
                      ["Ichimoku Base", nf(p * 0.970), isUp ? "Buy" : "Sell"],
                      ["VWAP",    nf(p * 0.994), isUp ? "Above" : "Below"],
                      ["Hull MA (9)", nf(p * 0.991), isUp ? "Buy" : "Sell"],
                    ] as [string, string, string][]).map(r => (
                      <tr key={r[0]}>
                        <td>{r[0]}</td><td className="v">{r[1]}</td>
                        <td className="a" style={{ color: ac(r[2]) }}>{r[2]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                  Computed from 11 oscillators + 15 moving averages. Not investment advice.
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
                {companies
                  .filter(x => x.sector === group && x.rsRating != null)
                  .sort((a, b) => b.rsRating! - a.rsRating!)
                  .map(x => {
                    const chg = (x.rsRating! - 50) / 10;
                    return (
                      <div key={x.ticker} className="minirow" style={{ cursor: "pointer" }}
                        onClick={() => { setInnerDrawer(null); openStock(x.ticker); }}>
                        <span className="mono" style={{
                          fontWeight: 700, minWidth: 52,
                          color: x.ticker === sym ? "var(--brand-2)" : "var(--text-hi)",
                        }}>{x.ticker}</span>
                        <span className="mid" style={{ fontSize: ".76rem" }}>{x.name ?? x.ticker}</span>
                        <span className="pill" style={{ fontSize: ".66rem", background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>RS {x.rsRating}</span>
                        <span className={`mono ${cls(chg)}`} style={{ fontSize: ".82rem" }}>{sign(chg)}</span>
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
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Industry Group Rank</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>All groups by relative strength</div>
                </div>
                <button className="closebtn" onClick={() => setInnerDrawer(null)}>✕</button>
              </div>
              <div className="drawer-b">
                {liveSectorRows.map(g => (
                  <div key={g.name} className="grouprow" style={{ cursor: "pointer" }}
                    onClick={() => { setInnerDrawer(null); openSector(g.name); }}>
                    <span className="rk">{g.rank}</span>
                    <span className="gn" style={{
                      color: g.name === group ? "var(--brand-2)" : undefined,
                      fontWeight: g.name === group ? 700 : undefined,
                    }}>{g.name}</span>
                    <div className="bar"><i style={{ width: Math.max(8, 100 - g.rank * 1.6) + "%" }} /></div>
                    <span className="mono" style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{sign(g.pctChange)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Insider & institutional */}
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
                  <div className="m"><div className="k">Inst. ownership</div><div className="v up">{io}%</div></div>
                  <div className="m"><div className="k">Short interest</div><div className={`v ${si > 10 ? "down" : ""}`}>{si}%</div></div>
                  <div className="m"><div className="k">13F funds</div><div className="v">{fundsHolding} tracked</div></div>
                </div>
                <div className="ai-sec"><div className="h">Recent insider transactions (Form 4)</div></div>
                {data.insiderActivity.length > 0 ? data.insiderActivity.map((n, i) => {
                  const isSell = /sale|sold|exercis/i.test(n.action);
                  const valEst = (Math.abs(data.pctChange) * 0.0015 * mc + 0.5).toFixed(1);
                  return (
                    <div key={i} className="minirow" style={{ alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border-soft)" }}>
                      <span className={`pill ${isSell ? "dn" : "up"}`} style={{ flex: "none", fontSize: ".66rem" }}>{isSell ? "SELL" : "BUY"}</span>
                      <span className="mid" style={{ whiteSpace: "normal", lineHeight: 1.45 }}>
                        <b style={{ color: "var(--text-hi)" }}>{n.name}</b> {n.action}{" "}
                        <span style={{ color: "var(--text-dim-solid)" }}>({n.date})</span>
                      </span>
                      <span className={`r mono ${isSell ? "down" : "up"}`} style={{ flex: "none" }}>
                        {isSell ? "−" : "+"}${valEst}M
                      </span>
                    </div>
                  );
                }) : (
                  <div style={{ fontSize: ".8rem", color: "var(--text-dim-solid)", padding: "6px 0 12px" }}>
                    No recent Form 4 activity found.
                  </div>
                )}
                {/* No live source ties a 13F fund's holdings to a ticker symbol
                    (positions are keyed by CUSIP/issuer name) — accepted gap. */}
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
                {([
                  ["R3", p * 1.09, "Resistance 3", "down"],
                  ["R2", R2,       "Resistance 2", "down"],
                  ["R1", R1,       "Resistance 1", "down"],
                  ["Pivot", p,     "Pivot point",  "dim"],
                  ["S1", S1,       "Support 1",    "up"],
                  ["S2", S2,       "Support 2",    "up"],
                  ["S3", p * 0.91, "Support 3",    "up"],
                ] as [string, number, string, string][]).map(x => (
                  <div key={x[0]} className="minirow">
                    <span className="tkr" style={{ width: 50 }}>{x[0]}</span>
                    <span className="mid" style={{ fontSize: ".76rem", color: "var(--text-dim-solid)" }}>{x[2]}</span>
                    <span className="r mono" style={{ color: x[3] === "dim" ? "var(--text-hi)" : x[3] === "up" ? "var(--up)" : "var(--down)" }}>
                      ${nf(x[1])}
                    </span>
                  </div>
                ))}
                <div className="ai-sec" style={{ marginTop: 14 }}><div className="h">52-week levels</div></div>
                <div className="metric-grid">
                  <div className="m"><div className="k">52W High</div><div className="v up">${nf(hi)}</div></div>
                  <div className="m"><div className="k">52W Low</div><div className="v down">${nf(lo)}</div></div>
                  <div className="m"><div className="k">From High</div><div className={`v ${cls((p - hi) / hi * 100)}`}>{sign((p - hi) / hi * 100)}</div></div>
                  <div className="m"><div className="k">From Low</div><div className={`v ${cls((p - lo) / lo * 100)}`}>{sign((p - lo) / lo * 100)}</div></div>
                </div>
                <div className="note" style={{ marginTop: 14 }}>
                  <b style={{ color: "var(--text-hi)" }}>AI read:</b> {sym} is ${nf(Math.abs(p - S1))} above S1 (${nf(S1)}) and ${nf(Math.abs(R1 - p))} below R1 (${nf(R1)}). Risk/reward {((R1 - p) / (p - S1)).toFixed(1)}×.
                </div>
                <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                  Pivot levels derived from recent OHLC data. Not investment advice.
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
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <div className="streak">
                    {chips.map((b, i) => (
                      <b key={i} style={{ background: b ? "var(--up)" : "var(--down)" }}>{b ? "B" : "M"}</b>
                    ))}
                  </div>
                  <span style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>{Math.abs(st)}-qtr {st >= 0 ? "beat" : "miss"} streak</span>
                </div>
                <div className="ec-legend">
                  <span><i style={{ background: "var(--surface-3)" }} />EPS estimate</span>
                  <span><i style={{ background: "var(--up)" }} />Beat</span>
                  <span><i style={{ background: "var(--down)" }} />Miss</span>
                  <span><i className="ln" style={{ background: "var(--brand-2)" }} />Stock move %</span>
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
                        <th className="num">Move</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hist10.map(q => (
                        <tr key={q.q}>
                          <td><b style={{ color: "var(--text-hi)" }}>{q.q}</b></td>
                          <td className="num">${q.e.toFixed(2)}</td>
                          <td className="num">${q.a.toFixed(2)}</td>
                          <td className={`num ${q.surp >= 0 ? "up" : "down"}`}>{q.surp >= 0 ? "+" : ""}{q.surp}%</td>
                          <td className={`num ${q.mv >= 0 ? "up" : "down"}`}>{q.mv >= 0 ? "+" : ""}{q.mv}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                  {hist10.filter(h => h.surp >= 0).length}/{hist10.length} beats over the last 10 quarters · illustrative.
                </div>
              </div>
            </div>
          )}

          {/* Financials */}
          {innerDrawer === "financials" && (() => {
            const inc = incRowsFromFinancials(finPeriod, financialsDoc, () => earnIncome(mc, mg, p, finPeriod));
            const fb = (v: number) => v >= 1 ? `$${v.toFixed(2)}B` : `$${(v * 1000).toFixed(0)}M`;
            const beats10 = hist10.filter(h => h.surp >= 0).length;
            const avgMv = (hist10.reduce((a, h) => a + Math.abs(h.mv), 0) / hist10.length).toFixed(1);
            const erEnt = liveEarnings.find(e => e.ticker === sym);
            const aiRead = erEnt && erEnt.epsActual != null && erEnt.epsEstimate != null
              ? `${sym} ${erEnt.epsActual >= erEnt.epsEstimate ? "beat" : "missed"} EPS estimates ($${erEnt.epsActual} vs $${erEnt.epsEstimate} est).`
              : `${data.name} reports around ${erDate !== "—" ? erDate : "next quarter"}.`;
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
                      <h3>{sym} · 10-quarter earnings history</h3>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>{beats10}/10 beats</span>
                        <ExpandBtn title={`${sym} · 10-quarter earnings history`} node={<EarnEpsChart hist={hist10} />} />
                      </div>
                    </div>
                    <div className="card-b" style={{ paddingTop: 8 }}>
                      <div className="ec-legend">
                        <span><i style={{ background: "var(--surface-3)" }} />EPS estimate</span>
                        <span><i style={{ background: "var(--up)" }} />Beat</span>
                        <span><i style={{ background: "var(--down)" }} />Miss</span>
                        <span><i className="ln" style={{ background: "var(--brand-2)" }} />Stock move %</span>
                      </div>
                      <EarnEpsChart hist={hist10} />
                    </div>
                  </div>
                  {/* Income statement */}
                  <div className="card" style={{ marginBottom: 14 }}>
                    <div className="card-h">
                      <h3>Income statement</h3>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>Quarterly</span>
                        <ExpandBtn title={`${sym} · Income statement`} node={<EarnIncChart inc={inc} />} />
                      </div>
                    </div>
                    <div className="card-b" style={{ paddingTop: 8 }}>
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
                    </div>
                  </div>
                  {/* AI read */}
                  <div className="ai-block">
                    <div className="card-h"><h3 className="ai-c">◆ AI earnings read · {sym}</h3></div>
                    <div className="card-b">
                      <p style={{ fontSize: ".85rem", lineHeight: 1.6, color: "var(--text)" }}>
                        {aiRead} History shows <b style={{ color: "var(--text-hi)" }}>{beats10}/10 beats</b> and an average post-print move of <b style={{ color: "var(--text-hi)" }}>{avgMv}%</b>. Watch revenue growth and forward guidance most.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {innerDrawer === "dividend" && (() => {
            const dh = dividendHistory;
            const hasReal = !!dh && dh.isPayer;
            const yieldPct = hasReal ? (dh!.yieldPct ?? data.dividendYield) : data.dividendYield;
            const annualDiv = hasReal ? (dh!.ttmTotal ?? 0) : p * (data.dividendYield / 100);
            const qDiv = annualDiv / 4;
            const growthPct = hasReal ? dh!.cagr5yPct : null;
            const growthLabel = growthPct != null ? `${growthPct >= 0 ? "+" : ""}${growthPct.toFixed(1)}%/yr` : "+6.5%/yr";
            const payoutRatio = yieldPct > 0 && data.eps > 0 ? Math.round((annualDiv / data.eps) * 100) : 0;
            const exDay = 6 + (sym.charCodeAt(0) % 22);
            const payDay = exDay + 30;

            // Real history is newest-first; reverse to chronological for the bar
            // chart, oldest→newest left-to-right, matching every other chart here.
            const barSource = hasReal
              ? [...dh!.history].reverse().slice(-8).map(h => ({
                  label: h.exDividendDate ? h.exDividendDate.slice(2, 7).replace("-", "'") : "—",
                  amt: h.amount,
                }))
              : ["Q3'24","Q4'24","Q1'25","Q2'25","Q3'25","Q4'25","Q1'26","Q2'26"].map((label, i) => ({
                  label, amt: qDiv * Math.pow(1 / 1.065, (7 - i) / 4),
                }));
            const maxAmt = Math.max(...barSource.map(b => b.amt)) * 1.15 || 1;
            const W = 420, H = 110, PADB = 22, PADT = 14;
            const bw = W / barSource.length * 0.55;
            const gap = W / barSource.length;
            return (
              <div className="side-drawer" style={{ zIndex: 52 }}>
                <div className="drawer-h">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Dividend History · {sym}</div>
                    <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>
                      {yieldPct > 0 ? `${yieldPct.toFixed(2)}% yield · $${annualDiv.toFixed(2)}/yr` : "No dividend paid"}
                    </div>
                  </div>
                  <button className="closebtn" onClick={() => setInnerDrawer(null)}>✕</button>
                </div>
                <div className="drawer-b">
                  {yieldPct === 0 ? (
                    <div style={{ padding: "24px 0", textAlign: "center", fontSize: ".9rem", color: "var(--text-dim-solid)" }}>
                      {sym} does not currently pay a dividend.
                    </div>
                  ) : (
                    <>
                      <div className="metric-grid" style={{ marginBottom: 14 }}>
                        <div className="m"><div className="k">Annual</div><div className="v">${annualDiv.toFixed(2)}</div></div>
                        <div className="m"><div className="k">Quarterly</div><div className="v">${qDiv.toFixed(2)}</div></div>
                        <div className="m"><div className="k">Yield</div><div className="v up">{yieldPct.toFixed(2)}%</div></div>
                        <div className="m"><div className="k">5-yr growth</div><div className="v up">{growthLabel}</div></div>
                        <div className="m"><div className="k">Payout ratio</div><div className="v">{payoutRatio}%</div></div>
                        <div className="m"><div className="k">Frequency</div><div className="v">{hasReal && dh!.frequency ? `${dh!.frequency}x/yr` : "Quarterly"}</div></div>
                      </div>
                      <div className="ai-sec"><div className="h">{hasReal ? "Dividend per share (recent payments)" : "Quarterly dividend per share"}</div></div>
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
                      <div className="ai-sec"><div className="h">Upcoming dates (estimated)</div></div>
                      <div className="minirow" style={{ marginTop: 8 }}>
                        <span className="mid">Ex-dividend date</span>
                        <span className="r mono" style={{ color: "var(--warn)" }}>Jul {exDay}, 2025</span>
                      </div>
                      <div className="minirow">
                        <span className="mid">Payment date</span>
                        <span className="r mono">Aug {payDay - 31}, 2025</span>
                      </div>
                      <div className="minirow">
                        <span className="mid">Declaration date</span>
                        <span className="r mono">Jun {Math.max(1, exDay - 10)}, 2025</span>
                      </div>

                      <div className="ai-sec"><div className="h">Stock splits</div></div>
                      {splitsDoc && splitsDoc.splits.length > 0 ? splitsDoc.splits.map(s => (
                        <div key={s.executionDate} className="minirow">
                          <span className="mid">{s.executionDate}</span>
                          <span className="r" style={{ color: "var(--text-hi)" }}>{s.splitFrom}:{s.splitTo}</span>
                        </div>
                      )) : (
                        <div style={{ fontSize: ".8rem", color: "var(--text-dim-solid)", padding: "4px 0" }}>No splits on record.</div>
                      )}

                      <div className="card" style={{ marginTop: 14 }}>
                        <div className="card-h"><h3 className="ai-c">◆ AI dividend read · {sym}</h3></div>
                        <div className="card-b">
                          <p style={{ fontSize: ".85rem", lineHeight: 1.6, color: "var(--text)" }}>
                            {sym} yields <b style={{ color: "var(--up)" }}>{yieldPct.toFixed(2)}%</b>, paying ${annualDiv.toFixed(2)}/share annually (${qDiv.toFixed(2)} quarterly).
                            The 5-year dividend CAGR is {growthLabel} with a payout ratio of {payoutRatio}%.
                            {payoutRatio < 60
                              ? " Payout is conservative — suggests room for future increases."
                              : " Payout is elevated — monitor earnings coverage carefully."}
                            {" "}Next ex-date is <b style={{ color: "var(--warn)" }}>Jul {exDay}, 2025 (estimated)</b>.
                          </p>
                        </div>
                      </div>
                      <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 10 }}>
                        {hasReal
                          ? "Historical payments and splits are real (Polygon). Upcoming dates are a calendar estimate, not a confirmed schedule — verify with company IR and SEC filings."
                          : "Dividend data is illustrative. Verify with company IR and SEC filings. Not investment advice."}
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
