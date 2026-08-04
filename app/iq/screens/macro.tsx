"use client";

import { useRef, useState } from "react";
import { StockLogo, DataState, NotAvailable } from "../utils";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import { useTapeStream } from "../hooks/useTapeStream";
import { tapeItemsToIndexDocs } from "../live-market-indices";
import type { MacroEventDoc, DividendDoc, DividendHistoryDoc, CompanyDoc } from "../types";
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
    // FRED publishes observations, not consensus forecasts — there is no
    // estimate to show, and no beat/miss to derive from one. Leaving `surprise`
    // blank is honest; colouring it from actual-vs-previous would present a
    // direction-of-change as a surprise against expectations.
    est: "—",
    actual: val(d.actual),
    surprise: "",
    note: `${d.seriesId} · ${d.source}`,
  };
}

/**
 * Economic-calendar rows for a tab. Live macro_events is authoritative; the
 * hardcoded CAL_* arrays render only when no live data exists at all.
 */
function ecoRowsFor(tabIdx: number, live: MacroEventDoc[], now: Date): MacroEvent[] {
  const r = rangeFor(ECO_TAB_RANGE[tabIdx] ?? "month", now);
  return live
    .filter(d => d.eventDate && inRange(d.eventDate, r))
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.name.localeCompare(b.name))
    .map(toMacroEvent);
}

// ── Dividend calendar data ───────────────────────────────────────────────────
type DivTabKey = "lmonth" | "prev" | "yest" | "today" | "tom" | "week" | "next" | "month";
const DIV_RANGES: [DivTabKey, string][] = [
  ["lmonth", "Last Month"],
  ["prev",   "Last Week"],
  ["yest",   "Yesterday"],
  ["today",  "Today"],
  ["tom",    "Tomorrow"],
  ["week",   "This Week"],
  ["next",   "Next Week"],
  ["month",  "Month"],
];

// Today = Thu Jun 25, 2026
// This week: Mon Jun 22 – Fri Jun 26  (weekDay 0=Mon … 4=Fri)
// Last week: Mon Jun 15 – Fri Jun 19
// Next week: Mon Jun 29 – Fri Jul 3
// Last month: May 2026
interface DivStock {
  sym: string; name: string; sector: string;
  exDate: string; payDate: string;   // display strings, e.g. "Jun 25"
  exMonth: number; exDay: number;    // for calendar + filter
  payMonth: number; payDay: number;  // for pay-date section in day view
  amount: number; yld: number | null; freq: string; streak: number | null;
  weekDay: number;                   // 0=Mon..4=Fri for week-grid view
}


/** Live Firestore dividend -> the shape the calendar renders. */
function toDivStock(d: DividendDoc): DivStock {
  const [, em, ed] = d.exDividendDate.split("-").map(Number);
  const pay = d.paymentDate ? d.paymentDate.split("-").map(Number) : null;
  const exDate = new Date(d.exDividendDate + "T00:00:00Z");
  return {
    sym: d.ticker,
    // Company name and sector are not on the dividend doc; showing the ticker is
    // honest, whereas inventing a name would not be.
    name: d.ticker,
    sector: "—",
    exDate: fmtMonthDay(d.exDividendDate),
    payDate: fmtMonthDay(d.paymentDate),
    exMonth: em, exDay: ed,
    payMonth: pay ? pay[1] : 0, payDay: pay ? pay[2] : 0,
    amount: d.dividendAmount ?? 0,
    // Polygon does not return dividend yield — null renders as "n/a" rather
    // than a fabricated 0%.
    yld: d.yieldPct ?? null,
    freq: d.frequency ?? "—",
    streak: null,
    weekDay: (exDate.getUTCDay() + 6) % 7,
  };
}


/**
 * Ex-dividend rows for a tab. Live Firestore data is authoritative; the mock
 * array is only used when no live data exists at all, so a demo still renders.
 */
function exDivFor(tab: DivTabKey, live: DividendDoc[], now: Date): DivStock[] {
  if (live.length > 0) {
    const r = rangeFor(tab as RangeTabKey, now);
    return live
      .filter(d => d.exDividendDate && inRange(d.exDividendDate, r))
      .sort((a, b) => a.exDividendDate.localeCompare(b.exDividendDate) || a.ticker.localeCompare(b.ticker))
      .map(toDivStock);
  }
  return [];
}

