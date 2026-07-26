"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { CandleChart, RsiPane, Spark } from "./utils";
import { ExpandBtn } from "./shell";
import { useChartBars } from "./hooks/useChartBars";
import { useCompany } from "./hooks/useCompany";

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

/* ── Honest earnings note — real EPS/sales history lives on the stock page ── */
function EarnPaneNote() {
  return (
    <div style={{ padding: "10px 2px", fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
      EPS &amp; sales history (real Polygon actuals) is on the stock page.
    </div>
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
  title, headerRight, isEmpty, emptyMessage = "No items.", maxListHeight, children,
}: {
  title: string;
  headerRight?: ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
  maxListHeight?: number;
  children?: ReactNode;
}) {
  return (
    <div style={{ width: 340, flexShrink: 0, display: "flex", flexDirection: "column" }}>
      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div className="card-h">
          <h3>{title}</h3>
          {headerRight}
        </div>
        <div className="pf-list" style={{ flex: 1, maxHeight: maxListHeight ?? "none", overflowY: "auto" }}>
          {isEmpty ? (
            <div style={{ padding: 16, fontSize: ".8rem", color: "var(--text-dim-solid)" }}>
              {emptyMessage}
            </div>
          ) : children}
        </div>
      </div>
    </div>
  );
}

/* ── Expanded chart rendered inside the modal opened by ExpandBtn ── */
function ChartCardExpanded({
  sym, px, initialTf, initialChartType, initialMaStep, initialEmaStep,
  initialShowVol, initialShowRsi, initialShowEarnings,
}: {
  sym: string; px: number; initialTf: string;
  initialChartType: "Candles" | "Hollow" | "Bars" | "Line" | "Area";
  initialMaStep: number; initialEmaStep: number;
  initialShowVol: boolean; initialShowRsi: boolean; initialShowEarnings: boolean;
}) {
  const [tf, setTf] = useState(initialTf);
  const [chartType, setChartType] = useState(initialChartType);
  const [maStep, setMaStep] = useState(initialMaStep);
  const [emaStep, setEmaStep] = useState(initialEmaStep);
  const [showVol, setShowVol] = useState(initialShowVol);
  const [showRsi, setShowRsi] = useState(initialShowRsi);
  const [showEarnings, setShowEarnings] = useState(initialShowEarnings);
  const realBars = useChartBars(sym, tf);
  const company = useCompany(sym);
  // Real RSI(14) only — null when the indicators job hasn't reached this ticker.
  const rsiVal = company?.rsi14 != null ? Math.round(company.rsi14) : null;
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
            <span className="mono" style={{ color: "var(--warn)" }}>{rsiVal != null ? `${rsiVal} · ${rsiVal > 70 ? "overbought" : rsiVal < 40 ? "weak" : "neutral-to-strong"}` : "not synced"}</span>
          </div>
          {company?.rsi14Series ? <RsiPane sym={sym} tf={tf} series={company.rsi14Series} /> : null}
        </div>
      )}
      {showEarnings && (
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 4 }}>
          <div style={{ padding: "6px 0 4px", fontSize: ".66rem", color: "var(--text-dim-solid)" }}>
            <span>Earnings</span>
          </div>
          <EarnPaneNote />
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

  // Real bars for whichever timeframe is selected. This component previously
  // called CandleChart WITHOUT `realBars`, so every chart on Watchlist,
  // Portfolio, Themes and Screener rendered a seeded random walk even for
  // tickers whose bars were already synced and plotted correctly one screen
  // over in Stock Detail. Wiring this prop is the whole fix.
  const realBars = useChartBars(sym, tf);
  const company = useCompany(sym);
  // Real RSI(14) only — null when the indicators job hasn't reached this ticker.
  const rsiVal = company?.rsi14 != null ? Math.round(company.rsi14) : null;

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {sym ? (
        <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
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
            <ExpandBtn
              title={`${sym} · Price Chart`}
              node={
                <ChartCardExpanded
                  sym={sym} px={px}
                  initialTf={tf} initialChartType={chartType}
                  initialMaStep={maStep} initialEmaStep={emaStep}
                  initialShowVol={showVol} initialShowRsi={showRsi}
                  initialShowEarnings={showEarnings}
                />
              }
            />
          </div>
          <div style={{ padding: "0 14px 0" }}>
            <CandleChart sym={sym} tf={tf} px={px} maStep={maStep} emaStep={emaStep} showVol={showVol} chartType={chartType.toLowerCase()} realBars={realBars} />
          </div>
          {showRsi && (
            <div style={{ padding: "0 14px 4px" }}>
              <div style={{ padding: "4px 0", fontSize: ".66rem", color: "var(--text-dim-solid)", display: "flex", justifyContent: "space-between" }}>
                <span>RSI (14)</span>
                <span className="mono" style={{ color: "var(--warn)" }}>
                  {rsiVal != null ? `${rsiVal} · ${rsiVal > 70 ? "overbought" : rsiVal < 40 ? "weak" : "neutral-to-strong"}` : "not synced"}
                </span>
              </div>
              {company?.rsi14Series ? <RsiPane sym={sym} tf={tf} series={company.rsi14Series} /> : null}
            </div>
          )}
          {showEarnings && (
            <div style={{ borderTop: "1px solid var(--border)", padding: "0 14px 8px" }}>
              <div style={{ padding: "6px 0 4px", fontSize: ".66rem", color: "var(--text-dim-solid)" }}>
                <span>Earnings</span>
              </div>
              <EarnPaneNote />
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
