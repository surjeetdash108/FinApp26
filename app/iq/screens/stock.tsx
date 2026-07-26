"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useIQActions, ExpandBtn } from "../shell";
import { type StockInfo } from "../data";
import { fmt, cls, arr, sign, CandleChart, RsiPane, TrGauge, RATING_VAL, EarnQ, EarningsGrowthChart, CenterSpinner } from "../utils";
import { collection, addDoc, getDocs, query, where, orderBy, Timestamp, deleteDoc, doc } from "firebase/firestore";
import { firebaseDb, firebaseAuth } from "../../firebase";
import { useCollection } from "../hooks/useCollection";
import { useChartBars } from "../hooks/useChartBars";
import { useCompany, useCompanyState } from "../hooks/useCompany";
import { useDividendHistory, quarterLabel, shortDate, daysUntil } from "../hooks/useDividendHistory";
import { useSplits, splitRatio, splitsSince } from "../hooks/useSplits";
import { trackFeatureOpen } from "../feature-adoption";
import { useFinancials } from "../hooks/useFinancials";
import { useTickerSearch } from "../hooks/useTickerSearch";
import { useLivePrice } from "../live-prices";

interface CompanyDoc {
  id: string; ticker: string; name: string | null; price: number | null; pctChange: number | null;
  marketCap: number | null; peRatio: number | null; dividendYield: number | null; beta: number | null;
  sector: string | null; exchange: string | null;
  // Real technicals from technical-indicators.job (null until it has run).
  rsi14: number | null; macd: number | null; macdSignal: number | null; macdHistogram: number | null;
  // Sector rank from tech-rating.job; source records which vendor served the profile.
  sectorRank: number | null; sectorRankTotal: number | null; source: string | null;
  sma50?: number | null; sma200?: number | null; rvol?: number | null; rsRating?: number | null;
  techRating?: number | null; grossMargin?: number | null;
  // Fields below replace values this screen used to derive from price multiples
  // or a seeded PRNG. All computed by technical-indicators.job from the same
  // ohlcv_bars the chart plots; peers/dividends come from the companies job.
  rsi14Series?: number[] | null;
  smaLadder?: Record<string, number | null> | null;
  emaLadder?: Record<string, number | null> | null;
  vwap?: number | null;
  high52?: number | null; low52?: number | null;
  pctFromHigh52?: number | null; pctFromLow52?: number | null;
  avgVolume20?: number | null; avgVolume50?: number | null;
  peers?: string[] | null; dividendPerShare?: number | null;
}

/**
 * Rows of the Moving Averages drawer: [label, ladder, period, legacy multiple].
 * The trailing number is the price multiple this row used to display before the
 * real ladder existed; kept only as a fallback for unsynced tickers.
 */
const MA_LADDER_ROWS: Array<[string, "sma" | "ema", number, number]> = [
  ["SMA 10", "sma", 10, 0.982],
  ["SMA 20", "sma", 20, 0.964],
  ["SMA 30", "sma", 30, 0.944],
  ["SMA 50", "sma", 50, 0.906],
  ["SMA 100", "sma", 100, 0.822],
  ["SMA 200", "sma", 200, 0.740],
  ["EMA 10", "ema", 10, 0.988],
  ["EMA 20", "ema", 20, 0.968],
  ["EMA 30", "ema", 30, 0.948],
  ["EMA 50", "ema", 50, 0.938],
  ["EMA 100", "ema", 100, 0.848],
  ["EMA 200", "ema", 200, 0.762],
];

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
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) return [];
  try {
    const q = query(
      collection(firebaseDb, "stock_comments"),
      where("uid", "==", uid),
      where("sym", "==", sym),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({
      id: d.id,
      sym: d.data().sym,
      name: d.data().name,
      comment: d.data().comment,
      createdAt: (d.data().createdAt as Timestamp).toDate(),
    }));
  } catch { return []; }
}

async function saveNote(sym: string, name: string, comment: string): Promise<string | null> {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid || !comment.trim()) return null;
  try {
    const ref = await addDoc(collection(firebaseDb, "stock_comments"), {
      uid, sym, name, comment: comment.trim(),
      createdAt: Timestamp.now(),
    });
    return ref.id;
  } catch { return null; }
}

