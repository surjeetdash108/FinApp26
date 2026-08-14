"use client";

import { useState } from "react";
import { useIQActions, ExpandBtn } from "../shell";
import { cls, sign, EarnQ, StockLogo, NotAvailable, DataState } from "../utils";
import { ChartCard } from "../stock-panel";
import { EpsSalesWidget } from "../eps-sales-widget";
import { EarningsPlaybook } from "./EarningsPlaybook";
import { backendUrl } from "../backend";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import { useTickerSearch } from "../hooks/useTickerSearch";
import type { LiveEarningsDoc, CompanyDoc, FinancialsDoc, QuarterFinancials, AnnualFinancials, EarningsAnnouncementDoc } from "../types";
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
function incRowsFromFinancials(doc: FinancialsDoc | null, period: "Q" | "A" = "Q"): IncRow[] {
  const rows: (QuarterFinancials | AnnualFinancials)[] = doc ? (period === "A" ? doc.annual : doc.quarters) : [];
  if (rows.length === 0) return [];
  return rows.slice(0, 10).map(r => {
    const revenue = r.revenue ?? 0;
    const grossProfit = r.grossProfit ?? 0;
    const operatingIncome = r.operatingIncome ?? 0;
    const netIncome = r.netIncome ?? 0;
    const opex = (r as QuarterFinancials).operatingExpenses ?? Math.max(0, grossProfit - operatingIncome);
    const label = period === "A"
      ? `FY '${(r.fiscalYear ?? "").slice(-2)}`
      : `${(r as QuarterFinancials).fiscalPeriod ?? "?"} '${(r.fiscalYear ?? "").slice(-2)}`;
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
  const W = 580, H = 210, PADL = 40, PADR = 18, PADT = 14, PADB = 30;
  const iw = W - PADL - PADR, ih = H - PADT - PADB;
  const allVals = d.flatMap(x => [x.e, x.a]);
  const dataMax = Math.max(...allVals) || 1;
  const maxE = dataMax * 1.15 || 1;
  const n = d.length, gw = iw / n, bw = gw * 0.28;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => dataMax * f);

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
    // Show every quarter label (previously every other was skipped, so the
    // axis read Mar'24, Sep'24, … with the in-between quarters missing). Each
    // ~30px label sits in its own ~48px slot, so they fit horizontally — same
    // as the IncChart axis directly below.
    labels.push(
      <text key={`l${i}`} x={cx} y={H - 10} textAnchor="middle"
        style={{ fill: "var(--text-dim-solid)", fontSize: "0.5625rem" }}>
        {x.q.replace(" ", "'")}
      </text>
    );
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }}>
      {yTicks.map((v, i) => {
        const y = PADT + ih - (v / maxE) * ih;
        return (
          <g key={`yt${i}`}>
            <line x1={PADL} y1={y} x2={W - PADR} y2={y} style={{ stroke: "var(--border)" }} strokeDasharray="3 3" opacity={0.45} />
            <text x={PADL - 5} y={y + 3} textAnchor="end" style={{ fill: "var(--text-dim-solid)", fontSize: "0.5rem" }}>${v.toFixed(2)}</text>
          </g>
        );
      })}
      {bars}
      {labels}
    </svg>
  );
}

function IncChart({ inc }: { inc: IncRow[] }) {
  const d = [...inc].reverse();
  const W = 580, H = 200, PADL = 46, PADR = 8, PADT = 14, PADB = 26;
  const iw = W - PADL - PADR, ih = H - PADT - PADB;
  const dataMax = Math.max(...d.map(x => x.rev)) || 1;
  const max = dataMax * 1.12 || 1;
  const n = d.length, gw = iw / n, bw = gw * 0.18;
  const fmtAxis = (v: number) => v >= 100 ? `$${v.toFixed(0)}B` : v >= 1 ? `$${v.toFixed(1)}B` : `$${Math.round(v * 1000)}M`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => dataMax * f);

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
      {yTicks.map((v, i) => {
        const y = PADT + ih - (v / max) * ih;
        return (
          <g key={`yt${i}`}>
            <line x1={PADL} y1={y} x2={W - PADR} y2={y} style={{ stroke: "var(--border)" }} strokeDasharray="3 3" opacity={0.45} />
            <text x={PADL - 5} y={y + 3} textAnchor="end" style={{ fill: "var(--text-dim-solid)", fontSize: "0.5rem" }}>{fmtAxis(v)}</text>
          </g>
        );
      })}
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
          // Polygon branding logo via the backend proxy (no third-party CDN);
          // a 404 hides the img and the letter behind it shows through.
          src={backendUrl(`/live/logo?ticker=${encodeURIComponent(sym)}`)}
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

