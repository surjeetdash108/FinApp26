"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { CandleChart, ChartSelect, TF_OPTIONS, CHART_TYPE_OPTIONS, RsiPane, DataState, Spark, VendorTag, type EarnQ } from "./utils";
import { ExpandBtn } from "./shell";
import { useApiList } from "./hooks/useApiList";
import { useApiResource } from "./hooks/useApiResource";
import { useBackendBars } from "./hooks/useBackendBars";
import { useChartEarnings } from "./hooks/useChartEarnings";
import type { LiveEarningsDoc, CompanyDoc } from "./types";
import { surprisePct } from "./types";

/* ── Shared dynamic embed — one definition for all screens ── */
export const StockScreenEmbed = dynamic<{ initialSym?: string; hideHeader?: boolean; hideChart?: boolean }>(
  () => import("./screens/stock").then(m => ({ default: m.StockScreen })),
  { ssr: false, loading: () => <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim-solid)" }}>Loading…</div> }
);

/* ── Trash SVG ── */
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

/* ── EPS surprise bars — real surprise % from the live earnings feed ── */
function EarnPane({ hist, loading }: { hist: EarnQ[]; loading: boolean }) {
  if (hist.length === 0) {
    return <DataState loading={loading} label="No live earnings-surprise history synced for this ticker yet." height={80} />;
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
      <line x1={PADL} y1={mid} x2={W - PADR} y2={mid}
        stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
      {hist.map((q, i) => {
        const beat = q.surp >= 0;
        const cx = PADL + gw * i + gw / 2;
        const barH = Math.max(4, (Math.abs(q.surp) / maxS) * (ih / 2 - 4));
        const rx = (cx - bw / 2).toFixed(1);
        const ry = beat ? (mid - barH).toFixed(1) : mid.toFixed(1);
        const color = beat ? "var(--up)" : "var(--down)";
        const labelY = beat ? (mid - barH - 4).toFixed(1) : (mid + barH + 9).toFixed(1);
        return (
          <g key={q.q}>
            <rect x={rx} y={ry} width={bw.toFixed(1)} height={barH.toFixed(1)} rx="2" fill={color} opacity="0.88" />
            <text x={cx.toFixed(1)} y={labelY} textAnchor="middle" fill={color} fontSize="7.5" fontFamily="JetBrains Mono,monospace">
              {beat ? "+" : ""}{q.surp.toFixed(1)}%
            </text>
            <text x={cx.toFixed(1)} y={(H - 3).toFixed(1)} textAnchor="middle"
              fill="var(--text-dim-solid)" fontSize="7.5" fontFamily="JetBrains Mono,monospace">
              {q.q.replace(" ", "'")}
            </text>
          </g>
        );
      })}
      <text x={PADL - 4} y={(mid - 2).toFixed(1)} textAnchor="end" fill="var(--text-dim-solid)" fontSize="7" fontFamily="JetBrains Mono,monospace">BEAT</text>
      <text x={PADL - 4} y={(mid + 10).toFixed(1)} textAnchor="end" fill="var(--text-dim-solid)" fontSize="7" fontFamily="JetBrains Mono,monospace">MISS</text>
    </svg>
  );
}

/* ── StockRow: one pf-li row ── */
export function StockRow({
  sym, name, seed, sparkUp,
  isSelected, onClick, onDelete,
  valueTop, valueBottom, valueBottomClass = "",
}: {
  sym: string;
  name: string;
  seed: number;
  sparkUp: boolean;
  isSelected: boolean;
  onClick: () => void;
  onDelete?: () => void;
  valueTop: string;
  valueBottom: string;
  valueBottomClass?: string;
}) {
  return (
    <div
      className={`pf-li${isSelected ? " active" : ""}`}
      style={{ gridTemplateColumns: onDelete ? "1fr 60px auto auto" : "1fr 60px auto" }}
      onClick={onClick}
    >
      <div>
        <span className="s">{sym}</span>
        <span className="n">{name}</span>
      </div>
      <div className="pf-spark">
        <Spark seed={seed} up={sparkUp} />
      </div>
      <div>
        <span className="px">{valueTop}</span>
        <span className={`ch${valueBottomClass ? ` ${valueBottomClass}` : ""}`}>{valueBottom}</span>
      </div>
      {onDelete && (
        <button className="wl-del-btn" title="Remove" onClick={e => { e.stopPropagation(); onDelete(); }}>
          <TrashIcon />
        </button>
      )}
    </div>
  );
}