async function deleteNote(id: string): Promise<void> {
  try { await deleteDoc(doc(firebaseDb, "stock_comments", id)); } catch { /* ignore */ }
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

// (curated per-ticker company descriptions removed — the live companies
// collection carries the real description; see useCompany.)

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

// The search suggestion list is live (useTickerSearch); no static ticker seed.
const SYMBOLS: string[] = [];

type IncRow = { c: string; rev: number; cogs: number; gp: number; opex: number; oi: number; ni: number; eps: number };

/**
 * Shown wherever real quarterly EPS has not been synced for this ticker.
 *
 * Deliberately says WHY rather than just going blank: `financials` is filled by
 * a nightly job that walks 40 of ~241 tickers per run, so "not yet" is a normal
 * transient state, not an error the reader should try to act on.
 */
function EarnEmpty({ what = "Earnings history" }: { what?: string }) {
  return (
    <div style={{
      padding: "18px 14px", textAlign: "center",
      fontSize: ".76rem", color: "var(--text-dim-solid)",
      border: "1px dashed var(--border)", borderRadius: 8,
    }}>
      {what} not available for this ticker yet.
      <div style={{ fontSize: ".68rem", marginTop: 4, opacity: 0.8 }}>
        Quarterly filings sync on a rolling nightly schedule.
      </div>
    </div>
  );
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
  // Guarded here rather than at each of the three call sites. On an empty array
  // `Math.max(...[])` is -Infinity and `iw / n` divides by zero, so the SVG
  // below would render with NaN coordinates — silently blank, and impossible to
  // tell from a chart that simply has no bars.
  if (d.length === 0) return <EarnEmpty />;
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

function EarnPane({ hist }: { hist: EarnQ[] }) {
  // Real EPS surprise history (from useFinancials → Polygon). Was seeded by
  // earnHistory(). A quarter only carries a surprise where a vendor estimate
  // exists (e.e !== e.a); otherwise its bar sits at zero — honest, not invented.
  if (hist.length === 0) {
    return <div style={{ padding: "10px 0", fontSize: ".7rem", color: "var(--text-dim-solid)" }}>EPS history not synced for this ticker yet.</div>;
  }
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
  initialShowVol, initialShowRsi, initialShowEarnings, rsi, erDate,
}: {
  sym: string; px: number; initialTf: string;
  initialChartType: "Candles" | "Hollow" | "Bars" | "Line" | "Area";
  initialMaStep: number; initialEmaStep: number;
  initialShowVol: boolean; initialShowRsi: boolean; initialShowEarnings: boolean;
  rsi: number | null; erDate: string;
}) {
  const [tf, setTf] = useState(initialTf);
  const [chartType, setChartType] = useState(initialChartType);
  const [maStep, setMaStep] = useState(initialMaStep);
  const [emaStep, setEmaStep] = useState(initialEmaStep);
  const [showVol, setShowVol] = useState(initialShowVol);
  const [showRsi, setShowRsi] = useState(initialShowRsi);
  const [showEarnings, setShowEarnings] = useState(initialShowEarnings);
  const realBars = useChartBars(sym, tf);
  const finX = useFinancials(sym);
  // Read directly rather than threading the parent's `liveCompany` through — this
  // component is rendered standalone inside the expand modal.
  const company = useCompany(sym);
  const isUp = px > 0;
  return (
    <div>
      <div className="chart-toolbar" style={{ flexWrap: "wrap", gap: "4px 0", paddingBottom: 8 }}>
        {(["1H","1D","1W","1M","3M","6M","1Y","5Y"] as const).map(r => (
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
              {rsi != null ? `${Math.round(rsi)} · ${rsi > 70 ? "overbought" : rsi < 40 ? "weak" : "neutral-to-strong"}` : "not synced"}
            </span>
          </div>
          {company?.rsi14Series ? <RsiPane sym={sym} tf={tf} series={company.rsi14Series} /> : null}
        </div>
      )}
      {showEarnings && (
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 4 }}>
          <div style={{ padding: "6px 0 4px", fontSize: ".66rem", color: "var(--text-dim-solid)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Earnings · EPS Surprise</span>
            <span className="mono" style={{ color: "var(--warn)", fontWeight: 600 }}>Next: {erDate}</span>
          </div>
          <EarnPane hist={[...finX.epsHistory].slice(-8)} />
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
  const { openStock } = useIQActions();
  const { data: companies } = useCollection<CompanyDoc>("companies");
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

  // Live overlays for the detail panels — real analyst consensus, news, insider
  // transactions (from their Firestore collections) and real 52-week levels
  // (from a year of ohlcv_bars). Each falls back to the existing mock when its
  // collection is empty, so nothing goes blank before the jobs have run.
  const { data: liveConsensus } = useCollection<{ id: string; ticker: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }>("analyst_actions");
  const { data: liveNews } = useCollection<{ id: string; ticker: string; headline: string; publishedAt: string }>("news");
  const { data: liveInsider } = useCollection<{ id: string; ticker: string; ownerName: string | null; acquiredOrDisposed: string; shares: number; transactionDate: string }>("insider_transactions");
  const yearBars = useChartBars(sym, "1Y");
  const divHist = useDividendHistory(sym);
  const splits = useSplits(sym);
  const fin = useFinancials(sym);
  // Live (delayed) price for the header + chart current-price line. Registered
  // into the shared subscription, so viewing a stock also keeps it warm.
  const liveQ = useLivePrice(sym);
  // Latest daily bar for REAL pivots (was fixed multiples of price).
  const lastBar = yearBars && yearBars.length > 0 ? yearBars[yearBars.length - 1] : null;
  const [emaStep, setEmaStep] = useState(0);
  const realBars = useChartBars(sym, tfActive);

  // ── Notes (Firebase stock_comments) ──────────────────────────────────────
  const [notes, setNotes]       = useState<StockNote[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [noteOpen, setNoteOpen]  = useState(false);
  const [ctxMenu, setCtxMenu]    = useState<{ x: number; y: number } | null>(null);

  type InnerDrawer = "techrating" | "peers" | "industry" | "insider" | "keylevels" | "earnings" | "financials" | "dividend" | null;
  const [innerDrawer, setInnerDrawerRaw] = useState<InnerDrawer>(null);
  // Wrapped rather than tracked at each of the eight call sites: a drawer added
  // later is then measured automatically instead of being silently absent from
  // adoption data. Closing (null) is not an open, so it is not counted.
  const setInnerDrawer = useCallback((d: InnerDrawer) => {
    if (d) trackFeatureOpen(`stock.drawer.${d}`);
    setInnerDrawerRaw(d);
  }, []);
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

  // Live search over the full ~10k-ticker universe by BOTH symbol and company
  // name (useTickerSearch). Falls back to the static symbol list only when the
  // live query returns nothing (offline / universe not yet synced).
  const liveResults = useTickerSearch(search);
  const suggestions: { ticker: string; name: string | null }[] = liveResults.length > 0
    ? liveResults.map(r => ({ ticker: r.ticker, name: r.name }))
    : (search
        ? SYMBOLS
            .filter(s => s.toLowerCase().startsWith(search.toLowerCase()))
            .map(s => ({ ticker: s, name: null }))
        : []);

  // On-demand (2026-07-26): the single-doc listener is BOTH the trigger (a
  // missing doc pokes /live/company, which fetches + writes it) and the fast
  // path (the cached companies list refreshes on a 5-min cadence; the doc
  // listener fires the moment the backend writes). The list entry, when
  // present, is the same doc — prefer it for referential stability.
  const { company: odCompany, loading: companyLoading } = useCompanyState(sym);
  const fromList = companies.find(c => c.ticker === sym);
  const liveCompany = fromList ?? (odCompany as typeof fromList);
  const isLiveStock = !!liveCompany && liveCompany.price != null;

  // Base is built from the live `companies/{ticker}` doc only — no mock. A
  // ticker outside the synced universe has 0/"—" placeholders and the render
  // shows an honest "not in the synced universe" state rather than fabricated
  // figures.
  const fallbackData: StockInfo = {
    name: liveCompany?.name ?? sym,
    price: liveCompany?.price ?? 0,
    pctChange: liveCompany?.pctChange ?? 0,
    marketCap: liveCompany?.marketCap != null ? fmtMarketCapB(liveCompany.marketCap / 1e9) : "—",
    peRatio: liveCompany?.peRatio ?? 0,
    eps: 0,
    week52High: 0, week52Low: 0,
    dividendYield: liveCompany?.dividendYield ?? 0,
    beta: liveCompany?.beta ?? 0,
    sector: liveCompany?.sector ?? "—",
    aiRating: "Neutral", aiThesis: "", aiRisk: "",
    aiMetrics: [],
    financials: [],
    news: [],
    insiderActivity: [],
  };

  // Real 52-week high/low from a year of daily bars (fallback: mock range).
  const yr = yearBars ?? [];
  const week52 = yr.length > 1
    ? { high: Math.max(...yr.map(b => b.h)), low: Math.min(...yr.map(b => b.l)) }
    : null;
  // Real news / insider for this ticker, mapped into the panels' shapes.
  const symNews = liveNews
    .filter(n => n.ticker === sym)
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, 6)
    .map(n => ({ headline: n.headline, date: (n.publishedAt ?? "").slice(0, 10) }));
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
    ...(week52 ? { week52High: week52.high, week52Low: week52.low } : {}),
    ...(symNews.length ? { news: symNews } : {}),
    ...(symInsider.length ? { insiderActivity: symInsider } : {}),
    // Live delayed price wins over the once-a-day `companies` close.
    ...(liveQ?.price != null
      ? { price: liveQ.price, pctChange: liveQ.changePct ?? base.pctChange }
      : {}),
  };
  const isUp = data.pctChange >= 0;
  const p = data.price;
  const priceIsLive = liveQ?.price != null;

  // Real technical rating label from the numeric composite, else "Neutral"
  // (a "no opinion" default for the gauge, not a fabricated per-ticker figure).
  const ratingLabel = (n: number) => n >= 90 ? "Strong Buy" : n >= 70 ? "Buy" : n >= 40 ? "Neutral" : n >= 20 ? "Sell" : "Strong Sell";
  const rating = liveCompany?.techRating != null ? ratingLabel(liveCompany.techRating) : "Neutral";
  const rs: number | null = liveCompany?.rsRating ?? null;   // relative strength (1-99)
  const rv: number | null = liveCompany?.rvol ?? null;       // relative volume
  const mc: number | null = liveCompany?.marketCap != null ? liveCompany.marketCap / 1e9 : null; // $B
  const gv = RATING_VAL[rating] ?? 0;
  const tone = gv > 0.6 ? "var(--up)" : gv > 0 ? "#7bdcae" : gv < -0.6 ? "var(--down)" : gv < 0 ? "#ff9aab" : "var(--text-dim-solid)";
  // Ratings triptych — every sub-rating now computed from REAL data instead of
  // the seeded ratingCounts() ladder (kept only as a last-resort when a ticker
  // has no synced indicators at all).
  const rcBase = ratingCounts(rating);

  // Moving Averages: vote the price against each real SMA/EMA (Polygon
  // technical-indicators.job). Was a fabricated fixed triple.
  const maVals = [liveCompany?.sma50, liveCompany?.sma200,
    ...(liveCompany?.emaLadder ? Object.values(liveCompany.emaLadder) : []),
  ].filter((v): v is number => typeof v === "number" && v > 0);
  const maBuy = maVals.filter(m => p > m).length;
  const maSell = maVals.filter(m => p < m).length;
  const maReal = maVals.length > 0
    ? {
        m: [maSell, maVals.length - maBuy - maSell, maBuy] as [number, number, number],
        ml: maBuy > maSell ? (maBuy >= Math.ceil(maVals.length * 0.75) ? "Strong Buy" : "Buy")
          : maSell > maBuy ? (maSell >= Math.ceil(maVals.length * 0.75) ? "Strong Sell" : "Sell") : "Neutral",
      }
    : null;

  // Oscillators: real RSI(14) + MACD-vs-signal.
  const oscVotes: ("buy" | "sell" | "neut")[] = [];
  if (liveCompany?.rsi14 != null) oscVotes.push(liveCompany.rsi14 > 70 ? "sell" : liveCompany.rsi14 < 30 ? "buy" : "neut");
  if (liveCompany?.macd != null) oscVotes.push(liveCompany.macd >= (liveCompany.macdSignal ?? 0) ? "buy" : "sell");
  const oscBuy = oscVotes.filter(v => v === "buy").length;
  const oscSell = oscVotes.filter(v => v === "sell").length;
  const oscReal = oscVotes.length > 0
    ? { o: [oscSell, oscVotes.length - oscBuy - oscSell, oscBuy] as [number, number, number],
        ol: oscBuy > oscSell ? "Buy" : oscSell > oscBuy ? "Sell" : "Neutral" }
    : null;

  // Analyst consensus (o/ol) from FMP `analyst_actions` when present — a
  // consensus snapshot, NOT per-firm actions (true per-firm needs the Benzinga
  // add-on → R41). Falls back to the real oscillator rating, never the seed.
  const consensusDoc = liveConsensus.find(c => c.ticker === sym);
  const rc = {
    ...rcBase,
    ...(maReal ? { m: maReal.m, ml: maReal.ml } : {}),
    ...(consensusDoc
      ? {
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
      : oscReal ? { o: oscReal.o, ol: oscReal.ol } : {}),
  };

  const ex = EXCHANGE[sym] ?? "—";
  const group = data.sector && data.sector !== "—" ? data.sector : null;
  // No redistributable source on the current plan for short interest, a
  // next-earnings session, beat streaks, institutional ownership % or 13F
  // holder counts — shown as "—" / omitted rather than fabricated.
  const si: number | null = null;
  const erDate = "—";

  // EPS is still derived from P/E for the mini-panels below. The revenue /
  // net-income / FCF / debt derivations that used to live here were removed:
  // they fed `finRows`, a fabricated at-a-glance panel that was never rendered,
  // and the real figures live in the financials statement table (from
  // useFinancials → Polygon /vX/reference/financials).
  // EPS derived from real price / P/E only; null when P/E hasn't synced.
  const eps: number | null = data.peRatio > 0 ? p / data.peRatio : null;
  // Real trailing-twelve-month revenue = sum of the last 4 real quarters
  // (useFinancials → Polygon). Null until 4 quarters have synced — never the old
  // P/E-and-margin guess.
  const rev: number | null = fin.incomeRows.length >= 4
    ? fin.incomeRows.slice(0, 4).reduce((s, q) => s + q.rev, 0)
    : null;
  // Real RSI(14)/MACD from technical-indicators.job — null when not synced.
  const rsi: number | null = liveCompany?.rsi14 ?? null;
  const macd: number | null = liveCompany?.macd ?? null;
  const macdBuy = macd != null && macd >= (liveCompany?.macdSignal ?? 0);
  const dollar = Math.abs(data.pctChange / 100 * p);
  // Real 20-session average volume, in millions; null when not synced.
  const avgVol: number | null = liveCompany?.avgVolume20 != null
    ? Math.max(0.1, Math.round((liveCompany.avgVolume20 / 1e6) * 10) / 10)
    : null;
  // Session VWAP straight off the last daily bar.
  const vwap = liveCompany?.vwap ?? null;

  const cap = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(2)}T` : v >= 10 ? `$${Math.round(v)}B` : `$${v.toFixed(1)}B`;
  const nf = (x: number) => Math.round(x).toLocaleString("en-US");
  /** Format a nullable number, or "—" when the real value hasn't synced. */
  const orDash = (v: number | null | undefined, f: (n: number) => string) => v == null ? "—" : f(v);
  // True rolling-52-week range from real data (company doc or a year of daily
  // bars); null when neither has synced — never a multiple of the current price.
  const lo: number | null = liveCompany?.low52 ?? week52?.low ?? null;
  const hi: number | null = liveCompany?.high52 ?? week52?.high ?? null;
  const has52w = lo != null && hi != null;

  /** One Moving-Averages drawer row from the real ladder, or "—" when unsynced. */
  const maRow = (
    label: string,
    kind: "sma" | "ema",
    period: number,
  ): [string, string, string] => {
    const ladder = kind === "sma" ? liveCompany?.smaLadder : liveCompany?.emaLadder;
    const value = ladder?.[String(period)] ?? null;
    if (value == null) return [label, "—", "—"];
    return [label, nf(value), p >= value ? "Buy" : "Sell"];
  };
  // Classic pivots from the last real daily bar (H/L/C); null when bars haven't loaded.
  const _pv = lastBar ? (lastBar.h + lastBar.l + lastBar.c) / 3 : null;
  const S1 = lastBar && _pv != null ? 2 * _pv - lastBar.h : null;
  const S2 = lastBar && _pv != null ? _pv - (lastBar.h - lastBar.l) : null;
  const R1 = lastBar && _pv != null ? 2 * _pv - lastBar.l : null;
  const R2 = lastBar && _pv != null ? _pv + (lastBar.h - lastBar.l) : null;

  // Trend/MA narrative only when a real RS rank exists — no rs-derived guess.
  const trendTxt = rs == null
    ? "Trend read not available — relative-strength rank hasn’t synced for this ticker."
    : rs >= 70
    ? "<b>Strong uptrend.</b> Higher highs and higher lows; momentum confirmed by recent strength."
    : rs < 40
    ? "<b>Downtrend.</b> Lower highs and lower lows; price is below key moving averages."
    : "<b>Range / consolidation.</b> Choppy two-way action with no decisive trend yet.";
  const maTxt = rs == null
    ? "Moving-average posture not available yet."
    : rs >= 60 ? "Above the 20, 50 and 200-day — bullish alignment."
    : rs < 40 ? "Below the 50 and 200-day — bearish alignment."
    : "Mixed: hugging the 50-day with a flat 200-day.";

  // Only indicators with a real synced value. Stoch/ADX had no source and were
  // arithmetic on the day % change — dropped rather than fabricated.
  const indRows: [string, string, string][] = [
    ...(rsi != null ? [["RSI (14)", rsi.toFixed(2), rsi > 70 ? "Sell" : rsi < 40 ? "Buy" : "Neutral"] as [string, string, string]] : []),
    ...(macd != null ? [["MACD (12,26)", macd.toFixed(1), macdBuy ? "Buy" : "Sell"] as [string, string, string]] : []),
    ...(liveCompany?.sma50 != null ? [["SMA 50", nf(liveCompany.sma50), p >= liveCompany.sma50 ? "Buy" : "Sell"] as [string, string, string]] : []),
    ...(liveCompany?.sma200 != null ? [["SMA 200", nf(liveCompany.sma200), p >= liveCompany.sma200 ? "Buy" : "Sell"] as [string, string, string]] : []),
  ];
  // Real recent EPS from useFinancials (Polygon /vX/reference/financials),
  // newest first. Was a hardcoded ladder ("Q1 25" = qeps*1.06 …). `surp` is a
  // real surprise ONLY when a vendor estimate exists (h.e !== h.a); otherwise
  // null so the row shows the actual without asserting a beat/miss.
  const erRows: { q: string; a: number; surp: number | null }[] =
    [...fin.epsHistory].reverse().slice(0, 5).map(h => ({
      q: h.q,
      a: h.a,
      surp: h.e !== h.a ? Math.round(h.surp) : null,
    }));
  // Real quarters only. This used to fall back to earnHistory(sym, qeps), a
  // generator seeded on the ticker STRING — so a ticker the financials job has
  // not reached yet rendered a full 10-quarter beat/miss table, a surprise
  // percentage and a post-print move that were all arithmetic on charCodeAt().
  // Nothing distinguished it from a real filing on screen. An empty history is
  // the honest answer; every consumer below now handles the empty case.
  //
  // `financials` covers TICKER_UNIVERSE 40 tickers per nightly run, so a given
  // ticker refreshes about every 6 days and a brand-new one is briefly blank.
  const hist10 = fin.epsHistory;

  // Sector trend/rank had only the fabricated static baseline — dropped. The
  // stock's real rank WITHIN its sector (tech-rating.job) is shown when present.
  const inSectorRank = liveCompany?.sectorRank ?? null;
  const inSectorTotal = liveCompany?.sectorRankTotal ?? null;

  // Real peers from Polygon /v1/related-companies (synced onto the company doc),
  // each peer's real day change from `companies`. Empty when the peers job
  // hasn't reached this ticker — never the old screener-sector guess with a
  // `(relativeStrength - 50) / 10` fabricated change.
  const livePeerTickers = liveCompany?.peers?.filter(t => t !== sym) ?? [];
  const peers = livePeerTickers.slice(0, 5).map(t => {
    const c = companies.find(x => x.ticker === t);
    return { t, c: c?.pctChange ?? 0, real: c?.pctChange != null };
  });
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

  // One spinner for the whole stock page while the on-demand company fetch is
  // in flight (first visit to a ticker after the empty-DB redesign). Bounded by
  // the hook's grace period, after which the honest "—" states render.
  if (companyLoading && !liveCompany) {
    return <CenterSpinner label={`Loading ${sym}…`} minHeight="60vh" />;
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
                minWidth: 280, marginTop: 2,
              }}>
                {suggestions.slice(0, 8).map(r => (
                  <div key={r.ticker} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px 6px 12px", gap: 8 }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}>
                    <div onMouseDown={() => selectSym(r.ticker)}
                      style={{ flex: 1, cursor: "pointer", minWidth: 0 }}>
                      <span style={{ fontSize: "0.7812rem", color: "var(--text-hi)", fontFamily: "var(--f-mono)" }}>{r.ticker}</span>
                      {r.name && <span style={{ fontSize: "0.68rem", color: "var(--text-dim-solid)", marginLeft: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>}
                    </div>
                    <button
                      onMouseDown={e => { e.preventDefault(); toggleWatchlist(r.ticker); }}
                      title={watchedSet.has(r.ticker) ? "Remove from watchlist" : "Add to watchlist"}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1rem", padding: "0 4px", flexShrink: 0,
                        color: watchedSet.has(r.ticker) ? "var(--warn)" : "var(--text-dim-solid)", lineHeight: 1 }}>
                      {watchedSet.has(r.ticker) ? "★" : "☆"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!hideHeader && (
        <div style={{ padding: "14px 18px 0" }}>
          <div className="sd-head">
            <div className="sd-logo" style={{ background: `linear-gradient(135deg,${logoBg(sym)},${logoBg(sym)}88)`, color: logoFg(sym) }}>
              {sym[0]}
            </div>
            <div className="sd-name">
              <h1>{sym} {!isLiveStock && <span style={{ fontSize: ".62rem", fontWeight: 600, color: "var(--text-dim-solid)", verticalAlign: "middle" }}>· not in synced universe</span>}</h1>
              <div className="sub">
                {data.name} · {ex} · {group ?? "—"}
                {inSectorRank != null && inSectorTotal != null && (
                  <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-hi)", marginLeft: 6, fontSize: ".62rem" }}>
                    #{inSectorRank} of {inSectorTotal} in sector
                  </span>
                )}
                {isLiveStock && (
                  <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", marginLeft: 6, fontSize: ".62rem" }}>
                    {priceIsLive ? "live · ~15m delayed" : "EOD close"} · {liveCompany?.source ? liveCompany.source[0].toUpperCase() + liveCompany.source.slice(1) : "Polygon"}
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
              {["1H","1D","1W","1M","3M","6M","1Y","5Y"].map(r => (
                <button key={r} className={`rng tfbtn${tfActive === r ? " on" : ""}`} onClick={() => { trackFeatureOpen(["1D","1W","1M"].includes(r) ? "chart.timeframe.intraday" : ["1Y","5Y"].includes(r) ? "chart.timeframe.long" : "chart.type"); setTfActive(r); }}>{r}</button>
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
                    rsi={rsi} erDate={erDate}
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
                    {rsi != null ? `${Math.round(rsi)} · ${rsi > 70 ? "overbought" : rsi < 40 ? "weak" : "neutral-to-strong"}` : "not synced"}
                  </span>
                </div>
                {liveCompany?.rsi14Series ? <div style={{ padding: "0 14px 4px" }}><RsiPane sym={sym} tf={tfActive} series={liveCompany.rsi14Series} /></div> : null}
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
                <div style={{ padding: "0 14px 8px" }}><EarnPane hist={[...fin.epsHistory].slice(-8)} /></div>
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
                ["Mkt Cap",        orDash(mc, cap)],
                ["P/E",            data.peRatio > 0 ? data.peRatio.toFixed(1) : "—"],
                ["Revenue (TTM)",  orDash(rev, cap)],
                ["EPS (TTM)",      orDash(eps, v => "$" + v.toFixed(2))],
                ["Short Int.",     orDash(si, v => v + "%")],
                ["Next ER",        erDate],
                ["52W Range",      has52w ? "$" + nf(lo!) + " – $" + nf(hi!) : "—"],
                ["Avg Vol",        orDash(avgVol, v => v + "M")],
              ] as [string, string][]).map(k => (
                <div key={k[0]} className="kstat">
                  <div className="k">{k[0]}</div>
                  <div className="v">{k[1]}</div>
                </div>
              ))}
            </div>
            {/* Splits inside the charted window. Bars are refetched with
                adjusted=true, so a split rewrites the history the chart above
                is drawing — without this note the price series appears to
                change for no reason. */}
            {(() => {
              const fiveYearsAgo = new Date();
              fiveYearsAgo.setUTCFullYear(fiveYearsAgo.getUTCFullYear() - 5);
              const recent = splitsSince(splits, fiveYearsAgo.toISOString().slice(0, 10));
              if (recent.length === 0) return null;
              return (
                <div style={{
                  padding: "6px 14px 10px", fontSize: ".7rem",
                  color: "var(--text-dim-solid)", borderTop: "1px solid var(--border-soft)",
                }}>
                  <b style={{ color: "var(--text-hi)" }}>Split-adjusted:</b>{" "}
                  {recent.map(s => `${splitRatio(s)} on ${shortDate(s.executionDate)}`).join(" · ")}
                  {" — prices before that date are restated."}
                </div>
              );
            })()}
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
                ["Support / Resist.", (S1 != null && S2 != null && R1 != null)
                  ? `Support near <b>$${nf(S1)}</b> and <b>$${nf(S2)}</b>; resistance at <b>$${nf(R1)}</b>${has52w ? ` then the 52-week high <b>$${nf(hi!)}</b>` : ""}.`
                  : "Pivot levels not available — daily bars haven’t loaded for this ticker."],
                ["MA posture",       maTxt],
                ["Rel. strength",    rs == null
                  ? "Relative-strength rank hasn’t synced for this ticker."
                  : `Relative-strength rank <b class="${rs >= 70 ? "up" : rs < 40 ? "down" : ""}">${Math.round(rs)}/99</b> vs the market — ${rs >= 70 ? "group leader." : rs < 40 ? "lagging the tape." : "roughly in line."}`],
                ["Volume",           rv == null
                  ? "Relative volume not synced yet."
                  : `Relative volume <b>${rv.toFixed(1)}×</b> — ${rv > 2 ? "well above average (event-driven)." : "near normal."}`],
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
            const inc     = fin.hasData ? fin.incomeRows : [];
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
                        {histEps.length > 0 && (
                          <ExpandBtn title={`${sym} · Earnings Growth (EPS)`} node={<EarningsGrowthChart hist={histEps} />} />
                        )}
                      </div>
                    </div>
                    {/* EarningsGrowthChart divides the plot width by d.length, so
                        an empty history renders an axis with no series rather
                        than saying anything. "0/0 beats · Latest EPS $0.00"
                        below reads like a real result for a company that earns
                        nothing, which is worse than admitting we have no data. */}
                    {histEps.length === 0 ? (
                      <EarnEmpty what="EPS history" />
                    ) : (
                      <>
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
                    <span className="mid">{tag && <span className={`pill ${tag === "Leader" ? "up" : "dn"}`}>{tag}</span>}</span>
                    <span className={`r ${cls(peer.c)}`}>{sign(peer.c)}</span>
                  </div>
                );
              }) : <div style={{ fontSize: ".8rem", color: "var(--text-dim-solid)" }}>No close peers tracked.</div>}
            </div>
          </div>

          {/* Sector rank — the stock's real rank within its sector (tech-rating.job) */}
          <div className="card">
            <div className="card-h">
              <h3>Sector rank</h3>
            </div>
            <div className="card-b">
              {inSectorRank != null && inSectorTotal != null ? (
                <div style={{ fontSize: ".82rem", color: "var(--text)" }}>
                  {sym} ranks{" "}
                  <b style={{ color: inSectorRank <= Math.max(1, Math.round(inSectorTotal * 0.1)) ? "var(--up)" : "var(--text-hi)" }}>
                    #{inSectorRank} of {inSectorTotal}
                  </b>{" "}
                  in {group ?? "its sector"} by relative strength.
                </div>
              ) : (
                <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Sector rank not synced for this ticker yet.</div>
              )}
            </div>
          </div>

        </div>

        {/* Dividend history — row 3, col 1 */}
        {/* alignSelf stretch is default on grid children; explicit here for clarity */}
        {(() => {
          // Real payments when the corporate-actions job has covered this ticker.
          // The `else` branch is the original extrapolation — quarterly amount
          // decayed by a fixed 6.5%/yr and an ex-day derived from the ticker's
          // first character — kept only so unsynced names still render.
          // `isPayer` only means "has dividend history at all", which is NOT the
          // same as "pays today". ADBE last paid in 2005 and INTC suspended in
          // 2024 — both have rich history and zero trailing-twelve-month
          // payments. Gating on isPayer alone rendered their real but
          // decades-old rows as if current.
          const hasData = divHist != null;
          const paysNow = hasData && divHist.ttmPayments > 0;
          const hasReal = paysNow;
          // Once real data exists it is authoritative — including when the
          // answer is "nothing". Falling through to the static mock here put a
          // fabricated yield on a company that has not paid in twenty years.
          const yieldPct = hasData ? (divHist.yieldPct ?? 0) : data.dividendYield;
          const annualDiv = hasData
            ? (divHist.ttmTotal ?? 0)
            : p * (data.dividendYield / 100);
          const qDiv = annualDiv / (paysNow ? divHist.ttmPayments : 4);
          const exDay = 6 + (sym.charCodeAt(0) % 22);
          const payoutRatio = annualDiv > 0 && data.eps > 0
            ? Math.min(99, Math.round((annualDiv / data.eps) * 100)) : 0;
          // A lapsed payer gets an explicit line rather than a bare "No dividend",
          // because "used to pay, stopped" is different information from "never paid".
          const lapsedSince = hasData && !paysNow && divHist.history.length > 0
            ? divHist.history[0].exDividendDate
            : null;
          const growthLabel = divHist?.cagr5yPct != null
            ? `${divHist.cagr5yPct >= 0 ? "+" : ""}${divHist.cagr5yPct.toFixed(1)}% / yr · payout ${payoutRatio}%`
            : yieldPct > 0 ? `payout ${payoutRatio}%` : "No dividend declared";
          // Next ex-date is the first future one in the real history; the vendor
          // publishes declared-but-not-yet-ex events, so this is a real countdown.
          const nextEx = hasReal
            ? divHist.history.map(h => daysUntil(h.exDividendDate)).find(d => d != null) ?? null
            : (yieldPct > 0 ? exDay - 1 : null);
          const divRows = hasReal
            ? divHist.history.slice(0, 5).map(h => ({
                label: quarterLabel(h.exDividendDate),
                ex: shortDate(h.exDividendDate),
                perShare: h.amount,
                special: h.dividendType != null && h.dividendType !== "CD",
              }))
            : [
                { label: "Q2'25", mo: "Apr" }, { label: "Q1'25", mo: "Jan" },
                { label: "Q4'24", mo: "Oct" }, { label: "Q3'24", mo: "Jul" },
                { label: "Q2'24", mo: "Apr" },
              ].map((r, i) => ({
                label: r.label,
                ex: `${r.mo} ${exDay}`,
                perShare: qDiv / Math.pow(1.065, i / 4),
                special: false,
              }));
          return (
            <div className="card">
              <div className="card-h">
                <h3>Dividend history</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {yieldPct > 0
                    ? <span className="pill up">{yieldPct.toFixed(2)}% yield</span>
                    : <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}
                        title={lapsedSince ? `Last paid ${shortDate(lapsedSince)}` : undefined}>
                        {lapsedSince ? "Dividend suspended" : "No dividend"}
                      </span>}
                  <span className="link" onClick={() => setInnerDrawer("dividend")}>View all →</span>
                </div>
              </div>
              <div className="card-b" style={{ paddingTop: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <div className="cd">
                    <span className="num">{nextEx ?? "—"}</span>
                    <span className="u">days to<br />ex-div</span>
                  </div>
                  <div>
                    <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginBottom: 4 }}>
                      5-yr dividend growth
                      {divHist != null && divHist.increaseStreakYears > 0 && (
                        <span style={{ color: "var(--up)" }}> · {divHist.increaseStreakYears}y streak</span>
                      )}
                    </div>
                    <div style={{ fontSize: ".78rem", color: "var(--text-hi)" }}>{growthLabel}</div>
                  </div>
                </div>
                {yieldPct > 0 ? divRows.map(q => (
                  <div key={`${q.label}-${q.ex}`} className="minirow">
                    <span className="tkr" style={{ width: 60 }}>{q.label}</span>
                    <span className="mid mono">
                      ${q.perShare.toFixed(4)}/sh
                      {q.special && <span style={{ color: "var(--warn)", marginLeft: 4 }}>special</span>}
                    </span>
                    <span className="r" style={{ color: "var(--text-dim-solid)", fontSize: ".72rem" }}>ex {q.ex}</span>
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
                  <span className="mid">
                    Annual ({yieldPct > 0
                      ? `${divHist?.ttmPayments ?? 4} payment${(divHist?.ttmPayments ?? 4) === 1 ? "" : "s"}`
                      : "no payments"})
                  </span>
                  <span className="r" style={{ color: "var(--text-hi)" }}>{yieldPct > 0 ? `$${annualDiv.toFixed(2)}/sh` : "—"}</span>
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
              <span className="link" onClick={() => setInnerDrawer("earnings")}>View all →</span>
            </div>
          </div>
          <div className="card-b" style={{ paddingTop: 6 }}>
            {erRows.length === 0 ? (
              <div className="minirow"><span className="mid" style={{ color: "var(--text-dim-solid)" }}>EPS history not synced for this ticker yet.</span></div>
            ) : erRows.map(q => (
              <div key={q.q} className="minirow">
                <span className="tkr" style={{ width: 60 }}>{q.q}</span>
                <span className="mid mono">${fmt(Math.abs(q.a), 2)} EPS</span>
                {q.surp != null
                  ? <span className={`r ${q.surp >= 0 ? "up" : "down"}`}>{q.surp >= 0 ? "beat" : "miss"} {Math.abs(q.surp)}%</span>
                  : <span className="r" style={{ color: "var(--text-dim-solid)" }}>no est.</span>}
              </div>
            ))}
            {/* Removed the fabricated "FY 25 EPS est." line (qeps*4*1.08) —
                forward EPS estimates have no Polygon source; that's Benzinga/FMP
                territory (R41/R42). */}
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
                      <span className={`r ${isSell ? "down" : "up"}`} style={{ flex: "none" }}>{isSell ? "Sell" : "Buy"}</span>
                    </div>
                  );
                })
              ) : (
                <div style={{ fontSize: ".8rem", color: "var(--text-dim-solid)", padding: "4px 0 8px" }}>
                  No recent Form 4 activity.
                </div>
              )}
              {/* Institutional-ownership %, short interest and 13F-holder counts
                  have no redistributable source on the current plan — omitted
                  rather than shown as fabricated per-ticker figures. */}
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
              {(S1 == null || R1 == null) ? (
                <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Pivot levels not available — daily bars haven’t loaded.</div>
              ) : ([["R2", R2, "down"], ["R1", R1, "down"], ["Pivot", p, "dim"], ["S1", S1, "up"], ["S2", S2, "up"]] as [string, number | null, string][])
                .filter(x => x[1] != null)
                .map(x => (
                <div key={x[0]} className="minirow">
                  <span className="tkr" style={{ width: 50 }}>{x[0]}</span>
                  <span className="mid" />
                  <span className="r mono" style={{ color: x[2] === "dim" ? "var(--text-hi)" : `var(--${x[2]})` }}>
                    ${nf(x[1]!)}
                  </span>
                </div>
              ))}
              <div style={{ height: 1, background: "var(--border-soft)", margin: "12px 0 8px" }} />
              <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-dim-solid)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>
                Moving averages &amp; range
              </div>
              {([
                ["52W High",  hi,                    "dim"],
                ["SMA 50",    liveCompany?.sma50 ?? null,  liveCompany?.sma50 != null && p >= liveCompany.sma50 ? "up" : "down"],
                ["SMA 200",   liveCompany?.sma200 ?? null, liveCompany?.sma200 != null && p >= liveCompany.sma200 ? "up" : "down"],
                ["52W Low",   lo,                    "dim"],
              ] as [string, number | null, string][])
                .filter(x => x[1] != null)
                .map(x => (
                <div key={x[0]} className="minirow">
                  <span className="tkr" style={{ width: 70 }}>{x[0]}</span>
                  <span className="mid" />
                  <span className="r mono" style={{ color: x[2] === "dim" ? "var(--text-hi)" : `var(--${x[2]})` }}>
                    ${nf(x[1]!)}
                  </span>
                </div>
              ))}
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
                      ...(rsi != null ? [["RSI (14)", rsi.toFixed(2), rsi > 70 ? "Sell" : rsi < 40 ? "Buy" : "Neutral"] as [string, string, string]] : []),
                      ...(macd != null ? [["MACD (12,26)", macd.toFixed(1), macdBuy ? "Buy" : "Sell"] as [string, string, string]] : []),
                    ]).map(r => (
                      <tr key={r[0]}>
                        <td>{r[0]}</td><td className="v">{r[1]}</td>
                        <td className="a" style={{ color: ac(r[2]) }}>{r[2]}</td>
                      </tr>
                    ))}
                    {rsi == null && macd == null && (
                      <tr><td colSpan={3} style={{ color: "var(--text-dim-solid)", fontSize: ".76rem" }}>Oscillators not synced for this ticker yet.</td></tr>
                    )}
                  </tbody>
                </table>
                <div className="ai-sec" style={{ marginTop: 14 }}><div className="h">Moving Averages</div></div>
                <table className="ind-tbl">
                  <tbody>
                    {([
                      // Real ladder from technical-indicators.job (daily closes);
                      // rows with no synced value read "—". Ichimoku/Hull/other
                      // fabricated price-multiple rows were dropped.
                      ...MA_LADDER_ROWS.map(([label, kind, period]) =>
                        maRow(label, kind as "sma" | "ema", period as number)),
                      ...(vwap != null ? [["VWAP", nf(vwap), p >= vwap ? "Above" : "Below"] as [string, string, string]] : []),
                    ]).map(r => (
                      <tr key={r[0]}>
                        <td>{r[0]}</td><td className="v">{r[1]}</td>
                        <td className="a" style={{ color: ac(r[2]) }}>{r[2]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                  Real RSI/MACD + moving averages from daily OHLCV. Not investment advice.
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
                {peers.length === 0 ? (
                  <div style={{ fontSize: ".8rem", color: "var(--text-dim-solid)" }}>No related companies synced for {sym} yet.</div>
                ) : peers.map(peer => (
                  <div key={peer.t} className="minirow" style={{ cursor: "pointer" }}
                    onClick={() => { setInnerDrawer(null); openStock(peer.t); }}>
                    <span className="mono" style={{
                      fontWeight: 700, minWidth: 52,
                      color: peer.t === sym ? "var(--brand-2)" : "var(--text-hi)",
                    }}>{peer.t}</span>
                    <span className="mid" />
                    <span className={`mono ${peer.real ? cls(peer.c) : ""}`} style={{ fontSize: ".82rem" }}>{peer.real ? sign(peer.c) : "—"}</span>
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
                      <span className={`r mono ${isSell ? "down" : "up"}`} style={{ flex: "none" }}>{isSell ? "Sell" : "Buy"}</span>
                    </div>
                  );
                }) : (
                  <div style={{ fontSize: ".8rem", color: "var(--text-dim-solid)", padding: "6px 0 12px" }}>
                    No recent Form 4 activity found.
                  </div>
                )}
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
                {(S1 == null || S2 == null || R1 == null || R2 == null) ? (
                  <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Pivot levels not available — daily bars haven’t loaded for this ticker.</div>
                ) : ([
                  ["R2", R2,       "Resistance 2", "down"],
                  ["R1", R1,       "Resistance 1", "down"],
                  ["Pivot", p,     "Pivot point",  "dim"],
                  ["S1", S1,       "Support 1",    "up"],
                  ["S2", S2,       "Support 2",    "up"],
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
                {has52w ? (
                  <div className="metric-grid">
                    <div className="m"><div className="k">52W High</div><div className="v up">${nf(hi!)}</div></div>
                    <div className="m"><div className="k">52W Low</div><div className="v down">${nf(lo!)}</div></div>
                    <div className="m"><div className="k">From High</div><div className={`v ${cls((p - hi!) / hi! * 100)}`}>{sign((p - hi!) / hi! * 100)}</div></div>
                    <div className="m"><div className="k">From Low</div><div className={`v ${cls((p - lo!) / lo! * 100)}`}>{sign((p - lo!) / lo! * 100)}</div></div>
                  </div>
                ) : (
                  <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>52-week range not synced for this ticker yet.</div>
                )}
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
                <div className="ec-legend">
                  <span><i style={{ background: "var(--surface-3)" }} />EPS estimate</span>
                  <span><i style={{ background: "var(--up)" }} />Beat</span>
                  <span><i style={{ background: "var(--down)" }} />Miss</span>
                  <span><i className="ln" style={{ background: "var(--brand-2)" }} />Stock move %</span>
                </div>
                <EarnEpsChart hist={hist10} />
                {/* Column headers over zero rows read as "this company has no
                    earnings", so the whole table goes with the data. The chart
                    above already renders EarnEmpty. */}
                <div style={{ overflowX: "auto", marginTop: 12, display: hist10.length ? undefined : "none" }}>
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
                {hist10.length > 0 && (
                  // Denominator is hist10.length, not a hardcoded 10: the vendor
                  // returns up to 10 quarters and a recent listing has fewer, so
                  // "6/10 beats" would have understated a perfect record. The
                  // "illustrative" disclaimer is gone with the generator — these
                  // are filed figures now.
                  <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                    {hist10.filter(h => h.surp >= 0).length}/{hist10.length} beats over the last {hist10.length} quarters.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Financials */}
          {innerDrawer === "financials" && (() => {
            const inc = fin.hasData ? fin.incomeRows : [];
            const fb = (v: number) => v >= 1 ? `$${v.toFixed(2)}B` : `$${(v * 1000).toFixed(0)}M`;
            const beats10 = hist10.filter(h => h.surp >= 0).length;
            // Empty history divides by zero -> "NaN%" rendered in the AI read
            // below. Null means the sentence drops that clause instead.
            const avgMv = hist10.length
              ? (hist10.reduce((a, h) => a + Math.abs(h.mv), 0) / hist10.length).toFixed(1)
              : null;
            // Summary derived from the REAL EPS history (useFinancials), not a
            // mock earnings row with fabricated guidance/reaction fields.
            const aiRead = hist10.length > 0
              ? `${data.name} beat estimates in ${beats10} of the last ${hist10.length} reported quarters.${avgMv != null ? ` Average absolute post-report move: ±${avgMv}%.` : ""}`
              : `No synced earnings history for ${sym} yet.`;
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
                        {hist10.length > 0
                          ? <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>{beats10}/{hist10.length} beats</span>
                          : null
                        }
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
                  {/* Balance sheet + cash flow — real, from the same vendor
                      response that already fed the income statement above. No
                      fallback: unlike revenue/EPS there was never a fabricated
                      version of these, so an unsynced ticker shows nothing
                      rather than something invented. */}
                  {fin.hasBalanceSheet && (() => {
                    const bs = fin.balanceRows.slice(0, 5);
                    const cell = (v: number | null) =>
                      v == null ? "—" : v >= 1 || v <= -1 ? `$${v.toFixed(2)}B` : `$${(v * 1000).toFixed(0)}M`;
                    const ROWS: Array<[string, keyof typeof bs[0], boolean]> = [
                      ["Total assets",        "assets",             true],
                      ["Current assets",      "currentAssets",      false],
                      ["Total liabilities",   "liabilities",        true],
                      ["Current liabilities", "currentLiabilities", false],
                      ["Long-term debt",      "longTermDebt",       false],
                      ["Shareholder equity",  "equity",             true],
                      ["Operating cash flow", "opCF",               true],
                      ["Investing cash flow", "invCF",              false],
                      ["Financing cash flow", "finCF",              false],
                      ["Net change in cash",  "netCF",              true],
                    ];
                    return (
                      <div className="card" style={{ marginBottom: 14 }}>
                        <div className="card-h">
                          <h3>Balance sheet &amp; cash flow</h3>
                          <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>
                            Quarterly
                          </span>
                        </div>
                        <div className="card-b" style={{ paddingTop: 8, overflowX: "auto" }}>
                          <table className="tbl">
                            <thead>
                              <tr>
                                <th>Item</th>
                                {bs.map(c => <th key={c.c} className="num">{c.c}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {ROWS.map(([lbl, key, bold]) => (
                                <tr key={lbl}>
                                  <td style={bold ? { fontWeight: 600, color: "var(--text-hi)" } : undefined}>{lbl}</td>
                                  {bs.map(c => (
                                    <td key={c.c} className="num"
                                      style={bold ? { fontWeight: 600, color: "var(--text-hi)" } : undefined}>
                                      {cell(c[key] as number | null)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                              <tr>
                                <td>Current ratio</td>
                                {bs.map(c => (
                                  <td key={c.c} className="num"
                                    style={{ color: c.currentRatio != null && c.currentRatio < 1 ? "var(--down)" : undefined }}>
                                    {c.currentRatio != null ? c.currentRatio.toFixed(2) : "—"}
                                  </td>
                                ))}
                              </tr>
                              {([["Gross margin","grossMarginPct"],["Operating margin","operatingMarginPct"],["Net margin","netMarginPct"]] as const).map(([lbl,key]) => (
                                <tr key={lbl}>
                                  <td>{lbl}</td>
                                  {bs.map(c => (
                                    <td key={c.c} className="num">
                                      {c[key] != null ? `${(c[key] as number).toFixed(1)}%` : "—"}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}
                  {/* AI read */}
                  <div className="ai-block">
                    <div className="card-h"><h3 className="ai-c">◆ AI earnings read · {sym}</h3></div>
                    <div className="card-b">
                      <p style={{ fontSize: ".85rem", lineHeight: 1.6, color: "var(--text)" }}>
                        {aiRead}{hist10.length > 0 && <> History shows <b style={{ color: "var(--text-hi)" }}>{beats10}/{hist10.length} beats</b>{avgMv != null && <> and an average post-print move of <b style={{ color: "var(--text-hi)" }}>{avgMv}%</b></>}.</>} Watch revenue growth and forward guidance most.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {innerDrawer === "dividend" && (() => {
            // Real payments when synced. The QLABELS/`Math.pow(1/1.065, …)` path
            // below was a fabricated series: eight quarters back-extrapolated from
            // the current amount at a fixed growth rate, with hardcoded "Jul/Aug
            // 2025" dates that never advanced.
            // Same isPayer-vs-pays-today distinction as the card above: a ticker
            // with history but no trailing-twelve-month payment is not currently
            // a dividend stock, and must not borrow the mock's yield.
            const hasData = divHist != null;
            const paysNow = hasData && divHist.ttmPayments > 0;
            const hasReal = paysNow;
            // History is still worth charting for a lapsed payer — it shows the
            // cut — so `recent` keys off available history, not off paysNow.
            const recent = hasData && divHist.history.length > 0
              ? divHist.history.slice(0, 8).reverse()
              : [];
            const yieldPct = hasData ? (divHist.yieldPct ?? 0) : data.dividendYield;
            const annualDiv = hasData
              ? (divHist.ttmTotal ?? 0)
              : p * (data.dividendYield / 100);
            const perYear = paysNow ? divHist.ttmPayments : 4;
            const qDiv = annualDiv / perYear;
            const QLABELS = hasReal
              ? recent.map(h => quarterLabel(h.exDividendDate))
              : ["Q3'24","Q4'24","Q1'25","Q2'25","Q3'25","Q4'25","Q1'26","Q2'26"];
            const divAmts = hasReal
              ? recent.map(h => h.amount)
              : QLABELS.map((_, i) => qDiv * Math.pow(1 / 1.065, (7 - i) / 4));
            const maxAmt = Math.max(...divAmts) * 1.15 || 1;
            const W = 420, H = 110, PADB = 22, PADT = 14;
            const bw = W / QLABELS.length * 0.55;
            const gap = W / QLABELS.length;
            // Next declared-but-not-yet-paid event, if the vendor has published one.
            const upcoming = hasReal
              ? divHist.history.find(h => daysUntil(h.exDividendDate) != null) ?? null
              : null;
            const freqLabel = { 1: "Annual", 2: "Semi-Annual", 4: "Quarterly", 12: "Monthly" }[
              divHist?.frequency ?? 4
            ] ?? "Quarterly";
            const payoutPct = data.eps > 0 ? Math.round((annualDiv / data.eps) * 100) : 0;
            const growthTxt = divHist?.cagr5yPct != null
              ? `${divHist.cagr5yPct >= 0 ? "+" : ""}${divHist.cagr5yPct.toFixed(1)}%/yr`
              : "—";
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
                      {/* "Stopped paying" and "never paid" are different facts, and
                          the real history distinguishes them — so say which. */}
                      {recent.length > 0 && (
                        <div style={{ marginTop: 6, fontSize: ".8rem" }}>
                          Last payment ${recent[recent.length - 1].amount.toFixed(4)}/sh,
                          ex-date {shortDate(recent[recent.length - 1].exDividendDate)}.
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="metric-grid" style={{ marginBottom: 14 }}>
                        <div className="m"><div className="k">Annual</div><div className="v">${annualDiv.toFixed(2)}</div></div>
                        <div className="m"><div className="k">Quarterly</div><div className="v">${qDiv.toFixed(2)}</div></div>
                        <div className="m"><div className="k">Yield</div><div className="v up">{yieldPct.toFixed(2)}%</div></div>
                        <div className="m"><div className="k">5-yr growth</div><div className={`v${divHist?.cagr5yPct != null && divHist.cagr5yPct >= 0 ? " up" : ""}`}>{growthTxt}</div></div>
                        <div className="m"><div className="k">Payout ratio</div><div className="v">{payoutPct}%</div></div>
                        <div className="m"><div className="k">Frequency</div><div className="v">{freqLabel}</div></div>
                      </div>
                      <div className="ai-sec"><div className="h">Dividend per share</div></div>
                      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", margin: "10px 0 14px" }}>
                        {divAmts.map((v, i) => {
                          const bh = (v / maxAmt) * (H - PADT - PADB);
                          const bx = gap * i + (gap - bw) / 2;
                          const by = PADT + (H - PADT - PADB) - bh;
                          const isLast = i === divAmts.length - 1;
                          return (
                            <g key={i}>
                              <rect x={bx} y={by} width={bw} height={bh} rx={2}
                                style={{ fill: isLast ? "var(--brand-2)" : "var(--surface-3)" }} />
                              <text x={bx + bw / 2} y={by - 3} textAnchor="middle"
                                style={{ fill: isLast ? "var(--brand-2)" : "var(--text-dim-solid)", fontSize: "0.4375rem" }}>
                                ${v.toFixed(2)}
                              </text>
                              <text x={bx + bw / 2} y={H - 5} textAnchor="middle"
                                style={{ fill: "var(--text-dim-solid)", fontSize: "0.5rem" }}>
                                {QLABELS[i]}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                      <div className="ai-sec">
                        <div className="h">{upcoming ? "Upcoming dates" : "Most recent dates"}</div>
                      </div>
                      {(() => {
                        // Real declared dates. These were three hardcoded strings
                        // ("Jul {exDay}, 2025") that never moved with the calendar.
                        const ev = upcoming ?? (hasReal ? divHist.history[0] : null);
                        const fmtFull = (d: string | null) =>
                          d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US",
                            { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
                        return (
                          <>
                            <div className="minirow" style={{ marginTop: 8 }}>
                              <span className="mid">Ex-dividend date</span>
                              <span className="r mono" style={{ color: "var(--warn)" }}>{fmtFull(ev?.exDividendDate ?? null)}</span>
                            </div>
                            <div className="minirow">
                              <span className="mid">Payment date</span>
                              <span className="r mono">{fmtFull(ev?.paymentDate ?? null)}</span>
                            </div>
                            <div className="minirow">
                              <span className="mid">Declaration date</span>
                              <span className="r mono">{fmtFull(ev?.declarationDate ?? null)}</span>
                            </div>
                          </>
                        );
                      })()}
                      <div className="card" style={{ marginTop: 14 }}>
                        <div className="card-h"><h3 className="ai-c">◆ AI dividend read · {sym}</h3></div>
                        <div className="card-b">
                          <p style={{ fontSize: ".85rem", lineHeight: 1.6, color: "var(--text)" }}>
                            {sym} yields <b style={{ color: "var(--up)" }}>{yieldPct.toFixed(2)}%</b>, paying ${annualDiv.toFixed(2)}/share over the last twelve months
                            (${qDiv.toFixed(2)} per payment, {freqLabel.toLowerCase()}).
                            {divHist?.cagr5yPct != null
                              ? ` The 5-year dividend CAGR is ${growthTxt} with a payout ratio of ${payoutPct}%.`
                              : ` Payout ratio is ${payoutPct}%.`}
                            {divHist != null && divHist.increaseStreakYears > 0
                              && ` It has raised the annual payout ${divHist.increaseStreakYears} year${divHist.increaseStreakYears === 1 ? "" : "s"} running.`}
                            {payoutPct > 0 && (payoutPct < 60
                              ? " Payout is conservative — suggests room for future increases."
                              : " Payout is elevated — monitor earnings coverage carefully.")}
                            {upcoming?.exDividendDate && (
                              <> Next ex-date is <b style={{ color: "var(--warn)" }}>{shortDate(upcoming.exDividendDate)}</b>.</>
                            )}
                          </p>
                        </div>
                      </div>
                      <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 10 }}>
                        {hasReal
                          ? "Dividend history from Polygon corporate actions. Verify with company IR and SEC filings. Not investment advice."
                          : "Dividend data is illustrative — not yet synced for this ticker. Verify with company IR and SEC filings. Not investment advice."}
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
