"use client";

import { useEffect, useState } from "react";
import { useIQActions, ExpandBtn } from "../shell";
import { earnings, stockInfo, type Earning } from "../data";
import { fmt, cls, sign, earnHistory, EarnQ, StockLogo, hashStr } from "../utils";
import { useApiList } from "../hooks/useApiList";
import { apiGet } from "../backend";
import type { LiveEarningsDoc, IpoEventDoc } from "../types";
import { isoDay, addDays, mondayOf } from "../calendar-range";

// Live source (FMP earnings calendar) has ticker/date/epsEstimate/epsActual —
// no session (BMO/AMC), guidance, price reaction, or implied move, which the
// mock EARN_CAL/CALLS_DATA supply. So EPS numbers are overlaid live when a
// synced doc exists for the ticker; everything else (session, guidance,
// call summaries/transcripts) stays the illustrative mock, clearly unmarked
// as such since no vendor (Benzinga real-time, Claude) is wired for it yet.

// ── Types ────────────────────────────────────────────────────────────────────

interface IncRow  { c: string; rev: number; cogs: number; gp: number; opex: number; oi: number; ni: number; eps: number; }

// ── Earnings calendar dataset (mock window: May–Jul 2026) ────────────────────

interface EarnCalItem {
  s: string; n: string; sec: string;
  // Live earnings_events has no session/guidance/reaction/implied-move data, so
  // these are nullable. Rendering a default would fabricate a claim.
  sess: "BMO" | "AMC" | null;
  month: number; day: number;
  weekDay: number; // 0=Mon … 4=Fri
  epsE: number | null; epsA: number | null; implied: number | null;
  guide: "Raised" | "In-line" | "Lowered" | null;
  react: number | null;
}

const EARN_CAL: EarnCalItem[] = [
  // ── May 2026 (Last Month) ──────────────────────────────────────────────────
  { s:"AMD",  n:"Adv Micro Dev",  sec:"Semis",      sess:"AMC", month:5, day:2,  weekDay:4, epsE:0.98,  epsA:1.12,  implied:5.2, guide:"Raised",  react: 6.4 },
  { s:"QCOM", n:"Qualcomm",       sec:"Semis",      sess:"AMC", month:5, day:7,  weekDay:2, epsE:2.19,  epsA:2.33,  implied:4.1, guide:"Raised",  react: 4.8 },
  { s:"UBER", n:"Uber Tech",      sec:"Software",   sess:"AMC", month:5, day:8,  weekDay:3, epsE:0.51,  epsA:0.64,  implied:4.8, guide:"Raised",  react: 5.2 },
  { s:"ARM",  n:"Arm Holdings",   sec:"Semis",      sess:"AMC", month:5, day:8,  weekDay:3, epsE:0.38,  epsA:0.45,  implied:6.2, guide:"Raised",  react: 4.6 },
  { s:"CSCO", n:"Cisco Systems",  sec:"Networking", sess:"AMC", month:5, day:14, weekDay:2, epsE:0.94,  epsA:0.96,  implied:3.1, guide:"In-line", react: 1.8 },
  { s:"WMT",  n:"Walmart",        sec:"Retail",     sess:"BMO", month:5, day:15, weekDay:3, epsE:0.52,  epsA:0.60,  implied:2.9, guide:"Raised",  react: 5.2 },
  { s:"HD",   n:"Home Depot",     sec:"Retail",     sess:"BMO", month:5, day:20, weekDay:1, epsE:3.68,  epsA:3.79,  implied:2.8, guide:"In-line", react: 1.4 },
  { s:"TGT",  n:"Target",         sec:"Retail",     sess:"BMO", month:5, day:20, weekDay:1, epsE:2.05,  epsA:1.82,  implied:4.6, guide:"Lowered", react:-7.8 },
  { s:"NVDA", n:"Nvidia",         sec:"Semis",      sess:"AMC", month:5, day:22, weekDay:3, epsE:5.56,  epsA:6.57,  implied:7.2, guide:"Raised",  react: 8.2 },
  { s:"SNOW", n:"Snowflake",      sec:"Software",   sess:"AMC", month:5, day:28, weekDay:2, epsE:-0.24, epsA:-0.15, implied:7.8, guide:"Raised",  react: 6.3 },
  { s:"MDB",  n:"MongoDB",        sec:"Software",   sess:"AMC", month:5, day:28, weekDay:2, epsE:0.71,  epsA:0.82,  implied:8.4, guide:"Raised",  react: 7.1 },
  { s:"COST", n:"Costco",         sec:"Retail",     sess:"AMC", month:5, day:29, weekDay:3, epsE:4.04,  epsA:4.11,  implied:2.6, guide:"In-line", react: 2.1 },
  { s:"CRM",  n:"Salesforce",     sec:"Software",   sess:"AMC", month:5, day:29, weekDay:3, epsE:2.38,  epsA:2.61,  implied:4.2, guide:"Raised",  react: 4.8 },
  // ── Jun 15–19 (Last Week) ─────────────────────────────────────────────────
  { s:"ORCL", n:"Oracle",         sec:"Software",   sess:"AMC", month:6, day:16, weekDay:0, epsE:1.68,  epsA:1.74,  implied:3.8, guide:"Raised",  react: 4.2 },
  { s:"ADBE", n:"Adobe",          sec:"Software",   sess:"AMC", month:6, day:17, weekDay:1, epsE:4.62,  epsA:4.78,  implied:5.1, guide:"Raised",  react: 3.8 },
  { s:"DAL",  n:"Delta Air Lines",sec:"Airlines",   sess:"BMO", month:6, day:18, weekDay:2, epsE:1.88,  epsA:2.04,  implied:4.6, guide:"Raised",  react: 5.4 },
  { s:"KR",   n:"Kroger",         sec:"Retail",     sess:"BMO", month:6, day:18, weekDay:2, epsE:1.12,  epsA:1.08,  implied:2.4, guide:"In-line", react:-1.2 },
  { s:"FDX",  n:"FedEx",          sec:"Logistics",  sess:"AMC", month:6, day:18, weekDay:2, epsE:5.41,  epsA:5.62,  implied:4.2, guide:"Raised",  react: 3.8 },
  { s:"NKE",  n:"Nike",           sec:"Consumer",   sess:"AMC", month:6, day:19, weekDay:3, epsE:0.88,  epsA:0.72,  implied:5.8, guide:"Lowered", react:-8.4 },
  // ── Jun 22–26 (This Week) ─────────────────────────────────────────────────
  { s:"GOOG", n:"Alphabet",       sec:"Internet",   sess:"AMC", month:6, day:23, weekDay:1, epsE:1.84,  epsA:1.89,  implied:3.9, guide:"In-line", react: 1.3 },
  { s:"META", n:"Meta Platforms", sec:"Social",     sess:"AMC", month:6, day:23, weekDay:1, epsE:4.71,  epsA:4.86,  implied:5.5, guide:"Raised",  react: 3.2 },
  { s:"MSFT", n:"Microsoft",      sec:"Software",   sess:"AMC", month:6, day:24, weekDay:2, epsE:2.82,  epsA:2.94,  implied:4.1, guide:"In-line", react: 2.1 },
  { s:"WBA",  n:"Walgreens",      sec:"Healthcare", sess:"BMO", month:6, day:25, weekDay:3, epsE:0.21,  epsA:null,  implied:6.2, guide:null,      react:null },
  { s:"PAYX", n:"Paychex",        sec:"Software",   sess:"BMO", month:6, day:25, weekDay:3, epsE:1.41,  epsA:null,  implied:2.8, guide:null,      react:null },
  { s:"CAG",  n:"Conagra Brands", sec:"Staples",    sess:"AMC", month:6, day:25, weekDay:3, epsE:0.64,  epsA:null,  implied:3.2, guide:null,      react:null },
  { s:"AMZN", n:"Amazon",         sec:"E-Commerce", sess:"AMC", month:6, day:26, weekDay:4, epsE:0.98,  epsA:null,  implied:5.8, guide:null,      react:null },
  { s:"AAPL", n:"Apple",          sec:"Hardware",   sess:"AMC", month:6, day:26, weekDay:4, epsE:1.50,  epsA:null,  implied:3.2, guide:null,      react:null },
  // ── Jun 29 – Jul 3 (Next Week) ────────────────────────────────────────────
  { s:"SMCI", n:"Super Micro",    sec:"Hardware",   sess:"AMC", month:6, day:30, weekDay:1, epsE:0.58,  epsA:null,  implied:9.4, guide:null,      react:null },
  { s:"MU",   n:"Micron",         sec:"Semis",      sess:"AMC", month:6, day:30, weekDay:1, epsE:1.18,  epsA:null,  implied:6.8, guide:null,      react:null },
  { s:"LEVI", n:"Levi Strauss",   sec:"Consumer",   sess:"AMC", month:7, day:1,  weekDay:2, epsE:0.32,  epsA:null,  implied:4.4, guide:null,      react:null },
  { s:"STZ",  n:"Constellation",  sec:"Staples",    sess:"BMO", month:7, day:2,  weekDay:3, epsE:3.41,  epsA:null,  implied:3.8, guide:null,      react:null },
  { s:"LEN",  n:"Lennar",         sec:"Real Estate",sess:"AMC", month:7, day:2,  weekDay:3, epsE:3.28,  epsA:null,  implied:4.6, guide:null,      react:null },
  { s:"ACN",  n:"Accenture",      sec:"Consulting", sess:"BMO", month:7, day:3,  weekDay:4, epsE:3.14,  epsA:null,  implied:3.2, guide:null,      react:null },
];

/** Live earnings_events doc -> the row shape this calendar renders. */
function toEarnCalItem(d: LiveEarningsDoc): EarnCalItem {
  const [, m, day] = d.date.split("-").map(Number);
  const dt = new Date(d.date + "T00:00:00Z");
  return {
    s: d.ticker,
    n: d.ticker,        // no company name on the earnings doc
    sec: "—",
    sess: null,         // not supplied by the vendor feed
    month: m, day,
    weekDay: (dt.getUTCDay() + 6) % 7,
    epsE: d.epsEstimate,
    epsA: d.epsActual,
    implied: null,
    guide: null,
    react: null,
  };
}

