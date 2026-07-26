"use client";

// iq.css is imported globally via app/layout.tsx
import { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";

// Dynamic import breaks the circular dep: stock.tsx → shell.tsx → stock.tsx
const StockScreenEmbed = dynamic<{ initialSym?: string }>(
  () => import("./screens/stock").then(m => ({ default: m.StockScreen })),
  { ssr: false, loading: () => <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim-solid)" }}>Loading…</div> }
);
import { signOut } from "firebase/auth";
import { firebaseAuth } from "../firebase";
import { apiGet, apiPatch } from "./backend";
import { useAppSelector } from "../store/hooks";
import { AuthGuard } from "../dashboard/auth-guard";
import { menuItems } from "../dashboard/menu-items";
import { pulse, sectorList, sectorByName, funds, fundDetail, folio, earnings as earningsData, movers, screenerStocks, type SectorRow, type Fund, type FundDetail, type PulseItem } from "./data";
import { fmt, sign, cls, arr, SemiGauge } from "./utils";
import { NotificationBell } from "./notification-bell";
import { useTickerSearch } from "./hooks/useTickerSearch";
import { useTapeStream } from "./hooks/useTapeStream";
import { useBackendMarketStatus } from "./hooks/useBackendMarketStatus";
import { mergePulse, tapeItemsToIndexDocs } from "./live-market-indices";

// ---- Route helpers ----
function slugToHref(slug: string): string {
  return slug === "dashboard" ? "/dashboard" : `/menu/${slug}`;
}

// ---- Font type ----
export type FontKey = "geist" | "inter" | "dm-sans" | "space-grotesk" | "plus-jakarta-sans" | "ibm-plex-sans" | "outfit" | "manrope";

// ---- IQ Actions context ----
interface IQActions {
  openStock: (sym: string) => void;
  openStockFull: (sym: string) => void;
  openMoverModal: (sym: string) => void;
  openEarnings: (sym: string) => void;
  openSector: (name: string) => void;
  openFund: (idx: number) => void;
  openIndex: (i: number) => void;
  openFearGreed: () => void;
  setCopilot: (open: boolean) => void;
  openChart: (title: string, node: ReactNode) => void;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
  font: FontKey;
  setFont: (f: FontKey) => void;
}
export const IQActionsContext = createContext<IQActions>({
  openStock: () => {},
  openStockFull: () => {},
  openMoverModal: () => {},
  openEarnings: () => {},
  openSector: () => {},
  openFund: () => {},
  openIndex: () => {},
  openFearGreed: () => {},
  setCopilot: () => {},
  openChart: () => {},
  theme: "dark",
  setTheme: () => {},
  font: "dm-sans",
  setFont: () => {},
});
export function useIQActions() { return useContext(IQActionsContext); }

export function ExpandBtn({ title, node }: { title: string; node: ReactNode }) {
  const { openChart } = useIQActions();
  return (
    <button
      className="chart-expand-btn"
      title="Expand chart"
      onClick={(e) => { e.stopPropagation(); openChart(title, node); }}
    >
      <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
      </svg>
    </button>
  );
}

// ---- Nav icon SVG ----
function NavIcon({ slug }: { slug: string }) {
  const paths: Record<string, string> = {
    dashboard:   "M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z",
    earnings:    "M4 5h16v14H4V5Zm0 4h16M8 3v4m8-4v4",
    movers:      "M3 17l5-5 4 3 7-9M16 6h6v6",
    heatmap:     "M3 3h8v8H3V3Zm13 0h8v5h-8V3ZM13 10h8v11h-8V10ZM3 13h8v8H3v-8Z",
    analyst:     "M12 2l2.5 6.5L21 9l-5 4.5L17.5 21 12 17l-5.5 4L8 13.5 3 9l6.5-.5z",
    screener:    "M3 4h18l-7 8v6l-4 2V12z",
    themes:      "M12 2L2 7l10 5 10-5L12 2zM2 12l10 5 10-5M2 17l10 5 10-5",
    ipos:        "M3 17l6-6 4 4 8-8M14 7h7v7",
    portfolio:   "M3 13a9 9 0 1 0 18 0 9 9 0 0 0-18 0ZM12 7v6l4 2",
    watchlist:   "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7ZM12 12m-3 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
    stock:       "M4 19V5M4 19h16M8 15l3-4 3 2 4-7",
    insider:     "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-1a6 6 0 0 1 12 0v1M18 11l2 2 3-3",
    commentary:  "M4 5h16v11H8l-4 4V5z",
    recap:       "M4 3h16a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H4V3Zm0 0v18M8 8h8M8 12h8M8 16h5",
    macro:       "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18ZM3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18",
    options:     "M12 3l8 4.5-8 4.5-8-4.5L12 3zM4 12l8 4.5 8-4.5M4 16.5L12 21l8-4.5",
  };
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[slug] ?? "M5 12h14"} />
    </svg>
  );
}