/** Pay-date rows, same rules. Only the single-day tabs show a pay-date block. */
function payDivFor(tab: DivTabKey, live: DividendDoc[], now: Date): DivStock[] {
  if (tab !== "today" && tab !== "yest" && tab !== "tom") return [];
  if (live.length > 0) {
    const r = rangeFor(tab as RangeTabKey, now);
    return live
      .filter(d => d.paymentDate && inRange(d.paymentDate, r))
      .sort((a, b) => a.ticker.localeCompare(b.ticker))
      .map(toDivStock);
  }
  return [];
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

// ── Dividend logo chip ────────────────────────────────────────────────────────
function DivChip({ d, selected, onSelect }: { d: DivStock; selected: boolean; onSelect: (s: DivStock) => void }) {
  return (
    <button className={`ec-chip${selected ? " on" : ""}`} onClick={() => onSelect(d)}
      title={`${d.name} · ex-div ${d.exDate} · $${d.amount.toFixed(2)}/qtr · ${d.yld != null && d.yld > 0 ? d.yld.toFixed(2) + "% yield" : "yield n/a"}`}>
      <span className="ec-logo" style={{ background: "#27314a", color: "#cdd6e6" }}>
        {d.sym[0]}
        <img
          src={`https://assets.parqet.com/logos/symbol/${d.sym}?format=png`}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          alt=""
        />
      </span>
      {d.sym}
    </button>
  );
}

// ── Month calendar helper ─────────────────────────────────────────────────────
const MONTHS_LBL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOWS       = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function divMonthCal(year: number, month1: number, liveStocks: DivStock[]) {
  const first = new Date(year, month1 - 1, 1).getDay();
  const days  = new Date(year, month1, 0).getDate();
  const map: Record<number, DivStock[]> = {};
  for (let d = 1; d <= days; d++) {
    map[d] = liveStocks.filter(s => s.exMonth === month1 && s.exDay === d);
  }
  return { first, days, map };
}

// ── Main screen ──────────────────────────────────────────────────────────────
export function MacroScreen() {
  const { data: macroLive, loading: macroLoading } = useApiList<MacroEventDoc>("/market-data/macro-events");

  const { data: liveDividends, loading: liveDividendsLoading } = useApiList<DividendDoc>("/market-data/dividends");
  const { data: companies, loading: companiesLoading } = useApiList<CompanyDoc>("/market-data/companies");
  const { data: mktStatus } = useApiResource<MarketStatusPayload>("/live/market-status");
  // Polygon /v1/marketstatus/upcoming — dedupe the per-exchange rows (NYSE +
  // NASDAQ list the same holiday) by date+name; show the next handful.
  const upcomingHolidays = (() => {
    const seen = new Set<string>();
    const out: MarketStatusPayload["upcoming"] = [];
    for (const h of mktStatus?.upcoming ?? []) {
      const key = h.date + h.name;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(h);
    }
    return out.slice(0, 6);
  })();
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
  const liveDividendsSorted = [...liveDividends].sort((a, b) => a.exDividendDate.localeCompare(b.exDividendDate));

  const [ecoTab,    setEcoTab]    = useState(2);
  const ecoRows = ecoRowsFor(ecoTab, macroLive, now);
  const [divTab,    setDivTab]    = useState<DivTabKey>("week");
  const [monthOff,  setMonthOff]  = useState(0);
  const [selStock,  setSelStock]  = useState<DivStock | null>(null);
  const [calDay,    setCalDay]    = useState<number | null>(null);
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

  // ── Dividend calendar rendering ──────────────────────────────────────────
  const isDivDay   = divTab === "today" || divTab === "yest" || divTab === "tom";
  const isDivWeek  = divTab === "week"  || divTab === "prev" || divTab === "next";
  const isDivLMon  = divTab === "lmonth";
  const isDivMonth = divTab === "month";

  const dayLabel: Record<string, string> = { today: "today · Jun 25", yest: "yesterday · Jun 24", tom: "tomorrow · Jun 26" };

  let divCalNode: React.ReactNode = null;

  if (isDivDay) {
    const exStocks  = exDivFor(divTab, liveDividends, now);
    const payStocks = payDivFor(divTab, liveDividends, now);
    divCalNode = (
      <div className="card">
        <div className="card-h">
          <h3>Dividend dates · {dayLabel[divTab]} · {exStocks.length + payStocks.length} events</h3>
          <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>tap a logo for 10-yr history</span>
        </div>
        <div className="card-b" style={{ paddingTop: 10 }}>
          <div className="ec-lbl">Ex-dividend date</div>
          <div style={{ marginBottom: 14 }}>
            {exStocks.length
              ? exStocks.map(d => <DivChip key={d.sym} d={d} selected={selStock?.sym === d.sym} onSelect={setSelStock} />)
              : <span className="ec-none">None</span>}
          </div>
          <div className="ec-lbl">Pay date</div>
          <div>
            {payStocks.length
              ? payStocks.map(d => <DivChip key={d.sym} d={d} selected={selStock?.sym === d.sym} onSelect={setSelStock} />)
              : <span className="ec-none">None</span>}
          </div>
        </div>
      </div>
    );
  } else if (isDivWeek) {
    const weekLabel: Record<string, string> = { week: "This Week · Jun 22–26", prev: "Last Week · Jun 15–19", next: "Next Week · Jun 29–Jul 3" };
    const isCurrentWeek = divTab === "week";
    const todayWeekDay  = 3; // Thursday Jun 25

    divCalNode = (
      <div className="card">
        <div className="card-h">
          <h3>Dividend ex-dates · {weekLabel[divTab]}</h3>
          <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>tap a logo for 10-yr history</span>
        </div>
        <div className="card-b" style={{ paddingTop: 12 }}>
          <div className="ec-grid">
            {["Mon", "Tue", "Wed", "Thu", "Fri"].map((dn, di) => {
              const dayStocks = exDivFor(divTab, liveDividends, now).filter(s => s.weekDay === di);
              const isToday   = isCurrentWeek && di === todayWeekDay;
              return (
                <div key={dn} className={`ec-day${isToday ? " is-today" : ""}`}>
                  <div className="ec-dh">{dn}{isToday ? " · Today" : ""}</div>
                  <div className="ec-sess">
                    <div className="ec-lbl">Ex-div</div>
                    {dayStocks.length
                      ? dayStocks.map(d => <DivChip key={d.sym} d={d} selected={selStock?.sym === d.sym} onSelect={setSelStock} />)
                      : <span className="ec-none">—</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  } else if (isDivLMon) {
    const stocks = exDivFor("lmonth", liveDividends, now);
    // A null yield means "vendor did not supply it", which is NOT the same as a
    // low yield — bucketing those as growth payers would invent a claim.
    const high   = stocks.filter(s => s.yld != null && s.yld >= 2.5);
    const growth = stocks.filter(s => s.yld != null && s.yld < 2.5);
    divCalNode = (
      <div className="card">
        <div className="card-h">
          <h3>Last Month · May 2026 · dividend recap</h3>
          <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>tap a logo for 10-yr history</span>
        </div>
        <div className="card-b" style={{ paddingTop: 10 }}>
          <div className="ec-lbl">High yield (&ge;2.5%)</div>
          <div style={{ marginBottom: 12 }}>
            {high.length
              ? high.map(d => <DivChip key={d.sym} d={d} selected={selStock?.sym === d.sym} onSelect={setSelStock} />)
              : <span className="ec-none">None</span>}
          </div>
          <div className="ec-lbl">Growth payers (&lt;2.5%)</div>
          <div>
            {growth.length
              ? growth.map(d => <DivChip key={d.sym} d={d} selected={selStock?.sym === d.sym} onSelect={setSelStock} />)
              : <span className="ec-none">None</span>}
          </div>
        </div>
      </div>
    );
  } else if (isDivMonth) {
    const base  = new Date(now.getFullYear(), now.getMonth() + monthOff, 1);
    const year  = base.getFullYear();
    const mon1  = base.getMonth() + 1;
    const cal   = divMonthCal(year, mon1, liveDividendsSorted.map(toDivStock));
    const todayMark = monthOff === 0 ? now.getDate() : -1;
    const dayList = calDay ? (cal.map[calDay] ?? []) : [];

    divCalNode = (
      <>
        <div className="ecm-wrap">
          <div className="ecm-monthbar">
            <button className="ecm-nav" onClick={() => { setMonthOff(o => o - 1); setCalDay(null); }}>←</button>
            <div className="ecm-month">{MONTHS_LBL[mon1 - 1]} {year} · dividend ex-dates</div>
            <button className="ecm-nav" onClick={() => { setMonthOff(o => o + 1); setCalDay(null); }}>→</button>
          </div>
          <div className="ecm-head">
            {DOWS.map(d => <div key={d}>{d}</div>)}
          </div>
          <div className="ecm-grid">
            {Array.from({ length: cal.first }, (_, i) => (
              <div key={`e${i}`} className="ecm-cell ecm-empty" />
            ))}
            {Array.from({ length: cal.days }, (_, i) => {
              const d    = i + 1;
              const lst  = cal.map[d] ?? [];
              const isT  = d === todayMark;
              const isSel = d === calDay;
              return (
                <div key={d}
                  className={`ecm-cell${lst.length > 0 ? " has" : ""}${isT ? " is-today" : ""}${isSel ? " sel" : ""}`}
                  onClick={lst.length > 0 ? () => { setCalDay(d); if (lst[0]) setSelStock(lst[0]); } : undefined}>
                  <div className="ecm-d">
                    {d}
                    {isT && <span className="ecm-t">Today</span>}
                  </div>
                  {lst.length > 0 && (
                    <>
                      <div className="ecm-logos">
                        {lst.slice(0, 3).map(s => (
                          <span key={s.sym} className="ecm-logo" style={{ background: "#27314a", color: "#cdd6e6" }}>
                            {s.sym[0]}
                            <img
                              src={`https://assets.parqet.com/logos/symbol/${s.sym}?format=png`}
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                              alt=""
                            />
                          </span>
                        ))}
                        {lst.length > 3 && <span className="ecm-more">+{lst.length - 3}</span>}
                      </div>
                      <div className="ecm-n">{lst.length} ex-div</div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {calDay && dayList.length > 0 && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <h3>{MONTHS_LBL[mon1 - 1]} {calDay}, {year} · {dayList.length} ex-dividend</h3>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>tap a logo for 10-yr history</span>
            </div>
            <div className="card-b" style={{ paddingTop: 10, display: "flex", flexWrap: "wrap" }}>
              {dayList.map(d => <DivChip key={d.sym} d={d} selected={selStock?.sym === d.sym} onSelect={setSelStock} />)}
            </div>
          </div>
        )}

        {calDay && dayList.length === 0 && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-b" style={{ color: "var(--text-dim-solid)" }}>No dividend ex-dates on this day.</div>
          </div>
        )}

        {!calDay && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-b" style={{ color: "var(--text-dim-solid)" }}>Click a date with ex-dividends to see the companies.</div>
          </div>
        )}
      </>
    );
  }


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
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", fontSize: ".62rem" }}>live · Polygon</span>
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
              <h3>VIXY</h3>
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
                  <div className="note" style={{ marginTop: 8 }}>
                    VIXY is a decaying futures ETN tracking VIX futures, not the spot VIX index — directionally indicative, not a 1:1 level.
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
            <div className="tbl-wrap" style={{ flex: 1 }}>
              {ecoRows.length === 0 ? (
                <div style={{ padding: 16 }}><DataState loading={macroLoading} label="No live macro events for this window yet." /></div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Event</th><th>Date</th><th>Impact</th>
                      <th className="num">Prior</th><th className="num">Actual</th><th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ecoRows.map(e => (
                      <tr key={e.ev + e.date}>
                        <td>
                          <b style={{ color: "var(--text-hi)" }}>{e.ev}</b>
                          {e.tier === "High" && <span style={{ color: "var(--warn)", fontSize: ".6rem", marginLeft: 5 }}>●</span>}
                        </td>
                        <td>
                          <div>{e.date}</div>
                          <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)" }}>{e.day}</div>
                        </td>
                        <td>
                          <span className={`pill ${e.tier === "High" ? "dn" : e.tier === "Med" ? "amc" : ""}`}
                            style={e.tier === "Low" ? { background: "var(--surface-3)", color: "var(--text-dim-solid)" } : undefined}>
                            {e.tier}
                          </span>
                        </td>
                        <td className="num">{e.prev}</td>
                        <td className="num"><b>{e.actual}</b></td>
                        <td style={{ fontSize: ".76rem", color: "var(--text-dim-solid)", maxWidth: 140 }}>{e.note || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Dividend calendar (Polygon-primary, FMP fallback) ── */}
      <div style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-h">
            <h3>Dividend Calendar</h3>
            <span className="pill ai" style={{ fontSize: ".68rem" }}>live · Polygon</span>
          </div>
          <div className="tbl-wrap">
            {liveDividendsSorted.length === 0 ? (
              <div style={{ padding: 16 }}><DataState loading={liveDividendsLoading} label="No live dividend calendar data synced yet." /></div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Ticker</th><th>Ex-div date</th><th>Pay date</th>
                    <th className="num">Amount</th><th className="num">Yield</th><th>Frequency</th>
                  </tr>
                </thead>
                <tbody>
                  {liveDividendsSorted.slice(0, 30).map(d => (
                    <tr key={d.id} style={{ cursor: "pointer" }} onClick={() => setSelStock(toDivStock(d))}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <StockLogo sym={d.ticker} size={20} />
                          <b style={{ color: "var(--text-hi)", fontFamily: "var(--f-mono)" }}>{d.ticker}</b>
                        </div>
                      </td>
                      <td>{d.exDividendDate}</td>
                      <td>{d.paymentDate ?? "—"}</td>
                      <td className="num">${d.dividendAmount.toFixed(2)}</td>
                      <td className="num">{d.yieldPct != null ? <span className="up">{d.yieldPct.toFixed(2)}%</span> : "—"}</td>
                      <td>{d.frequency ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>


      {/* ── High-beta Stocks ── */}
      <div style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-h">
            <h3>High-beta Stocks</h3>
            <span style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>Highest real beta · hover for details · click for dividend history</span>
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
    </>
  );
}