/** Mock EARN_CAL carries month/day only (no year) — the whole curated window is 2026. */
function isoOfCal(e: EarnCalItem): string {
  return `2026-${String(e.month).padStart(2, "0")}-${String(e.day).padStart(2, "0")}`;
}

/**
 * Earnings rows for one calendar date, blended per-ticker: a live doc's
 * epsEstimate/epsActual override the mock EARN_CAL entry when both exist for
 * the same (ticker, date); a live doc for a ticker outside EARN_CAL entirely
 * still renders (session/guidance/reaction stay unknown, honestly null). This
 * replaces the old whole-tab live-or-mock switch, so the mock catalog and real
 * `earnings_events` data can coexist on the same day instead of one hiding
 * the other.
 */
function rowsForDate(iso: string, live: LiveEarningsDoc[]): EarnCalItem[] {
  const mockOnDate = EARN_CAL.filter(e => isoOfCal(e) === iso);
  const mockTickers = new Set(mockOnDate.map(e => e.s));
  const liveOnDate = live.filter(d => d.date === iso);
  const liveByTicker = new Map(liveOnDate.map(d => [d.ticker, d]));

  const blended = mockOnDate.map(e => {
    const ld = liveByTicker.get(e.s);
    return ld ? { ...e, epsE: ld.epsEstimate ?? e.epsE, epsA: ld.epsActual ?? e.epsA } : e;
  });
  const liveOnly = liveOnDate.filter(d => !mockTickers.has(d.ticker)).map(toEarnCalItem);
  return [...blended, ...liveOnly];
}

function calToEarning(cal: EarnCalItem): Earning {
  return {
    ticker: cal.s, name: cal.n,
    session: cal.sess === "BMO" ? "Before open" : "After close",
    marketCap: "$60B", sector: cal.sec,
    epsEstimate: cal.epsE, epsActual: cal.epsA,
    revenueEstimate: 0, revenueActual: null,
    guidanceStatus: cal.guide, priceReaction: cal.react,
    tags: [], owned: false, impliedMove: cal.implied,
  };
}

// ── Deterministic data helpers ───────────────────────────────────────────────

function parseMcNum(mc: string): number {
  const m = mc.replace(/[$,\s]/g, "");
  if (m.endsWith("T")) return parseFloat(m) * 1000;
  if (m.endsWith("B")) return parseFloat(m);
  if (m.endsWith("M")) return parseFloat(m) / 1000;
  return parseFloat(m) || 60;
}

function earnIncome(s: string, mcStr: string): IncRow[] {
  const si    = stockInfo[s];
  const mc    = parseMcNum(mcStr);
  const price = si?.price ?? 100;
  const rev0  = Math.max(2, mc * 0.02);
  const sh    = Math.max(0.3, mc / price);
  const cols  = ["Q2 25","Q1 25","Q4 24","Q3 24","Q2 24","Q1 24","Q4 23","Q3 23","Q2 23","Q1 23"];
  return cols.map((c, i) => {
    const rev  = rev0 * (1 - i * 0.05);
    const cogs = rev * 0.55;
    const gp   = rev - cogs;
    const opex = rev * 0.22;
    const oi   = gp - opex;
    const ni   = oi * 0.82;
    const eps  = ni / sh;
    return { c, rev, cogs, gp, opex, oi, ni, eps };
  });
}

// ── Calendar toolbar: row shape + illustrative fields not on the live feed ───
//
// The live earnings_events doc carries only ticker/date/epsEstimate/epsActual
// (see toEarnCalItem above) — no market cap, no sales, no YoY comparisons. The
// fields below are deterministic per-ticker (hashStr-seeded, same pattern as
// earnHistory/genOHLC elsewhere in this app) so a given symbol always renders
// the same illustrative numbers rather than reshuffling on every render; they
// are not fetched, and nothing here claims they are.

