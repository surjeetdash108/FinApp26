"use client";

import { useRef, useState } from "react";
import { StockLogo, DataState, NotAvailable } from "../utils";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import { useTapeStream } from "../hooks/useTapeStream";
import { tapeItemsToIndexDocs } from "../live-market-indices";
import type { MacroEventDoc, DividendHistoryDoc, CompanyDoc } from "../types";
import type { MarketStatusPayload } from "../types/market-status";
import { rangeFor, inRange, fmtMonthDay, type RangeTabKey } from "../calendar-range";

// ── Economic calendar ────────────────────────────────────────────────────────
const ECO_TABS = ["Last month", "Last week", "This week", "Next week", "This month"];

interface MacroEvent {
  ev: string; date: string; day: string; tier: "High" | "Med" | "Low";
  prev: string; est: string; actual: string; surprise: "up" | "down" | "";
  note: string;
}

/** ECO_TABS index -> shared calendar range key. */
const ECO_TAB_RANGE: RangeTabKey[] = ["lmonth", "prev", "week", "next", "month"];

const DOW_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Live macro_events doc -> the row shape this calendar renders. */
function toMacroEvent(d: MacroEventDoc): MacroEvent {
  const dt = new Date(d.eventDate + "T00:00:00Z");
  const unit = d.unit === "%" ? "%" : "";
  const val = (v: number | null) => (v == null ? "—" : `${v}${unit}`);
  return {
    ev: d.name,
    date: fmtMonthDay(d.eventDate),
    day: DOW_ABBR[dt.getUTCDay()] ?? "",
    tier: d.importance === "high" ? "High" : d.importance === "medium" ? "Med" : "Low",
    prev: val(d.previous),
    // FMP carries the consensus estimate; FRED does not (leaves it null). We show
    // the estimate when present but keep `surprise` blank: for macro data a print
    // above/below consensus isn't inherently good/bad, so colouring it green/red
    // would be misleading.
    est: d.estimate == null ? "—" : val(d.estimate),
    actual: val(d.actual),
    surprise: "",
    note: `${d.seriesId} · ${d.source}`,
  };
}

/**
 * Economic-calendar rows for a tab, from live macro_events only. An empty
 * result yields an empty state upstream — there is no hardcoded fallback.
 */
function ecoRowsFor(tabIdx: number, live: MacroEventDoc[], now: Date): MacroEvent[] {
  const r = rangeFor(ECO_TAB_RANGE[tabIdx] ?? "month", now);
  return live
    .filter(d => d.eventDate && inRange(d.eventDate, r))
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.name.localeCompare(b.name))
    .map(toMacroEvent);
}

// ── Dividend data ────────────────────────────────────────────────────────────
interface DivStock {
  sym: string; name: string; sector: string;
  exDate: string; payDate: string;   // display strings, e.g. "Jun 25"
  exMonth: number; exDay: number;    // for calendar + filter
  payMonth: number; payDay: number;  // for pay-date section in day view
  amount: number; yld: number | null; freq: string; streak: number | null;
  weekDay: number;                   // 0=Mon..4=Fri for week-grid view
}


