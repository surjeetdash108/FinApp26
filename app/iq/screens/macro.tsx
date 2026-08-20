"use client";

import { useRef, useState, useEffect } from "react";
import { StockLogo, DataState, NotAvailable, VendorTag } from "../utils";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import { useTapeStream } from "../hooks/useTapeStream";
import { tapeItemsToIndexDocs } from "../live-market-indices";
import type { MacroEventDoc, DividendHistoryDoc, CompanyDoc } from "../types";
import type { MarketStatusPayload } from "../types/market-status";
import { fmtMonthDay, isoDay, addDays, mondayOf } from "../calendar-range";

// ── Economic calendar ────────────────────────────────────────────────────────
interface MacroEvent {
  ev: string; date: string; day: string; tier: "High" | "Med" | "Low";
  prev: string; est: string; actual: string; surprise: "up" | "down" | "";
  note: string;
}

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

/** Importance rank for in-day sort (High first). */
const TIER_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

// ── Full-year NYSE holiday calendar (fixed rules) ────────────────────────────
// Polygon's /marketstatus/upcoming only lists FUTURE holidays, so the "show all"
// modal computes the standard NYSE closures for the whole year instead.
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + shift + (n - 1) * 7));
}
function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const shift = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month, last.getUTCDate() - shift));
}
/** Anonymous Gregorian Computus — Easter Sunday, for Good Friday. */
function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
/** Federal observance: Saturday → Friday, Sunday → Monday. */
function observed(date: Date): Date {
  const dow = date.getUTCDay();
  if (dow === 6) return new Date(date.getTime() - 86_400_000);
  if (dow === 0) return new Date(date.getTime() + 86_400_000);
  return date;
}
function usMarketHolidays(year: number): { date: string; name: string }[] {
  const easter = easterSunday(year);
  const rows: { d: Date; name: string }[] = [
    { d: observed(new Date(Date.UTC(year, 0, 1))), name: "New Year's Day" },
    { d: nthWeekday(year, 0, 1, 3), name: "Martin Luther King Jr. Day" },
    { d: nthWeekday(year, 1, 1, 3), name: "Washington's Birthday" },
    { d: new Date(easter.getTime() - 2 * 86_400_000), name: "Good Friday" },
    { d: lastWeekday(year, 4, 1), name: "Memorial Day" },
    { d: observed(new Date(Date.UTC(year, 5, 19))), name: "Juneteenth" },
    { d: observed(new Date(Date.UTC(year, 6, 4))), name: "Independence Day" },
    { d: nthWeekday(year, 8, 1, 1), name: "Labor Day" },
    { d: nthWeekday(year, 10, 4, 4), name: "Thanksgiving Day" },
    { d: observed(new Date(Date.UTC(year, 11, 25))), name: "Christmas Day" },
  ];
  return rows
    .map(r => ({ date: r.d.toISOString().slice(0, 10), name: r.name }))
    .sort((a, b) => a.date.localeCompare(b.date));
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
  const hist = (dh?.annualTotals ?? []).map(a => ({ year: a.year, div: a.total ?? 0 })).sort((a, b) => a.year - b.year);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="side-drawer">
        <div className="drawer-h">
          <StockLogo sym={stock.sym} size={30} />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)", fontFamily: "var(--f-display)" }}>
                {stock.sym} · Dividend History
              </div>
              <VendorTag v="polygon" />
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
  // Real high-beta names (proxy for "VIX sensitive"). A ticker search lets you
  // look up ANY name's beta / dividend yield, not just the default top-beta set.
  const [vixQuery, setVixQuery] = useState("");
  const vixQ = vixQuery.trim().toUpperCase();
  const betaStocks = [...companies]
    .filter((c): c is CompanyDoc & { beta: number } => c.beta != null)
    .sort((a, b) => b.beta - a.beta);
  const highBetaStocks = vixQ
    ? betaStocks.filter(c => c.ticker.toUpperCase().includes(vixQ)).slice(0, 25)
    : betaStocks.slice(0, 10);

  // One clock for the whole screen so tabs cannot disagree mid-render.
  const now = new Date();

  const [holidaysAllOpen, setHolidaysAllOpen] = useState(false);

  // ── Economic calendar: Earnings-Hub-style week grid (Mon–Fri) ──
  const [ecoAnchor, setEcoAnchor] = useState(() => isoDay(now));
  const [ecoSel, setEcoSel] = useState<MacroEventDoc | null>(null);
  const ecoAnchorDate = new Date(`${ecoAnchor}T00:00:00Z`);
  const ecoWeekMon = mondayOf(ecoAnchorDate);
  const ecoWeekDays = [0, 1, 2, 3, 4].map(i => isoDay(addDays(ecoWeekMon, i)));
  // macro_events keyed by day (raw docs so the detail popup has every field),
  // sorted High-impact first.
  const ecoByDate = new Map<string, MacroEventDoc[]>();
  for (const d of macroLive) {
    if (!d.eventDate) continue;
    const day = d.eventDate.slice(0, 10);
    const arr = ecoByDate.get(day);
    if (arr) arr.push(d);
    else ecoByDate.set(day, [d]);
  }
  for (const arr of ecoByDate.values()) {
    arr.sort((a, b) => (TIER_RANK[a.importance] ?? 3) - (TIER_RANK[b.importance] ?? 3) || a.name.localeCompare(b.name));
  }
  const ecoWeekLabel = `${fmtMonthDay(ecoWeekDays[0])} – ${fmtMonthDay(ecoWeekDays[4])}, ${ecoWeekDays[4].slice(0, 4)}`;
  const ecoWeekCount = ecoWeekDays.reduce((n, iso) => n + (ecoByDate.get(iso)?.length ?? 0), 0);
  const [vixSel,    setVixSel]    = useState<DivStock | null>(null);
  const vixTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [vixPop, setVixPop] = useState<{ s: CompanyDoc & { beta: number }; x: number; y: number } | null>(null);

  // Match the Economic calendar's height to the left column (Market holidays +
  // VIX) so the calendar's bottom lines up with the VIX widget's bottom. Measured
  // live so it tracks the left column as its content/viewport changes.
  const leftColRef = useRef<HTMLDivElement | null>(null);
  const [leftColH, setLeftColH] = useState<number>();
  useEffect(() => {
    const el = leftColRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setLeftColH(el.offsetHeight));
    ro.observe(el);
    setLeftColH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

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
      <div className="page-head" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <button className="ecal-arrow" onClick={() => setEcoAnchor(isoDay(addDays(ecoAnchorDate, -7)))} aria-label="Previous week">‹</button>
        <span style={{ fontSize: "1.02rem", fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--f-display)", minWidth: 220, textAlign: "center" }}>{ecoWeekLabel}</span>
        <button className="ecal-arrow" onClick={() => setEcoAnchor(isoDay(addDays(ecoAnchorDate, 7)))} aria-label="Next week">›</button>
        <button className="chip" onClick={() => setEcoAnchor(isoDay(new Date()))} style={{ marginLeft: 4 }}>Today</button>
      </div>

      {/* ── Market regime + VIX + Economic calendar ── */}
      <div className="dash" style={{ alignItems: "flex-start" }}>
        <div ref={leftColRef} className="col-4" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="card">
            <div className="card-h">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Market holidays</h3><VendorTag v="polygon" /></div>
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
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>VIX</h3><VendorTag v="polygon" /></div>
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
          {/* Height matched to the left column (measured) so the calendar's
              bottom aligns with the VIX widget's bottom; it scrolls internally
              instead of growing and elongating the VIX column. */}
          <div className="card" style={{ height: leftColH ?? 460, display: "flex", flexDirection: "column" }}>
            <div className="card-h">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Economic calendar</h3><VendorTag v="fmp" /></div>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>
                {ecoWeekCount} this week
              </span>
            </div>
            <div className="tbl-wrap" style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              <div className="ec-grid">
                {ecoWeekDays.map((iso, di) => {
                  const evs = ecoByDate.get(iso) ?? [];
                  const dn = ["MON", "TUE", "WED", "THU", "FRI"][di];
                  const isToday = iso === isoDay(new Date());
                  const isSel = iso === ecoAnchor;
                  return (
                    <div key={iso} className={`ec-day${isToday ? " is-today" : ""}${isSel && !isToday ? " is-sel" : ""}`}
                      style={{ cursor: "pointer" }} onClick={() => setEcoAnchor(iso)}>
                      <div className="ec-dh">{dn} {Number(iso.slice(8))}{isToday ? " · Today" : ""}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {evs.length ? evs.map((d, i) => {
                          const e = toMacroEvent(d);
                          const color = e.tier === "High" ? "var(--down)" : e.tier === "Med" ? "var(--warn)" : "var(--text-dim-solid)";
                          const valBits = [e.est !== "—" ? `est ${e.est}` : "", e.actual !== "—" ? `act ${e.actual}` : ""].filter(Boolean).join(" · ");
                          return (
                            <div key={(d.id ?? e.ev) + i} title={`${e.ev} — click for details`}
                              onClick={ev => { ev.stopPropagation(); setEcoSel(d); }}
                              style={{ display: "flex", gap: 6, alignItems: "flex-start", background: "var(--surface-3)", borderRadius: 8, padding: "5px 8px", cursor: "pointer" }}>
                              <span style={{ width: 6, height: 6, borderRadius: 3, background: color, marginTop: 5, flexShrink: 0 }} />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--text-hi)", lineHeight: 1.25 }}>{e.ev}</div>
                                {valBits && <div style={{ fontSize: ".64rem", color: "var(--text-dim-solid)", marginTop: 1 }}>{valBits}</div>}
                              </div>
                            </div>
                          );
                        }) : <span className="ec-none">—</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── VIX-sensitive stocks ── */}
      <div style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-h">
            {/* Search sits LEFT next to the title — filters this table by ticker. */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>VIX-sensitive stocks</h3><VendorTag v="polygon" /></div>
              <input
                value={vixQuery}
                onChange={e => setVixQuery(e.target.value.toUpperCase())}
                placeholder="Search ticker…"
                style={{ width: 230, boxSizing: "border-box", background: "var(--surface-3)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: "5px 9px", fontSize: ".74rem", color: "var(--text-hi)", outline: "none", fontFamily: "var(--f-mono)", textAlign: "left" }}
              />
            </div>
            <span style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>{vixQ ? `Matches for “${vixQuery}”` : "Highest-beta names — most sensitive to volatility spikes · hover for details"}</span>
          </div>
          <div className="tbl-wrap">
            {highBetaStocks.length === 0 ? (
              <DataState loading={companiesLoading} label={vixQ ? `No name matching “${vixQuery}” with a beta.` : "No live beta data synced yet."} />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Stock</th>
                    <th className="num">Beta</th>
                    <th className="num">30d Vol</th>
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
                        <td className="num">{s.realizedVol30 != null ? `${s.realizedVol30.toFixed(1)}%` : <NotAvailable />}</td>
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
        const yearHolidays = usMarketHolidays(yr);
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

      {/* ── Economic event detail popup ── */}
      {ecoSel && (() => {
        const d = ecoSel;
        const unit = d.unit === "%" ? "%" : "";
        const fv = (v: number | null | undefined) => (v == null ? "—" : `${v}${unit}`);
        const change = d.actual != null && d.previous != null ? d.actual - d.previous : null;
        const dateFull = new Date(`${d.eventDate}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
        const tier = d.importance === "high" ? "High" : d.importance === "medium" ? "Medium" : "Low";
        const tierColor = d.importance === "high" ? "var(--down)" : d.importance === "medium" ? "var(--warn)" : "var(--text-dim-solid)";
        return (
          <div onClick={() => setEcoSel(null)} style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(4,7,14,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 14, width: "min(460px, 100%)", boxShadow: "0 20px 60px rgba(0,0,0,.5)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "16px 18px", borderBottom: "1px solid var(--border-soft)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--f-display)", lineHeight: 1.3 }}>{d.name}</div>
                    <VendorTag v="fmp" />
                  </div>
                  <div style={{ fontSize: ".74rem", color: "var(--text-dim-solid)", marginTop: 3 }}>{dateFull}{d.country ? ` · ${d.country}` : ""}</div>
                </div>
                <span className="pill" style={{ background: "var(--surface-3)", color: tierColor, flexShrink: 0 }}>{tier} impact</span>
                <button className="closebtn" onClick={() => setEcoSel(null)}>✕</button>
              </div>
              <div style={{ padding: 18 }}>
                <div className="metric-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                  <div className="m"><div className="k">Previous</div><div className="v">{fv(d.previous)}</div></div>
                  <div className="m"><div className="k">Estimate</div><div className="v">{fv(d.estimate)}</div></div>
                  <div className="m"><div className="k">Actual</div><div className="v" style={{ color: d.actual != null ? "var(--text-hi)" : "var(--text-dim-solid)" }}>{fv(d.actual)}</div></div>
                </div>
                {change != null && (
                  <div style={{ marginTop: 12, fontSize: ".78rem", color: "var(--text-dim-solid)" }}>
                    Change vs previous: <b className={change >= 0 ? "up" : "down"}>{change >= 0 ? "+" : ""}{change.toFixed(2)}{unit}</b>
                  </div>
                )}
                {d.actual == null && (
                  <div style={{ marginTop: 12, fontSize: ".74rem", color: "var(--text-dim-solid)" }}>
                    Not yet released — showing the consensus estimate and prior reading.
                  </div>
                )}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-soft)", fontSize: ".68rem", color: "var(--text-dim-solid)", fontFamily: "var(--f-mono)" }}>
                  {d.seriesId} · source: {d.source}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