/* ── StockListCard: 340px card with scrollable list ── */
export function StockListCard({
  title, headerRight, isEmpty, emptyMessage = "No items.", loading, maxListHeight, children,
}: {
  title: string;
  headerRight?: ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
  /** True while the underlying fetch is still in flight — shows a spinner instead of the empty message. */
  loading?: boolean;
  maxListHeight?: number;
  children?: ReactNode;
}) {
  return (
    <div style={{ width: 340, flexShrink: 0, display: "flex", flexDirection: "column" }}>
      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div className="card-h">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <h3>{title}</h3>
            <VendorTag v="polygon" />
          </span>
          {headerRight}
        </div>
        <div className="pf-list" style={{ flex: 1, maxHeight: maxListHeight ?? "none", overflowY: "auto" }}>
          {isEmpty ? <DataState loading={loading} label={emptyMessage} /> : children}
        </div>
      </div>
    </div>
  );
}

/**
 * Real 10-quarter-style EPS-surprise history + next earnings date, built from
 * the live earnings feed for one ticker — same pattern stock.tsx uses for its
 * own hist10, shared here so the two never drift onto different data.
 */
function useLiveEarningsForSym(sym: string): { hist: EarnQ[]; erDate: string; loading: boolean } {
  const { data: liveEarnings, loading } = useApiList<LiveEarningsDoc>("/market-data/earnings");
  const symEvents = liveEarnings.filter(e => e.ticker === sym).sort((a, b) => a.date.localeCompare(b.date));
  const todayStr = new Date().toISOString().slice(0, 10);
  const erDate = symEvents.find(e => e.date >= todayStr)?.date ?? symEvents[symEvents.length - 1]?.date ?? "—";
  const hist: EarnQ[] = symEvents
    .filter(e => e.epsEstimate != null && e.epsActual != null)
    .slice(-8)
    .reverse()
    .map(e => {
      const est = e.epsEstimate as number, act = e.epsActual as number;
      const surp = surprisePct(act, est) ?? 0;
      return {
        q: new Date(e.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        e: est, a: act, surp: parseFloat(surp.toFixed(1)), mv: 0,
      };
    });
  return { hist, erDate, loading };
}

/* ── Expanded chart rendered inside the modal opened by ExpandBtn ── */
function ChartCardExpanded({
  sym, px, initialTf, initialChartType, initialMaStep, initialEmaStep,
  initialShowVol, initialShowRsi, initialShowEarnings, rsi, rsiLoading, hist, earningsLoading, erDate,
}: {
  sym: string; px: number; initialTf: string;
  initialChartType: "Candles" | "Hollow" | "Bars" | "Line" | "Area";
  initialMaStep: number; initialEmaStep: number;
  initialShowVol: boolean; initialShowRsi: boolean; initialShowEarnings: boolean;
  rsi: number | null; rsiLoading: boolean; hist: EarnQ[]; earningsLoading: boolean; erDate: string;
}) {
  const [tf, setTf] = useState(initialTf);
  const [chartType, setChartType] = useState(initialChartType);
  const [maStep, setMaStep] = useState(initialMaStep);
  const [emaStep, setEmaStep] = useState(initialEmaStep);
  const [showVol, setShowVol] = useState(initialShowVol);
  const [showRsi, setShowRsi] = useState(initialShowRsi);
  const [showEarnings, setShowEarnings] = useState(initialShowEarnings);
  const { bars: realBars } = useBackendBars(sym, tf);
  // Same derivation as stock details, so a report lands on the same bar with
  // the same numbers here as it does there.
  const chartEarnings = useChartEarnings(sym, showEarnings);
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
        earnings={showEarnings ? chartEarnings : []} />
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
          <EarnPane hist={hist} loading={earningsLoading} />
        </div>
      )}
    </div>
  );
}