// ---- Drawers ----
function StockDrawer({ sym, onClose }: { sym: string; onClose: () => void }) {
  const { openStockFull, openSector } = useIQActions();
  const mv  = movers.find(x => x.ticker === sym);
  const scr = screenerStocks.find(x => x.ticker === sym);

  const name   = mv?.name      ?? scr?.name   ?? sym;
  const sector = mv?.sector ?? scr?.sector ?? "—";
  const p      = mv?.price   ?? 0;
  const c      = mv?.pctChange   ?? 0;
  const rvol   = mv?.rvolRatio ?? scr?.rvolRatio ?? 1;
  const rs     = mv?.relativeStrength  ?? scr?.relativeStrength  ?? 50;
  const wk     = mv?.weekPct  ?? 0;
  const cat    = mv?.catalystLabel ?? "";
  const ma     = mv?.maPosture  ?? "";
  const tech   = mv?.techContext ?? "";
  const news   = mv?.newsContext ?? "";
  const mc     = scr?.marketCap ?? 0;
  const mcTxt  = mc >= 1000 ? `$${(mc / 1000).toFixed(2)}T` : mc > 0 ? `$${mc}B` : mv?.cap ?? "—";

  // Build "why it moved" narrative (HTML string — data is internal, never user input)
  let why = `<b>${name}</b> is trading <b class="${cls(c)}">${sign(c)}</b> today`;
  why += cat && cat !== "No known catalyst"
    ? ` on <b style="color:var(--text-hi)">${cat.toLowerCase()}</b>.`
    : ` with no single company headline — it is moving with its sector and the broad tape.`;
  why += ` Volume is running <b>${rvol.toFixed(1)}×</b> its normal pace`;
  why += rvol >= 2 ? ` — well above average, which confirms real participation behind the move.` : `.`;
  if (ma) why += ` Price is <b>${ma}</b> with a relative-strength rank of <b>${rs}/99</b>, so the underlying trend is ${c >= 0 ? "constructive" : "weak"}.`;
  const sec = sectorByName[sector] ?? null;
  if (sec) {
    why += ` Its group, <b>${sector}</b>, is ${sec.pctChange >= 0 ? "up" : "down"} <b class="${cls(sec.pctChange)}">${sign(sec.pctChange)}</b> today (${(sec.trend || "Flat").toLowerCase()}) — `;
    why += (sec.pctChange >= 0) === (c >= 0) ? "in line with sector strength." : "bucking its sector today.";
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer open">
        <div className="drawer-h">
          <div className="sd-logo" style={{ background: "linear-gradient(135deg,#3a2f6b,#241c44)", color: "var(--brand-2)" }}>
            {sym[0]}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--f-display)" }}>
              {sym}
            </div>
            <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>
              {name} · {sector}
            </div>
          </div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-b">
          {/* Pills */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            <span className={`pill ${c >= 0 ? "up" : "dn"}`}>{arr(c)} {sign(c)} today</span>
            {cat && cat !== "No known catalyst"
              ? <span className="pill" style={{ background: "var(--surface-3)", color: "var(--brand-2)" }}>{cat}</span>
              : <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>No known catalyst</span>
            }
            {rvol >= 2 && <span className="pill amc">{rvol.toFixed(1)}× volume</span>}
          </div>

          {/* Why it moved */}
          {mv && (
            <div className="ai-block" style={{ marginBottom: 14 }}>
              <div className="card-h">
                <h3 className="ai-c">◆ Why it moved</h3>
              </div>
              <div className="card-b">
                <p style={{ fontSize: ".85rem", lineHeight: 1.6, color: "var(--text)", margin: 0 }}
                   dangerouslySetInnerHTML={{ __html: why }} />
              </div>
            </div>
          )}

          {/* Grid 1: Today · Rel. volume · 5-day */}
          <div className="metric-grid" style={{ marginBottom: 12 }}>
            <div className="m"><div className="k">Today</div><div className={`v ${cls(c)}`}>{sign(c)}</div></div>
            <div className="m"><div className="k">Rel. volume</div><div className="v">{rvol.toFixed(1)}×</div></div>
            <div className="m"><div className="k">5-day</div><div className={`v ${cls(wk)}`}>{sign(wk)}</div></div>
          </div>

          {/* Grid 2: Last price · RS rank · Market cap */}
          <div className="metric-grid" style={{ marginBottom: 14 }}>
            <div className="m"><div className="k">Last price</div><div className="v">${fmt(p)}</div></div>
            <div className="m"><div className="k">RS rank</div><div className="v">{rs}</div></div>
            <div className="m"><div className="k">Market cap</div><div className="v" style={{ fontSize: ".92rem" }}>{mcTxt}</div></div>
          </div>

          {/* Technical posture */}
          {tech && (
            <div className="ai-sec">
              <div className="h">Technical posture</div>
              <p>{tech}</p>
            </div>
          )}

          {/* News & catalyst */}
          {news && (
            <div className="ai-sec" style={{ marginTop: 10 }}>
              <div className="h">News &amp; catalyst</div>
              <p>{news}</p>
            </div>
          )}

          {/* CTA buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            {sec && (
              <button className="btn" style={{ width: "100%" }}
                onClick={() => { onClose(); openSector(sector); }}>
                View {sector} in heatmap →
              </button>
            )}
            <button className="btn primary" style={{ width: "100%" }}
              onClick={() => { onClose(); openStockFull(sym); }}>
              Open full stock page →
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function EarningsDrawer({ sym, onClose }: { sym: string; onClose: () => void }) {
  const { openStockFull } = useIQActions();
  const e = earningsData.find(x => x.ticker ===sym);
  const posted = e && e.epsActual != null;
  const epsBeat = e && e.epsActual != null && e.epsEstimate != null && e.epsEstimate !== 0
    ? ((e.epsActual - e.epsEstimate) / Math.abs(e.epsEstimate) * 100)
    : null;
  const revBeat = e && e.revenueActual != null && e.revenueEstimate != null && e.revenueEstimate !== 0
    ? ((e.revenueActual - e.revenueEstimate) / Math.abs(e.revenueEstimate) * 100)
    : null;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer open">
        <div className="drawer-h">
          <div className="sd-logo" style={{ background: "linear-gradient(135deg,#1f6b4d,#0e3a2a)", color: "#5ff0b3" }}>
            {sym[0]}
          </div>
          <div style={{ flex: 1 }}>
            <div className="mono" style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-hi)" }}>{sym}</div>
            <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>
              {e?.name ?? sym} · {e?.sector ?? "—"} ·{" "}
              <span className={`pill ${e?.session === "Before open" ? "bmo" : "amc"}`}>{e?.session ?? "—"}</span>
            </div>
          </div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-b">
          {posted && e ? (
            <>
              <div className="metric-grid">
                <div className="m">
                  <div className="k">EPS · actual vs est</div>
                  <div className="v">${e.epsActual}</div>
                  <div className={`s ${(epsBeat ?? 0) >= 0 ? "up" : "dn"}`}>
                    est {e.epsEstimate != null ? `$${e.epsEstimate}` : "—"} · {epsBeat != null ? `${epsBeat > 0 ? "+" : ""}${epsBeat.toFixed(1)}%` : ""}
                  </div>
                </div>
                <div className="m">
                  <div className="k">Revenue</div>
                  <div className="v">${e.revenueActual}B</div>
                  <div className={`s ${(revBeat ?? 0) >= 0 ? "up" : "dn"}`}>
                    est ${e.revenueEstimate}B{revBeat != null ? ` · ${revBeat > 0 ? "+" : ""}${revBeat.toFixed(1)}%` : ""}
                  </div>
                </div>
                <div className="m">
                  <div className="k">Guidance</div>
                  <div className="v" style={{ color: e.guidanceStatus === "Raised" ? "var(--up)" : e.guidanceStatus === "Cut" ? "var(--down)" : "var(--text-hi)", fontSize: "1rem" }}>
                    {e.guidanceStatus ?? "—"}
                  </div>
                </div>
                <div className="m">
                  <div className="k">Reaction</div>
                  <div className={`v ${cls(e.priceReaction ?? 0)}`}>{sign(e.priceReaction ?? 0)}</div>
                  <div className="s">after hours</div>
                </div>
              </div>

              <div className="takeaway">
                <span className="lbl">AI takeaway</span>
                <span style={{ fontSize: ".8rem", color: "var(--text-dim-solid)" }}>
                  {e.tags.includes("Beat") ? "Beat on top and bottom line — guidance the catalyst" : "Results mixed; reaction tells the story"}
                </span>
                <span className={`verdict ${(e.priceReaction ?? 0) >= 0 ? "up" : "dn"}`}>
                  {(e.priceReaction ?? 0) >= 2 ? "Bullish" : (e.priceReaction ?? 0) >= 0 ? "Mild beat" : "Bearish"}
                </span>
              </div>

              <div className="ai-block" style={{ marginBottom: 14 }}>
                <div className="card-h">
                  <h3 className="ai-c">◆ AI Earnings Summary</h3>
                  <span className="pill ai">conf. 91%</span>
                </div>
                <div className="card-b">
                  <div className="ai-sec">
                    <div className="h">What happened</div>
                    <p>{e.name} reported {(epsBeat ?? 0) >= 0 ? "above" : "below"}-consensus EPS of ${e.epsActual} vs. est ${e.epsEstimate}, with revenue of ${e.revenueActual}B. Stock reacted {sign(e.priceReaction ?? 0)} after hours.</p>
                  </div>
                  <div className="ai-sec">
                    <div className="h">Bull case</div>
                    <p>Beat on both lines with guidance {e.guidanceStatus === "Raised" ? "raised — management confidence is a strong signal" : "maintained — execution visible"}. {e.owned ? "Your position benefits directly." : ""}</p>
                  </div>
                  <div className="ai-sec">
                    <div className="h">Bear case</div>
                    <p>Much of the upside may be priced in. Implied move was {e.impliedMove != null ? `±${e.impliedMove}%` : "n/a"} — actual {Math.abs(e.priceReaction ?? 0).toFixed(1)}% {e.impliedMove != null && Math.abs(e.priceReaction ?? 0) > e.impliedMove ? "exceeded" : "was within"} expectations.</p>
                  </div>
                  <div className="ai-sec">
                    <div className="h">Guidance detail</div>
                    <p>Company {e.guidanceStatus === "Raised" ? "raised" : e.guidanceStatus === "In-line" ? "maintained" : "cut"} forward guidance. Watch next quarter&apos;s setup relative to current Street estimates.</p>
                  </div>
                  <div className="ai-sec">
                    <div className="h">What to watch next</div>
                    <p>Analyst PT revisions in the next 48 hours, conference call tone, and peer read-throughs from sector names reporting later this week.</p>
                  </div>
                </div>
              </div>

              <div className="card" style={{ marginBottom: 14 }}>
                <div className="card-h"><h3>Peer reactions</h3></div>
                <div className="card-b">
                  {[{ s: "Sector index", c: parseFloat(((e.priceReaction ?? 0) * 0.3).toFixed(2)) }, { s: "Direct peers", c: parseFloat(((e.priceReaction ?? 0) * 0.5).toFixed(2)) }].map(p => (
                    <div key={p.s} className="minirow">
                      <span className="mono" style={{ fontWeight: 700, color: "var(--text-hi)" }}>{p.s}</span>
                      <span className={`mono ${cls(p.c)}`} style={{ marginLeft: "auto" }}>{sign(p.c)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div style={{ padding: "20px 0", color: "var(--text-dim-solid)", fontSize: ".85rem" }}>
              {e
                ? `${e.name} reports ${e.session.toLowerCase()}. Implied move: ±${e.impliedMove}%. Check back after results are posted.`
                : `No earnings data available for ${sym}.`}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={() => { onClose(); openStockFull(sym); }}>Open full stock page</button>
            <button className="btn">Transcript</button>
            <button className="btn ai">▶ Call audio</button>
          </div>
        </div>
      </div>
    </>
  );
}

function SectorDrawer({ name, onClose }: { name: string; onClose: () => void }) {
  const { openStock } = useIQActions();
  const sector: SectorRow | undefined = sectorByName[name];
  const sorted = sector ? [...sector.items].sort((a, b) => b[1] - a[1]) : [];

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer open">
        <div className="drawer-h">
          <div className="sd-logo" style={{ background: "linear-gradient(135deg,#1f4d6b,#0e2233)", color: "#7fd0ff" }}>
            {name[0]}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--f-display)" }}>{name}</div>
            <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>
              {sector ? `Group rank #${sector.rank} · ` : ""}
              <span className={cls(sector?.pctChange ?? 0)}>{sign(sector?.pctChange ?? 0)} today</span>
              {sector && <> · <span className="pill" style={{ marginLeft: 2 }}>{sector.trend}</span></>}
            </div>
          </div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-b">
          <div className="ai-sec"><div className="h">Constituents · by market cap</div></div>
          {sorted.map(([sym, mc, chg]) => (
            <div key={sym} className="minirow" style={{ cursor: "pointer" }} onClick={() => { onClose(); openStock(sym); }}>
              <span className="mono" style={{ fontWeight: 700, color: "var(--text-hi)", minWidth: 52 }}>{sym}</span>
              <span style={{ fontSize: ".75rem", color: "var(--text-dim-solid)", flex: 1, marginLeft: 8 }}>${mc}B</span>
              <span className={`mono ${cls(chg)}`} style={{ fontSize: ".82rem" }}>{sign(chg)}</span>
            </div>
          ))}

          <div className="ai-sec" style={{ marginTop: 14 }}><div className="h">Big news across the sector</div></div>
          {[
            { t: `Rotation into ${name} continues as valuations stay supported`, dt: "Today" },
            { t: `Sector sees notable inflows amid broad risk-on positioning`, dt: "Yesterday" },
            { t: `Analyst consensus turns constructive — multiple PT upgrades`, dt: "2 days ago" },
          ].map((item, i) => (
            <div key={i} style={{ padding: "8px 0", borderBottom: i < 2 ? "1px solid var(--border-soft)" : "none" }}>
              <div style={{ fontSize: ".82rem", color: "var(--text-hi)", lineHeight: 1.4 }}>{item.t}</div>
              <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", marginTop: 2 }}>{item.dt}</div>
            </div>
          ))}

          <button className="btn primary" style={{ width: "100%", marginTop: 16 }} onClick={onClose}>Back to heatmap</button>
        </div>
      </div>
    </>
  );
}

function FundDrawer({ idx, onClose }: { idx: number; onClose: () => void }) {
  const { openStock } = useIQActions();
  const fund: Fund | undefined = funds[idx];
  const dt: FundDetail | undefined = fund ? fundDetail[fund.fundName] : undefined;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer open">
        <div className="drawer-h">
          <div className="sd-logo" style={{ background: "linear-gradient(135deg,#3a2f6b,#241c44)", color: "var(--brand-2)", fontSize: ".78rem" }}>
            {fund?.avatar ?? "—"}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--f-display)" }}>{fund?.fundName ?? "Fund"}</div>
            <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>
              {fund?.managerName} · 13F AUM {fund?.aum} · {fund?.totalPositions} positions · {fund?.quarter}
            </div>
          </div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-b">
          {fund && (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                <span className="pill up">{fund.newPositions} new</span>
                <span className="pill dn">{fund.exitCount} exits</span>
                <span className="src-chip">{fund.quarter} 13F-HR</span>
              </div>

              {dt && (
                <>
                  <div className="ai-sec"><div className="h">Top 10 holdings · % of portfolio</div></div>
                  <div className="tbl-wrap" style={{ marginBottom: 14 }}>
                    <table className="tbl">
                      <thead>
                        <tr><th>Ticker</th><th className="num">% wt</th><th>Change</th></tr>
                      </thead>
                      <tbody>
                        {dt.holdings.map(([sym, pct, chg]) => (
                          <tr key={sym} style={{ cursor: "pointer" }} onClick={() => { onClose(); openStock(sym); }}>
                            <td className="mono" style={{ fontWeight: 700, color: "var(--text-hi)" }}>{sym}</td>
                            <td className="num">{pct}%</td>
                            <td>
                              <span className={`pill ${chg === "new" ? "up" : chg === "reduced" ? "dn" : ""}`} style={{ fontSize: ".68rem" }}>
                                {chg}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="dash">
                    <div className="col-6">
                      <div className="ai-sec"><div className="h" style={{ color: "var(--up)" }}>Biggest buys / adds</div></div>
                      {dt.buys.map(([sym, desc]) => (
                        <div key={sym} className="minirow" style={{ cursor: "pointer", flexDirection: "column", alignItems: "flex-start", gap: 2, marginBottom: 6 }} onClick={() => { onClose(); openStock(sym); }}>
                          <span className="mono" style={{ fontWeight: 700, color: "var(--text-hi)" }}>{sym}</span>
                          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{desc}</span>
                        </div>
                      ))}
                    </div>
                    <div className="col-6">
                      <div className="ai-sec"><div className="h" style={{ color: "var(--down)" }}>Biggest exits / trims</div></div>
                      {dt.exits.map(([sym, desc]) => (
                        <div key={sym} className="minirow" style={{ cursor: "pointer", flexDirection: "column", alignItems: "flex-start", gap: 2, marginBottom: 6 }} onClick={() => { onClose(); openStock(sym); }}>
                          <span className="mono" style={{ fontWeight: 700, color: "var(--text-hi)" }}>{sym}</span>
                          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="ai-block" style={{ marginTop: 14, marginBottom: 14 }}>
                    <div className="card-h"><h3 className="ai-c">◆ AI read on the quarter</h3></div>
                    <div className="card-b">
                      <div className="ai-sec">
                        <div className="h">Theme shift</div>
                        <p style={{ fontSize: ".82rem", lineHeight: 1.6 }}>{dt.theme}</p>
                      </div>
                      <div className="ai-sec">
                        <div className="h">Concentration</div>
                        <p style={{ fontSize: ".82rem", lineHeight: 1.6 }}>{dt.conc}</p>
                      </div>
                      <div className="ai-sec">
                        <div className="h">Overlap with your portfolio</div>
                        <p style={{ fontSize: ".82rem", lineHeight: 1.6 }}>
                          {dt.holdings.filter(([sym]) => folio.some(f => f.ticker ===sym)).length} of {dt.holdings.length} top holdings overlap with your portfolio. Review position sizing for shared names.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <button className="btn primary" style={{ width: "100%" }} onClick={onClose}>Back to 13F overview</button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ---- Index drawer (openIndex) ----
function IndexDrawer({ idx, pulse: livePulse, onClose }: { idx: number; pulse: PulseItem[]; onClose: () => void }) {
  const x = livePulse[idx];
  if (!x) return null;
  const dec = x.value > 1000 ? 0 : 2;
  const dollar = x.value - x.prevClose;
  const c = x.change >= 0 ? "up" : "down";
  const dayLow = Math.min(x.open, x.prevClose, x.value) * 0.997;
  const dayHigh = Math.max(x.open, x.prevClose, x.value) * 1.003;
  const y52lo = x.value * 0.82, y52hi = x.value * 1.06;
  const eq = ["S&P 500", "Nasdaq", "Dow", "Russell 2K"].includes(x.label);
  const lead = [...sectorList].sort((a, b) => b.pctChange - a.pctChange).slice(0, 3);
  const lag = [...sectorList].sort((a, b) => b.pctChange - a.pctChange).slice(-3).reverse();
  const note = x.label === "VIX" ? "Volatility is low and falling — a calm, risk-on tape with cheap hedging."
    : x.label.includes("Yield") ? "Yields easing — supportive for long-duration growth and rate-sensitive sectors."
    : x.label === "WTI Crude" ? "Crude softer — pressures energy names, eases input-cost worries elsewhere."
    : x.label === "Gold" ? "Gold firmer — mild safe-haven bid alongside a softer dollar."
    : x.label === "Dollar (DXY)" ? "Dollar steady — limited FX headwind for multinationals today."
    : x.change >= 0 ? "Broad-based gains; breadth is positive and the tape reads risk-on." : "Mild risk-off; defensives are outpacing cyclicals.";
  const sub = eq ? "Equity index" : x.label === "VIX" ? "Volatility index" : x.label.includes("Yield") ? "Treasury yield" : "Market benchmark";
  return (
    <>
      <div className="scrim open" onClick={onClose} />
      <div className="side-drawer">
        <div className="drawer-h">
          <div className="sd-logo" style={{ background: "linear-gradient(135deg,#1f4d6b,#0e2233)", color: "#7fd0ff" }}>{x.label[0]}</div>
          <div><div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--f-display)" }}>{x.label}</div><div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>{sub} · delayed ≤15s</div></div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-b">
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
            <div className="mono" style={{ fontSize: "1.7rem", fontWeight: 700, color: "var(--text-hi)" }}>{fmt(x.value, dec)}</div>
            <div className={c} style={{ fontWeight: 600 }}>{arr(x.change)} {x.change >= 0 ? "+" : ""}{fmt(Math.abs(dollar), dec)} ({sign(x.change)})</div>
          </div>
          <div className="metric-grid">
            <div className="m"><div className="k">Open</div><div className="v">{fmt(x.open, dec)}</div></div>
            <div className="m"><div className="k">Prev close</div><div className="v">{fmt(x.prevClose, dec)}</div></div>
            <div className="m"><div className="k">Day range</div><div className="v" style={{ fontSize: ".92rem" }}>{fmt(dayLow, dec)} – {fmt(dayHigh, dec)}</div></div>
            <div className="m"><div className="k">52-wk range</div><div className="v" style={{ fontSize: ".92rem" }}>{fmt(y52lo, dec)} – {fmt(y52hi, dec)}</div></div>
          </div>
          <div className="note" style={{ marginTop: 14 }}><b style={{ color: "var(--text-hi)" }}>AI read:</b> {note}</div>
          {eq && (
            <>
              <div className="ai-sec" style={{ marginTop: 16 }}><div className="h">Leading sectors today</div></div>
              {lead.map(g => (
                <div key={g.name} className="minirow" style={{ cursor: "pointer" }} onClick={() => { onClose(); }}>
                  <span className="tkr" style={{ fontFamily: "var(--f-body)", fontWeight: 600, width: "auto" }}>{g.name}</span>
                  <span className="mid" />
                  <span className="r up">{sign(g.pctChange)}</span>
                </div>
              ))}
              <div className="ai-sec" style={{ marginTop: 12 }}><div className="h">Lagging sectors today</div></div>
              {lag.map(g => (
                <div key={g.name} className="minirow" style={{ cursor: "pointer" }} onClick={() => { onClose(); }}>
                  <span className="tkr" style={{ fontFamily: "var(--f-body)", fontWeight: 600, width: "auto" }}>{g.name}</span>
                  <span className="mid" />
                  <span className="r down">{sign(g.pctChange)}</span>
                </div>
              ))}
            </>
          )}
          <button className="btn primary" style={{ width: "100%", marginTop: 14 }} onClick={onClose}>
            {eq ? "View market heatmap →" : "Go to Macro & VIX →"}
          </button>
        </div>
      </div>
    </>
  );
}

// ---- Mover Drawer — full stock page in a right-side sliding drawer ----
function MoverModal({ sym, onClose }: { sym: string; onClose: () => void }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="stock-side-drawer">
        <div className="drawer-h" style={{ paddingTop: 14, paddingBottom: 14 }}>
          <div className="sd-logo" style={{ background: "linear-gradient(135deg,#1a2640,#0d1520)", color: "var(--brand-2)", fontSize: ".9rem" }}>
            {sym[0]}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)" }}>
              {sym} · Stock Details
            </div>
            <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>Full analysis · chart · technicals · peers</div>
          </div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-b">
          <StockScreenEmbed initialSym={sym} />
        </div>
      </div>
    </>
  );
}

// ---- Fear & Greed drawer ----
function FearGreedDrawer({ onClose }: { onClose: () => void }) {
  const comps = [
    ["Market momentum", "Greed", 72], ["Stock price strength", "Greed", 66],
    ["Stock price breadth", "Neutral", 54], ["Put / call ratio", "Greed", 68],
    ["Market volatility (VIX)", "Calm", 60], ["Safe-haven demand", "Greed", 64],
    ["Junk-bond demand", "Greed", 58],
  ] as [string, string, number][];
  return (
    <>
      <div className="scrim open" onClick={onClose} />
      <div className="side-drawer">
        <div className="drawer-h">
          <div className="sd-logo" style={{ background: "linear-gradient(135deg,#1f6b4d,#0e3a2a)", color: "#5ff0b3" }}>62</div>
          <div>
            <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--f-display)" }}>Fear &amp; Greed Index</div>
            <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Composite sentiment · 7 inputs · updates continuously</div>
          </div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-b">
          <div className="gauge-wrap" style={{ padding: "4px 0 10px" }}>
            <SemiGauge val={62} label="Greed" id="fg-drawer" />
          </div>
          <div className="ai-sec"><div className="h">History</div></div>
          <div className="metric-grid">
            <div className="m"><div className="k">Previous close</div><div className="v up">58 · Greed</div></div>
            <div className="m"><div className="k">1 week ago</div><div className="v">49 · Neutral</div></div>
            <div className="m"><div className="k">1 month ago</div><div className="v up">71 · Greed</div></div>
            <div className="m"><div className="k">1 year ago</div><div className="v down">39 · Fear</div></div>
          </div>
          <div className="ai-sec" style={{ marginTop: 16 }}><div className="h">Seven components</div></div>
          {comps.map(([label, rating, val]) => (
            <div key={label} style={{ margin: "9px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".78rem", color: "var(--text)" }}>
                <span>{label}</span>
                <span style={{ color: val >= 60 ? "var(--up)" : val < 45 ? "var(--down)" : "var(--text-dim-solid)", fontWeight: 600 }}>{rating} · {val}</span>
              </div>
              <div style={{ height: 6, background: "var(--surface-3)", borderRadius: 4, marginTop: 4 }}>
                <i style={{ display: "block", height: "100%", width: val + "%", borderRadius: 4, background: val >= 60 ? "var(--up)" : val < 45 ? "var(--down)" : "var(--warn)" }} />
              </div>
            </div>
          ))}
          <div className="note" style={{ marginTop: 16 }}>
            <b style={{ color: "var(--text-hi)" }}>AI read:</b> Sentiment is in <b>Greed (62)</b> and rising vs last week (49). Risk appetite is healthy but not euphoric — a push above 75 (extreme greed) would be a contrarian caution flag.
          </div>
          <button className="btn primary" style={{ width: "100%", marginTop: 14 }} onClick={onClose}>Stay on Macro &amp; VIX</button>
        </div>
      </div>
    </>
  );
}

// ---- Copilot panel ----
type CopilotMsg = { role: "user" | "ai"; text: string };
const aiReplies = [
  "Based on current market data, NVDA has strong momentum driven by AI infrastructure spending.",
  "The recent CPI print suggests inflation is cooling — watch for September rate cut probability to increase.",
  "Portfolio concentration in tech is currently elevated. Consider reviewing sector allocation.",
  "Analyst consensus for the S&P 500 is constructive, with a year-end target of ~5,400.",
];

function CopilotPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<CopilotMsg[]>([
    { role: "ai", text: "Hello! I'm your MarketCatalyst AI Copilot. Ask me about markets, your portfolio, earnings, or any stock." },
  ]);
  const [input, setInput] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  function send(overrideText?: string) {
    const txt = (overrideText ?? input).trim();
    if (!txt) return;
    const reply = aiReplies[messages.length % aiReplies.length];
    setMessages(prev => [...prev, { role: "user", text: txt }, { role: "ai", text: reply }]);
    setInput("");
    setTimeout(() => { bodyRef.current?.scrollTo({ top: 9999, behavior: "smooth" }); }, 50);
  }

  const SUGGESTS = [
    "Explain today's biggest mover",
    "How's my portfolio positioned?",
    "What's driving rates today?",
  ];

  return (
    <div className="copilot">
      <div className="copilot-head">
        <div className="copilot-icon">✦</div>
        <div>
          <div className="copilot-title">Market Copilot</div>
          <div className="copilot-sub">
            <span className="dot" style={{ background: "var(--up)", width: 6, height: 6, borderRadius: "50%", display: "inline-block" }} />
            Connected to your portfolio · live data
          </div>
        </div>
        <button className="copilot-close" onClick={onClose}>✕</button>
      </div>
      <div className="copilot-body" ref={bodyRef}>
        {messages.map((m, i) => (
          <div key={i} className={`copilot-msg ${m.role}`}>
            <div className="cm-text">{m.text}</div>
          </div>
        ))}
      </div>
      {messages.length === 1 && (
        <div className="cop-suggest">
          {SUGGESTS.map(s => (
            <button key={s} onClick={() => send(s)}>{s}</button>
          ))}
        </div>
      )}
      <div className="copilot-inp">
        <input
          placeholder="Ask about markets, earnings, your portfolio…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") send(); }}
          autoFocus
        />
        <button className="copilot-send" onClick={() => send()}>
          <svg viewBox="0 0 24 24" width="16" fill="none">
            <path d="M4 12l16-8-6 16-2-6-8-2z" fill="#fff" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// Stock tickers that can be starred/added to watchlist from search
// Curated quick-access list (shown before typing, and as a name/symbol-matched
// fallback while the live `tickers` search warms up / before ticker-universe
// backfills nameLower). Names let it match by company name too — e.g. "Apple".
const SEARCHABLE_STOCKS: Array<{ sym: string; name: string }> = [
  { sym: "NVDA", name: "NVIDIA" },
  { sym: "AAPL", name: "Apple" },
  { sym: "MSFT", name: "Microsoft" },
  { sym: "TSLA", name: "Tesla" },
  { sym: "META", name: "Meta Platforms" },
  { sym: "AMZN", name: "Amazon" },
  { sym: "GOOGL", name: "Alphabet (Google)" },
  { sym: "AMD", name: "Advanced Micro Devices" },
  { sym: "AVGO", name: "Broadcom" },
  { sym: "SMCI", name: "Super Micro Computer" },
  { sym: "COIN", name: "Coinbase" },
  { sym: "UBER", name: "Uber Technologies" },
  { sym: "PLTR", name: "Palantir" },
  { sym: "JPM", name: "JPMorgan Chase" },
  { sym: "V", name: "Visa" },
];

// ---- Main IQ Shell ----
export function IQShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAppSelector(state => state.auth);
  const { data: profile } = useAppSelector(state => state.profile);

  // Same live merge Dashboard's Market Pulse widget uses — keeps the top
  // ticker strip and the index drawer it opens in sync with each other.
  // Backed by the backend's ticker-tape SSE broadcast, not a direct Firestore
  // listener — one shared upstream Polygon call for every connected browser.
  const { frame: tapeFrame } = useTapeStream();
  const liveIndices = tapeFrame ? tapeItemsToIndexDocs(tapeFrame.items) : [];
  const livePulse = mergePulse(pulse, liveIndices);
  const tickerItems = [...livePulse, ...livePulse];

  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem("iq-theme") as "dark" | "light") || "dark";
  });
  const [font, setFont] = useState<FontKey>(() => {
    if (typeof window === "undefined") return "dm-sans";
    return (localStorage.getItem("iq-font") as FontKey) || "dm-sans";
  });
  const [navTime, setNavTime] = useState(() => {
    const d = new Date();
    const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return { day, time };
  });
  // GET /live/market-status (vendor session state), not the local ET-clock
  // computation — falls back to that computation internally on a fetch failure.
  const mkt = useBackendMarketStatus();

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNavTime({
        day: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
        time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      });
    };
    tick(); // correct any build-time (static-export) value right after hydration
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const [copilotOpen, setCopilotOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [expandedChart, setExpandedChart] = useState<{ title: string; node: ReactNode } | null>(null);
  // Collapsed-rail tooltip. A CSS ::after cannot be used here: .rail sets
  // overflow-x:hidden (and overflow-y:auto forces the other axis to compute as
  // auto), so anything drawn to the right of an item is clipped. A fixed-position
  // element positioned from the hovered item's rect escapes that entirely.
  const [navTip, setNavTip] = useState<{ label: string; top: number } | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("iq-nav-collapsed") === "1";
  });
  const [searchQ, setSearchQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchStarred, setSearchStarred] = useState<Set<string>>(() => new Set());
  // Full ~10,000-ticker universe search (on-demand, scoped query — see
  // useTickerSearch's docblock) — SEARCHABLE_STOCKS below stays as the
  // curated "quick access" list shown before the user types anything.
  const tickerSearchResults = useTickerSearch(searchQ);
  const searchMatches: Array<{ sym: string; name: string | null; price: number | null; pctChange: number | null }> = searchQ
    ? (() => {
        const q = searchQ.toLowerCase();
        const bySym = new Map(tickerSearchResults.map(r => [r.ticker, r]));
        // Curated fallback matches by ticker OR company-name prefix, deduped
        // against whatever the live query already returned.
        // Substring (not just prefix) match, so "google" finds "Alphabet
        // (Google)" and "oogl" finds GOOGL. Cheap because this list is small.
        const curated = SEARCHABLE_STOCKS.filter(
          s => (s.sym.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) && !bySym.has(s.sym),
        );
        return [
          ...tickerSearchResults.map(r => ({ sym: r.ticker, name: r.name, price: r.price, pctChange: r.pctChange })),
          ...curated.map(s => ({ sym: s.sym, name: s.name, price: null, pctChange: null })),
        ];
      })()
    : SEARCHABLE_STOCKS.map(s => ({ sym: s.sym, name: s.name, price: null, pctChange: null }));
  const cmdRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const [drawer, setDrawer] = useState<
    | { type: "stock"; sym: string }
    | { type: "mover-modal"; sym: string }
    | { type: "earnings"; sym: string }
    | { type: "sector"; name: string }
    | { type: "fund"; idx: number }
    | { type: "index"; idx: number }
    | { type: "feargreed" }
    | null
  >(null);

  const profileDropdownRef = useRef<HTMLDivElement>(null);

  // Load saved theme + font from the backend on mount
  useEffect(() => {
    if (!user?.uid) return;
    void (async () => {
      try {
        const data = await apiGet<{ darkMode?: boolean; font?: string }>("/api/settings");
        if (typeof data.darkMode === "boolean") {
          const resolved = data.darkMode ? "dark" : "light";
          localStorage.setItem("iq-theme", resolved);
          setTheme(resolved);
        }
        if (typeof data.font === "string") {
          localStorage.setItem("iq-font", data.font);
          setFont(data.font as FontKey);
        }
      } catch { /* keep defaults on error */ }
    })();
  }, [user?.uid]);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(e.target as Node)) {
        setProfileDropdownOpen(false);
      }
    }
    if (profileDropdownOpen) document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [profileDropdownOpen]);

  // Close search dropdown when clicking outside
  useEffect(() => {
    function handleCmdOutside(e: MouseEvent) {
      if (cmdRef.current && !cmdRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
        setSearchQ("");
      }
    }
    if (searchOpen) document.addEventListener("mousedown", handleCmdOutside);
    return () => document.removeEventListener("mousedown", handleCmdOutside);
  }, [searchOpen]);

  // Close mobile nav on route change
  useEffect(() => { setNavOpen(false); }, [pathname]);

  // Persist rail scroll position across page navigations
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const saved = sessionStorage.getItem("iq-rail-scroll");
    if (saved) rail.scrollTop = parseInt(saved, 10);
    function onScroll() { sessionStorage.setItem("iq-rail-scroll", String(rail!.scrollTop)); }
    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => rail.removeEventListener("scroll", onScroll);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen(true); (document.querySelector(".cmd-input") as HTMLInputElement)?.focus(); }
      if (e.key === "Escape") { setSearchOpen(false); setSearchQ(""); setDrawer(null); setCopilotOpen(false); setProfileDropdownOpen(false); setNavOpen(false); }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Action context
  const actions: IQActions = {
    openStock: useCallback((sym) => setDrawer({ type: "stock", sym }), []),
    openMoverModal: useCallback((sym) => setDrawer({ type: "mover-modal", sym }), []),
    openStockFull: useCallback((sym) => {
      if (typeof window !== "undefined") localStorage.setItem("iq-stock", sym);
      router.push("/menu/stock");
    }, [router]),
    openEarnings: useCallback((sym) => setDrawer({ type: "earnings", sym }), []),
    openSector: useCallback((name) => setDrawer({ type: "sector", name }), []),
    openFund: useCallback((idx) => setDrawer({ type: "fund", idx }), []),
    openIndex: useCallback((idx) => setDrawer({ type: "index", idx }), []),
    openFearGreed: useCallback(() => setDrawer({ type: "feargreed" }), []),
    openChart: useCallback((title: string, node: ReactNode) => setExpandedChart({ title, node }), []),
    setCopilot: setCopilotOpen,
    theme,
    setTheme,
    font,
    setFont,
  };

  const displayName = profile?.name || user?.displayName || user?.email || "User";
  const initials = displayName.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
  const profileImage = profile?.profile_image || user?.photoURL || null;
  const tier = profile?.tier === "free" ? "Free" : "Premium";

  // First-time Google sign-ins arrive with only name/email — flag the profile as
  // incomplete (drives the "Pending" pill on My Profile) until every field is filled.
  const profileIncomplete =
    !profile ||
    (["name", "mobileNumber", "age", "incomeRange", "investmentExperience",
      "investmentGoals", "riskTolerance", "investmentHorizon", "currentPortfolioValue"] as const)
      .some(f => String(profile[f] ?? "").trim() === "") ||
    (profile.preferredAssetClasses?.length ?? 0) === 0;

  async function handleSignOut() {
    await signOut(firebaseAuth);
    window.location.href = "/";
  }

  return (
    <AuthGuard>
      <IQActionsContext.Provider value={actions}>
        <div className="iq-root" data-theme={theme} data-font={font}>
          <div className={`app${navCollapsed ? " nav-collapsed" : ""}`}>
            {/* Brand cell */}
            <div className="brandcell">
              <div className="brand-top">
                <div className="logo">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" />
                  </svg>
                </div>
                <div className="wordmark">MarketCatalyst<span>Market Intelligence</span></div>
                <button
                  className="nav-collapse-btn"
                  onClick={() => setNavCollapsed(c => { const next = !c; localStorage.setItem("iq-nav-collapsed", next ? "1" : "0"); return next; })}
                  aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"}
                  title={navCollapsed ? "Expand navigation" : "Collapse navigation"}
                >
                  {/* Panel-collapse glyph: a framed rail with a chevron showing
                      which way the sidebar will move. */}
                  <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 3v18" />
                    {navCollapsed ? <path d="m14 9 3 3-3 3" /> : <path d="m16 15-3-3 3-3" />}
                  </svg>
                </button>
              </div>
              <div className="nav-clock">
                {navTime.day} · <span style={{ color: "var(--text-hi)", fontWeight: 700 }}>{navTime.time} ET</span>
              </div>
            </div>

            {/* Topbar */}
            <div className="topbar">
              {/* Mobile hamburger — hidden on desktop via CSS */}
              <button className="mob-ham" onClick={() => setNavOpen(o => !o)} aria-label="Open navigation">
                <svg viewBox="0 0 24 24" width="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M3 7h18M3 12h18M3 17h18" />
                </svg>
              </button>
              {/* Mobile brand — hidden on desktop via CSS */}
              <div className="mob-brand">
                <div className="logo" style={{ width: 26, height: 26 }}>
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" />
                  </svg>
                </div>
                <div className="wordmark">MarketCatalyst<span>Market Intelligence</span></div>
              </div>
              <div className="cmd-wrap" ref={cmdRef}>
                <div className={`cmd${searchOpen ? " cmd-active" : ""}`}>
                  <span className="palette-icon">⌕</span>
                  <input
                    className="cmd-input"
                    placeholder="Search tickers and stocks…"
                    value={searchQ}
                    onFocus={() => setSearchOpen(true)}
                    onChange={e => { setSearchQ(e.target.value); setSearchOpen(true); }}
                    onKeyDown={e => {
                      if (e.key === "Escape") { setSearchOpen(false); setSearchQ(""); }
                      if (e.key === "Enter") {
                        if (searchMatches[0]) { localStorage.setItem("iq-stock", searchMatches[0].sym); router.push("/menu/stock"); setSearchOpen(false); setSearchQ(""); }
                      }
                    }}
                  />
                  {searchQ && <button className="cmd-clear" onClick={() => { setSearchQ(""); setSearchOpen(false); }}>✕</button>}
                </div>
                {searchOpen && (
                  <div className="cmd-dropdown">
                    {searchMatches.map(m => (
                      <div key={m.sym} className="palette-item"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { localStorage.setItem("iq-stock", m.sym); router.push("/menu/stock"); setSearchOpen(false); setSearchQ(""); }}
                      >
                        <div className="palette-item-icon" style={{ color: "var(--brand-2)", fontWeight: 700, fontFamily: "var(--f-mono)" }}>{m.sym[0]}</div>
                        <div style={{ flex: 1 }}>
                          <div className="palette-item-label">{m.sym}</div>
                          <div className="palette-item-sub">{m.name ?? "Stock"} · click to open</div>
                        </div>
                        {m.price != null && (
                          <div style={{ textAlign: "right", marginRight: 4 }}>
                            <div className="mono" style={{ fontSize: ".78rem", color: "var(--text-hi)" }}>{fmt(m.price)}</div>
                            {m.pctChange != null && <div className={`mono ${cls(m.pctChange)}`} style={{ fontSize: ".68rem" }}>{sign(m.pctChange)}</div>}
                          </div>
                        )}
                        <button
                          title={searchStarred.has(m.sym) ? "Remove from watchlist" : "Add to watchlist"}
                          onMouseDown={e => e.preventDefault()}
                          onClick={e => { e.stopPropagation(); setSearchStarred(prev => { const n = new Set(prev); n.has(m.sym) ? n.delete(m.sym) : n.add(m.sym); return n; }); }}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1rem", color: searchStarred.has(m.sym) ? "var(--warn)" : "var(--text-dim-solid)", padding: "0 4px" }}>
                          {searchStarred.has(m.sym) ? "★" : "☆"}
                        </button>
                      </div>
                    ))}
                    {searchQ && searchMatches.length === 0 && (
                      <div style={{ padding: "12px 15px", color: "var(--text-dim-solid)", fontSize: "0.8125rem" }}>No results for &ldquo;{searchQ}&rdquo;</div>
                    )}
                  </div>
                )}
              </div>
              <div className={`statuspill${mkt.phase === "open" ? "" : mkt.phase === "closed" ? " mkt-closed" : " mkt-ext"}`}>
                <div className="dot" />
                {mkt.label}
              </div>
              <button
                className="iconbtn"
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                onClick={() => {
                  const next = theme === "dark" ? "light" : "dark";
                  localStorage.setItem("iq-theme", next);
                  setTheme(next);
                  if (user?.uid) {
                    void apiPatch("/api/settings", { darkMode: next === "dark" });
                  }
                }}
              >
                {theme === "dark"
                  ? <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
                  : <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>}
              </button>
              <button className={`iconbtn${copilotOpen ? " ai-active" : ""}`} title="AI Copilot"
                onClick={() => setCopilotOpen(o => !o)}>
                ✦
              </button>
              {/* Bell sits immediately left of the profile avatar. */}
              <NotificationBell />
              <div className="profile-dropdown-wrap" ref={profileDropdownRef}>
                <div
                  className="topbar-avatar"
                  title={displayName}
                  onClick={() => setProfileDropdownOpen(o => !o)}
                  style={{ cursor: "pointer" }}
                >
                  {initials}
                  {profileImage && <img src={profileImage} alt={displayName} />}
                </div>

                {profileDropdownOpen && (
                  <div className="profile-dropdown">
                    {/* User info */}
                    <div className="pd-user">
                      <div className="pd-avatar">
                        {initials}
                        {profileImage && <img src={profileImage} alt={displayName} />}
                      </div>
                      <div className="pd-name">{displayName}</div>
                      <div className="pd-email">{user?.email ?? ""}</div>
                    </div>

                    {/* Menu items */}
                    <button className="pd-item" onClick={() => { router.push("/profile/edit"); setProfileDropdownOpen(false); }}>
                      <span className="pd-icon">👤</span> My Profile
                      {profileIncomplete && <span className="pd-pending">Pending</span>}
                    </button>
                    <button className="pd-item" onClick={() => { router.push("/settings"); setProfileDropdownOpen(false); }}>
                      <span className="pd-icon">⚙</span> Settings
                    </button>
                    <button className="pd-item" onClick={() => { router.push("/manage-plan"); setProfileDropdownOpen(false); }}>
                      <span className="pd-icon">◈</span> Manage Account
                    </button>
                    <div className="pd-divider" />
                    <button className="pd-item danger" onClick={() => { handleSignOut(); setProfileDropdownOpen(false); }}>
                      <span className="pd-icon">↩</span> Logout
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Ticker */}
            <div className="ticker">
              <div className="ticker-track">
                {tickerItems.map((x, i) => (
                  <div key={i} className="tk">
                    <span className="lbl">{x.label}</span>
                    <span className="val">{fmt(x.value, x.value > 1000 ? 0 : 2)}</span>
                    <span className={`chg ${cls(x.change)}`}>{arr(x.change)} {Math.abs(x.change).toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Mobile nav scrim — inside .app so it shares .app's stacking context with the rail */}
            {navOpen && <div className="mob-nav-scrim" onClick={() => setNavOpen(false)} />}

            {/* Rail / Sidebar */}
            <nav ref={railRef} className={`rail${navOpen ? " mob-open" : ""}`}>
              {/* Mobile rail header — hidden on desktop via CSS */}
              <div className="mob-rail-head">
                <div className="logo" style={{ width: 26, height: 26 }}>
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" />
                  </svg>
                </div>
                <div className="wordmark">MarketCatalyst<span>Market Intelligence</span></div>
                <button className="mob-nav-close" onClick={() => setNavOpen(false)} aria-label="Close navigation">✕</button>
              </div>
              {(["Intelligence", "Context", "My Money"] as const).map(group => (
                <div key={group}>
                  <div className="sec-lbl">{group}</div>
                  {menuItems.filter(m => m.group === group).map(item => {
                    const href = slugToHref(item.slug);
                    const isActive = pathname === href;
                    return (
                      <Link
                          key={item.slug}
                          href={href}
                          className={`navitem${isActive ? " active" : ""}`}
                          onMouseEnter={e => {
                            if (!navCollapsed) return;
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setNavTip({ label: item.label, top: r.top + r.height / 2 });
                          }}
                          onMouseLeave={() => setNavTip(null)}
                        >
                        <div className="nicon"><NavIcon slug={item.slug} /></div>
                        <span className="nav-label">{item.label}</span>
                        {item.badge && <span className="nav-tag">{item.badge}</span>}
                      </Link>
                    );
                  })}
                </div>
              ))}

            </nav>

            {/* Rendered outside .rail so overflow-x:hidden cannot clip it. */}
            {navCollapsed && navTip && (
              <div className="nav-tip" style={{ top: navTip.top }}>{navTip.label}</div>
            )}

            {/* Main content */}
            <main className="main">
              {children}
              <footer className="disclaimer-bar">
                MarketCatalyst LLC is not a registered investment advisor and does not manage client assets. Information and tools on this platform are for informational and educational purposes only and do not constitute investment advice. MarketCatalyst is a data provider, not a stock-picks or alert service. Trading stocks and options carries risk — consult your own financial advisor.
              </footer>
            </main>
          </div>

          {/* Drawers */}
          {drawer?.type === "stock" && (
            <StockDrawer sym={drawer.sym} onClose={() => setDrawer(null)} />
          )}
          {drawer?.type === "mover-modal" && (
            <MoverModal key={drawer.sym} sym={drawer.sym} onClose={() => setDrawer(null)} />
          )}
          {drawer?.type === "earnings" && (
            <EarningsDrawer sym={drawer.sym} onClose={() => setDrawer(null)} />
          )}
          {drawer?.type === "sector" && (
            <SectorDrawer name={drawer.name} onClose={() => setDrawer(null)} />
          )}
          {drawer?.type === "fund" && (
            <FundDrawer idx={drawer.idx} onClose={() => setDrawer(null)} />
          )}
          {drawer?.type === "index" && (
            <IndexDrawer idx={drawer.idx} pulse={livePulse} onClose={() => setDrawer(null)} />
          )}
          {drawer?.type === "feargreed" && (
            <FearGreedDrawer onClose={() => setDrawer(null)} />
          )}


          {/* Copilot panel */}
          {copilotOpen && <CopilotPanel onClose={() => setCopilotOpen(false)} />}

          {/* Chart expand modal */}
          {expandedChart && (
            <div className="chart-modal-overlay" onClick={() => setExpandedChart(null)}>
              <div className="chart-modal" onClick={e => e.stopPropagation()}>
                <div className="chart-modal-head">
                  <h3>{expandedChart.title}</h3>
                  <button className="chart-modal-close" onClick={() => setExpandedChart(null)}>
                    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 3v5H3M21 8h-5V3M16 21v-5h5M3 16h5v5" />
                    </svg>
                  </button>
                </div>
                <div className="chart-modal-body">
                  {expandedChart.node}
                </div>
              </div>
            </div>
          )}

        </div>
      </IQActionsContext.Provider>
    </AuthGuard>
  );
}