// ── Dividend bar chart ───────────────────────────────────────────────────────
function DivHistoryChart({ data }: { data: { year: number; div: number }[] }) {
  const W = 480, H = 160, PADL = 40, PADR = 10, PADT = 20, PADB = 24;
  const iw = W - PADL - PADR, ih = H - PADT - PADB;
  const maxV = Math.max(...data.map(d => d.div)) * 1.15 || 1;
  const n = data.length, gw = iw / n, bw = gw * 0.52;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {[0, maxV / 2, maxV].map(v => {
        const y = PADT + ih - (v / maxV) * ih;
        return (
          <g key={v}>
            <line x1={PADL} y1={y} x2={W - PADR} y2={y} stroke="var(--border-soft)" strokeDasharray="2 4" />
            <text x={PADL - 4} y={y + 3.5} textAnchor="end" style={{ fill: "var(--text-dim-solid)", fontSize: "0.5rem" }}>
              ${v.toFixed(2)}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const cx = PADL + gw * i + gw / 2;
        const bh = Math.max(2, (d.div / maxV) * ih);
        const by = PADT + ih - bh;
        return (
          <g key={d.year}>
            <rect x={(cx - bw / 2).toFixed(1)} y={by.toFixed(1)} width={bw.toFixed(1)} height={bh.toFixed(1)} rx="3"
              style={{ fill: "var(--brand-2)", opacity: 0.85 }} />
            <text x={cx.toFixed(1)} y={(by - 4).toFixed(1)} textAnchor="middle"
              style={{ fill: "var(--text-hi)", fontSize: "0.4688rem", fontWeight: 600 }}>
              ${d.div.toFixed(2)}
            </text>
            <text x={cx.toFixed(1)} y={H - 6} textAnchor="middle"
              style={{ fill: "var(--text-dim-solid)", fontSize: "0.5rem" }}>
              {d.year}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Dividend sliding drawer ──────────────────────────────────────────────────
function DividendDrawer({ stock, onClose }: { stock: DivStock; onClose: () => void }) {
  const { data: dh, loading: dhLoading } = useApiResource<DividendHistoryDoc>(`/live/dividend-history?ticker=${encodeURIComponent(stock.sym)}`);
  const hist = (dh?.annualTotals ?? []).map(a => ({ year: a.year, div: a.total })).sort((a, b) => a.year - b.year);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="side-drawer">
        <div className="drawer-h">
          <StockLogo sym={stock.sym} size={30} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)", fontFamily: "var(--f-display)" }}>
              {stock.sym} · Dividend History
            </div>
            <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{stock.name}</div>
          </div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-b">
          {!dh ? (
            <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Loading…</div>
          ) : (
            <>
              <div className="metric-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 14 }}>
                <div className="m"><div className="k">Latest payment</div><div className="v">{dh.history[0]?.amount != null ? `$${dh.history[0].amount.toFixed(2)}` : "—"}</div></div>
                <div className="m"><div className="k">TTM div</div><div className="v">{dh.ttmTotal != null ? `$${dh.ttmTotal.toFixed(2)}` : "—"}</div></div>
                <div className="m"><div className="k">Yield</div><div className="v up">{dh.yieldPct != null ? dh.yieldPct.toFixed(2) + "%" : "—"}</div></div>
                <div className="m"><div className="k">Div streak</div><div className="v">{dh.increaseStreakYears > 0 ? dh.increaseStreakYears + " yrs" : "—"}</div></div>
                <div className="m"><div className="k">Frequency</div><div className="v" style={{ fontSize: ".85rem" }}>{dh.frequency ? `${dh.frequency}x/yr` : "—"}</div></div>
                <div className="m"><div className="k">5yr CAGR</div><div className="v up">{dh.cagr5yPct != null ? `${dh.cagr5yPct.toFixed(1)}%` : "—"}</div></div>
              </div>
              {hist.length === 0 ? (
                <DataState loading={dhLoading} label={`No live dividend history synced for ${stock.sym} yet.`} />
              ) : (
                <>
                  <div className="card" style={{ marginBottom: 14 }}>
                    <div className="card-h"><h3>Annual dividend per share</h3></div>
                    <div className="card-b" style={{ paddingTop: 8 }}>
                      <DivHistoryChart data={hist} />
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-h"><h3>Year-by-year breakdown</h3></div>
                    <div className="card-b" style={{ padding: 0 }}>
                      <table className="tbl">
                        <thead><tr><th>Year</th><th className="num">Annual div</th><th className="num">YoY growth</th></tr></thead>
                        <tbody>
                          {[...hist].reverse().map((h, i, arr) => {
                            const prev = arr[i + 1]?.div ?? null;
                            const g    = prev != null ? ((h.div - prev) / (prev || 1)) * 100 : null;
                            return (
                              <tr key={h.year}>
                                <td><b style={{ color: "var(--text-hi)" }}>{h.year}</b></td>
                                <td className="num">${h.div.toFixed(2)}</td>
                                <td className={`num ${g != null ? (g >= 0 ? "up" : "down") : ""}`}>
                                  {g != null ? `${g >= 0 ? "+" : ""}${g.toFixed(1)}%` : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────
export function MacroScreen() {
  const { data: macroLive, loading: macroLoading } = useApiList<MacroEventDoc>("/market-data/macro-events");

  const { data: companies, loading: companiesLoading } = useApiList<CompanyDoc>("/market-data/companies");
  const { data: mktStatus } = useApiResource<MarketStatusPayload>("/live/market-status");
  // Polygon /v1/marketstatus/upcoming — dedupe the per-exchange rows (NYSE +
  // NASDAQ list the same holiday) by date+name; show the next handful.
  const dedupedHolidays = (() => {
    const seen = new Set<string>();
    const out: MarketStatusPayload["upcoming"] = [];
    for (const h of mktStatus?.upcoming ?? []) {
      const key = h.date + h.name;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(h);
    }
    return out;
  })();
  const upcomingHolidays = dedupedHolidays.slice(0, 6);
  const { frame: tapeFrame } = useTapeStream();
  const liveVix = tapeFrame ? tapeItemsToIndexDocs(tapeFrame.items).find(i => i.label === "VIX") : null;
  // Real high-beta names (proxy for "VIX sensitive") — no live implied-vol
  // source exists, so IV30 is dropped rather than fabricated.
  const highBetaStocks = [...companies]
    .filter((c): c is CompanyDoc & { beta: number } => c.beta != null)
    .sort((a, b) => b.beta - a.beta)
    .slice(0, 10);

  // One clock for the whole screen so tabs cannot disagree mid-render.
  const now = new Date();

  const [ecoTab,    setEcoTab]    = useState(2);
  const [holidaysAllOpen, setHolidaysAllOpen] = useState(false);
  const ecoRows = ecoRowsFor(ecoTab, macroLive, now);
  // Group by day so the calendar reads like the Earnings Hub — a dated section
  // per day rather than one flat table.
  const ecoByDay: { date: string; day: string; rows: MacroEvent[] }[] = [];
  for (const e of ecoRows) {
    const last = ecoByDay[ecoByDay.length - 1];
    if (last && last.date === e.date) last.rows.push(e);
    else ecoByDay.push({ date: e.date, day: e.day, rows: [e] });
  }
  const [selStock,  setSelStock]  = useState<DivStock | null>(null);
  const [vixSel,    setVixSel]    = useState<DivStock | null>(null);
  const vixTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [vixPop, setVixPop] = useState<{ s: CompanyDoc & { beta: number }; x: number; y: number } | null>(null);

  const showVixPop = (e: React.MouseEvent, s: CompanyDoc & { beta: number }) => {
    if (vixTimerRef.current) clearTimeout(vixTimerRef.current);
    const x = Math.max(8, Math.min(e.clientX + 14, window.innerWidth - 306));
    const y = Math.max(8, Math.min(e.clientY - 10, window.innerHeight - 230));
    setVixPop({ s, x, y });
  };
  const hideVixPop   = () => { vixTimerRef.current = setTimeout(() => setVixPop(null), 200); };
  const cancelVixPop = () => { if (vixTimerRef.current) clearTimeout(vixTimerRef.current); };

  return (
    <>
      <div className="page-head">
      
        <div className="tabs">
          {ECO_TABS.map((t, i) => (
            <button key={t} className={`tab${i === ecoTab ? " on" : ""}`} onClick={() => setEcoTab(i)}>{t}</button>
          ))}
        </div>
      </div>

      {/* ── Market regime + VIX + Economic calendar ── */}
      <div className="dash" style={{ alignItems: "stretch" }}>
        <div className="col-4" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="card">
            <div className="card-h">
              <h3>Market holidays</h3>
              <button className="link" onClick={() => setHolidaysAllOpen(true)}>Show all →</button>
            </div>
            <div className="card-b" style={{ padding: "6px 13px 10px" }}>
              {upcomingHolidays.length === 0 ? (
                <DataState label="No upcoming market holidays." />
              ) : upcomingHolidays.map(h => (
                <div key={h.date + h.name} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "7px 0", borderBottom: "1px solid var(--border-soft)",
                }}>
                  <div>
                    <div style={{ fontSize: ".82rem", color: "var(--text-hi)", fontWeight: 600 }}>{h.name}</div>
                    <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", fontFamily: "var(--f-mono)" }}>
                      {new Date(h.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    </div>
                  </div>
                  <span className="pill" style={{
                    background: "var(--surface-3)", fontSize: ".58rem", textTransform: "capitalize",
                    color: h.status === "closed" ? "var(--down)" : "var(--warn)",
                  }}>{h.status === "early-close" ? "Early close" : h.status}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card vix" style={{ flex: 1 }}>
            <div className="card-h">
              <h3>VIX</h3>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", fontSize: ".62rem" }}>live · Polygon</span>
            </div>
            <div className="card-b">
              {!liveVix ? (
                <DataState loading={!tapeFrame} label="No live VIX-proxy quote available right now." />
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span className="big">{liveVix.value.toFixed(2)}</span>
                    <span className={`mono ${liveVix.pctChange >= 0 ? "up" : "down"}`} style={{ fontWeight: 600 }}>
                      {liveVix.pctChange >= 0 ? "▲" : "▼"} {liveVix.pctChange.toFixed(2)}%
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="col-8" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div className="card-h">
              <h3>Economic calendar</h3>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>
                {ecoRows.length} events
              </span>
            </div>
            <div className="tbl-wrap" style={{ flex: 1, overflowY: "auto" }}>
              {ecoRows.length === 0 ? (
                <div style={{ padding: 16 }}><DataState loading={macroLoading} label="No live macro events for this window yet." /></div>
              ) : (
                <div style={{ padding: "6px 4px 4px" }}>
                  {ecoByDay.map(g => (
                    <div key={g.date} className="ecal-day" style={{ marginBottom: 12 }}>
                      <div className="ecal-day-h">
                        <span className="ecal-day-t">{g.day}, {g.date}</span>
                        <span className="ecal-day-n">{g.rows.length}</span>
                      </div>
                      <div className="ecal-tablewrap">
                        <table className="ecal-table">
                          <thead>
                            <tr>
                              <th>Event</th><th>Impact</th>
                              <th className="r">Prior</th><th className="r">Est</th><th className="r">Actual</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.rows.map(e => (
                              <tr key={e.ev}>
                                <td>
                                  <div className="ecal-sym" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                    {e.ev}
                                    {e.tier === "High" && <span style={{ color: "var(--warn)", fontSize: ".6rem" }}>●</span>}
                                  </div>
                                  {e.note && <div className="ecal-name">{e.note}</div>}
                                </td>
                                <td>
                                  <span className={`pill ${e.tier === "High" ? "dn" : e.tier === "Med" ? "amc" : ""}`}
                                    style={e.tier === "Low" ? { background: "var(--surface-3)", color: "var(--text-dim-solid)" } : undefined}>
                                    {e.tier}
                                  </span>
                                </td>
                                <td className="r ecal-num">{e.prev}</td>
                                <td className="r ecal-num">{e.est}</td>
                                <td className="r ecal-num"><b>{e.actual}</b></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── VIX-sensitive stocks ── */}
      <div style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-h">
            <h3>VIX-sensitive stocks</h3>
            <span style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>Highest-beta names — most sensitive to volatility spikes · hover for details</span>
          </div>
          <div className="tbl-wrap">
            {highBetaStocks.length === 0 ? (
              <DataState loading={companiesLoading} label="No live beta data synced yet." />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Stock</th>
                    <th className="num">Beta</th>
                    <th className="num">IV 30d</th>
                    <th className="num">Div yield</th>
                  </tr>
                </thead>
                <tbody>
                  {highBetaStocks.map(s => {
                    const divStk: DivStock = {
                      sym: s.ticker, name: s.name ?? s.ticker, sector: s.sector ?? "—",
                      exDate: "—", payDate: "—",
                      exMonth: 0, exDay: 0, payMonth: 0, payDay: 0,
                      amount: 0, yld: s.dividendYield, freq: "—", streak: null, weekDay: 0,
                    };
                    return (
                      <tr key={s.ticker} style={{ cursor: "pointer" }}
                        onClick={() => setVixSel(divStk)}
                        onMouseEnter={e => showVixPop(e, s)}
                        onMouseLeave={hideVixPop}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <StockLogo sym={s.ticker} size={20} />
                            <div>
                              <div style={{ fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--f-mono)", fontSize: ".85rem" }}>{s.ticker}</div>
                              <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)" }}>{s.name ?? s.ticker}</div>
                            </div>
                          </div>
                        </td>
                        <td className="num"><b style={{ color: s.beta >= 2 ? "var(--down)" : "var(--warn)" }}>{s.beta.toFixed(2)}</b></td>
                        <td className="num"><NotAvailable /></td>
                        <td className="num">{s.dividendYield != null && s.dividendYield > 0 ? <span className="up">{s.dividendYield.toFixed(2)}%</span> : <span style={{ color: "var(--text-dim-solid)" }}>—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* ── Dividend drawer from chip click ── */}
      {selStock && (
        <DividendDrawer stock={selStock} onClose={() => setSelStock(null)} />
      )}

      {/* ── Dividend drawer from high-beta row click ── */}
      {vixSel && (
        <DividendDrawer stock={vixSel} onClose={() => setVixSel(null)} />
      )}

      {/* ── High-beta hover popup (fixed, smart above/below) ── */}
      {vixPop && (
        <div className="mv-dp"
          style={{ display: "block", position: "fixed", left: vixPop.x, top: vixPop.y, zIndex: 200 }}
          onMouseEnter={cancelVixPop}
          onMouseLeave={hideVixPop}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9, paddingBottom: 9, borderBottom: "1px solid var(--border)" }}>
            <StockLogo sym={vixPop.s.ticker} size={26} />
            <div>
              <div style={{ fontWeight: 800, color: "var(--text-hi)", fontSize: ".9rem" }}>{vixPop.s.ticker}</div>
              <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>{vixPop.s.name ?? vixPop.s.ticker} · {vixPop.s.sector ?? "—"}</div>
            </div>
          </div>
          <div className="dp-row"><span>Beta (5yr monthly)</span><b style={{ color: vixPop.s.beta >= 2 ? "var(--down)" : "var(--warn)" }}>{vixPop.s.beta.toFixed(2)}</b></div>
          <div className="dp-row"><span>Implied vol (30d)</span><NotAvailable /></div>
          <div className="dp-row"><span>VIX sensitivity</span><b>{vixPop.s.beta >= 2.5 ? "Extreme" : vixPop.s.beta >= 1.8 ? "High" : "Moderate"}</b></div>
          {vixPop.s.dividendYield != null && vixPop.s.dividendYield > 0 && (
            <div className="dp-row"><span>Dividend yield</span><b style={{ color: "var(--up)" }}>{vixPop.s.dividendYield.toFixed(2)}%</b></div>
          )}
          <div className="dp-note" style={{ marginTop: 8 }}>
            Click row to see dividend history →
          </div>
        </div>
      )}

      {/* All market holidays for the running year — modal */}
      {holidaysAllOpen && (() => {
        const yr = new Date().getFullYear();
        const yearHolidays = dedupedHolidays.filter(h => Number(h.date.slice(0, 4)) === yr);
        return (
          <>
            <div className="scrim" style={{ zIndex: 60 }} onClick={() => setHolidaysAllOpen(false)} />
            <div style={{
              position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
              background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)",
              zIndex: 61, width: "min(460px, 92vw)", maxHeight: "80vh", display: "flex", flexDirection: "column",
              boxShadow: "0 20px 60px rgba(0,0,0,.5)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--border-soft)" }}>
                <span style={{ fontWeight: 700, fontSize: ".95rem", color: "var(--text-hi)", flex: 1 }}>Market holidays · {yr}</span>
                <button className="closebtn" onClick={() => setHolidaysAllOpen(false)}>✕</button>
              </div>
              <div style={{ padding: "6px 16px 16px", overflowY: "auto" }}>
                {yearHolidays.length === 0 ? (
                  <DataState label={`No market holidays listed for ${yr}.`} />
                ) : yearHolidays.map(h => (
                  <div key={h.date + h.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--border-soft)" }}>
                    <div style={{ fontSize: ".84rem", color: "var(--text-hi)", fontWeight: 600 }}>{h.name}</div>
                    <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", fontFamily: "var(--f-mono)" }}>
                      {new Date(h.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        );
      })()}
    </>
  );
}
