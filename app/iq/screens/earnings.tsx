"use client";

import { useState } from "react";
import { useIQActions, ExpandBtn } from "../shell";
import { cls, sign, EarnQ, StockLogo, NotAvailable, DataState } from "../utils";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import type { LiveEarningsDoc, CompanyDoc, FinancialsDoc, QuarterFinancials } from "../types";
import { isoDay, addDays, mondayOf } from "../calendar-range";

// Live source (Polygon SEC financials) has ticker/date/epsEstimate/epsActual —
// no session (BMO/AMC), guidance, price reaction, implied move, or quarterly
// financials. The selected-company detail card below only ever shows real
// numbers (EPS estimate/actual from this feed, financials from GET
// /live/financials) — fields with no live source render as NotAvailable/
// DataState instead of the illustrative mock this file used to blend in.

// ── Types ────────────────────────────────────────────────────────────────────

interface IncRow  { c: string; rev: number; cogs: number; gp: number; opex: number; oi: number; ni: number; eps: number; }

/**
 * Real quarterly/annual financials (GET /live/financials) mapped onto the
 * IncRow shape the existing chart/table render — mirrors stock.tsx's
 * incRowsFromFinancials so the two screens never show different numbers.
 */
function incRowsFromFinancials(doc: FinancialsDoc | null): IncRow[] {
  const rows = doc ? doc.quarters : [];
  if (rows.length === 0) return [];
  return rows.slice(0, 10).map(r => {
    const revenue = r.revenue ?? 0;
    const grossProfit = r.grossProfit ?? 0;
    const operatingIncome = r.operatingIncome ?? 0;
    const netIncome = r.netIncome ?? 0;
    const opex = (r as QuarterFinancials).operatingExpenses ?? Math.max(0, grossProfit - operatingIncome);
    const label = `${r.fiscalPeriod ?? "?"} '${(r.fiscalYear ?? "").slice(-2)}`;
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

// ── Earnings calendar row shape ─────────────────────────────────────────────

interface EarnCalItem {
  s: string; n: string; sec: string;
  // Live earnings_events has no session/guidance/reaction/implied-move data, so
  // these are nullable. Rendering a default would fabricate a claim.
  sess: "BMO" | "AMC" | null;
  month: number; day: number;
  weekDay: number; // 0=Mon … 4=Fri
  epsE: number | null; epsA: number | null; implied: number | null;
  revE: number | null; revA: number | null; // reported revenue (Polygon actuals)
  guide: "Raised" | "In-line" | "Lowered" | null;
  react: number | null;
}

/** Live earnings_events doc -> the row shape this calendar renders. */
function toEarnCalItem(d: LiveEarningsDoc): EarnCalItem {
  const [, m, day] = d.date.split("-").map(Number);
  const dt = new Date(d.date + "T00:00:00Z");
  return {
    s: d.ticker,
    n: d.companyName ?? d.ticker,
    sec: "—",
    sess: d.session ?? null,  // "BMO"/"AMC" when the vendor supplies a time, else null
    month: m, day,
    weekDay: (dt.getUTCDay() + 6) % 7,
    epsE: d.epsEstimate,
    epsA: d.epsActual,
    implied: null,
    revE: d.revenueEstimate ?? null,
    revA: d.revenueActual ?? null,
    guide: null,
    react: null,
  };
}

/**
 * Live-only: a row exists here only if a real `earnings_events` doc exists for
 * this date. There is no static/illustrative catalog — every row, and the
 * ticker-history detail card, come from Polygon (earnings_events + the
 * per-ticker /live/financials call).
 */
function rowsForDate(iso: string, live: LiveEarningsDoc[]): EarnCalItem[] {
  return live.filter(d => d.date === iso).map(toEarnCalItem);
}

// ── Calendar toolbar: row shape ───────────────────────────────────────────
//
// The live earnings_events doc (Polygon reported financials) carries
// ticker/companyName/date/epsActual/revenueActual — no estimates, session,
// guidance or reaction. Those fields render as NotAvailable rather than being
// filled with fabricated numbers — a row shows only data it genuinely has.

interface CalRow {
  s: string; n: string; sess: "BMO" | "AMC" | null;
  epsE: number | null; epsA: number | null; epsSurp: number | null;
  revE: number | null; revA: number | null; revSurp: number | null;
}

/** Guarded on a near-zero estimate: dividing by ~$0 EPS yields a nonsense ±Infinity%. */
function surprise(est: number | null, act: number | null): number | null {
  if (est == null || act == null || Math.abs(est) < 0.005) return null;
  return ((act - est) / Math.abs(est)) * 100;
}

function fmtPctSigned(v: number | null, digits = 0): string {
  return v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}
function fmtUpDn(v: number | null): string {
  return v == null ? "" : v >= 0 ? "up" : "dn";
}
/** Raw-dollar revenue → $B / $M. */
function fmtRev(v: number | null): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

function toCalRow(item: EarnCalItem): CalRow {
  return {
    s: item.s, n: item.n, sess: item.sess,
    epsE: item.epsE, epsA: item.epsA,
    epsSurp: surprise(item.epsE, item.epsA),
    revE: item.revE, revA: item.revA,
    revSurp: surprise(item.revE, item.revA),
  };
}

type SortKey = "symbol" | "surprise";
type SessionKey = "both" | "BMO" | "AMC";

function filterSortRows(rows: CalRow[], opts: { sort: SortKey; session: SessionKey }): CalRow[] {
  const out = rows.filter(r => opts.session === "both" || r.sess === opts.session);
  out.sort((a, b) => {
    if (opts.sort === "surprise") return (b.epsSurp ?? -Infinity) - (a.epsSurp ?? -Infinity);
    return a.s.localeCompare(b.s);
  });
  return out;
}

/** Month-grid date picker opened by clicking the header date label. */
function MiniCalendar({ value, onPick, onClose }: { value: string; onPick: (iso: string) => void; onClose: () => void }) {
  const [month, setMonth] = useState<string>(() => value.slice(0, 7));
  const first = new Date(`${month}-01T00:00:00Z`);
  const y = first.getUTCFullYear(), m = first.getUTCMonth();
  const firstDow = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const monthLabel = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const today = isoDay(new Date());

  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);

  const stepMonth = (dir: 1 | -1) => {
    const nm = new Date(Date.UTC(y, m + dir, 1));
    setMonth(`${nm.getUTCFullYear()}-${String(nm.getUTCMonth() + 1).padStart(2, "0")}`);
  };

  const cell: React.CSSProperties = {
    aspectRatio: "1 / 1", display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: 6, fontSize: ".78rem", cursor: "pointer", border: "1px solid transparent",
    fontFamily: "var(--f-mono)",
  };

  return (
    <>
      <div className="ecal-away" onClick={onClose} />
      <div style={{
        position: "absolute", top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
        zIndex: 41, width: 252, padding: 10,
        background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 10,
        boxShadow: "0 10px 30px rgba(0,0,0,.4)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <button className="ecal-arrow" onClick={() => stepMonth(-1)} aria-label="Previous month">‹</button>
          <div style={{ fontSize: ".82rem", fontWeight: 700, color: "var(--text-hi)" }}>{monthLabel}</div>
          <button className="ecal-arrow" onClick={() => stepMonth(1)} aria-label="Next month">›</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 4 }}>
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => (
            <div key={d} style={{ textAlign: "center", fontSize: ".62rem", color: "var(--text-dim-solid)", fontWeight: 600 }}>{d}</div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
          {cells.map((iso, i) => {
            if (!iso) return <div key={`b${i}`} />;
            const isSel = iso === value;
            const isToday = iso === today;
            const day = Number(iso.slice(8));
            return (
              <div key={iso} onClick={() => { onPick(iso); onClose(); }}
                style={{
                  ...cell,
                  background: isSel ? "var(--brand-2)" : "transparent",
                  color: isSel ? "#0a0e14" : "var(--text-hi)",
                  fontWeight: isSel ? 700 : 500,
                  borderColor: !isSel && isToday ? "var(--brand-2)" : "transparent",
                }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = "var(--surface-3)"; }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
              >
                {day}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ── SVG Charts ───────────────────────────────────────────────────────────────

// No live source exists for post-earnings stock-move %, so unlike the old
// mock version this only draws the two numbers the live earnings feed
// actually has (EPS estimate vs. actual) — no fabricated move line/dots.
function EpsChart({ hist }: { hist: EarnQ[] }) {
  const d = [...hist].reverse();
  const W = 580, H = 210, PADL = 30, PADR = 18, PADT = 14, PADB = 30;
  const iw = W - PADL - PADR, ih = H - PADT - PADB;
  const allVals = d.flatMap(x => [x.e, x.a]);
  const maxE = Math.max(...allVals) * 1.15 || 1;
  const n = d.length, gw = iw / n, bw = gw * 0.28;

  const bars: React.ReactElement[] = [];
  const labels: React.ReactElement[] = [];

  d.forEach((x, i) => {
    const cx = PADL + gw * i + gw / 2;
    const eh = x.e / maxE * ih, ah = x.a / maxE * ih;
    const ex = cx - bw - 2, ax = cx + 2;
    bars.push(
      <rect key={`e${i}`} x={ex} y={PADT + ih - eh} width={bw} height={eh} rx={2} style={{ fill: "var(--surface-3)" }} />,
      <rect key={`a${i}`} x={ax} y={PADT + ih - ah} width={bw} height={ah} rx={2}
        style={{ fill: x.surp > 0 ? "var(--up)" : x.surp < 0 ? "var(--down)" : "var(--brand-2)" }} />,
    );
    if (i % 2 === 0 || i === n - 1) {
      labels.push(
        <text key={`l${i}`} x={cx} y={H - 10} textAnchor="middle"
          style={{ fill: "var(--text-dim-solid)", fontSize: "0.5625rem" }}>
          {x.q.replace(" ", "'")}
        </text>
      );
    }
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }}>
      <line x1={PADL} y1={PADT + ih / 2} x2={W - PADR} y2={PADT + ih / 2}
        style={{ stroke: "var(--border)" }} strokeDasharray="3 3" />
      {bars}
      {labels}
    </svg>
  );
}

function IncChart({ inc }: { inc: IncRow[] }) {
  const d = [...inc].reverse();
  const W = 580, H = 200, PADL = 8, PADR = 8, PADT = 14, PADB = 26;
  const iw = W - PADL - PADR, ih = H - PADT - PADB;
  const max = Math.max(...d.map(x => x.rev)) * 1.12 || 1;
  const n = d.length, gw = iw / n, bw = gw * 0.18;

  type IncKey = "rev" | "gp" | "ni";
  const series: [IncKey, string][] = [
    ["rev", "var(--brand)"],
    ["gp",  "var(--ai)"],
    ["ni",  "var(--up)"],
  ];

  const bars: React.ReactElement[] = [];
  const labels: React.ReactElement[] = [];

  d.forEach((x, i) => {
    const gx = PADL + gw * i;
    series.forEach(([key, color], si) => {
      const v = x[key];
      const h = v / max * ih;
      const bx = gx + gw * 0.1 + si * (bw + 3);
      bars.push(
        <rect key={`${i}${si}`} x={bx} y={PADT + ih - h} width={bw} height={h} rx={2}
          style={{ fill: color }} />
      );
    });
    labels.push(
      <text key={`l${i}`} x={gx + gw / 2} y={H - 8} textAnchor="middle"
        style={{ fill: "var(--text-dim-solid)", fontSize: "0.5625rem" }}>
        {x.c.replace(" ", "'")}
      </text>
    );
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }}>
      {bars}{labels}
    </svg>
  );
}

// ── Company logo chip ─────────────────────────────────────────────────────────

function EcChip({ sym, selected, onSelect }: { sym: string; selected: boolean; onSelect: (s: string) => void }) {
  return (
    <button className={`ec-chip${selected ? " on" : ""}`} onClick={() => onSelect(sym)}>
      <span className="ec-logo" style={{ background: "#27314a", color: "#cdd6e6" }}>
        {sym[0]}
        <img
          src={`https://assets.parqet.com/logos/symbol/${sym}?format=png`}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          alt=""
        />
      </span>
      {sym}
    </button>
  );
}

// ── Earnings call drawer ──────────────────────────────────────────────────
// No live vendor for call audio/transcripts/AI summaries is wired up — the
// drawer stays reachable from the "Earnings call" button, but says so rather
// than showing fabricated call summaries and invented transcript dialogue.

function CallDrawer({ sym, onClose }: { sym: string; onClose: () => void }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="side-drawer">
        <div className="drawer-h">
          <StockLogo sym={sym} size={38} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)" }}>
              {sym} · Earnings call
            </div>
          </div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-b">
          <DataState label="Earnings-call audio, AI summaries, and transcripts aren't connected to a live vendor yet." />
        </div>
      </div>
    </>
  );
}

// ── Day-view table (Before Open / After Close) ────────────────────────────────

type CalView = "eps" | "sales";

function CalTable({
  title, rows, sel, onSelect, view,
}: { title: string; rows: CalRow[]; sel: string; onSelect: (s: string) => void; view: CalView }) {
  if (rows.length === 0) return null;
  return (
    <div className="ecal-day" style={{ marginBottom: 12 }}>
      <div className="ecal-day-h">
        <span className="ecal-day-t">{title}</span>
        <span className="ecal-day-n">{rows.length}</span>
      </div>
      <div className="ecal-tablewrap">
        <table className="ecal-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="r">{view === "eps" ? "Est EPS" : "Est Sales"}</th>
              <th className="r">{view === "eps" ? "EPS" : "Sales"}</th>
              <th className="r">{view === "eps" ? "EPS Surp" : "Sales Surp"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.s} className={sel === r.s ? "on" : ""} onClick={() => onSelect(r.s)}>
                <td>
                  <div className="ecal-symcell">
                    <StockLogo sym={r.s} size={22} />
                    <div>
                      <div className="ecal-sym">{r.s}</div>
                      {r.n !== r.s && <div className="ecal-name">{r.n}</div>}
                    </div>
                  </div>
                </td>
                {view === "eps" ? (
                  <>
                    <td className="r ecal-num">{r.epsE != null ? `$${r.epsE.toFixed(2)}` : "—"}</td>
                    <td className="r ecal-num">{r.epsA != null ? `$${r.epsA.toFixed(2)}` : "—"}</td>
                    <td className={`r ecal-num ${fmtUpDn(r.epsSurp)}`}>{fmtPctSigned(r.epsSurp)}</td>
                  </>
                ) : (
                  <>
                    <td className="r ecal-num">{fmtRev(r.revE)}</td>
                    <td className="r ecal-num">{fmtRev(r.revA)}</td>
                    <td className={`r ecal-num ${fmtUpDn(r.revSurp)}`}>{fmtPctSigned(r.revSurp)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export function EarningsScreen() {
  const { openStockFull } = useIQActions();
  const { data: liveEarnings, loading: earningsLoading } = useApiList<LiveEarningsDoc>("/market-data/earnings");
  const liveEarningsData = liveEarnings;

  const [mode, setMode]     = useState<"day" | "week" | "month">("day");
  const [anchor, setAnchor] = useState<string>(() => isoDay(new Date()));
  // The filter bar (session / cap / sort / min-move / view / news / auto-refresh)
  // was removed — the live earnings feed has no data to drive those — so these
  // stay at fixed defaults.
  const session: SessionKey = "both";
  const sort: SortKey = "symbol";
  const view: CalView = "eps";
  const [pickerOpen, setPickerOpen]   = useState(false);

  // No company is selected by default — the detail panels appear only after the
  // user clicks a reporting company in the calendar.
  const [sel, setSel]           = useState<string>("");
  const { data: liveCompanySel } = useApiResource<CompanyDoc>(sel ? `/live/company?ticker=${encodeURIComponent(sel)}` : null);
  const { data: financialsDoc, loading: financialsLoading } = useApiResource<FinancialsDoc>(sel ? `/live/financials?ticker=${encodeURIComponent(sel)}` : null);
  const [selectedCall,   setSelectedCall]   = useState<string | null>(null);
  const [aiModalSym,      setAiModalSym]      = useState<string | null>(null);

  const weekMon   = mondayOf(new Date(`${anchor}T00:00:00Z`));
  const weekDays5 = [0, 1, 2, 3, 4].map(i => isoDay(addDays(weekMon, i)));

  const filterOpts = { sort };
  const dayRows   = rowsForDate(anchor, liveEarningsData).map(toCalRow);
  const bmoRows   = filterSortRows(dayRows, { ...filterOpts, session: "BMO" });
  const amcRows   = filterSortRows(dayRows, { ...filterOpts, session: "AMC" });
  // Rows the vendor didn't tag with a reporting time — shown under "Time TBD"
  // so no reporting company is hidden just because it lacks a session tag.
  const tbdRows   = filterSortRows(dayRows.filter(r => r.sess === null), { ...filterOpts, session: "both" });
  const visibleRows = session === "both" ? [...bmoRows, ...amcRows, ...tbdRows] : session === "BMO" ? bmoRows : amcRows;

  const anchorDate = new Date(`${anchor}T00:00:00Z`);
  const DOW3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateLabel = `${DOW3[anchorDate.getUTCDay()]}, ${MON3[anchorDate.getUTCMonth()]} ${anchorDate.getUTCDate()}, ${anchorDate.getUTCFullYear()}`;
  const monthLabel = `${anchorDate.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}`;
  const headerLabel = mode === "month" ? monthLabel : dateLabel;

  /** Navigate to a date and, like the old per-tab navigation, select its first
   *  reporting ticker — computed directly here rather than via an effect, so
   *  the update lands in the same render as the click instead of cascading. */
  function goToDate(iso: string) {
    setAnchor(iso);
    const first = rowsForDate(iso, liveEarningsData)[0];
    if (first) setSel(first.s);
  }
  const step = (dir: 1 | -1) => {
    if (mode === "month") {
      goToDate(isoDay(new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth() + dir, 1))));
    } else {
      goToDate(isoDay(addDays(anchorDate, mode === "day" ? dir : dir * 7)));
    }
  };


  // ── Calendar rendering ────────────────────────────────────────────────────

  let calNode: React.ReactNode;

  if (mode === "day") {
    calNode = (
      <>
        {(session === "both" || session === "BMO") && <CalTable title="Before Open" rows={bmoRows} sel={sel} onSelect={setSel} view={view} />}
        {(session === "both" || session === "AMC") && <CalTable title="After Close" rows={amcRows} sel={sel} onSelect={setSel} view={view} />}
        {session === "both" && <CalTable title="Time TBD" rows={tbdRows} sel={sel} onSelect={setSel} view={view} />}
        {visibleRows.length === 0 && (
          <div className="ecal-empty">
            <div className="ecal-empty-h">No companies reporting</div>
            <div>
              Nothing scheduled for {dateLabel}
              {session !== "both" ? ` (${session === "BMO" ? "before open" : "after close"})` : ""} in the synced calendar.
            </div>
          </div>
        )}
      </>
    );
  } else if (mode === "week") {
    calNode = (
      <div className="ec-grid">
        {weekDays5.map((iso, di) => {
          const items = rowsForDate(iso, liveEarningsData).map(toCalRow);
          const bmo = filterSortRows(items, { ...filterOpts, session: "BMO" });
          const amc = filterSortRows(items, { ...filterOpts, session: "AMC" });
          const tbd = filterSortRows(items.filter(r => r.sess === null), { ...filterOpts, session: "both" });
          const dn = ["Mon", "Tue", "Wed", "Thu", "Fri"][di];
          const isToday = iso === isoDay(new Date());
          return (
            <div key={iso} className={`ec-day${isToday ? " is-today" : ""}${iso === anchor && !isToday ? " is-sel" : ""}`}>
              <div className="ec-dh" style={{ cursor: "pointer" }} onClick={() => { goToDate(iso); setMode("day"); }}>
                {dn} {Number(iso.slice(8))}{isToday ? " · Today" : ""}
              </div>
              {(session === "both" || session === "BMO") && (
                <div className="ec-sess">
                  <div className="ec-lbl">Before open</div>
                  {bmo.length ? bmo.map(r => <EcChip key={r.s} sym={r.s} selected={sel === r.s} onSelect={setSel} />) : <span className="ec-none">—</span>}
                </div>
              )}
              {(session === "both" || session === "AMC") && (
                <div className="ec-sess">
                  <div className="ec-lbl">After close</div>
                  {amc.length ? amc.map(r => <EcChip key={r.s} sym={r.s} selected={sel === r.s} onSelect={setSel} />) : <span className="ec-none">—</span>}
                </div>
              )}
              {session === "both" && tbd.length > 0 && (
                <div className="ec-sess">
                  <div className="ec-lbl">Time TBD</div>
                  {tbd.map(r => <EcChip key={r.s} sym={r.s} selected={sel === r.s} onSelect={setSel} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  } else {
    // ── Month grid ────────────────────────────────────────────────────────────
    // Full weekday calendar (Mon–Fri), every reporting company shown as a logo,
    // matching the reference Earnings-Hub layout. Session (BMO/AMC) isn't in the
    // vendor feed, so month cells show all companies for the day regardless of
    // the Before/After chip.
    const mFirst = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth(), 1));
    const mLast  = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth() + 1, 0));
    const leadOffset = (mFirst.getUTCDay() + 6) % 7; // 0 = Monday
    const gridStart  = addDays(mFirst, -leadOffset); // Monday of the first week
    const weeks = Math.ceil((leadOffset + mLast.getUTCDate()) / 7);
    const monthKey = isoDay(mFirst).slice(0, 7);
    const todayIso = isoDay(new Date());
    const MAX_LOGOS = 24;
    const cells: string[] = [];
    for (let wk = 0; wk < weeks; wk++) for (let d = 0; d < 5; d++) cells.push(isoDay(addDays(gridStart, wk * 7 + d)));
    calNode = (
      <>
        <div className="emc-head">
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => <div key={d} className="emc-hcell">{d}</div>)}
        </div>
        <div className="emc-grid">
          {cells.map(iso => {
            if (iso.slice(0, 7) !== monthKey) return <div key={iso} className="emc-day is-out" />;
            const items = filterSortRows(rowsForDate(iso, liveEarningsData).map(toCalRow), { sort, session: "both" });
            const isToday = iso === todayIso;
            const isSel   = iso === anchor && !isToday;
            const shown   = items.slice(0, MAX_LOGOS);
            const extra   = items.length - shown.length;
            return (
              <div key={iso} className={`emc-day${isToday ? " is-today" : ""}${isSel ? " is-sel" : ""}`}>
                <div className="emc-dh" onClick={() => { goToDate(iso); setMode("day"); }} title="Open day view">
                  {Number(iso.slice(8))}{isToday ? <span className="t">Today</span> : null}
                </div>
                {items.length === 0 ? (
                  <div className="emc-none">No earnings</div>
                ) : (
                  <div className="emc-logos">
                    {shown.map(r => (
                      <button key={r.s} className={`emc-logo${sel === r.s ? " on" : ""}`} title={r.s} onClick={() => setSel(r.s)}>
                        <StockLogo sym={r.s} size={20} />
                      </button>
                    ))}
                    {extra > 0 && (
                      <button className="emc-more" title={`${extra} more — open day view`} onClick={() => { goToDate(iso); setMode("day"); }}>+{extra}</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  // ── Detail section ────────────────────────────────────────────────────────

  const liveMatches = liveEarnings.filter(e => e.ticker === sel).sort((a, b) => b.date.localeCompare(a.date));
  const liveMatch = liveMatches[0];
  const hasLiveEps = !!liveMatch && (liveMatch.epsEstimate != null || liveMatch.epsActual != null);

  // 10-quarter EPS history comes from the per-ticker Polygon financials
  // (GET /live/financials — 10 reported quarters), not the market-wide calendar
  // feed, which only holds ~1–2 filings per ticker inside its date window.
  // Polygon reports actuals only, so estimates/beat-miss are absent.
  const histQuarters = (financialsDoc?.quarters ?? [])
    .filter(q => q.epsActual != null)
    .slice()
    .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""))
    .slice(0, 10);
  const hasEstimates = histQuarters.some(q => q.epsEstimate != null);
  const hist: EarnQ[] = histQuarters.map(q => {
    const act = q.epsActual as number;
    const est = q.epsEstimate;
    const surp = est != null && est !== 0 ? ((act - est) / Math.abs(est)) * 100 : 0;
    const label = q.endDate
      ? new Date(q.endDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" })
      : `${q.fiscalPeriod ?? ""} ${q.fiscalYear ?? ""}`.trim();
    return { q: label, e: est ?? 0, a: act, surp: parseFloat(surp.toFixed(1)), mv: 0 };
  });
  const beats = hist.filter(h => h.surp >= 0).length;

  const inc = incRowsFromFinancials(financialsDoc);

  const fmtB = (v: number) => v >= 1 ? `$${v.toFixed(2)}B` : `$${(v * 1000).toFixed(0)}M`;

  const aiRead = liveMatch
    ? `${sel} ${liveMatch.epsActual != null
        ? liveMatch.epsEstimate != null
          ? `${liveMatch.epsActual >= liveMatch.epsEstimate ? "beat" : "missed"} EPS estimates`
          : `reported EPS of $${liveMatch.epsActual.toFixed(2)} (filed ${liveMatch.date})`
        : `reports on ${liveMatch.date}`
      }.${hist.length > 0 && hasEstimates ? ` ${beats}/${hist.length} historical EPS beats.` : ""}`
    : `${sel}: no reported earnings synced yet.`;

  return (
    <>
      {/* ── Calendar toolbar ───────────────────────────────────────────── */}
      <div className="ecal" style={{ marginBottom: 16 }}>
        <div className="ecal-top">
          <div className="ecal-nav">
            <button className="ecal-arrow" onClick={() => step(-1)} aria-label="Previous">‹</button>
            <div style={{ position: "relative" }}>
              <div className="ecal-date" onClick={() => setPickerOpen(o => !o)} style={{ cursor: "pointer" }} title="Pick a date">
                {headerLabel} <span aria-hidden style={{ fontSize: ".7em", opacity: .7 }}>▾</span>
              </div>
              {pickerOpen && (
                <MiniCalendar
                  value={anchor}
                  onPick={iso => { goToDate(iso); setMode("day"); }}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>
            <button className="ecal-arrow" onClick={() => step(1)} aria-label="Next">›</button>
          </div>
          <div className="ecal-seg">
            <button className={`ecal-segbtn${mode === "month" ? " on" : ""}`} onClick={() => setMode("month")}>Month</button>
            <button className={`ecal-segbtn${mode === "week" ? " on" : ""}`} onClick={() => setMode("week")}>Week</button>
            <button className={`ecal-segbtn${mode === "day" ? " on" : ""}`} onClick={() => setMode("day")}>Day</button>
          </div>
        </div>

        {/* ── Calendar ─────────────────────────────────────────────────── */}
        {calNode}
      </div>

      {/* ── Selected company inline detail (below calendar, no drawer) ── */}
      {sel && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <StockLogo sym={sel} size={36} />
              <div>
                <span style={{ fontWeight: 700, color: "var(--text-hi)", fontSize: ".95rem" }}>{sel}</span>
                <span style={{ color: "var(--text-dim-solid)", fontSize: ".78rem", marginLeft: 8 }}>
                  {liveCompanySel?.name ?? sel} · {liveCompanySel?.sector ?? <NotAvailable />}
                </span>
              </div>
              <span className="pill" style={{ marginLeft: 4, background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>
                Session: <NotAvailable />
              </span>
              {hasLiveEps && (
                <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)" }}>live EPS · Polygon</span>
              )}
              {/* Action buttons — inline, same row */}
              <div style={{ display: "flex", gap: 6, marginLeft: 4 }}>
              <button
                title="Earnings call"
                onClick={() => setSelectedCall(sel)}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: "var(--surface-2)", border: "1px solid var(--border-soft)",
                  borderRadius: 8, padding: "5px 10px", cursor: "pointer",
                  color: "var(--text)", fontSize: ".75rem", fontWeight: 600,
                  transition: ".15s",
                }}
              >
                <svg viewBox="0 0 24 24" width={12} height={12} fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
                Earnings call
              </button>
              <button
                title="AI earnings analysis"
                onClick={() => setAiModalSym(sel)}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: "var(--surface-2)", border: "1px solid var(--border-soft)",
                  borderRadius: 8, padding: "5px 10px", cursor: "pointer",
                  color: "var(--ai)", fontSize: ".75rem", fontWeight: 600,
                }}
              >
                <span style={{ fontSize: ".85rem", lineHeight: 1 }}>◆</span>
                AI analysis
              </button>
              </div>{/* end buttons */}
            </div>{/* end outer flex */}
          </div>{/* end card-h */}
          <div className="card-b" style={{ paddingTop: 10 }}>
            <div className="metric-grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 12 }}>
              <div className="m">
                <div className="k">EPS estimate</div>
                <div className="v">{liveMatch?.epsEstimate != null ? `$${liveMatch.epsEstimate.toFixed(2)}` : "—"}</div>
              </div>
              <div className="m">
                <div className="k">EPS actual</div>
                {liveMatch?.epsActual != null
                  ? <div className={`v ${liveMatch.epsEstimate != null ? (liveMatch.epsActual >= liveMatch.epsEstimate ? "up" : "down") : ""}`}>${liveMatch.epsActual.toFixed(2)}</div>
                  : <div className="v" style={{ color: "var(--text-dim-solid)" }}>Pending</div>}
              </div>
              <div className="m">
                <div className="k">Guidance</div>
                <div className="v" style={{ fontSize: ".95rem" }}><NotAvailable /></div>
              </div>
            </div>
            <p style={{ fontSize: ".82rem", color: "var(--text-dim-solid)", margin: 0 }}>{aiRead}</p>
          </div>
        </div>
      )}

      {/* ── Detail: EPS history + Income statement (only once a company is picked) ── */}
      {sel && (
      <>
      <div className="dash" style={{ marginTop: 16 }}>
        {/* col-6: 10-quarter EPS history */}
        <div className="col-6">
          <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div className="card-h">
              <h3>{sel} · 10-quarter earnings history</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {hist.length === 0 || !hasEstimates ? (
                  hist.length > 0
                    ? <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>{hist.length} reported</span>
                    : null
                ) : beats / hist.length >= 0.7
                  ? <span className="pill up">{beats}/{hist.length} beats</span>
                  : beats / hist.length < 0.5
                  ? <span className="pill dn">{beats}/{hist.length} beats</span>
                  : <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>{beats}/{hist.length} beats</span>}
                <ExpandBtn title={`${sel} · 10-quarter earnings history`} node={<EpsChart hist={hist} />} />
              </div>
            </div>
            <div className="card-b" style={{ paddingTop: 8, flex: 1, display: "flex", flexDirection: "column" }}>
              {hist.length === 0 ? (
                <DataState loading={financialsLoading} label={`No reported earnings history for ${sel} yet.`} height="100%" />
              ) : (
                <>
                  <div className="ec-legend">
                    {hasEstimates ? (
                      <>
                        <span><i style={{ background: "var(--surface-3)" }} /> EPS estimate</span>
                        <span><i style={{ background: "var(--up)" }} /> Beat</span>
                        <span><i style={{ background: "var(--down)" }} /> Miss</span>
                      </>
                    ) : (
                      <span><i style={{ background: "var(--brand-2)" }} /> Reported EPS (diluted)</span>
                    )}
                  </div>
                  <EpsChart hist={hist} />
                  <details className="ec-det">
                    <summary>Show quarterly table</summary>
                    <div style={{ overflowX: "auto", marginTop: 8 }}>
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Quarter</th>
                            <th className="num">EPS est</th>
                            <th className="num">EPS act</th>
                            <th className="num">Surprise</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hist.map(h => (
                            <tr key={h.q}>
                              <td><b style={{ color: "var(--text-hi)" }}>{h.q}</b></td>
                              <td className="num">{hasEstimates ? `$${h.e.toFixed(2)}` : "—"}</td>
                              <td className="num">${h.a.toFixed(2)}</td>
                              <td className={`num ${hasEstimates ? cls(h.surp) : ""}`}>{hasEstimates ? sign(h.surp) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              )}
            </div>
          </div>
        </div>

        {/* col-6: Income statement */}
        <div className="col-6">
          <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div className="card-h">
              <h3>{sel} · Income statement</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>Quarterly</span>
                <ExpandBtn title={`${sel} · Income statement`} node={<IncChart inc={inc} />} />
              </div>
            </div>
            <div className="card-b" style={{ paddingTop: 8, flex: 1, display: "flex", flexDirection: "column" }}>
              {inc.length === 0 ? (
                <DataState loading={financialsLoading} label={`No live quarterly financials synced for ${sel} yet.`} height="100%" />
              ) : (
                <>
                  <div className="ec-legend">
                    <span><i style={{ background: "var(--brand)" }} /> Revenue</span>
                    <span><i style={{ background: "var(--ai)" }} /> Gross profit</span>
                    <span><i style={{ background: "var(--up)" }} /> Net income</span>
                  </div>
                  <IncChart inc={inc} />
                  <details className="ec-det">
                    <summary>Show statement table</summary>
                    <div style={{ overflowX: "auto", marginTop: 8 }}>
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Item</th>
                            {inc.map(c => <th key={c.c} className="num">{c.c}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {(
                            [
                              ["Revenue",            "rev",  true ],
                              ["Cost of revenue",    "cogs", false],
                              ["Gross profit",       "gp",   true ],
                              ["Operating expenses", "opex", false],
                              ["Operating income",   "oi",   true ],
                              ["Net income",         "ni",   true ],
                              ["Diluted EPS",        "eps",  false],
                            ] as [string, keyof IncRow, boolean][]
                          ).map(([lbl, key, bold]) => (
                            <tr key={lbl}>
                              <td style={bold ? { fontWeight: 700, color: "var(--text-hi)" } : undefined}>{lbl}</td>
                              {inc.map(c => (
                                <td key={c.c} className="num"
                                  style={bold ? { fontWeight: 700, color: "var(--text-hi)" } : undefined}>
                                  {key === "eps" ? `$${(c[key] as number).toFixed(2)}` : fmtB(c[key] as number)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── AI earnings read ──────────────────────────────────────────────── */}
      <div className="ai-block" style={{ marginTop: 2 }}>
        <div className="card-h">
          <h3 className="ai-c">◆ AI earnings read · {sel}</h3>
        </div>
        <div className="card-b">
          <p style={{ fontSize: ".85rem", lineHeight: 1.6, color: "var(--text)" }}>
            {aiRead}{" "}
            Watch revenue growth and forward guidance most.{" "}
            <button className="btn" style={{ marginLeft: 8, padding: "4px 10px" }}
              onClick={() => openStockFull(sel)}>
              Open full stock page →
            </button>
          </p>
        </div>
      </div>
      </>
      )}

      {/* Earnings call detail drawer — honest not-connected state, no fabricated summary/transcript */}
      {selectedCall && (
        <CallDrawer sym={selectedCall} onClose={() => setSelectedCall(null)} />
      )}

      {/* AI analysis modal — honest not-connected state */}
      {aiModalSym && (
        <>
          <div className="scrim" style={{ zIndex: 60 }} onClick={() => setAiModalSym(null)} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            background: "var(--surface-1)", border: "1px solid var(--border)",
            borderRadius: "var(--r-lg)", zIndex: 61, width: "min(520px, 92vw)",
            boxShadow: "0 20px 60px rgba(0,0,0,.5)",
          }}>
            {/* Modal header */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "14px 16px", borderBottom: "1px solid var(--border-soft)",
            }}>
              <span style={{ color: "var(--ai)", fontSize: "1rem", lineHeight: 1 }}>◆</span>
              <span style={{ fontWeight: 700, fontSize: ".95rem", color: "var(--text-hi)", flex: 1 }}>
                AI Analysis · {aiModalSym}
              </span>
              <button className="closebtn" onClick={() => setAiModalSym(null)}>✕</button>
            </div>
            {/* Modal body */}
            <div style={{ padding: "16px 18px 20px" }}>
              <DataState label="AI earnings-call analysis isn't connected to a live transcript vendor yet." />
            </div>
          </div>
        </>
      )}
    </>
  );
}