interface CalRow {
  s: string; n: string; sec: string; sess: "BMO" | "AMC" | null;
  marketCap: number; // $B, deterministic
  epsE: number | null; epsA: number | null; epsSurp: number | null; epsYoY: number | null;
  salesE: number | null; salesA: number | null; salesSurp: number | null; salesYoY: number | null;
  typical: number | null; guide: EarnCalItem["guide"]; react: number | null;
  hasNews: boolean;
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

function fabMarketCap(s: string): number {
  return 2 + (Math.abs(hashStr(s)) % 400); // $2B – $401B
}
function fabSalesEst(s: string, mc: number): number {
  return Math.max(0.05, mc * 0.02 * (1 + (Math.abs(hashStr(s + "s")) % 40) / 100));
}
function fabSalesAct(s: string, est: number): number {
  const surpPct = ((Math.abs(hashStr(s + "sa")) % 21) - 8) / 100; // -8%..+12%
  return est * (1 + surpPct);
}
function fabYoY(s: string, salt: string): number {
  return (Math.abs(hashStr(s + salt)) % 61) - 20; // -20%..+40%
}
function fabHasNews(s: string): boolean {
  return Math.abs(hashStr(s + "news")) % 3 !== 0; // ~2/3 true
}

function toCalRow(item: EarnCalItem): CalRow {
  const marketCap = fabMarketCap(item.s);
  const salesE = fabSalesEst(item.s, marketCap);
  const salesA = item.epsA != null ? fabSalesAct(item.s, salesE) : null;
  return {
    s: item.s, n: item.n, sec: item.sec, sess: item.sess, marketCap,
    epsE: item.epsE, epsA: item.epsA,
    epsSurp: surprise(item.epsE, item.epsA),
    epsYoY: item.epsA != null ? fabYoY(item.s, "ey") : null,
    salesE, salesA,
    salesSurp: surprise(salesE, salesA),
    salesYoY: salesA != null ? fabYoY(item.s, "sy") : null,
    typical: item.implied, guide: item.guide, react: item.react,
    hasNews: fabHasNews(item.s),
  };
}

type CapKey = 0 | 1e8 | 1e9 | 1e10 | 1e11;
const CAPS: [CapKey, string][] = [[0, "All"], [1e8, "100M+"], [1e9, "1B+"], [1e10, "10B+"], [1e11, "100B+"]];
type SortKey = "cap" | "symbol" | "surprise";
const SORTS: [SortKey, string][] = [["cap", "Market Cap"], ["symbol", "Symbol"], ["surprise", "Surprise"]];
type MoveKey = 0 | 3 | 5 | 10;
const MOVES: [MoveKey, string][] = [[0, "Any"], [3, "3%+"], [5, "5%+"], [10, "10%+"]];
type ViewKey = "eps" | "sales";
type SessionKey = "both" | "BMO" | "AMC";

function filterSortRows(
  rows: CalRow[],
  opts: { cap: CapKey; sort: SortKey; minMove: MoveKey; view: ViewKey; hasNews: boolean; session: SessionKey },
): CalRow[] {
  const out = rows
    .filter(r => opts.session === "both" || r.sess === opts.session)
    .filter(r => opts.cap === 0 || r.marketCap * 1e9 >= opts.cap)
    .filter(r => opts.minMove === 0 || Math.abs(r.typical ?? 0) >= opts.minMove)
    .filter(r => !opts.hasNews || r.hasNews);
  out.sort((a, b) => {
    if (opts.sort === "symbol") return a.s.localeCompare(b.s);
    if (opts.sort === "surprise") {
      const av = opts.view === "eps" ? a.epsSurp : a.salesSurp;
      const bv = opts.view === "eps" ? b.epsSurp : b.salesSurp;
      return (bv ?? -Infinity) - (av ?? -Infinity);
    }
    return b.marketCap - a.marketCap;
  });
  return out;
}

/** Filter/sort dropdown chip that closes on select or click-away. */
function Picker<T extends string | number>({
  label, value, options, onPick,
}: { label: string; value: string; options: [T, string][]; onPick: (v: T) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ecal-pick">
      <button className={`ecal-chip${open ? " on" : ""}`} onClick={() => setOpen(o => !o)}>
        {label}: <b>{value}</b>
        <span className="ecal-caret" aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <>
          <div className="ecal-away" onClick={() => setOpen(false)} />
          <div className="ecal-menu">
            {options.map(([v, l]) => (
              <button key={String(v)} className={`ecal-opt${l === value ? " on" : ""}`}
                onClick={() => { onPick(v); setOpen(false); }}>
                {l}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
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

function EpsChart({ hist }: { hist: EarnQ[] }) {
  const d = [...hist].reverse();
  const W = 580, H = 210, PADL = 30, PADR = 18, PADT = 14, PADB = 30;
  const iw = W - PADL - PADR, ih = H - PADT - PADB;
  const allVals = d.flatMap(x => [x.e, x.a]);
  const maxE = Math.max(...allVals) * 1.15 || 1;
  const maxM = Math.max(1, ...d.map(x => Math.abs(x.mv)));
  const n = d.length, gw = iw / n, bw = gw * 0.28;

  const bars: React.ReactElement[] = [];
  const linePts: [number, number][] = [];
  const dots: React.ReactElement[] = [];
  const labels: React.ReactElement[] = [];

  d.forEach((x, i) => {
    const cx = PADL + gw * i + gw / 2;
    const eh = x.e / maxE * ih, ah = x.a / maxE * ih;
    const ex = cx - bw - 2, ax = cx + 2;
    bars.push(
      <rect key={`e${i}`} x={ex} y={PADT + ih - eh} width={bw} height={eh} rx={2} style={{ fill: "var(--surface-3)" }} />,
      <rect key={`a${i}`} x={ax} y={PADT + ih - ah} width={bw} height={ah} rx={2}
        style={{ fill: x.surp >= 0 ? "var(--up)" : "var(--down)" }} />,
    );
    const my = PADT + ih / 2 - (x.mv / maxM) * (ih / 2 - 8);
    linePts.push([cx, my]);
    dots.push(<circle key={`d${i}`} cx={cx} cy={my} r={2.6} style={{ fill: "var(--brand-2)" }} />);
    if (i % 2 === 0 || i === n - 1) {
      labels.push(
        <text key={`l${i}`} x={cx} y={H - 10} textAnchor="middle"
          style={{ fill: "var(--text-dim-solid)", fontSize: "0.5625rem" }}>
          {x.q.replace(" ", "'")}
        </text>
      );
    }
  });

  const linePath = linePts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }}>
      <line x1={PADL} y1={PADT + ih / 2} x2={W - PADR} y2={PADT + ih / 2}
        style={{ stroke: "var(--border)" }} strokeDasharray="3 3" />
      {bars}
      <path d={linePath} style={{ fill: "none", stroke: "var(--brand-2)", strokeWidth: 1.6 }} />
      {dots}
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

// ── Earnings Calls data ──────────────────────────────────────────────────────

interface CallEntry {
  sym: string;
  name: string;
  price: number;
  change: number;
  callDate: string;
  callTime: string;
  session: "BMO" | "AMC";
  title: string;
  duration?: string;
  epsEst: number | null;
  epsAct: number | null;
  revEst: string | null;
  revAct: string | null;
  guide: "Up" | "In-line" | "Down" | null;
  react: number | null;
  summary: string;
  points: string[];
}

const CALLS_DATA: CallEntry[] = [
  {
    sym: "NVDA", name: "NVIDIA Corporation", price: 135.82, change: 3.14,
    callDate: "Jun 4, 2026", callTime: "5:00 PM ET", session: "AMC", title: "Q1 2026 Earnings Call", duration: "62 min",
    epsEst: 0.89, epsAct: 1.04, revEst: "28.2B", revAct: "30.1B", guide: "Up", react: 8.2,
    summary: "NVIDIA posted a blowout quarter driven by relentless demand for its Blackwell GPU architecture across cloud hyperscalers and enterprise AI deployments. Data center revenue hit $26.3B, up 93% YoY. Management raised Q2 guidance significantly above consensus.",
    points: ["Data center revenue +93% YoY to $26.3B", "Blackwell backlog remains 'several quarters' long", "Q2 revenue guide $32–34B vs. $29.8B consensus", "Gross margin expanded 80bps to 73.5%", "Gaming revenue recovered +18% sequentially"],
  },
  {
    sym: "AAPL", name: "Apple Inc.", price: 211.45, change: 1.87,
    callDate: "May 1, 2026", callTime: "5:00 PM ET", session: "AMC", title: "Q2 FY2026 Earnings Call", duration: "55 min",
    epsEst: 1.58, epsAct: 1.65, revEst: "94.1B", revAct: "95.4B", guide: "Up", react: 2.4,
    summary: "Apple beat on both EPS and revenue, led by Services revenue hitting a new record of $26.9B. iPhone volumes came in ahead of expectations on strength in emerging markets. The company announced a $110B buyback authorization.",
    points: ["Services revenue record $26.9B, +15% YoY", "iPhone revenue $46.2B, beat by $1.4B", "New $110B share repurchase program authorized", "India and Southeast Asia drove unit upside", "Gross margin 46.6%, above 46.2% guide"],
  },
  {
    sym: "MSFT", name: "Microsoft Corporation", price: 432.10, change: 2.31,
    callDate: "Apr 30, 2026", callTime: "5:30 PM ET", session: "AMC", title: "Q3 FY2026 Earnings Call", duration: "68 min",
    epsEst: 3.21, epsAct: 3.46, revEst: "68.7B", revAct: "70.1B", guide: "Up", react: 4.6,
    summary: "Microsoft delivered strong beats across all three segments. Azure growth re-accelerated to 35% CC, materially ahead of the 31% consensus. Copilot monetization is ramping with $6B in ARR. Management guided next quarter well above street on continued AI infrastructure build-out.",
    points: ["Azure +35% CC vs. 31% consensus estimate", "Copilot ARR reached $6B, ahead of schedule", "Commercial bookings +23% on multi-year AI deals", "Operating margin expanded 120bps to 44.4%", "LinkedIn revenue +11%, gaming flat YoY"],
  },
  {
    sym: "AMZN", name: "Amazon.com Inc.", price: 198.73, change: 5.02,
    callDate: "May 1, 2026", callTime: "4:30 PM ET", session: "AMC", title: "Q1 2026 Earnings Call", duration: "74 min",
    epsEst: 1.29, epsAct: 1.59, revEst: "155.3B", revAct: "157.2B", guide: "Up", react: 6.8,
    summary: "Amazon's Q1 showed AWS re-acceleration to 21% growth and Advertising crossing $16B for the first time. North America retail returned to double-digit operating margins. Management increased FY2026 capex to $100B+ for AI infrastructure, signaling confidence in demand.",
    points: ["AWS revenue +21% YoY, re-acceleration from 17%", "Advertising $16.0B, +19% YoY", "North America operating margin 6.4%, best in 6 quarters", "Q2 op income guide $13–17.5B vs. $12.9B est.", "Capex raised to $100B+ for 2026"],
  },
  {
    sym: "GOOGL", name: "Alphabet Inc.", price: 174.50, change: -0.83,
    callDate: "Apr 29, 2026", callTime: "4:30 PM ET", session: "AMC", title: "Q1 2026 Earnings Call", duration: "65 min",
    epsEst: 2.01, epsAct: 2.12, revEst: "89.3B", revAct: "90.2B", guide: "In-line", react: 1.2,
    summary: "Alphabet reported solid but not spectacular results. Search revenue held steady with AI Overviews monetizing better than feared. YouTube Shorts ad load is approaching long-form levels. Google Cloud reached 30% growth. The $70B buyback announcement was the key post-market catalyst.",
    points: ["Search & Other $50.7B, +9% YoY — fears overdone", "YouTube ads $8.9B, +10% YoY — Shorts monetizing", "Google Cloud $12.3B, +30% YoY", "Announced $70B incremental buyback", "AI Overviews cost per query declining ahead of plan"],
  },
  {
    sym: "META", name: "Meta Platforms Inc.", price: 522.34, change: 4.55,
    callDate: "Apr 30, 2026", callTime: "4:30 PM ET", session: "AMC", title: "Q1 2026 Earnings Call", duration: "57 min",
    epsEst: 5.14, epsAct: 6.43, revEst: "41.2B", revAct: "42.3B", guide: "Up", react: 7.1,
    summary: "Meta delivered a spectacular quarter. Ad revenue accelerated on AI-driven Advantage+ campaigns, which now represent 42% of total ad spend. Llama 4 is powering recommendations and reducing content moderation costs. Reality Labs losses narrowed more than expected.",
    points: ["Ad revenue +19% YoY; Advantage+ = 42% of spend", "Daily active people 3.43B, +7% YoY", "Llama 4 deployment reducing infra costs by 20%", "Reality Labs op loss narrowed to -$3.4B (est. -$4.1B)", "Q2 revenue guide $42.5–45.5B — well above est."],
  },
  {
    sym: "TSLA", name: "Tesla Inc.", price: 178.92, change: -3.26,
    callDate: "Apr 22, 2026", callTime: "5:30 PM ET", session: "AMC", title: "Q1 2026 Earnings Call", duration: "72 min",
    epsEst: 0.41, epsAct: 0.27, revEst: "21.8B", revAct: "19.3B", guide: "Down", react: -8.4,
    summary: "Tesla missed across the board as automotive margins compressed to 12.5%, the lowest since 2019, amid aggressive price cuts in China and Europe. Deliveries were below even lowered expectations. Management focused heavily on autonomous and Optimus robot timelines, which offered limited near-term financial clarity.",
    points: ["Automotive gross margin 12.5% vs. 14.2% expected", "Deliveries 336K, -16% YoY — 5th consecutive decline", "FSD take rate only 4.2% of new buyers", "Optimus production target 1M units by 2030 reiterated", "Energy storage revenue $2.7B — bright spot"],
  },
  {
    sym: "JPM", name: "JPMorgan Chase & Co.", price: 224.60, change: 1.44,
    callDate: "Apr 11, 2026", callTime: "8:30 AM ET", session: "BMO", title: "Q1 2026 Earnings Call", duration: "61 min",
    epsEst: 4.12, epsAct: 4.44, revEst: "42.6B", revAct: "43.9B", guide: "Up", react: 3.1,
    summary: "JPMorgan crushed Q1 estimates. Net interest income came in ahead of expectations as the rate environment held favorable. Investment banking revenue surged 46% on a reopening deal pipeline. Management raised full-year NII guidance by $2B.",
    points: ["Net interest income $23.4B, +5% vs. est. $22.1B", "Investment banking fees +46% YoY to $2.7B", "Credit card net charge-offs stabilized at 3.6%", "Full-year NII guidance raised to $94B (+$2B)", "CET1 ratio 15.7% — excess capital building"],
  },
  {
    sym: "BAC", name: "Bank of America Corp.", price: 42.18, change: 0.34,
    callDate: "Apr 15, 2026", callTime: "6:30 AM ET", session: "BMO", title: "Q1 2026 Earnings Call", duration: "58 min",
    epsEst: 0.82, epsAct: 0.90, revEst: "25.4B", revAct: "26.1B", guide: "In-line", react: 1.7,
    summary: "BofA posted a solid beat driven by stronger NII and better-than-feared consumer credit quality. Wealth management AUM hit a record $4.1T. Management guided for flat NII sequentially in Q2, roughly in line with consensus.",
    points: ["NII $14.2B, beat by $400M on deposit repricing", "Merrill Lynch AUM record $4.1T, +12% YoY", "Consumer credit card losses declined 20bps QoQ", "Efficiency ratio improved to 63.8% vs. 65.1% prior", "Common equity Tier 1 ratio 13.4%"],
  },
  {
    sym: "AMD", name: "Advanced Micro Devices", price: 156.44, change: 6.23,
    callDate: "Apr 29, 2026", callTime: "5:00 PM ET", session: "AMC", title: "Q1 2026 Earnings Call", duration: "66 min",
    epsEst: 0.68, epsAct: 0.96, revEst: "7.1B", revAct: "7.7B", guide: "Up", react: 9.5,
    summary: "AMD shattered expectations. MI300X GPU sales are exceeding AMD's own forecasts with data center GPU revenue hitting $2.3B — a new record and triple the prior-year quarter. Client and embedded segments are recovering. Management raised the FY2026 data center GPU forecast to $10B+.",
    points: ["Data center GPU revenue $2.3B, triple YoY", "FY2026 data center GPU target raised to $10B+", "MI300X outperforming H100 in memory bandwidth benchmarks", "PC client segment +29% on Ryzen AI refresh", "Embedded recovery accelerating, +22% QoQ"],
  },
  {
    sym: "INTC", name: "Intel Corporation", price: 21.38, change: -4.12,
    callDate: "Apr 24, 2026", callTime: "4:30 PM ET", session: "AMC", title: "Q1 2026 Earnings Call", duration: "78 min",
    epsEst: 0.01, epsAct: -0.17, revEst: "12.8B", revAct: "12.7B", guide: "Down", react: -7.3,
    summary: "Intel's Q1 showed continued margin pressure as the foundry segment posted a $1.4B operating loss. PC client revenue held up but server share losses to AMD are ongoing. Management trimmed workforce by a further 3,000 and reduced the FY2026 capex plan. A Foundry strategic review is ongoing.",
    points: ["Foundry segment op loss -$1.4B, wider than -$1.1B est.", "Server (DCAI) revenue -8% YoY; AMD share gains accelerating", "FY2026 capex reduced to $18B (from $21B)", "Additional 3,000 headcount reduction announced", "Intel 18A process yield still below internal targets"],
  },
  {
    sym: "CRM", name: "Salesforce Inc.", price: 298.44, change: 2.77,
    callDate: "May 28, 2026", callTime: "5:00 PM ET", session: "AMC", title: "Q1 FY2027 Earnings Call", duration: "63 min",
    epsEst: 2.61, epsAct: 2.98, revEst: "9.12B", revAct: "9.38B", guide: "Up", react: 4.4,
    summary: "Salesforce had a standout quarter as Agentforce AI adoption drove a 17% beat in professional services and accelerated upsell across the existing base. RPO grew 22% to $63B — the strongest in six quarters. Management raised FY2027 revenue guide by $400M.",
    points: ["Agentforce deployed at 4,000+ customers, up from 200 in Q4", "RPO +22% to $63B — six-quarter high", "Operating margin 32.1%, +280bps YoY", "FY2027 revenue guide raised to $37.7–37.9B", "Data Cloud users +35% — new monetization layer emerging"],
  },
  {
    sym: "NFLX", name: "Netflix Inc.", price: 892.45, change: 3.88,
    callDate: "Apr 15, 2026", callTime: "4:00 PM ET", session: "AMC", title: "Q1 2026 Earnings Call", duration: "48 min",
    epsEst: 5.68, epsAct: 6.61, revEst: "10.4B", revAct: "10.5B", guide: "Up", react: 5.2,
    summary: "Netflix delivered a strong quarter with operating margin expanding to 29.2%, new subscriber disclosure replaced by engagement disclosures. Advertising tier now has 94M monthly active users. Live events strategy — sports and WWE — is driving a step-up in total viewing hours.",
    points: ["Ad-supported tier: 94M MAUs, 40% of new sign-ups", "Operating margin 29.2%, guide for 29.5% in Q2", "Engagement up 14% YoY to 98M hours/day globally", "WWE Raw and NFL Christmas games boosted Q1 hours", "Password-sharing enforcement now complete — tailwinds fading"],
  },
  {
    sym: "V", name: "Visa Inc.", price: 287.33, change: 1.22,
    callDate: "Apr 23, 2026", callTime: "5:00 PM ET", session: "AMC", title: "Q2 FY2026 Earnings Call", duration: "52 min",
    epsEst: 2.68, epsAct: 2.88, revEst: "9.0B", revAct: "9.3B", guide: "In-line", react: 2.0,
    summary: "Visa posted steady growth driven by cross-border travel volumes that remained 10% above 2019 levels. US consumer spending was resilient despite macro uncertainty. New flows and value-added services are the incremental growth drivers, now comprising 22% of net revenue.",
    points: ["Cross-border volume +14% YoY, still above 2019", "US consumer spending +7% — resilient through rate pressure", "New flows (B2B, gov) +20% YoY", "Value-added services 22% of net revenue — fastest growing segment", "Buyback $4.0B in Q2; $14B remaining authorization"],
  },
  {
    sym: "JNJ", name: "Johnson & Johnson", price: 157.82, change: 0.44,
    callDate: "Apr 15, 2026", callTime: "8:00 AM ET", session: "BMO", title: "Q1 2026 Earnings Call", duration: "56 min",
    epsEst: 2.55, epsAct: 2.71, revEst: "21.6B", revAct: "21.9B", guide: "In-line", react: 1.3,
    summary: "J&J delivered a solid in-line quarter. MedTech segment outperformed with robotic surgery driving procedure volumes higher. The pharmaceutical segment saw Darzalex continue its dominance in multiple myeloma while TREMFYA posted strong psoriasis share gains. Management reaffirmed FY2026 guidance.",
    points: ["Darzalex revenue $3.0B, +22% YoY — market share 57%", "MedTech +8% on robotic surgery and Abiomed strength", "TREMFYA $1.5B, gaining on Humira biosimilar entrants", "FY2026 EPS guidance reaffirmed at $10.50–10.70", "Innovative Med pipeline: 6 new FDA submissions in Q2"],
  },
  {
    sym: "WMT", name: "Walmart Inc.", price: 98.44, change: 2.11,
    callDate: "May 15, 2026", callTime: "8:00 AM ET", session: "BMO", title: "Q1 FY2027 Earnings Call", duration: "59 min",
    epsEst: 0.58, epsAct: 0.61, revEst: "168.0B", revAct: "169.6B", guide: "Up", react: 3.4,
    summary: "Walmart outperformed on all metrics. US comparable sales rose 5.0% led by grocery market share gains from higher-income households and strong private label penetration. Walmart+ membership is approaching 40M. Advertising revenue hit $1.6B — an 18-month consecutive record.",
    points: ["US comp sales +5.0% — 8th consecutive acceleration quarter", "Higher-income (>$100K) shopper growth driving mix", "Walmart+ approaching 40M members", "Advertising revenue $1.6B, +26% YoY", "FY2027 EPS guide raised by $0.10 to $2.52–2.57"],
  },
  {
    sym: "DIS", name: "The Walt Disney Company", price: 111.20, change: -2.55,
    callDate: "May 7, 2026", callTime: "5:00 PM ET", session: "AMC", title: "Q2 FY2026 Earnings Call", duration: "64 min",
    epsEst: 1.20, epsAct: 1.04, revEst: "22.6B", revAct: "22.1B", guide: "Down", react: -4.8,
    summary: "Disney missed consensus with weaker-than-expected Parks & Experiences revenue as domestic park attendance softened on macro pressures and rising competition. Streaming reached profitability but below the seasonal high. Management lowered Parks segment operating income guidance for the full year.",
    points: ["Parks & Experiences op income -9% on attendance softness", "Disney+ net adds 4.3M, slightly below 5.1M est.", "Streaming combined profit $0.9B — below Q1's $0.97B", "Parks full-year op income guide cut by ~$500M", "Content impairments $0.8B related to legacy IP writedowns"],
  },
  /* ── Upcoming calls ── */
  {
    sym: "ORCL", name: "Oracle Corporation", price: 148.30, change: 0.88,
    callDate: "Jun 9, 2026", callTime: "5:00 PM ET", session: "AMC", title: "Q4 FY2026 Earnings Call",
    epsEst: 1.62, epsAct: null, revEst: "14.7B", revAct: null, guide: null, react: null,
    summary: "", points: [],
  },
  {
    sym: "ADBE", name: "Adobe Inc.", price: 396.10, change: -0.41,
    callDate: "Jun 11, 2026", callTime: "5:00 PM ET", session: "AMC", title: "Q2 FY2026 Earnings Call",
    epsEst: 4.98, epsAct: null, revEst: "5.84B", revAct: null, guide: null, react: null,
    summary: "", points: [],
  },
  {
    sym: "FDX", name: "FedEx Corporation", price: 282.44, change: 1.03,
    callDate: "Jun 24, 2026", callTime: "5:30 PM ET", session: "AMC", title: "Q4 FY2026 Earnings Call",
    epsEst: 5.41, epsAct: null, revEst: "21.8B", revAct: null, guide: null, react: null,
    summary: "", points: [],
  },
  {
    sym: "COST", name: "Costco Wholesale", price: 918.75, change: 2.14,
    callDate: "Jun 26, 2026", callTime: "5:00 PM ET", session: "AMC", title: "Q3 FY2026 Earnings Call",
    epsEst: 4.01, epsAct: null, revEst: "61.4B", revAct: null, guide: null, react: null,
    summary: "", points: [],
  },
  {
    sym: "TGT", name: "Target Corporation", price: 138.90, change: -0.72,
    callDate: "Jun 18, 2026", callTime: "8:00 AM ET", session: "BMO", title: "Q1 FY2027 Earnings Call",
    epsEst: 1.88, epsAct: null, revEst: "24.0B", revAct: null, guide: null, react: null,
    summary: "", points: [],
  },
  {
    sym: "NKE", name: "Nike Inc.", price: 82.14, change: 0.31,
    callDate: "Jun 26, 2026", callTime: "4:15 PM ET", session: "AMC", title: "Q4 FY2026 Earnings Call",
    epsEst: 0.29, epsAct: null, revEst: "11.2B", revAct: null, guide: null, react: null,
    summary: "", points: [],
  },
  {
    sym: "SBUX", name: "Starbucks Corporation", price: 89.22, change: 0.57,
    callDate: "Jul 29, 2026", callTime: "5:00 PM ET", session: "AMC", title: "Q3 FY2026 Earnings Call",
    epsEst: 0.52, epsAct: null, revEst: "9.2B", revAct: null, guide: null, react: null,
    summary: "", points: [],
  },
  {
    sym: "GS", name: "Goldman Sachs Group", price: 544.80, change: 1.92,
    callDate: "Jul 14, 2026", callTime: "8:30 AM ET", session: "BMO", title: "Q2 2026 Earnings Call",
    epsEst: 9.18, epsAct: null, revEst: "13.8B", revAct: null, guide: null, react: null,
    summary: "", points: [],
  },
  {
    sym: "WDAY", name: "Workday Inc.", price: 268.30, change: 1.12,
    callDate: "Jun 30, 2026", callTime: "4:30 PM ET", session: "AMC", title: "Q1 FY2027 Earnings Call",
    epsEst: 1.82, epsAct: null, revEst: "2.21B", revAct: null, guide: null, react: null,
    summary: "", points: [],
  },
  {
    sym: "GIS", name: "General Mills Inc.", price: 72.40, change: -0.88,
    callDate: "Jul 2, 2026", callTime: "8:00 AM ET", session: "BMO", title: "Q4 FY2026 Earnings Call",
    epsEst: 1.02, epsAct: null, revEst: "5.11B", revAct: null, guide: null, react: null,
    summary: "", points: [],
  },
  {
    sym: "LULU", name: "Lululemon Athletica", price: 312.80, change: 0.54,
    callDate: "Jul 2, 2026", callTime: "4:15 PM ET", session: "AMC", title: "Q1 FY2027 Earnings Call",
    epsEst: 2.61, epsAct: null, revEst: "2.45B", revAct: null, guide: null, react: null,
    summary: "", points: [],
  },
];

// ── Earnings call calendar helpers ───────────────────────────────────────────



function CallDrawer({ call, onClose, playing, onTogglePlay, initialTab = "summary" }: {
  call: CallEntry; onClose: () => void; playing: boolean; onTogglePlay: () => void;
  initialTab?: "summary" | "transcript";
}) {
  const [activeTab, setActiveTab] = useState<"summary" | "transcript">(initialTab);

  const beat = call.epsAct !== null && call.epsEst !== null && call.epsAct > call.epsEst;
  const miss = call.epsAct !== null && call.epsEst !== null && call.epsAct < call.epsEst;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="side-drawer">
        {/* Header */}
        <div className="drawer-h">
          <StockLogo sym={call.sym} size={38} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)" }}>
              {call.sym} · {call.name}
            </div>
            <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", marginTop: 2 }}>
              ${fmt(call.price)}{" "}
              <span className={cls(call.change)}>{sign(call.change)}</span>
              {" · "}{call.callDate} · {call.session}
            </div>
          </div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-b">
          {/* Call title + play button */}
          <div style={{
            display: "flex", alignItems: "center", gap: 12, marginBottom: 14,
            background: "var(--surface-1)", borderRadius: 12, padding: 14,
            border: "1px solid var(--border-soft)",
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: "var(--text-hi)", fontSize: ".95rem" }}>{call.title}</div>
              <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", marginTop: 3 }}>
                {call.callTime}{call.duration ? ` · ${call.duration}` : ""}
                {call.epsAct === null && (
                  <span className="pill" style={{ background: "var(--warn-dim, rgba(255,186,0,.15))", color: "var(--warn)", marginLeft: 6, fontSize: ".64rem" }}>
                    Upcoming
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onTogglePlay}
              style={{
                width: 42, height: 42, borderRadius: "50%",
                background: playing ? "var(--brand-2)" : "var(--surface-2)",
                border: `1px solid ${playing ? "var(--brand-2)" : "var(--border)"}`,
                color: playing ? "#000" : "var(--text-hi)",
                fontSize: "1rem", cursor: "pointer", display: "flex",
                alignItems: "center", justifyContent: "center", flexShrink: 0,
                transition: ".18s",
              }}
            >
              {playing ? "⏸" : "▶"}
            </button>
          </div>

          {/* Mock audio progress bar */}
          {playing && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ height: 4, background: "var(--border-soft)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: "22%", height: "100%", background: "var(--brand-2)", borderRadius: 2 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 4 }}>
                <span>12:43</span>
                <span>{call.duration ?? "—"}</span>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="tabs" style={{ marginBottom: 16 }}>
            <button className={`tab${activeTab === "summary" ? " on" : ""}`} onClick={() => setActiveTab("summary")}>AI Summary</button>
            <button className={`tab${activeTab === "transcript" ? " on" : ""}`} onClick={() => setActiveTab("transcript")}>Full Transcript</button>
          </div>

          {activeTab === "summary" && (
            <>
              {/* EPS / Rev metric grid */}
              {call.epsAct !== null && (
                <div className="metric-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
                  <div className="m">
                    <div className="k">EPS Est</div>
                    <div className="v">{call.epsEst ?? "—"}</div>
                  </div>
                  <div className="m">
                    <div className="k">EPS Act</div>
                    <div className={`v ${beat ? "up" : miss ? "dn" : ""}`}>{call.epsAct}</div>
                    {beat && <div className="s up">Beat</div>}
                    {miss && <div className="s dn">Miss</div>}
                  </div>
                  <div className="m">
                    <div className="k">Rev Est</div>
                    <div className="v" style={{ fontSize: ".9rem" }}>{call.revEst ?? "—"}</div>
                  </div>
                  <div className="m">
                    <div className="k">Rev Act</div>
                    <div className="v" style={{ fontSize: ".9rem" }}>{call.revAct ?? "—"}</div>
                  </div>
                </div>
              )}

              {/* Guidance + Reaction pills */}
              {(call.guide || call.react !== null) && (
                <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                  {call.guide && (
                    <span className="pill" style={{
                      background: call.guide === "Up" ? "var(--up-dim)" : call.guide === "Down" ? "var(--down-dim)" : "var(--surface-3)",
                      color: call.guide === "Up" ? "var(--up)" : call.guide === "Down" ? "var(--down)" : "var(--text-dim-solid)",
                    }}>
                      Guidance: {call.guide}
                    </span>
                  )}
                  {call.react !== null && (
                    <span className={`pill ${call.react >= 0 ? "up" : "dn"}`}>
                      Reaction: {call.react > 0 ? "+" : ""}{call.react}%
                    </span>
                  )}
                </div>
              )}

              {/* Summary */}
              {call.summary ? (
                <>
                  <p style={{ fontSize: ".88rem", color: "var(--text)", lineHeight: 1.65, marginBottom: 14 }}>
                    {call.summary}
                  </p>
                  <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-dim-solid)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
                    Main Points
                  </div>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                    {call.points.map((pt, i) => (
                      <li key={i} style={{ display: "flex", gap: 10, fontSize: ".85rem", color: "var(--text)", lineHeight: 1.5 }}>
                        <span style={{ width: 18, height: 18, borderRadius: 5, background: "var(--brand-2)", color: "#000", fontWeight: 800, fontSize: ".65rem", display: "grid", placeItems: "center", flexShrink: 0, marginTop: 1 }}>
                          {i + 1}
                        </span>
                        {pt}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div style={{ padding: "28px 0", textAlign: "center", color: "var(--text-dim-solid)", fontSize: ".88rem" }}>
                  Call summary will be available after the call.
                </div>
              )}
            </>
          )}

          {activeTab === "transcript" && (
            <div style={{ fontSize: ".82rem", color: "var(--text)", lineHeight: 1.75 }}>
              {call.epsAct === null ? (
                <div style={{ padding: "28px 0", textAlign: "center", color: "var(--text-dim-solid)" }}>
                  Transcript will be available after the call.
                </div>
              ) : (
                <>
                  <p><b style={{ color: "var(--text-dim-solid)" }}>Operator:</b> Good {"BMO" === call.session ? "morning" : "afternoon"} and welcome to the {call.title} for {call.name}. As a reminder, this conference call is being recorded. I will now turn the call over to the Investor Relations team. Please go ahead.</p>
                  <p style={{ marginTop: 12 }}><b style={{ color: "var(--text-dim-solid)" }}>IR:</b> Thank you. Good {"BMO" === call.session ? "morning" : "afternoon"} everyone. Joining us today are our Chief Executive Officer and Chief Financial Officer. Before we begin, I would like to remind you that this call contains forward-looking statements that are subject to risks and uncertainties. Please refer to our most recent SEC filings for a description of the risk factors that may affect our results. We will now begin with prepared remarks.</p>
                  <p style={{ marginTop: 12 }}><b style={{ color: "var(--text-dim-solid)" }}>CEO:</b> Thank you, and good {"BMO" === call.session ? "morning" : "afternoon"} to everyone joining us. We are pleased to report strong results for the quarter. {call.summary.split(".")[0]}. Our team continues to execute exceptionally well against our long-term strategic priorities.</p>
                  <p style={{ marginTop: 12 }}><b style={{ color: "var(--text-dim-solid)" }}>CFO:</b> Thank you. Let me take you through the financial details. {call.points[0] ?? "We delivered solid results across all segments."}. {call.points[1] ?? "Margins expanded as we continue to optimize our cost structure."}. We remain confident in our guidance for the balance of the year.</p>
                  <p style={{ marginTop: 12, color: "var(--text-dim-solid)", fontStyle: "italic", fontSize: ".76rem" }}>— Transcript continues. Q&A session follows prepared remarks. —</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Company bios ─────────────────────────────────────────────────────────────

const COMPANY_BIO: Record<string, string> = {
  AAPL:  "Apple designs and sells iPhones, Macs, iPads, and wearables while growing its high-margin Services business including the App Store, iCloud, and Apple Pay. Services is now the most profitable segment and the key driver of multiple expansion.",
  MSFT:  "Microsoft is a global technology leader with enterprise software (Office 365, Windows), Azure cloud computing, and AI services powered by its OpenAI partnership. Azure is the company's fastest-growing segment and the main earnings driver.",
  NVDA:  "NVIDIA designs the world's leading data center GPUs for AI training and inference. Blackwell architecture demand is driving unprecedented revenue growth, with hyperscaler backlogs extending several quarters and data center revenue up 90%+ year-over-year.",
  AMZN:  "Amazon is the world's largest e-commerce marketplace and cloud computing provider through AWS. The company also operates a fast-growing advertising business now crossing $60B in annualized revenue, with AWS margins expanding as AI workloads ramp.",
  GOOG:  "Alphabet operates Google Search, YouTube, Google Cloud, and Waymo. Revenue is primarily advertising-driven with Cloud growing at 30%+ and AI Overviews monetizing better than feared, supporting the long-term ad revenue base.",
  GOOGL: "Alphabet operates Google Search, YouTube, Google Cloud, and Waymo. Revenue is primarily advertising-driven with Cloud growing at 30%+ and AI Overviews monetizing better than feared, supporting the long-term ad revenue base.",
  META:  "Meta Platforms owns Facebook, Instagram, and WhatsApp, reaching over 3 billion daily active users. AI-driven Advantage+ ad campaigns and Llama 4 integration are accelerating revenue growth and reducing infrastructure costs simultaneously.",
  TSLA:  "Tesla designs and manufactures electric vehicles, battery storage, and solar products globally. Near-term earnings are pressured by automotive margin compression from price cuts, while energy storage and autonomous (FSD/Optimus) represent long-term optionality.",
  AMD:   "Advanced Micro Devices designs high-performance CPUs and GPUs for data centers, gaming, and embedded applications. MI300X AI accelerators are gaining significant share against NVIDIA with data center GPU revenue tripling year-over-year.",
  INTC:  "Intel is a legacy semiconductor manufacturer undergoing a multi-year turnaround, competing in CPUs, AI accelerators, and foundry services. The company is managing significant losses in its Intel Foundry segment while facing ongoing share losses to AMD.",
  JPM:   "JPMorgan Chase is the largest US bank by assets, with leading positions in consumer banking, investment banking, and asset management. Net interest income remains a key earnings driver and the firm benefits from its scale in volatile markets.",
  BAC:   "Bank of America is the second-largest US bank, heavily exposed to retail deposits and consumer credit. The company benefits disproportionately from higher-for-longer rates through its large fixed-rate bond portfolio repricing over time.",
  CRM:   "Salesforce is the world's leading CRM platform, serving sales, service, marketing, and commerce teams. Its Agentforce AI product is accelerating upsell across the installed base and driving higher total contract values per customer.",
  NFLX:  "Netflix is the world's largest streaming service with 270M+ subscribers globally. The advertising-supported tier is scaling rapidly with 94M monthly active users, and live events strategy — sports and WWE — is driving total viewing hour growth.",
  V:     "Visa operates the world's largest payment network, processing trillions in volume annually across 200+ countries. Growth is driven by cross-border travel recovery, B2B payment digitization, and value-added services now at 22% of net revenue.",
  JNJ:   "Johnson & Johnson is a global healthcare company with leading MedTech and pharmaceutical divisions. Key drugs Darzalex and TREMFYA are growing strongly while the MedTech segment benefits from robotic surgery procedure volume recovery.",
  WMT:   "Walmart is the world's largest retailer by revenue operating 10,500+ stores globally with a fast-growing e-commerce platform. Higher-income shoppers trading down from premium grocers and advertising revenue growth are the two key earnings catalysts.",
  DIS:   "The Walt Disney Company operates theme parks, studios, cruise lines, and streaming through Disney+, Hulu, and ESPN+. Streaming has reached profitability while Parks & Experiences faces near-term pressure from macroeconomic softness in domestic attendance.",
  QCOM:  "Qualcomm is the world's leading mobile chipmaker, supplying Snapdragon processors for Android smartphones. The company is diversifying into automotive, IoT, and AI-on-device markets to reduce its handset concentration risk.",
  UBER:  "Uber operates a global mobility and food delivery platform across 70+ countries with 150M+ active users. The business generates strong network effects and is generating consistent EBITDA profitability as Delivery and Freight segments mature.",
  ARM:   "Arm Holdings licenses CPU and GPU architectures to semiconductor manufacturers worldwide. Virtually every smartphone chip uses Arm designs, and the company is expanding into AI inference, data center, and edge computing markets.",
  CSCO:  "Cisco Systems is the dominant provider of enterprise networking equipment including routers, switches, and security appliances. The company is pivoting to software and subscription revenue through its networking, collaboration, and observability platforms.",
  HD:    "Home Depot is the largest home improvement retailer in the US with 2,300+ stores serving DIY and professional customers. Pro contractor revenue is an increasingly large portion of sales and tends to be higher-ticket and more recurring.",
  TGT:   "Target is a national mass-merchandise retailer offering groceries, apparel, home goods, and electronics. The company is working to recover discretionary spending share after aggressive inventory corrections and pricing pressure from competition.",
  SNOW:  "Snowflake provides a cloud-native data platform enabling organizations to store, query, and share data across multiple cloud providers. Its consumption-based model makes revenue growth closely tied to enterprise AI data workload expansion.",
  MDB:   "MongoDB provides a flexible document-oriented database platform used by developers worldwide. Its Atlas cloud database product is the fastest-growing segment, with AI vector search capabilities expanding the addressable market significantly.",
  COST:  "Costco operates a membership-only warehouse club with over 130 million members globally. Its low-price model, strong Kirkland private label, and membership fee income create a deeply loyal customer base and predictable recurring earnings.",
  ORCL:  "Oracle is a cloud applications and database company with a fast-growing Infrastructure Cloud (OCI) division. AI workload demand has filled its data centers and driven a multi-year backlog, with revenue guidance being raised materially.",
  ADBE:  "Adobe provides creative software (Photoshop, Illustrator, Premiere), document management (Acrobat), and marketing analytics tools. AI-powered Firefly features are expanding its content creation addressable market and driving meaningful upsell activity.",
  DAL:   "Delta Air Lines is one of the world's largest carriers, differentiated by its premium cabin mix and American Express co-brand credit card partnership generating $7B+ in annual revenue. Domestic and international travel demand remains resilient.",
  KR:    "Kroger is the largest traditional US grocery chain with 2,700+ stores and a strong loyalty data platform. The company faces ongoing margin pressure from labor cost inflation and competitive pricing, with digital grocery a key investment area.",
  FDX:   "FedEx is a global logistics and express delivery company operating in 220+ countries. The company is executing its multi-year DRIVE cost reduction program targeting $4B+ in savings, improving operating margin structurally as volumes normalize.",
  NKE:   "Nike is the world's largest athletic footwear and apparel brand selling through wholesale, direct-to-consumer, and its own digital platform. The company is working to stabilize volumes in North America and China after an inventory reset.",
  SMCI:  "Super Micro Computer manufactures high-performance server and storage solutions for AI and data center applications. The company is a key AI infrastructure supplier but has faced accounting restatement and Nasdaq compliance challenges.",
  MU:    "Micron Technology manufactures DRAM and NAND memory chips for AI servers, PCs, smartphones, and automotive. Its HBM3E high-bandwidth memory for AI accelerators is a fast-growing, highly profitable product driving significant margin improvement.",
  LEVI:  "Levi Strauss is a global denim apparel brand with the iconic Levi's, Dockers, and Beyond Yoga labels. The company is growing its direct-to-consumer channel to improve margins and reduce dependence on wholesale department store accounts.",
  STZ:   "Constellation Brands is a leading beverage alcohol company with premium Mexican beer brands including Corona, Modelo, and Pacifico. Beer segment operating margins consistently exceed 37%, driven by strong premiumization trends in the US Hispanic market.",
  LEN:   "Lennar is one of the largest US homebuilders operating across 20+ states. The company benefits from a significant structural housing supply shortage and has used mortgage rate buydowns effectively to maintain order pace despite elevated rates.",
  ACN:   "Accenture is a global professional services firm providing strategy, consulting, digital transformation, and managed services to enterprises in 120+ countries. AI-related consulting engagements are growing rapidly and expanding total engagement size.",
  WBA:   "Walgreens Boots Alliance operates one of the largest pharmacy retail chains in the US and Europe with 8,700+ locations. The company is undergoing a strategic transformation to expand healthcare services amid declining retail pharmacy foot traffic.",
  PAYX:  "Paychex is a leading provider of payroll, HR, and benefits administration services to small and medium-sized businesses. The company generates highly recurring SaaS-like revenue from its 745,000+ client base with strong retention rates.",
  CAG:   "Conagra Brands is a packaged food company with brands including Slim Jim, Birds Eye, Duncan Hines, and Hunt's. The company is navigating volume pressure from consumer trade-down while managing input cost inflation across its grocery portfolio.",
};

// ── Upcoming IPOs panel ───────────────────────────────────────────────────────
// Live-only, no mock fallback: an IPO date is either scheduled by the vendor
// feed or it isn't, and the panel says so rather than inventing a pipeline.

function formatIpoPriceRange(low: number | null, high: number | null): string {
  if (low == null && high == null) return "—";
  if (low != null && high != null && low !== high) return `$${low.toFixed(2)}–$${high.toFixed(2)}`;
  return `$${(low ?? high)!.toFixed(2)}`;
}

function IpoPanel({ ipos }: { ipos: IpoEventDoc[] }) {
  const [open, setOpen] = useState(true);
  const today = isoDay(new Date());
  const upcoming = ipos
    .filter(i => i.date >= today && i.status !== "withdrawn")
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 15);

  return (
    <div className="ecal-ipo">
      <button className="ecal-ipo-h" onClick={() => setOpen(o => !o)}>
        <span className="ecal-ipo-icon" aria-hidden>▲</span>
        Upcoming IPOs <span className="ecal-ipo-n">{upcoming.length}</span>
        <span className="ecal-ipo-chev" aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        upcoming.length === 0 ? (
          <div className="ecal-empty" style={{ border: "none", borderRadius: 0 }}>No upcoming IPOs scheduled.</div>
        ) : (
          <div className="ecal-tablewrap">
            <table className="ecal-table">
              <thead>
                <tr>
                  <th>Symbol</th><th>Company</th><th>Exchange</th>
                  <th className="r">Price range</th><th className="r">Est. market cap</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map(i => (
                  <tr key={i.id}>
                    <td className="ecal-sym">{i.symbol ?? "—"}</td>
                    <td>{i.name}</td>
                    <td>{i.exchange ?? "—"}</td>
                    <td className="r ecal-num">{formatIpoPriceRange(i.priceLow, i.priceHigh)}</td>
                    <td className="r ecal-num">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

// ── Day-view table (Before Open / After Close) ────────────────────────────────

function CalTable({
  title, rows, sel, onSelect,
}: { title: string; rows: CalRow[]; sel: string; onSelect: (s: string) => void }) {
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
              <th className="r">Mkt Cap</th>
              <th className="r">Est EPS</th>
              <th className="r">EPS</th>
              <th className="r">EPS Surp</th>
              <th className="r">EPS YoY</th>
              <th className="r">Est Sales</th>
              <th className="r">Sales</th>
              <th className="r">Sales Surp</th>
              <th className="r">Sales YoY</th>
              <th className="r">Typical</th>
              <th>Guidance</th>
              <th className="r">Reaction</th>
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
                <td className="r ecal-num">${r.marketCap.toFixed(1)}B</td>
                <td className="r ecal-num">{r.epsE != null ? `$${r.epsE.toFixed(2)}` : "—"}</td>
                <td className="r ecal-num">{r.epsA != null ? `$${r.epsA.toFixed(2)}` : "—"}</td>
                <td className={`r ecal-num ${fmtUpDn(r.epsSurp)}`}>{fmtPctSigned(r.epsSurp)}</td>
                <td className={`r ecal-num ${fmtUpDn(r.epsYoY)}`}>{fmtPctSigned(r.epsYoY)}</td>
                <td className="r ecal-num">{r.salesE != null ? `$${r.salesE.toFixed(1)}B` : "—"}</td>
                <td className="r ecal-num">{r.salesA != null ? `$${r.salesA.toFixed(1)}B` : "—"}</td>
                <td className={`r ecal-num ${fmtUpDn(r.salesSurp)}`}>{fmtPctSigned(r.salesSurp)}</td>
                <td className={`r ecal-num ${fmtUpDn(r.salesYoY)}`}>{fmtPctSigned(r.salesYoY)}</td>
                <td className="r ecal-num">{r.typical != null ? `±${r.typical.toFixed(1)}%` : "—"}</td>
                <td>{r.guide ?? "—"}</td>
                <td className={`r ecal-num ${fmtUpDn(r.react)}`}>{fmtPctSigned(r.react, 1)}</td>
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
  const [autoRefresh, setAutoRefresh] = useState(false);
  const { data: liveEarnings } = useApiList<LiveEarningsDoc>("/market-data/earnings", autoRefresh ? 300_000 : undefined);
  const { data: liveIpos } = useApiList<IpoEventDoc>("/market-data/ipos");
  // Manual refresh (⟳ button) bypasses the polling interval with a one-shot
  // fetch, merged in ahead of whatever the hooks above last returned.
  const [manualEarnings, setManualEarnings] = useState<LiveEarningsDoc[] | null>(null);
  const [manualIpos, setManualIpos] = useState<IpoEventDoc[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const liveEarningsData = manualEarnings ?? liveEarnings;
  const liveIposData = manualIpos ?? liveIpos;
  async function refreshNow() {
    setRefreshing(true);
    try {
      const [e, i] = await Promise.all([
        apiGet<LiveEarningsDoc[]>("/market-data/earnings"),
        apiGet<IpoEventDoc[]>("/market-data/ipos"),
      ]);
      setManualEarnings(e);
      setManualIpos(i);
    } catch {
      // Swallow — the polling/initial fetch already surfaces errors via its own state.
    }
    setRefreshing(false);
  }

  const [mode, setMode]     = useState<"day" | "week">("day");
  const [anchor, setAnchor] = useState<string>(() => isoDay(new Date()));
  const [session, setSession] = useState<SessionKey>("both");
  const [cap, setCap]         = useState<CapKey>(0);
  const [sort, setSort]       = useState<SortKey>("cap");
  const [minMove, setMinMove] = useState<MoveKey>(0);
  const [view, setView]       = useState<ViewKey>("eps");
  const [hasNewsOnly, setHasNewsOnly] = useState(false);
  const [pickerOpen, setPickerOpen]   = useState(false);

  const [sel, setSel]           = useState<string>("GOOG");
  const [selectedCall,   setSelectedCall]   = useState<CallEntry | null>(null);
  const [playingCallSym, setPlayingCallSym] = useState<string | null>(null);
  const [cardPlaying,     setCardPlaying]     = useState<string | null>(null);
  const [aiModalSym,      setAiModalSym]      = useState<string | null>(null);

  // ET clock next to "Auto 5m" — ticks on its own timer, independent of
  // whether polling is actually on, so it never implies a fetch that didn't happen.
  const [nowTick, setNowTick] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const etClock = nowTick.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

  const weekMon   = mondayOf(new Date(`${anchor}T00:00:00Z`));
  const weekDays5 = [0, 1, 2, 3, 4].map(i => isoDay(addDays(weekMon, i)));

  const filterOpts = { cap, sort, minMove, view, hasNews: hasNewsOnly };
  const dayRows   = rowsForDate(anchor, liveEarningsData).map(toCalRow);
  const bmoRows   = filterSortRows(dayRows, { ...filterOpts, session: "BMO" });
  const amcRows   = filterSortRows(dayRows, { ...filterOpts, session: "AMC" });
  const visibleRows = session === "both" ? [...bmoRows, ...amcRows] : session === "BMO" ? bmoRows : amcRows;

  const anchorDate = new Date(`${anchor}T00:00:00Z`);
  const DOW3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateLabel = `${DOW3[anchorDate.getUTCDay()]}, ${MON3[anchorDate.getUTCMonth()]} ${anchorDate.getUTCDate()}, ${anchorDate.getUTCFullYear()}`;

  /** Navigate to a date and, like the old per-tab navigation, select its first
   *  reporting ticker — computed directly here rather than via an effect, so
   *  the update lands in the same render as the click instead of cascading. */
  function goToDate(iso: string) {
    setAnchor(iso);
    const first = rowsForDate(iso, liveEarningsData)[0];
    if (first) setSel(first.s);
  }
  const step = (dir: 1 | -1) => goToDate(isoDay(addDays(anchorDate, mode === "day" ? dir : dir * 7)));

  const capLabel  = CAPS.find(([v]) => v === cap)?.[1] ?? "All";
  const sortLabel = SORTS.find(([v]) => v === sort)?.[1] ?? "Market Cap";
  const moveLabel = MOVES.find(([v]) => v === minMove)?.[1] ?? "Any";
  const viewLabel = view === "eps" ? "EPS" : "Sales";

  // ── Calendar rendering ────────────────────────────────────────────────────

  let calNode: React.ReactNode;

  if (mode === "day") {
    calNode = (
      <>
        {(session === "both" || session === "BMO") && <CalTable title="Before Open" rows={bmoRows} sel={sel} onSelect={setSel} />}
        {(session === "both" || session === "AMC") && <CalTable title="After Close" rows={amcRows} sel={sel} onSelect={setSel} />}
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
  } else {
    calNode = (
      <div className="ec-grid">
        {weekDays5.map((iso, di) => {
          const items = rowsForDate(iso, liveEarningsData).map(toCalRow);
          const bmo = filterSortRows(items, { ...filterOpts, session: "BMO" });
          const amc = filterSortRows(items, { ...filterOpts, session: "AMC" });
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
            </div>
          );
        })}
      </div>
    );
  }

  // ── Detail section ────────────────────────────────────────────────────────

  const baseEarning: Earning = earnings.find(e => e.ticker === sel)
    ?? (() => { const cal = EARN_CAL.find(e => e.s === sel); return cal ? calToEarning(cal) : calToEarning(EARN_CAL[0]); })();

  const liveMatches = liveEarnings.filter(e => e.ticker === sel).sort((a, b) => b.date.localeCompare(a.date));
  const liveMatch = liveMatches[0];
  const isLiveEarning = !!liveMatch && (liveMatch.epsEstimate != null || liveMatch.epsActual != null);
  const selEarning: Earning = isLiveEarning
    ? { ...baseEarning, epsEstimate: liveMatch.epsEstimate ?? baseEarning.epsEstimate, epsActual: liveMatch.epsActual ?? baseEarning.epsActual }
    : baseEarning;

  const _si   = stockInfo[sel];
  const _base = Math.max(0.05, ((_si?.price ?? 100) / (_si?.peRatio ?? 25)) / 4);
  const hist  = earnHistory(sel, _base);
  const inc   = earnIncome(sel, selEarning?.marketCap ?? "$60B");
  const beats = hist.filter(h => h.surp > 0).length;
  const avgMv = (hist.reduce((a, h) => a + Math.abs(h.mv), 0) / hist.length).toFixed(1);

  const fmtB = (v: number) => v >= 1 ? `$${v.toFixed(2)}B` : `$${(v * 1000).toFixed(0)}M`;

  const aiRead = selEarning
    ? `${sel} ${selEarning.epsActual != null
        ? (selEarning.epsEstimate != null && selEarning.epsActual >= selEarning.epsEstimate ? "beat" : "missed") + " EPS estimates"
        : "reports " + selEarning.session
      }. Guidance ${selEarning.guidanceStatus === "Raised" ? "was raised — bullish" : selEarning.guidanceStatus === "Lowered" ? "was lowered — watch downside" : "was maintained"}. ${selEarning.priceReaction != null ? `Shares reacted ${sign(selEarning.priceReaction)} on the print.` : `Options imply a ±${selEarning.impliedMove}% move.`}`
    : `${sel} reports next quarter.`;

  return (
    <>
      {/* ── Calendar toolbar ───────────────────────────────────────────── */}
      <div className="ecal" style={{ marginBottom: 16 }}>
        <div className="ecal-top">
          <div className="ecal-nav">
            <button className="ecal-arrow" onClick={() => step(-1)} aria-label="Previous">‹</button>
            <div style={{ position: "relative" }}>
              <div className="ecal-date" onClick={() => setPickerOpen(o => !o)} style={{ cursor: "pointer" }} title="Pick a date">
                {dateLabel} <span aria-hidden style={{ fontSize: ".7em", opacity: .7 }}>▾</span>
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
            <button className={`ecal-segbtn${mode === "week" ? " on" : ""}`} onClick={() => setMode("week")}>Week</button>
            <button className={`ecal-segbtn${mode === "day" ? " on" : ""}`} onClick={() => setMode("day")}>Day</button>
          </div>
        </div>

        <div className="ecal-filters">
          <div className="ecal-seg">
            <button className={`ecal-segbtn${session === "BMO" ? " on" : ""}`} onClick={() => setSession("BMO")}>Before Open</button>
            <button className={`ecal-segbtn${session === "AMC" ? " on" : ""}`} onClick={() => setSession("AMC")}>After Close</button>
            <button className={`ecal-segbtn${session === "both" ? " on" : ""}`} onClick={() => setSession("both")}>Both</button>
          </div>
          <Picker label="Cap" value={capLabel} options={CAPS} onPick={setCap} />
          <Picker label="Sort" value={sortLabel} options={SORTS} onPick={setSort} />
          <Picker label="Min move" value={moveLabel} options={MOVES} onPick={setMinMove} />
          <Picker label="View" value={viewLabel} options={[["eps", "EPS"], ["sales", "Sales"]] as [ViewKey, string][]} onPick={setView} />
          <button className={`ecal-chip ecal-toggle${hasNewsOnly ? " on" : ""}`} onClick={() => setHasNewsOnly(v => !v)}>
            Has news
          </button>
          <button className="ecal-arrow" title="Refresh now" onClick={refreshNow} disabled={refreshing} style={{ marginLeft: "auto" }}>
            {refreshing ? "⋯" : "⟳"}
          </button>
          <label className="ecal-chip" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} style={{ marginRight: 5 }} />
            Auto 5m
          </label>
          <span style={{ fontSize: ".76rem", color: "var(--text-dim-solid)", fontFamily: "var(--f-mono)" }}>{etClock} ET</span>
        </div>

        <IpoPanel ipos={liveIposData} />

        {/* ── Calendar ─────────────────────────────────────────────────── */}
        {calNode}
      </div>

      {/* ── Selected company inline detail (below calendar, no drawer) ── */}
      {selEarning && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <StockLogo sym={sel} size={36} />
              <div>
                <span style={{ fontWeight: 700, color: "var(--text-hi)", fontSize: ".95rem" }}>{sel}</span>
                <span style={{ color: "var(--text-dim-solid)", fontSize: ".78rem", marginLeft: 8 }}>{selEarning.name} · {selEarning.sector}</span>
              </div>
              <span className={`pill ${selEarning.session.includes("pre") || selEarning.session.includes("Before") ? "bmo" : "amc"}`} style={{ marginLeft: 4 }}>
                {selEarning.session}
              </span>
              {isLiveEarning && (
                <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)" }}>live EPS · FMP</span>
              )}
              {/* Action buttons — inline, same row */}
              <div style={{ display: "flex", gap: 6, marginLeft: 4 }}>
              <button
                title={cardPlaying === sel ? "Pause earnings call" : "Play earnings call"}
                onClick={() => setCardPlaying(p => p === sel ? null : sel)}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: cardPlaying === sel ? "var(--brand-dim, rgba(99,102,241,.15))" : "var(--surface-2)",
                  border: `1px solid ${cardPlaying === sel ? "var(--brand-2)" : "var(--border-soft)"}`,
                  borderRadius: 8, padding: "5px 10px", cursor: "pointer",
                  color: cardPlaying === sel ? "var(--brand-2)" : "var(--text)", fontSize: ".75rem", fontWeight: 600,
                  transition: ".15s",
                }}
              >
                {cardPlaying === sel
                  ? <svg viewBox="0 0 24 24" width={12} height={12} fill="currentColor"><path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>
                  : <svg viewBox="0 0 24 24" width={12} height={12} fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>}
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
            {(COMPANY_BIO[sel] ?? stockInfo[sel]?.aiThesis) && (
              <p style={{ fontSize: ".82rem", color: "var(--text)", lineHeight: 1.6, marginBottom: 14, marginTop: 0 }}>
                {COMPANY_BIO[sel] ?? stockInfo[sel]?.aiThesis}
              </p>
            )}
            <div className="metric-grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginBottom: 12 }}>
              <div className="m">
                <div className="k">EPS estimate</div>
                <div className="v">{selEarning.epsEstimate != null ? `$${selEarning.epsEstimate.toFixed(2)}` : "—"}</div>
              </div>
              <div className="m">
                <div className="k">EPS actual</div>
                {selEarning.epsActual != null
                  ? <div className={`v ${selEarning.epsEstimate != null && selEarning.epsActual >= selEarning.epsEstimate ? "up" : "down"}`}>${selEarning.epsActual.toFixed(2)}</div>
                  : <div className="v" style={{ color: "var(--text-dim-solid)" }}>Pending</div>}
              </div>
              <div className="m">
                <div className="k">Guidance</div>
                <div className={`v ${selEarning.guidanceStatus === "Raised" ? "up" : selEarning.guidanceStatus === "Lowered" ? "down" : ""}`} style={{ fontSize: ".95rem" }}>
                  {selEarning.guidanceStatus ?? "—"}
                </div>
              </div>
              <div className="m">
                <div className="k">{selEarning.priceReaction != null ? "Reaction" : "Implied move"}</div>
                {selEarning.priceReaction != null
                  ? <div className={`v ${cls(selEarning.priceReaction)}`}>{sign(selEarning.priceReaction)}</div>
                  : <div className="v" style={{ color: "var(--warn)" }}>±{selEarning.impliedMove}%</div>}
              </div>
            </div>
            <p style={{ fontSize: ".82rem", color: "var(--text-dim-solid)", margin: 0 }}>{aiRead}</p>
          </div>
        </div>
      )}

      {/* ── Detail: EPS history + Income statement ─────────────────────── */}
      <div className="dash" style={{ marginTop: 16 }}>
        {/* col-6: 10-quarter EPS history */}
        <div className="col-6">
          <div className="card">
            <div className="card-h">
              <h3>{sel} · 10-quarter earnings history</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {selEarning?.priceReaction != null
                  ? <span className={`pill ${selEarning.priceReaction >= 0 ? "up" : "dn"}`}>{sign(selEarning.priceReaction)} last reaction</span>
                  : beats >= 7
                    ? <span className="pill up">{beats}/10 beats</span>
                    : beats < 5
                    ? <span className="pill dn">{beats}/10 beats</span>
                    : <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>{beats}/10 beats</span>}
                <ExpandBtn title={`${sel} · 10-quarter earnings history`} node={<EpsChart hist={hist} />} />
              </div>
            </div>
            <div className="card-b" style={{ paddingTop: 8 }}>
              <div className="ec-legend">
                <span><i style={{ background: "var(--surface-3)" }} /> EPS estimate</span>
                <span><i style={{ background: "var(--up)" }} /> Beat</span>
                <span><i style={{ background: "var(--down)" }} /> Miss</span>
                <span><i className="ln" style={{ background: "var(--brand-2)" }} /> Stock move %</span>
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
                        <th className="num">Stock move</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hist.map(h => (
                        <tr key={h.q}>
                          <td><b style={{ color: "var(--text-hi)" }}>{h.q}</b></td>
                          <td className="num">${h.e.toFixed(2)}</td>
                          <td className="num">${h.a.toFixed(2)}</td>
                          <td className={`num ${cls(h.surp)}`}>{sign(h.surp)}</td>
                          <td className={`num ${cls(h.mv)}`}>{sign(h.mv)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          </div>
        </div>

        {/* col-6: Income statement */}
        <div className="col-6">
          <div className="card">
            <div className="card-h">
              <h3>{sel} · Income statement</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>Quarterly</span>
                <ExpandBtn title={`${sel} · Income statement`} node={<IncChart inc={inc} />} />
              </div>
            </div>
            <div className="card-b" style={{ paddingTop: 8 }}>
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
            {aiRead}{" "}History shows{" "}
            <b style={{ color: "var(--text-hi)" }}>{beats}/10 beats</b>{" "}
            and an average post-print move of{" "}
            <b style={{ color: "var(--text-hi)" }}>{avgMv}%</b>.{" "}
            Watch revenue growth and forward guidance most.{" "}
            <button className="btn" style={{ marginLeft: 8, padding: "4px 10px" }}
              onClick={() => openStockFull(sel)}>
              Open full stock page →
            </button>
          </p>
        </div>
      </div>


      {/* Earnings call detail drawer */}
      {selectedCall && (
        <CallDrawer
          call={selectedCall}
          onClose={() => setSelectedCall(null)}
          playing={playingCallSym === selectedCall.sym}
          onTogglePlay={() => setPlayingCallSym(p => p === selectedCall.sym ? null : selectedCall.sym)}
          initialTab="summary"
        />
      )}

      {/* AI analysis modal */}
      {aiModalSym && (() => {
        const call = CALLS_DATA.find(c => c.sym === aiModalSym);
        return (
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
                {call ? (
                  <>
                    <div style={{ fontSize: ".72rem", color: "var(--ai)", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 10 }}>
                      {call.title} · {call.callDate}
                    </div>
                    <p style={{ fontSize: ".88rem", lineHeight: 1.65, color: "var(--text)", margin: "0 0 14px" }}>
                      {call.summary}
                    </p>
                    {call.points && call.points.length > 0 && (
                      <>
                        <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 8 }}>
                          Key takeaways
                        </div>
                        <ul style={{ margin: 0, padding: "0 0 0 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                          {call.points.map((pt, i) => (
                            <li key={i} style={{ fontSize: ".83rem", color: "var(--text)", lineHeight: 1.5 }}>{pt}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    <div style={{ marginTop: 16, fontSize: ".72rem", color: "var(--text-dim-solid)", fontStyle: "italic" }}>
                      AI-generated summary based on earnings call transcript. Full transcript integration coming soon.
                    </div>
                  </>
                ) : (
                  <p style={{ fontSize: ".88rem", color: "var(--text-dim-solid)", margin: 0 }}>
                    No AI analysis available for {aiModalSym} yet.
                  </p>
                )}
              </div>
            </div>
          </>
        );
      })()}
    </>
  );
}