/* ── ChartCard: full-featured self-contained chart (mirrors stock details) ── */
export function ChartCard({
  sym, px,
  emptyText = "Select a stock to see chart",
}: {
  sym: string;
  px: number;
  emptyText?: string;
}) {
  const [tf, setTf] = useState("3M");
  const [chartType, setChartType] = useState<"Candles" | "Hollow" | "Bars" | "Line" | "Area">("Candles");
  const [maStep, setMaStep] = useState(0);
  const [emaStep, setEmaStep] = useState(0);
  const [showVol, setShowVol] = useState(true);
  const [showRsi, setShowRsi] = useState(false);
  const [showEarnings, setShowEarnings] = useState(false);

  const { bars: realBars } = useBackendBars(sym, tf);
  const { data: liveCompany, loading: liveCompanyLoading } = useApiResource<CompanyDoc>(sym ? `/live/company?ticker=${encodeURIComponent(sym)}` : null);
  const rsi = liveCompany?.rsi14 ?? null;
  const { hist, erDate, loading: earningsLoading } = useLiveEarningsForSym(sym);
  // Same derivation as stock details — see chart-earnings.ts. Fetched only while
  // the Earnings overlay is on; before this the toggle below flipped state that
  // nothing read, so this chart never drew a dot.
  const chartEarnings = useChartEarnings(sym, showEarnings);

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {sym ? (
        <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <div className="chart-toolbar" style={{ flexWrap: "wrap", gap: "4px 0", paddingBottom: 8 }}>
            <ChartSelect value={tf} options={TF_OPTIONS} onChange={v => setTf(v as typeof tf)} title="Timeframe" />
            <ChartSelect value={chartType} options={CHART_TYPE_OPTIONS} onChange={v => setChartType(v as typeof chartType)} title="Chart type" />
            <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 4px" }} />
            <button className={`rng indbtn${maStep > 0 ? " on" : ""}`} onClick={() => setMaStep(s => (s + 1) % 5)}>
              MA {[9,21,50,200].map((v, i) => (
                <span key={v} style={{ opacity: i < maStep ? 1 : 0.4, fontWeight: i < maStep ? 700 : undefined }}>
                  {i > 0 ? "/" : ""}{v}
                </span>
              ))}
            </button>
            <button className={`rng indbtn${emaStep > 0 ? " on" : ""}`} onClick={() => setEmaStep(s => (s + 1) % 5)}>
              EMA {[9,21,50,200].map((v, i) => (
                <span key={v} style={{ opacity: i < emaStep ? 1 : 0.4, fontWeight: i < emaStep ? 700 : undefined }}>
                  {i > 0 ? "/" : ""}{v}
                </span>
              ))}
            </button>
            <button className={`rng indbtn${showVol ? " on" : ""}`} onClick={() => setShowVol(v => !v)}>Volume</button>
            <button className={`rng indbtn${showRsi ? " on" : ""}`} onClick={() => setShowRsi(v => !v)}>RSI</button>
            <button className={`rng indbtn${showEarnings ? " on" : ""}`} onClick={() => setShowEarnings(v => !v)}>Earnings</button>
            <div style={{ flex: 1 }} />
            <VendorTag v="polygon" />
            <ExpandBtn
              title={`${sym} · Price Chart`}
              node={
                <ChartCardExpanded
                  sym={sym} px={px}
                  initialTf={tf} initialChartType={chartType}
                  initialMaStep={maStep} initialEmaStep={emaStep}
                  initialShowVol={showVol} initialShowRsi={showRsi}
                  initialShowEarnings={showEarnings}
                  rsi={rsi} rsiLoading={liveCompanyLoading} hist={hist} earningsLoading={earningsLoading} erDate={erDate}
                />
              }
            />
          </div>
          <div style={{ padding: "0 14px 0" }}>
            <CandleChart sym={sym} tf={tf} px={px} maStep={maStep} emaStep={emaStep} showVol={showVol} chartType={chartType.toLowerCase()} realBars={realBars}
        earnings={showEarnings ? chartEarnings : []} />
          </div>
          {showRsi && (
            <div style={{ padding: "0 14px 4px" }}>
              <div style={{ padding: "4px 0", fontSize: ".66rem", color: "var(--text-dim-solid)", display: "flex", justifyContent: "space-between" }}>
                <span>RSI (14)</span>
                <span className="mono" style={{ color: "var(--warn)" }}>
                  {rsi != null ? `${Math.round(rsi)} · ${rsi > 70 ? "overbought" : rsi < 40 ? "weak" : "neutral-to-strong"}` : "not available"}
                </span>
              </div>
              <RsiPane rsi14={rsi} loading={liveCompanyLoading} />
            </div>
          )}
          {showEarnings && (
            <div style={{ borderTop: "1px solid var(--border)", padding: "0 14px 8px" }}>
              <div style={{ padding: "6px 0 4px", fontSize: ".66rem", color: "var(--text-dim-solid)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Earnings · EPS Surprise</span>
                <span className="mono" style={{ color: "var(--warn)", fontWeight: 600 }}>Next: {erDate}</span>
              </div>
              <EarnPane hist={hist} loading={earningsLoading} />
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "var(--text-dim-solid)", fontSize: ".85rem" }}>{emptyText}</span>
        </div>
      )}
    </div>
  );
}

/* ── StockPanelLayout: top row (list + chart) + bottom stock detail ── */
export function StockPanelLayout({
  listCard, selectedSym, chartPx,
  chartEmptyText,
  detailEmptyText = "Select a stock to see its full analysis.",
}: {
  listCard: ReactNode;
  selectedSym: string;
  chartPx: number;
  chartEmptyText?: string;
  detailEmptyText?: string;
}) {
  return (
    <>
      <div style={{ display: "flex", gap: 14, alignItems: "stretch", marginBottom: 14 }}>
        {listCard}
        <ChartCard sym={selectedSym} px={chartPx} emptyText={chartEmptyText} />
      </div>
      {selectedSym ? (
        <StockScreenEmbed initialSym={selectedSym} hideHeader hideChart />
      ) : (
        <div className="card">
          <div className="card-b" style={{ padding: 40, textAlign: "center", color: "var(--text-dim-solid)" }}>
            {detailEmptyText}
          </div>
        </div>
      )}
    </>
  );
}