// Max ticker logos/rows shown before an overflow "+N" — shared by the day
// tables, the week columns, and the month cells so all three views cap alike.
const MAX_CAL_LOGOS = 24;

function CalTable({
  title, rows, sel, onSelect, view,
}: { title: string; rows: CalRow[]; sel: string; onSelect: (s: string) => void; view: CalView }) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, MAX_CAL_LOGOS);
  const canExpand = rows.length > MAX_CAL_LOGOS;
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
            {shown.map(r => (
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
      {canExpand && (
        <button
          type="button"
          className="ecal-more"
          onClick={() => setExpanded(v => !v)}
          style={{
            display: "block", width: "100%", marginTop: 6, padding: "6px 10px",
            background: "var(--surface-2)", border: "1px solid var(--border-soft)",
            borderRadius: 6, color: "var(--text-dim-solid)", cursor: "pointer",
            fontSize: ".75rem", fontWeight: 600,
          }}
        >
          {expanded ? "Show less" : `+${rows.length - MAX_CAL_LOGOS} more`}
        </button>
      )}
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export function EarningsScreen() {
  const { openStockFull } = useIQActions();
  const { data: liveEarnings } = useApiList<LiveEarningsDoc>("/market-data/earnings");
  const { data: earningsAnnouncements } = useApiList<EarningsAnnouncementDoc>("/market-data/earnings-announcements");
  const liveEarningsData = liveEarnings;

  const [mode, setMode]     = useState<"day" | "week" | "month">("day");
  const [anchor, setAnchor] = useState<string>(() => isoDay(new Date()));
  // The filter bar (session / cap / sort / min-move / view / news / auto-refresh)
  // was removed — the live earnings feed has no data to drive those — so these
  // stay at fixed defaults.
  const sort: SortKey = "symbol";
  const view: CalView = "eps";
  // Pre-market (Before open) / after-market (After close) filter for the calendar.
  const [session, setSession] = useState<SessionKey>("both");
  const [pickerOpen, setPickerOpen]   = useState(false);
  // Quarterly vs Yearly toggles for the two detail tables (independent).
  const [histPeriod, setHistPeriod] = useState<"Q" | "A">("Q");
  const [incPeriod, setIncPeriod]   = useState<"Q" | "A">("Q");
  const [aiReadOpen, setAiReadOpen] = useState(true);
  const [tickerSearch, setTickerSearch] = useState("");
  const tickerResults = useTickerSearch(tickerSearch);
  // Detail mode: clicking a stock opens a split view (weekly picker + details)
  // that replaces the calendar; the ✕ in the weekly panel closes back to it.
  const [detailOpen, setDetailOpen] = useState(false);

  // No company is selected by default — the detail panels appear only after the
  // user clicks a reporting company in the calendar.
  const [sel, setSel]           = useState<string>("");
  const { data: liveCompanySel } = useApiResource<CompanyDoc>(sel ? `/live/company?ticker=${encodeURIComponent(sel)}` : null);
  const { data: financialsDoc, loading: financialsLoading } = useApiResource<FinancialsDoc>(sel ? `/live/financials?ticker=${encodeURIComponent(sel)}` : null);
  const [selectedCall,   setSelectedCall]   = useState<string | null>(null);
  const [aiModalSym,      setAiModalSym]      = useState<string | null>(null);

  const weekMon   = mondayOf(new Date(`${anchor}T00:00:00Z`));
  const weekDays5 = [0, 1, 2, 3, 4].map(i => isoDay(addDays(weekMon, i)));

  const dayRows = rowsForDate(anchor, liveEarningsData).map(toCalRow);
  const visibleRows = filterSortRows(dayRows, { sort, session: "both" });

  // Pre-market (Before Open) / post-market (After Close) session comes from the
  // EDGAR 8-K `earnings_announcements` feed — Polygon's earnings_events carries
  // no session — joined by ticker + reporting date. Rows with no 8-K session
  // match fall into a "Time not specified" group rather than being hidden.
  const annSessionByKey = new Map<string, "BMO" | "AMC">();
  for (const a of earningsAnnouncements) {
    if (a.session === "BMO" || a.session === "AMC") {
      annSessionByKey.set(`${a.ticker}|${a.announceDate}`, a.session);
    }
  }
  const withSess = (rows: CalRow[], iso: string): CalRow[] =>
    rows.map(r => (r.sess ? r : { ...r, sess: annSessionByKey.get(`${r.s}|${iso}`) ?? null }));

  const daySessRows = withSess(visibleRows, anchor);
  const bmoRows = daySessRows.filter(r => r.sess === "BMO");
  const amcRows = daySessRows.filter(r => r.sess === "AMC");
  const tbdRows = daySessRows.filter(r => r.sess !== "BMO" && r.sess !== "AMC");

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
  /** Click a reporting stock → open the split detail view for it. Keeps the
   *  anchor on the stock's day so the weekly picker shows the right week. */
  function openStockDetail(sym: string, iso?: string) {
    if (iso) setAnchor(iso);
    setSel(sym);
    setDetailOpen(true);
  }
  const closeDetail = () => { setDetailOpen(false); setSel(""); };
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
        {visibleRows.length > 0 ? (
          <>
            {session !== "AMC" && <CalTable title="Before open · Pre-market" rows={bmoRows} sel={sel} onSelect={s => openStockDetail(s, anchor)} view={view} />}
            {session !== "BMO" && <CalTable title="After close · Post-market" rows={amcRows} sel={sel} onSelect={s => openStockDetail(s, anchor)} view={view} />}
            {session === "both" && <CalTable title="Time not specified" rows={tbdRows} sel={sel} onSelect={s => openStockDetail(s, anchor)} view={view} />}
          </>
        ) : (
          <div className="ecal-empty">
            <div className="ecal-empty-h">No companies reporting</div>
            <div>Nothing scheduled for {dateLabel} in the synced calendar.</div>
          </div>
        )}
      </>
    );
  } else if (mode === "week") {
    calNode = (
      <div className="ec-grid">
        {weekDays5.map((iso, di) => {
          const items = filterSortRows(rowsForDate(iso, liveEarningsData).map(toCalRow), { sort, session });
          const dn = ["Mon", "Tue", "Wed", "Thu", "Fri"][di];
          const isToday = iso === isoDay(new Date());
          return (
            <div key={iso} className={`ec-day${isToday ? " is-today" : ""}${iso === anchor && !isToday ? " is-sel" : ""}`}>
              <div className="ec-dh" style={{ cursor: "pointer" }} onClick={() => { goToDate(iso); setMode("day"); }}>
                {dn} {Number(iso.slice(8))}{isToday ? " · Today" : ""}
              </div>
              <div className="ec-sess">
                {items.length ? (
                  <>
                    {items.slice(0, MAX_CAL_LOGOS).map(r => <EcChip key={r.s} sym={r.s} selected={sel === r.s} onSelect={s => openStockDetail(s, iso)} />)}
                    {items.length > MAX_CAL_LOGOS && (
                      <button className="emc-more" title={`${items.length - MAX_CAL_LOGOS} more — open day view`} onClick={() => { goToDate(iso); setMode("day"); }}>+{items.length - MAX_CAL_LOGOS}</button>
                    )}
                  </>
                ) : <span className="ec-none">—</span>}
              </div>
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
    const MAX_LOGOS = MAX_CAL_LOGOS;
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
            const items = filterSortRows(rowsForDate(iso, liveEarningsData).map(toCalRow), { sort, session });
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
                      <button key={r.s} className={`emc-logo${sel === r.s ? " on" : ""}`} title={r.s} onClick={() => openStockDetail(r.s, iso)}>
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
  // Session (BMO/AMC) + post-announcement reaction from the EDGAR 8-K job.
  const annMatch = earningsAnnouncements
    .filter(a => a.ticker === sel)
    .sort((a, b) => b.announceDate.localeCompare(a.announceDate))[0];
  const hasLiveEps = !!liveMatch && (liveMatch.epsEstimate != null || liveMatch.epsActual != null);

  // 10-quarter EPS history comes from the per-ticker Polygon financials
  // (GET /live/financials — 10 reported quarters), not the market-wide calendar
  // feed, which only holds ~1–2 filings per ticker inside its date window.
  // Polygon reports actuals only, so estimates/beat-miss are absent.
  const histSource: (QuarterFinancials | AnnualFinancials)[] =
    (histPeriod === "A" ? (financialsDoc?.annual ?? []) : (financialsDoc?.quarters ?? []))
      .filter(q => q.epsActual != null)
      .slice()
      .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""))
      .slice(0, 10);
  // Annual filings carry no per-quarter estimate, so beat/miss only applies to Q.
  const hasEstimates = histPeriod === "Q" && histSource.some(q => (q as QuarterFinancials).epsEstimate != null);
  const hist: EarnQ[] = histSource.map(q => {
    const act = q.epsActual as number;
    const est = (q as QuarterFinancials).epsEstimate ?? null;
    const surp = est != null && est !== 0 ? ((act - est) / Math.abs(est)) * 100 : 0;
    const label = q.endDate
      ? new Date(q.endDate + "T00:00:00").toLocaleDateString("en-US", histPeriod === "A" ? { year: "numeric" } : { month: "short", year: "2-digit" })
      : (histPeriod === "A" ? `${q.fiscalYear ?? ""}`.trim() : `${(q as QuarterFinancials).fiscalPeriod ?? ""} ${q.fiscalYear ?? ""}`.trim());
    return { q: label, e: est ?? 0, a: act, surp: parseFloat(surp.toFixed(1)), mv: 0 };
  });
  const beats = hist.filter(h => h.surp >= 0).length;

  const inc = incRowsFromFinancials(financialsDoc, incPeriod);

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
      {/* ── Calendar toolbar (original view; hidden in detail mode) ─────── */}
      {!detailOpen && (
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
          {/* Session filter — narrows the calendar to pre-market / after-market. */}
          <div className="ecal-seg">
            <button className={`ecal-segbtn${session === "both" ? " on" : ""}`} onClick={() => setSession("both")}>All</button>
            <button className={`ecal-segbtn${session === "BMO" ? " on" : ""}`} onClick={() => setSession("BMO")}>Pre-market</button>
            <button className={`ecal-segbtn${session === "AMC" ? " on" : ""}`} onClick={() => setSession("AMC")}>After-market</button>
          </div>
        </div>

        {/* ── Calendar ─────────────────────────────────────────────────── */}
        {calNode}
      </div>
      )}

      {/* ── Detail mode: weekly picker (left) + stock details (right) ────── */}
      {detailOpen && sel && (
        <div className="ew-split">
          {/* Left: weekly picker with close button */}
          <aside className="ew-week">
            <div className="ew-week-h">
              <span>Week of {MON3[weekMon.getUTCMonth()]} {weekMon.getUTCDate()}</span>
              <button className="closebtn" title="Close details" onClick={closeDetail}>✕</button>
            </div>
            {/* Ticker search — type a symbol/company; click a match (or press
                Enter) to open its detail. Backed by /live/search (~10k universe). */}
            <div style={{ padding: "8px 0 10px" }}>
              <input
                value={tickerSearch}
                onChange={e => setTickerSearch(e.target.value.toUpperCase())}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    const pick = tickerResults[0]?.ticker ?? tickerSearch.trim().toUpperCase();
                    if (pick) { openStockDetail(pick); setTickerSearch(""); }
                  }
                }}
                placeholder="Search ticker…"
                style={{ width: "100%", boxSizing: "border-box", background: "var(--surface-3)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: "7px 10px", fontSize: ".8rem", color: "var(--text-hi)", outline: "none", fontFamily: "var(--f-mono)" }}
              />
              {tickerSearch.trim().length > 0 && tickerResults.length > 0 && (
                <div role="listbox" style={{ marginTop: 6, maxHeight: 220, overflowY: "auto", background: "var(--surface-2)", border: "1px solid var(--border-soft)", borderRadius: 8 }}>
                  {tickerResults.slice(0, 10).map(r => (
                    <button key={r.ticker} type="button"
                      onClick={() => { openStockDetail(r.ticker); setTickerSearch(""); }}
                      style={{ display: "flex", alignItems: "baseline", gap: 8, width: "100%", textAlign: "left", padding: "7px 10px", background: "transparent", border: "none", borderBottom: "1px solid var(--border-soft)", color: "var(--text)", cursor: "pointer", fontSize: ".8rem" }}>
                      <span style={{ fontWeight: 700, fontFamily: "var(--f-mono)", minWidth: 52, color: "var(--text-hi)" }}>{r.ticker}</span>
                      <span style={{ color: "var(--text-dim-solid)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name ?? ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="ew-week-body">
              {weekDays5.map(iso => {
                const items = filterSortRows(rowsForDate(iso, liveEarningsData).map(toCalRow), { sort, session });
                const d = new Date(`${iso}T00:00:00Z`);
                const isToday = iso === isoDay(new Date());
                return (
                  <div className="ew-week-day" key={iso}>
                    <div className="ew-week-daylabel">{DOW3[d.getUTCDay()]} {d.getUTCDate()}{isToday ? " · Today" : ""}</div>
                    {items.length ? (
                      <div className="emc-logos">
                        {items.map(r => (
                          <button key={r.s} className={`emc-logo${sel === r.s ? " on" : ""}`} title={r.s} onClick={() => openStockDetail(r.s, iso)}>
                            <StockLogo sym={r.s} size={20} />
                          </button>
                        ))}
                      </div>
                    ) : <div className="ew-week-none">No earnings</div>}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Right: stock details */}
          <div className="ew-main">
            {/* top row: what company does + AI summary */}
            <div className="ew-toprow">
              <div className="card">
                <div className="card-h" style={{ gap: 10, flexWrap: "wrap" }}>
                  <StockLogo sym={sel} size={30} />
                  <span style={{ fontWeight: 700, fontFamily: "var(--f-mono)", color: "var(--text-hi)", fontSize: ".95rem" }}>{sel}</span>
                  {liveCompanySel?.price != null && (
                    <span style={{ fontFamily: "var(--f-mono)", fontWeight: 700, color: "var(--text-hi)", fontSize: ".9rem" }}>
                      ${liveCompanySel.price.toFixed(2)}
                      {liveCompanySel.pctChange != null && <span className={cls(liveCompanySel.pctChange)} style={{ marginLeft: 6, fontSize: ".8rem" }}>{sign(liveCompanySel.pctChange)}</span>}
                    </span>
                  )}
                  <h3 style={{ marginLeft: 6 }}>What this company does</h3>
                </div>
                <div className="card-b">
                  {liveCompanySel?.description
                    ? <p style={{ fontSize: ".82rem", lineHeight: 1.6, color: "var(--text)", margin: 0 }}>{liveCompanySel.description}</p>
                    : <DataState loading={!liveCompanySel} label={`No company description synced for ${sel} yet.`} />}
                </div>
              </div>
              <div className="card">
                <div className="card-h"><h3>AI summary</h3><span className="pill" style={{ background: "var(--surface-3)", color: "var(--ai)" }}>◆ AI</span></div>
                <div className="card-b">
                  <p style={{ fontSize: ".82rem", lineHeight: 1.6, color: "var(--text)", margin: "0 0 10px" }}>{aiRead}</p>
                  <div className="ew-aisum">
                    <div><span>Post-earnings reaction</span><b>{annMatch?.reactionPct != null ? <span className={cls(annMatch.reactionPct)}>{sign(annMatch.reactionPct)}</span> : <NotAvailable />}</b></div>
                    <div><span>Historical EPS beats</span><b>{hasEstimates ? `${beats} / ${hist.length}` : <span style={{ color: "var(--text-dim-solid)", fontWeight: 500 }}>Pending — needs estimates</span>}</b></div>
                    <div><span>What street expects</span><b style={{ color: "var(--text-dim-solid)", fontWeight: 500 }}>Pending — forward consensus not in feed yet</b></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Price chart (full width) */}
            <div style={{ marginBottom: 14 }}>
              <ChartCard sym={sel} px={liveCompanySel?.price ?? 0} />
            </div>

            {/* Sales & EPS — bar charts (Quarterly/Annual) + fiscal-year and
                quarterly tables, per the reference layout. */}
            <div style={{ marginBottom: 14 }}>
              <EpsSalesWidget financialsDoc={financialsDoc} />
            </div>

            {/* Reports — how the stock trades when it reports (bottom). */}
            <div className="card">
              <div className="card-h">
                <h3>Earnings Playbook</h3>
                <span style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>how {sel} trades when it reports</span>
              </div>
              <div className="card-b" style={{ paddingTop: 6 }}>
                <EarningsPlaybook
                  sym={sel}
                  reports={(financialsDoc?.quarters ?? [])
                    .filter(q => q.filingDate)
                    .map(q => ({ date: q.filingDate as string, epsActual: q.epsActual, epsEstimate: q.epsEstimate }))}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Legacy inline detail — superseded by detail mode; kept gated ── */}
      {!detailOpen && sel && (
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
              <div className="m">
                <div className="k">Session</div>
                <div className="v" style={{ fontSize: ".95rem" }}>{annMatch?.session ?? <NotAvailable />}</div>
              </div>
              <div className="m">
                <div className="k">Reaction</div>
                <div className="v" style={{ fontSize: ".95rem" }}>{annMatch?.reactionPct != null ? <span className={cls(annMatch.reactionPct)}>{sign(annMatch.reactionPct)}</span> : <NotAvailable />}</div>
              </div>
            </div>
            <p style={{ fontSize: ".82rem", color: "var(--text-dim-solid)", margin: 0 }}>{aiRead}</p>
          </div>
        </div>
      )}

      {/* ── Legacy detail (EPS history + Income statement) — gated off ── */}
      {!detailOpen && sel && (
      <>
      <div className="dash" style={{ marginTop: 16 }}>
        {/* col-6: 10-quarter EPS history */}
        <div className="col-6">
          <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div className="card-h">
              <h3>{sel} · earnings history</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div className="ecal-seg">
                  <button className={`ecal-segbtn${histPeriod === "Q" ? " on" : ""}`} onClick={() => setHistPeriod("Q")}>Quarterly</button>
                  <button className={`ecal-segbtn${histPeriod === "A" ? " on" : ""}`} onClick={() => setHistPeriod("A")}>Yearly</button>
                </div>
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
                  <div style={{ overflowX: "auto", marginTop: 10 }}>
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>{histPeriod === "A" ? "Year" : "Quarter"}</th>
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
                <div className="ecal-seg">
                  <button className={`ecal-segbtn${incPeriod === "Q" ? " on" : ""}`} onClick={() => setIncPeriod("Q")}>Quarterly</button>
                  <button className={`ecal-segbtn${incPeriod === "A" ? " on" : ""}`} onClick={() => setIncPeriod("A")}>Yearly</button>
                </div>
                <ExpandBtn title={`${sel} · Income statement`} node={<IncChart inc={inc} />} />
              </div>
            </div>
            <div className="card-b" style={{ paddingTop: 8, flex: 1, display: "flex", flexDirection: "column" }}>
              {inc.length === 0 ? (
                <DataState loading={financialsLoading} label={`No live ${incPeriod === "A" ? "annual" : "quarterly"} financials synced for ${sel} yet.`} height="100%" />
              ) : (
                <>
                  <div className="ec-legend">
                    <span><i style={{ background: "var(--brand)" }} /> Revenue</span>
                    <span><i style={{ background: "var(--ai)" }} /> Gross profit</span>
                    <span><i style={{ background: "var(--up)" }} /> Net income</span>
                  </div>
                  <IncChart inc={inc} />
                  <div style={{ overflowX: "auto", marginTop: 10 }}>
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
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── AI earnings read — expandable, same widget as the dashboard ──────── */}
      <div className={`wmn${aiReadOpen ? " open" : ""}`} style={{ marginTop: 12 }}>
        <button type="button" className="wmn-h" aria-expanded={aiReadOpen} onClick={() => setAiReadOpen(o => !o)}>
          <div className="t">
            <div className="wmn-orb">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9z" fill="currentColor" />
              </svg>
            </div>
            <div>
              <h2>AI earnings read · {sel}</h2>
              <div className="meta">Reported vs. estimates · guidance focus</div>
            </div>
          </div>
          <svg className="wmn-chev" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="wmn-collapse">
          <div className="wmn-collapse-inner">
            <p style={{ fontSize: ".85rem", lineHeight: 1.6, color: "var(--text)", margin: 0 }}>
              {aiRead}{" "}
              Watch revenue growth and forward guidance most.{" "}
              <button className="btn" style={{ marginLeft: 8, padding: "4px 10px" }}
                onClick={() => openStockFull(sel)}>
                Open full stock page →
              </button>
            </p>
          </div>
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
