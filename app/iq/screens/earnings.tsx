"use client";

import { useState, useRef, useEffect } from "react";
import { useIQActions, ExpandBtn } from "../shell";
import { cls, sign, EarnQ, StockLogo, NotAvailable, DataState, VendorTag } from "../utils";
import { useNarrationVoice, applyNarrationVoice, pickNarrationVoice } from "../speech";
import { ChartCard } from "../stock-panel";
import { EpsSalesWidget } from "../eps-sales-widget";
import { EarningsPlaybook } from "./EarningsPlaybook";
import { backendUrl } from "../backend";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import type { LiveEarningsDoc, CompanyDoc, FinancialsDoc, QuarterFinancials, AnnualFinancials, EarningsAnnouncementDoc, AnalystConsensusDoc } from "../types";
import { isoDay, addDays, mondayOf } from "../calendar-range";
import { surprisePct, reportedQuarterEps, quarterEpsSurprisePct } from "../types";

// Live source (Polygon SEC financials) has ticker/date/epsEstimate/epsActual —
// no session (BMO/AMC), guidance, price reaction, implied move, or quarterly
// financials. The selected-company detail card below only ever shows real
// numbers (EPS estimate/actual from this feed, financials from GET
// /live/financials) — fields with no live source render as NotAvailable/
// DataState instead of the illustrative mock this file used to blend in.

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
  epsAYearAgo: number | null; revYearAgo: number | null; // same fiscal quarter, prior year
  date: string; // ISO report date — used to group the snapshot across a week/month
  /** Direction the company moved its own guidance, from the 8-K press release. */
  guide: "raised" | "cut" | "mixed" | "reaffirmed" | null;
  /** Guidance range as the company wrote it, e.g. "$4.10 to $4.30". */
  guideRange: string | null;
  /** The sentence the direction came from — shown as the cell's tooltip. */
  guideSnippet: string | null;
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
    epsAYearAgo: d.epsActualYearAgo ?? null,
    revYearAgo: d.revenueYearAgo ?? null,
    date: d.date,
    guide: null,
    guideRange: null,
    guideSnippet: null,
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

/** Local (est, act) argument order over the shared derivation. */
const surprise = (est: number | null, act: number | null): number | null =>
  surprisePct(act, est);

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

function filterSortRows(rows: CalRow[], opts: { sort: SortKey; session: SessionKey; mcap?: Map<string, number> }): CalRow[] {
  const out = rows.filter(r => opts.session === "both" || r.sess === opts.session);
  out.sort((a, b) => {
    // Market-cap descending is the primary order (largest companies first);
    // ties and unknowns (mcap 0) fall back to alphabetical.
    if (opts.mcap) {
      const d = (opts.mcap.get(b.s) ?? 0) - (opts.mcap.get(a.s) ?? 0);
      if (d !== 0) return d;
      return a.s.localeCompare(b.s);
    }
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
// Real earnings-call transcript from FMP (GET /live/earnings-transcript). FMP
// carries the transcript TEXT, not call audio, so "Play" reads the transcript
// aloud via the browser's built-in speech synthesis — no audio vendor needed.

interface TranscriptDoc {
  ticker: string;
  quarter?: number | null;
  year?: number | null;
  date?: string | null;
  content?: string | null;
  hasTranscript?: boolean;
}

/**
 * Splits transcript text into short sentence groups for speech. Chrome cuts a
 * single SpeechSynthesisUtterance off after ~15s, so we queue many small ones;
 * pause/resume then acts on the whole queue as one.
 */
function chunkForSpeech(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [clean];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > 220 && cur) { chunks.push(cur.trim()); cur = s; }
    else cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

function CallDrawer({ sym, onClose }: { sym: string; onClose: () => void }) {
  const { data, loading } = useApiResource<TranscriptDoc>(
    `/live/earnings-transcript?ticker=${encodeURIComponent(sym)}`,
  );
  const content = data?.content ?? "";
  const hasTx = !!data?.hasTranscript && content.trim().length > 0;
  const paras = hasTx ? content.split(/\n+/).map(p => p.trim()).filter(Boolean) : [];

  const period = [
    data?.quarter ? `Q${data.quarter}` : null,
    data?.year ?? null,
  ].filter(Boolean).join(" ");

  // ── Text-to-speech play / pause ──
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [tts, setTts] = useState<"idle" | "playing" | "paused">("idle");
  const chunks = useRef<string[]>([]);
  // Without this the utterances get the platform default voice, which is the
  // legacy formant synth on every major OS — the "computerised" sound.
  const voice = useNarrationVoice(ttsSupported);

  // Rebuild the speech queue when the transcript changes; stop any prior speech.
  useEffect(() => {
    chunks.current = chunkForSpeech(content);
    if (ttsSupported) window.speechSynthesis.cancel();
    setTts("idle");
  }, [content, ttsSupported]);

  // Never keep talking after the drawer closes.
  useEffect(() => () => { if (ttsSupported) window.speechSynthesis.cancel(); }, [ttsSupported]);

  function play() {
    if (!ttsSupported || !hasTx) return;
    const synth = window.speechSynthesis;
    if (tts === "paused") { synth.resume(); setTts("playing"); return; }
    synth.cancel();
    // The voice list can still be loading on a very early first click, so resolve
    // once more here rather than falling back to the robotic default.
    const v = voice ?? pickNarrationVoice(synth.getVoices());
    for (const c of chunks.current) {
      const u = new SpeechSynthesisUtterance(c);
      applyNarrationVoice(u, v);
      u.onend = () => { if (!synth.pending && !synth.speaking) setTts("idle"); };
      synth.speak(u);
    }
    setTts("playing");
  }
  function pause() {
    if (!ttsSupported) return;
    window.speechSynthesis.pause();
    setTts("paused");
  }

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
            <div style={{ fontSize: ".76rem", color: "var(--text-dim-solid)", display: "flex", alignItems: "center", gap: 6 }}>
              {hasTx
                ? `Transcript${period ? ` · ${period}` : ""}${data?.date ? ` · ${String(data.date).slice(0, 10)}` : ""}`
                : "Earnings-call transcript"}
              <VendorTag v="fmp" />
            </div>
          </div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-b">
          {!hasTx ? (
            <DataState loading={loading} label={`No earnings-call transcript available for ${sym} yet.`} />
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                {ttsSupported && (
                  <button
                    onClick={tts === "playing" ? pause : play}
                    className="btn primary"
                    style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
                  >
                    {tts === "playing"
                      ? <><span style={{ fontSize: ".9em" }}>❚❚</span> Pause</>
                      : <><span style={{ fontSize: ".9em" }}>▶</span> {tts === "paused" ? "Resume" : "Read aloud"}</>}
                  </button>
                )}
                <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)" }}>
                  live · FMP transcript
                </span>
                {tts === "playing"
                  ? <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>Reading aloud…</span>
                  : ttsSupported && <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>text-to-speech narration of the transcript</span>}
              </div>
              <div style={{ fontSize: ".84rem", lineHeight: 1.6, color: "var(--text)" }}>
                {paras.map((p, i) => (
                  <p key={i} style={{ marginBottom: 10, whiteSpace: "pre-wrap" }}>{p}</p>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── Day-view table (Before Open / After Close) ────────────────────────────────

// Max ticker logos/rows shown before an overflow "+N" — shared by the day
// tables, the week columns, and the month cells so all three views cap alike.
const MAX_CAL_LOGOS = 24;
// The at-a-glance snapshot shows this many rows per session (per side) before
// its "+N more" toggle.
const GLANCE_MAX = 25;

/** One row of the at-a-glance snapshot — the Earnings-Hub "results" layout:
 *  actual vs consensus EPS + surprise, revenue actual/consensus, and the
 *  same-quarter-a-year-ago comparables. Everything comes from Polygon + FMP;
 *  Guidance is intentionally absent (no vendor feed for it). */
/**
 * Guidance the company issued in its own 8-K press release — NOT analyst
 * consensus, and not derived from news headlines (measured: 22 guidance
 * headlines per month across the whole feed, most misattributed by Polygon's
 * multi-ticker tagging). A dash means the release did not state a direction,
 * which is the honest answer for roughly half of reporters.
 */
function GuidanceCell({ it }: { it: EarnCalItem }) {
  if (!it.guide) {
    // A stored range with no direction still tells the reader something.
    return it.guideRange
      ? <span style={{ color: "var(--text-dim-solid)" }} title={`Guidance issued: ${it.guideRange}`}>{it.guideRange}</span>
      : <span style={{ color: "var(--text-dim-solid)" }}>—</span>;
  }
  const label = { raised: "Raised", cut: "Cut", mixed: "Mixed", reaffirmed: "Reaffirmed" }[it.guide];
  const arrow = it.guide === "raised" ? "\u25B2" : it.guide === "cut" ? "\u25BC" : "";
  const cls = it.guide === "raised" ? "up" : it.guide === "cut" ? "dn" : "";
  const tip = [it.guideRange ? `Guidance: ${it.guideRange}` : null, it.guideSnippet]
    .filter(Boolean).join("  —  ");
  return (
    <span className={cls} title={tip || label} style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
      {arrow && <span style={{ fontSize: ".8em", marginRight: 3 }}>{arrow}</span>}{label}
    </span>
  );
}

/** How many reported quarters the expanded row shows. */
const GLANCE_HISTORY_QUARTERS = 4;

/**
 * The last four reported quarters for one ticker, shown inside an expanded
 * at-a-glance row.
 *
 * Fetched lazily — `useApiResource(null)` skips the request entirely, so the
 * per-ticker /live/financials call only happens the first time a row is opened.
 * The alternative, prefetching for every row, would fire 25 requests to render
 * a panel nobody had asked to see yet.
 *
 * The market-wide /market-data/earnings feed can NOT serve this: it holds ~10
 * months of the calendar, which is 2-3 rows per ticker (measured: 13,236 rows
 * over 5,516 tickers, IREN has 2). Four quarters of history only exists on the
 * per-ticker financials doc.
 *
 * EPS uses reportedQuarterEps / quarterEpsSurprisePct — the FMP matched
 * (actual, estimate) pair on one basis — never the raw GAAP epsActual, so the
 * beat/miss here agrees with every other beat/miss in the app.
 */
interface GlanceQuarterRow {
  key: string;
  period: string;
  reported: string | null;
  act: number | null;
  est: number | null;
  surp: number | null;
  revenue: number | null;
}

function GlanceQuarters({ ticker, colSpan }: { ticker: string; colSpan: number }) {
  const { data, loading } = useApiResource<FinancialsDoc>(
    `/live/financials?ticker=${encodeURIComponent(ticker)}`,
  );

  // Newest first. The vendor already returns them in that order, but a doc
  // written by an older sync run cannot be assumed to be sorted.
  const quarters: QuarterFinancials[] = [...(data?.quarters ?? [])]
    .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""));

  // Revenue lives only on `quarters`, so index it to join onto the EPS series.
  const revByPeriod = new Map<string, number | null>(
    quarters.map(q => [`${q.fiscalYear}-${q.fiscalPeriod}`, q.revenue]),
  );

  /**
   * Rows come from `epsHistory` (deep FMP reported EPS), NOT from `quarters`.
   *
   * `quarters` is the Polygon SEC-filing series and it lags: measured on CSCO,
   * `quarters` topped out at Q2 FY2026 (filed 2026-02-17) while epsHistory
   * already carried Q3 (2026-05-13) and Q4 (2026-08-12) — so a quarters-driven
   * panel omitted the two newest reports, including the very one its own row
   * describes ($1.22 vs $1.17 on 08-12). epsHistory is also the basis
   * reportedAnnualEps uses, so the numbers agree with the rest of the app.
   *
   * Rows with no actual are upcoming quarters carrying only an estimate
   * (CSCO has a Q1 FY2027 row dated 2026-11-11) — dropped, since this panel is
   * about what was reported.
   */
  const fromHistory: GlanceQuarterRow[] = (data?.epsHistory ?? [])
    .filter(h => h.epsActual != null)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, GLANCE_HISTORY_QUARTERS)
    .map(h => ({
      key: `${h.fiscalYear}-${h.fiscalPeriod}-${h.date}`,
      period: [h.fiscalPeriod, h.fiscalYear].filter(Boolean).join(" "),
      reported: h.date ?? null,
      act: h.epsActual,
      est: h.epsEstimate,
      surp: surprisePct(h.epsActual, h.epsEstimate),
      revenue: revByPeriod.get(`${h.fiscalYear}-${h.fiscalPeriod}`) ?? null,
    }));

  // Docs synced before epsHistory existed have only `quarters`; fall back so
  // those tickers still get a panel rather than an empty one.
  const fromQuarters: GlanceQuarterRow[] = quarters
    .slice(0, GLANCE_HISTORY_QUARTERS)
    .map((q, i) => ({
      key: `${q.fiscalYear}-${q.fiscalPeriod}-${q.endDate}-${i}`,
      period: [q.fiscalPeriod, q.fiscalYear].filter(Boolean).join(" "),
      // Filing date is when it was actually reported; endDate (quarter close)
      // is the fallback when the filing carries no date.
      reported: q.filingDate ?? q.endDate ?? null,
      act: reportedQuarterEps(q),
      est: q.epsEstimateReported ?? q.epsEstimate,
      surp: quarterEpsSurprisePct(q),
      revenue: q.revenue,
    }));

  const rows = fromHistory.length > 0 ? fromHistory : fromQuarters;

  return (
    <tr className="ecal-exp-row">
      <td colSpan={colSpan} style={{ padding: 0 }}>
        <div className="ecal-exp">
          <div className="ecal-exp-h">
            Last {GLANCE_HISTORY_QUARTERS} reported quarters · {ticker}
            <VendorTag v={["polygon", "fmp"]} />
          </div>
          {rows.length === 0 ? (
            <DataState loading={loading} label={`No reported quarters on file for ${ticker}.`} />
          ) : (
            <table className="ecal-exp-tbl">
              <thead>
                <tr>
                  <th>Quarter</th>
                  <th className="r">Reported</th>
                  <th className="r">EPS act</th>
                  <th className="r">EPS est</th>
                  <th className="r">Surprise</th>
                  <th className="r">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key}>
                    <td>{r.period || r.reported || "—"}</td>
                    <td className="r ecal-num" style={{ color: "var(--text-dim-solid)" }}>{r.reported ?? "—"}</td>
                    <td className="r ecal-num">{r.act != null ? `$${r.act.toFixed(2)}` : "—"}</td>
                    <td className="r ecal-num" style={{ color: "var(--text-dim-solid)" }}>
                      {r.est != null ? `$${r.est.toFixed(2)}` : "—"}
                    </td>
                    <td className={`r ecal-num ${fmtUpDn(r.surp)}`}>{fmtPctSigned(r.surp)}</td>
                    <td className="r ecal-num">{fmtRev(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </td>
    </tr>
  );
}

function GlanceRow({ it, showDate, onSelect, colSpan }: { it: EarnCalItem; showDate: boolean; onSelect: (s: string, date: string) => void; colSpan: number }) {
  const epsSurp = surprise(it.epsE, it.epsA);
  const yoyRev = surprise(it.revYearAgo, it.revA); // (rev - yearAgo)/|yearAgo|
  const [open, setOpen] = useState(false);
  return (
    <>
    <tr onClick={() => onSelect(it.s, it.date)} style={{ cursor: "pointer" }}>
      <td>
        <div className="ecal-symcell">
          {/* Its own control rather than a whole-row toggle: clicking the row
              still opens the ticker's detail view, which is the primary action
              and predates this. stopPropagation keeps the two apart. */}
          <button
            type="button"
            className={`ecal-caret${open ? " open" : ""}`}
            aria-expanded={open}
            aria-label={open ? `Hide quarters for ${it.s}` : `Show last ${GLANCE_HISTORY_QUARTERS} quarters for ${it.s}`}
            title={open ? "Hide recent quarters" : "Show last 4 reported quarters"}
            onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
          >
            ▸
          </button>
          <StockLogo sym={it.s} size={28} />
          <div>
            <div className="ecal-sym">{it.s}</div>
            {it.n !== it.s && <div className="ecal-name">{it.n}</div>}
          </div>
        </div>
      </td>
      {showDate && <td className="r ecal-num" style={{ whiteSpace: "nowrap", color: "var(--text-dim-solid)" }}>{it.date ? it.date.slice(5) : "—"}</td>}
      <td className={`r ecal-num ${fmtUpDn(epsSurp)}`}>{fmtPctSigned(epsSurp)}</td>
      <td className="r ecal-num">{it.epsA != null ? `$${it.epsA.toFixed(2)}` : "—"}</td>
      <td className="r ecal-num">{it.epsE != null ? `$${it.epsE.toFixed(2)}` : "—"}</td>
      <td className="r ecal-num" style={{ color: "var(--text-dim-solid)" }}>{it.epsAYearAgo != null ? `$${it.epsAYearAgo.toFixed(2)}` : "—"}</td>
      <td className="r ecal-num">{fmtRev(it.revA)}</td>
      <td className="r ecal-num">{fmtRev(it.revE)}</td>
      <td className={`r ecal-num ${fmtUpDn(yoyRev)}`}>{fmtPctSigned(yoyRev)}</td>
      <td className="r ecal-num"><GuidanceCell it={it} /></td>
    </tr>
    {/* Mounted only while open, so closing a row also drops its fetched doc —
        25 open rows would otherwise hold 25 financials docs alive for the rest
        of the session. */}
    {open && <GlanceQuarters ticker={it.s} colSpan={colSpan} />}
    </>
  );
}

type GlanceSortKey =
  | "company" | "date" | "surprise" | "actual" | "consensus"
  | "yearAgo" | "actualRev" | "consRev" | "yoyRev" | "guidance";

/** Direction a column starts in on first click — text ascends (A→Z), numbers
 *  and dates descend (biggest / most recent first). Mirrors movers.tsx. */
const GLANCE_FIRST_DIR: Record<GlanceSortKey, "asc" | "desc"> = {
  company: "asc", date: "desc", surprise: "desc", actual: "desc",
  consensus: "desc", yearAgo: "desc", actualRev: "desc", consRev: "desc",
  yoyRev: "desc", guidance: "desc",
};

/** Guidance ordered by how favourable it is, so a descending sort surfaces
 *  raises first and cuts last. A range with no stated direction ranks above
 *  nothing at all; a blank cell has no value and sorts to the end either way. */
const GUIDANCE_RANK: Record<string, number> = {
  raised: 5, reaffirmed: 4, mixed: 3, cut: 2,
};
function guidanceValue(it: EarnCalItem): number | null {
  if (it.guide) return GUIDANCE_RANK[it.guide] ?? null;
  return it.guideRange ? 1 : null;
}

function glanceValue(it: EarnCalItem, k: GlanceSortKey): number | string | null {
  switch (k) {
    case "company":   return it.s;
    case "date":      return it.date || null;
    case "surprise":  return surprise(it.epsE, it.epsA);
    case "actual":    return it.epsA;
    case "consensus": return it.epsE;
    case "yearAgo":   return it.epsAYearAgo;
    case "actualRev": return it.revA;
    case "consRev":   return it.revE;
    case "yoyRev":    return surprise(it.revYearAgo, it.revA);
    case "guidance":  return guidanceValue(it);
  }
}

/** Missing values sort to the BOTTOM in both directions — a blank is not
 *  "smallest", and flipping direction should not fill the top with dashes. */
function compareGlance(a: EarnCalItem, b: EarnCalItem, k: GlanceSortKey, dir: 1 | -1): number {
  const x = glanceValue(a, k), y = glanceValue(b, k);
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  if (typeof x === "string" || typeof y === "string") {
    return String(x).localeCompare(String(y)) * dir;
  }
  return (x - y) * dir;
}

function GlanceTable({ title, items, showDate, onSelect }: { title: string; items: EarnCalItem[]; showDate: boolean; onSelect: (s: string, date: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [sortKey, setSortKey] = useState<GlanceSortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  if (items.length === 0) return null;

  /** First click applies the column's natural direction, the second toggles,
   *  the third clears back to the incoming largest-cap-first ordering. */
  const toggleSort = (k: GlanceSortKey) => {
    if (sortKey !== k) { setSortKey(k); setSortDir(GLANCE_FIRST_DIR[k]); return; }
    if (sortDir === GLANCE_FIRST_DIR[k]) { setSortDir(sortDir === "asc" ? "desc" : "asc"); return; }
    setSortKey(null);
  };
  /** Plain render helper, not a nested component, so React does not remount
   *  the header row on every parent render. */
  const sortTh = (k: GlanceSortKey, label: string, right = true) => (
    <th
      className={right ? "r" : undefined}
      onClick={() => toggleSort(k)}
      title={`Sort by ${label}`}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
    >
      {label}
      {/* Always a FILLED glyph in brand violet, dimmed when inactive — same as
          movers.tsx / insider.tsx. A hollow glyph for the unsorted state was
          near-invisible and shifted the column width on every toggle. */}
      <span style={{ color: "var(--brand-2)", fontSize: ".82em", marginLeft: 4, opacity: sortKey === k ? 1 : 0.45 }}>
        {sortKey === k && sortDir === "asc" ? "▲" : "▼"}
      </span>
    </th>
  );

  const ordered = sortKey
    ? [...items].sort((a, b) => compareGlance(a, b, sortKey, sortDir === "asc" ? 1 : -1))
    : items;
  const shown = expanded ? ordered : ordered.slice(0, GLANCE_MAX);
  const canExpand = items.length > GLANCE_MAX;
  // Company, Surprise, Actual, Consensus, 1 Yr Ago, Actual Rev, Cons. Rev,
  // Yr/Yr Rev, Guidance — plus Date when it is shown. Kept next to the header
  // it counts so the two move together.
  const colCount = 9 + (showDate ? 1 : 0);
  return (
    <div className="ecal-day" style={{ marginBottom: 14 }}>
      <div className="ecal-day-h">
        <span className="ecal-day-t">{title}</span>
        <span className="ecal-day-n">{items.length}</span>
      </div>
      <div className="ecal-tablewrap" style={{ overflowX: "auto" }}>
        <table className="ecal-table">
          <thead>
            <tr>
              {sortTh("company", "Company", false)}
              {showDate && sortTh("date", "Date")}
              {sortTh("surprise", "Surprise")}
              {sortTh("actual", "Actual")}
              {sortTh("consensus", "Consensus")}
              {sortTh("yearAgo", "1 Yr Ago")}
              {sortTh("actualRev", "Actual Rev")}
              {sortTh("consRev", "Cons. Rev")}
              {sortTh("yoyRev", "Yr/Yr Rev")}
              {sortTh("guidance", "Guidance")}
            </tr>
          </thead>
          <tbody>
            {shown.map((it, i) => <GlanceRow key={`${it.s}-${it.date}-${i}`} it={it} showDate={showDate} onSelect={onSelect} colSpan={colCount} />)}
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
          {expanded ? "Show less" : `+${items.length - GLANCE_MAX} more`}
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
  // Market cap per ticker — used to order every earnings list largest-first.
  const { data: companies } = useApiList<CompanyDoc>("/market-data/companies");
  const mcapByTicker = new Map(companies.filter(c => c.ticker).map(c => [c.ticker as string, c.marketCap ?? 0]));
  // FMP analyst consensus + price target, keyed by ticker (for the AI summary).
  const { data: analystActions } = useApiList<AnalystConsensusDoc>("/market-data/analyst-actions");
  const liveEarningsData = liveEarnings;

  const [mode, setMode]     = useState<"day" | "week" | "month">("day");
  // Day view caps at MAX_CAL_LOGOS like every other view; this opens it out.
  const [dayExpanded, setDayExpanded] = useState(false);
  const [anchor, setAnchor] = useState<string>(() => isoDay(new Date()));
  // At-a-glance snapshot: a Nasdaq-style results table (actual vs consensus,
  // surprise, revenue, year-ago) for the selected day/week/month, toggled from
  // the calendar header. Off = the normal icon calendar.
  const [atGlance, setAtGlance] = useState(false);
  // The filter bar (session / cap / sort / min-move / view / news / auto-refresh)
  // was removed — the live earnings feed has no data to drive those — so these
  // stay at fixed defaults.
  const sort: SortKey = "symbol";
  // Pre-market (Before open) / after-market (After close) filter for the calendar.
  const [session, setSession] = useState<SessionKey>("both");
  const [pickerOpen, setPickerOpen]   = useState(false);
  // Quarterly vs Yearly toggles for the two detail tables (independent).
  // Quarterly basis for the EPS-history table. The Q/A toggle lived in the
  // removed legacy detail block, so this is fixed at "Q" (the only basis that
  // carries per-quarter estimates for beat/miss). Kept as a widened variable so
  // the annual branches below stay valid if the toggle is ever reintroduced.
  const histPeriod = "Q" as "Q" | "A";
  const [aiReadOpen, setAiReadOpen] = useState(true);
  const [tickerSearch, setTickerSearch] = useState("");
  // Detail mode: clicking a stock opens a split view (weekly picker + details)
  // that replaces the calendar; the ✕ in the weekly panel closes back to it.
  const [detailOpen, setDetailOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(true);
  // The two legacy inline company-detail blocks that used to render at the bottom
  // of the calendar view (a duplicate header + EPS metrics, and an earnings-
  // history / income-statement / AI-read stack) are superseded by the full detail

  // No company is selected by default — the detail panels appear only after the
  // user clicks a reporting company in the calendar.
  const [sel, setSel]           = useState<string>("");
  const { data: liveCompanySel } = useApiResource<CompanyDoc>(sel ? `/live/company?ticker=${encodeURIComponent(sel)}` : null);
  const { data: financialsDoc, loading: financialsLoading } = useApiResource<FinancialsDoc>(sel ? `/live/financials?ticker=${encodeURIComponent(sel)}` : null);
  const [selectedCall,   setSelectedCall]   = useState<string | null>(null);
  const [aiModalSym,      setAiModalSym]      = useState<string | null>(null);

  // Stepping to another day starts collapsed again — an expansion belongs to
  // the day it was opened on, not to the view.
  useEffect(() => { setDayExpanded(false); }, [anchor, mode]);

  const weekMon   = mondayOf(new Date(`${anchor}T00:00:00Z`));
  const weekDays5 = [0, 1, 2, 3, 4].map(i => isoDay(addDays(weekMon, i)));

  const dayRows = rowsForDate(anchor, liveEarningsData).map(toCalRow);
  const visibleRows = filterSortRows(dayRows, { sort, session: "both", mcap: mcapByTicker });
  // Detail-mode side tray: the SELECTED DAY's reporting tickers (not the week),
  // narrowed live by the "Search earnings" box (symbol or company name).
  const trayBaseItems = filterSortRows(dayRows, { sort, session, mcap: mcapByTicker });
  const trayQuery = tickerSearch.trim().toUpperCase();
  const trayItems = trayQuery
    ? trayBaseItems.filter(r => r.s.includes(trayQuery) || (r.n ?? "").toUpperCase().includes(trayQuery))
    : trayBaseItems;

  // Pre-market (Before Open) / post-market (After Close) session comes from the
  // EDGAR 8-K `earnings_announcements` feed — Polygon's earnings_events carries
  // no session — joined by ticker + reporting date. Rows with no 8-K session
  // match fall into a "Time not specified" group rather than being hidden.
  const annSessionByKey = new Map<string, "BMO" | "AMC">();
  // Guidance rides the same 8-K feed and the same ticker|date key as session.
  const annGuidanceByKey = new Map<string, EarningsAnnouncementDoc>();
  for (const a of earningsAnnouncements) {
    if (a.session === "BMO" || a.session === "AMC") {
      annSessionByKey.set(`${a.ticker}|${a.announceDate}`, a.session);
    }
    annGuidanceByKey.set(`${a.ticker}|${a.announceDate}`, a);
  }
  // ── At-a-glance snapshot rows ──────────────────────────────────────────────
  // Reporters for the current mode (day = the anchor day; week = its 5 weekdays;
  // month = the whole month), each with its Before-Open / After-Close session
  // resolved from the EDGAR 8-K feed (ticker|date), then filtered by the session
  // chip and ordered largest-cap first — the same ordering as the calendar.
  const glanceRaw: EarnCalItem[] =
    mode === "month"
      ? liveEarningsData.filter(d => d.date.slice(0, 7) === anchor.slice(0, 7)).map(toEarnCalItem)
      : (mode === "week" ? weekDays5 : [anchor]).flatMap(iso => rowsForDate(iso, liveEarningsData));
  const glanceItems: EarnCalItem[] = glanceRaw
    .map(it => (it.sess ? it : { ...it, sess: annSessionByKey.get(`${it.s}|${it.date}`) ?? null }))
    .map(it => {
      const a = annGuidanceByKey.get(`${it.s}|${it.date}`);
      return a
        ? { ...it, guide: a.guidanceDirection ?? null, guideRange: a.guidanceRange ?? null, guideSnippet: a.guidanceSnippet ?? null }
        : it;
    })
    .filter(it => session === "both" || it.sess === session)
    .sort((a, b) => (mcapByTicker.get(b.s) ?? 0) - (mcapByTicker.get(a.s) ?? 0) || a.s.localeCompare(b.s));
  const glanceBmo = glanceItems.filter(it => it.sess === "BMO");
  const glanceAmc = glanceItems.filter(it => it.sess === "AMC");
  const glanceTbd = glanceItems.filter(it => it.sess !== "BMO" && it.sess !== "AMC");
  const glanceShowDate = mode !== "day";

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
    // One column, built exactly like a day in the week view — same card, same
    // two-up chips, same +N. Spreading the whole list across the full width
    // made a day look like a different product from the week it belongs to,
    // and with no cap a heavy reporting day ran to hundreds of tiles.
    const shown  = dayExpanded ? visibleRows : visibleRows.slice(0, MAX_CAL_LOGOS);
    const extra  = visibleRows.length - shown.length;
    const isToday = anchor === isoDay(new Date());
    calNode = visibleRows.length > 0 ? (
      <div className="ec-grid">
        <div className={`ec-day${isToday ? " is-today" : ""}`}>
          <div className="ec-dh">
            {DOW3[anchorDate.getUTCDay()]} {anchorDate.getUTCDate()}{isToday ? " · Today" : ""}
          </div>
          <div className="ec-sess">
            {shown.map(r => (
              <EcChip key={r.s} sym={r.s} selected={sel === r.s} onSelect={s => openStockDetail(s, anchor)} />
            ))}
          </div>
          {/* In the week and month views +N opens the day; here it IS the day,
              so it expands in place — and offers the way back. */}
          {extra > 0 && (
            <div className="ec-more-row">
              <button className="emc-more" title={`Show ${extra} more`} onClick={() => setDayExpanded(true)}>+{extra}</button>
            </div>
          )}
          {dayExpanded && visibleRows.length > MAX_CAL_LOGOS && (
            <div className="ec-more-row">
              <button className="emc-more" onClick={() => setDayExpanded(false)}>Show less</button>
            </div>
          )}
        </div>
      </div>
    ) : (
      <div className="ecal-empty">
        <div className="ecal-empty-h">No companies reporting</div>
        <div>Nothing scheduled for {dateLabel} in the synced calendar.</div>
      </div>
    );
  } else if (mode === "week") {
    calNode = (
      <div className="ec-grid">
        {weekDays5.map((iso, di) => {
          const items = filterSortRows(rowsForDate(iso, liveEarningsData).map(toCalRow), { sort, session, mcap: mcapByTicker });
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
            const items = filterSortRows(rowsForDate(iso, liveEarningsData).map(toCalRow), { sort, session, mcap: mcapByTicker });
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
                        <StockLogo sym={r.s} size={30} />
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
  const consensusForSel = analystActions.find(c => c.ticker === sel);
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
  // Beat/miss uses the FMP matched pair (epsActualReported + epsEstimateReported,
  // same basis) — never Polygon GAAP actual vs a non-GAAP estimate.
  const hasEstimates = histPeriod === "Q" && histSource.some(q => {
    const qq = q as QuarterFinancials;
    return qq.epsActualReported != null && qq.epsEstimateReported != null;
  });
  let pairedBeats = 0, pairedTotal = 0;
  const hist: EarnQ[] = histSource.map(q => {
    const qq = q as QuarterFinancials;
    // Prefer FMP's consensus-basis actual/estimate (matches NASDAQ); Polygon
    // GAAP is a display-only fallback. Surprise ONLY from the matched pair.
    const repAct = histPeriod === "Q" ? (qq.epsActualReported ?? null) : null;
    const repEst = histPeriod === "Q" ? (qq.epsEstimateReported ?? null) : null;
    const act = repAct ?? (q.epsActual as number);
    const est = repEst ?? ((qq.epsEstimate ?? null));
    const pairedSurp = surprisePct(repAct, repEst);
    const paired = pairedSurp != null;
    const surp = pairedSurp ?? 0;
    if (paired) { pairedTotal++; if (surp >= 0) pairedBeats++; }
    const label = q.endDate
      ? new Date(q.endDate + "T00:00:00").toLocaleDateString("en-US", histPeriod === "A" ? { year: "numeric" } : { month: "short", year: "2-digit" })
      : (histPeriod === "A" ? `${q.fiscalYear ?? ""}`.trim() : `${(q as QuarterFinancials).fiscalPeriod ?? ""} ${q.fiscalYear ?? ""}`.trim());
    return { q: label, e: est ?? 0, a: act, surp: parseFloat(surp.toFixed(1)), mv: 0 };
  });
  const beats = pairedBeats;
  // "What street expects" — prefer the next (unreported) quarter's consensus EPS,
  // else the nearest forward fiscal-year estimate. Both come from the FMP feed.
  const upcomingRow = liveMatches.find(e => e.epsActual == null && e.epsEstimate != null);
  const fwdAnnual = [...(financialsDoc?.annualEstimates ?? [])]
    .filter(e => e.epsEstimate != null)
    .sort((a, b) => Number(a.fiscalYear) - Number(b.fiscalYear))[0];
  const streetExpects = upcomingRow?.epsEstimate != null
    ? `$${upcomingRow.epsEstimate.toFixed(2)} · ${upcomingRow.date}`
    : fwdAnnual?.epsEstimate != null
      ? `$${fwdAnnual.epsEstimate.toFixed(2)} · FY${fwdAnnual.fiscalYear}`
      : null;



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
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 10 }}>
            <button
              className={`ecal-segbtn ecal-glancebtn${atGlance ? " on" : ""}`}
              onClick={() => setAtGlance(v => !v)}
              title="At-a-glance results: actual vs consensus, surprise, revenue and year-ago for every reporter in the selected day/week/month"
              style={{ border: "1px solid var(--border-soft)", borderRadius: 8, padding: "5px 12px", display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}
            >
              <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18M7 15l4-4 3 3 5-6"/></svg>
              At a glance
            </button>
            <VendorTag v={["fmp", "polygon"]} />
          </span>
        </div>

        {/* ── Calendar / At-a-glance snapshot ──────────────────────────── */}
        {atGlance ? (
          glanceItems.length > 0 ? (
            <div>
              <GlanceTable title="Before open" items={glanceBmo} showDate={glanceShowDate} onSelect={(s, d) => openStockDetail(s, d)} />
              <GlanceTable title="After close" items={glanceAmc} showDate={glanceShowDate} onSelect={(s, d) => openStockDetail(s, d)} />
              <GlanceTable title="Time not specified" items={glanceTbd} showDate={glanceShowDate} onSelect={(s, d) => openStockDetail(s, d)} />
            </div>
          ) : (
            <div className="ecal-empty">
              <div className="ecal-empty-h">No companies reporting</div>
              <div>Nothing scheduled for {headerLabel} in the synced calendar.</div>
            </div>
          )
        ) : calNode}
      </div>
      )}

      {/* ── Detail mode: weekly picker (left) + stock details (right) ────── */}
      {detailOpen && sel && (
        <div className="ew-split">
          {/* Left: weekly picker with close button */}
          <aside className="ew-week">
            <div className="ew-week-h">
              <span>{DOW3[anchorDate.getUTCDay()]} {MON3[anchorDate.getUTCMonth()]} {anchorDate.getUTCDate()}</span>
              <button className="closebtn" title="Close details" onClick={closeDetail}>✕</button>
            </div>
            {/* Search this day's reporting tickers by symbol or company name. */}
            <div style={{ padding: "8px 0 10px" }}>
              <input
                value={tickerSearch}
                onChange={e => setTickerSearch(e.target.value.toUpperCase())}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    const pick = trayItems[0]?.s;
                    if (pick) { openStockDetail(pick, anchor); setTickerSearch(""); }
                  }
                }}
                placeholder="Search earnings…"
                style={{ width: "100%", boxSizing: "border-box", background: "var(--surface-3)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: "7px 10px", fontSize: ".8rem", color: "var(--text-hi)", outline: "none", fontFamily: "var(--f-mono)" }}
              />
            </div>
            <div className="ew-week-body">
              {trayItems.length ? (
                <div className="ew-ticklist">
                  {trayItems.map(r => (
                    <button key={r.s} className={`ew-tickrow${sel === r.s ? " on" : ""}`} title={r.n ?? r.s} onClick={() => openStockDetail(r.s, anchor)}>
                      <StockLogo sym={r.s} size={27} />
                      <span className="ew-tickrow-txt">
                        <span className="ew-tickrow-line">
                          <span className="ew-tickrow-sym">{r.s}</span>
                          {r.n && r.n !== r.s && <span className="ew-tickrow-name">{r.n}</span>}
                        </span>
                        {/* Beat/miss vs the consensus estimate, on its own line
                            under the name. Only rendered once the company has
                            actually reported AND there's a matched estimate to
                            compare against — an upcoming reporter has no result
                            yet, so showing "Miss 0%" there would be a fabrication. */}
                        {r.epsSurp != null && (
                          <span
                            className="ew-tickrow-surp"
                            style={{ color: r.epsSurp >= 0 ? "var(--up)" : "var(--down)" }}
                          >
                            {r.epsSurp >= 0 ? "Beat" : "Miss"} {fmtPctSigned(r.epsSurp, 1)}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              ) : <div className="ew-week-none">{trayQuery ? "No match on this day." : "No earnings on this day."}</div>}
            </div>
          </aside>

          {/* Right: stock details */}
          <div className="ew-main">
            {/* top row: what company does + AI summary */}
            <div className="ew-toprow">
              <div className="card">
                <div className="card-h" style={{ gap: 10, flexWrap: "wrap" }}>
                  <StockLogo sym={sel} size={45} />
                  <span style={{ fontWeight: 700, fontFamily: "var(--f-mono)", color: "var(--text-hi)", fontSize: ".95rem" }}>{sel}</span>
                  {liveCompanySel?.price != null && (
                    <span style={{ fontFamily: "var(--f-mono)", fontWeight: 700, color: "var(--text-hi)", fontSize: ".9rem" }}>
                      ${liveCompanySel.price.toFixed(2)}
                      {liveCompanySel.pctChange != null && <span className={cls(liveCompanySel.pctChange)} style={{ marginLeft: 6, fontSize: ".8rem" }}>{sign(liveCompanySel.pctChange)}</span>}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <button
                      title="Earnings-call transcript (Read aloud)"
                      onClick={() => setSelectedCall(sel)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        background: "var(--surface-2)", border: "1px solid var(--border-soft)",
                        borderRadius: 8, padding: "5px 10px", cursor: "pointer",
                        color: "var(--text)", fontSize: ".75rem", fontWeight: 600,
                      }}
                    >
                      <svg viewBox="0 0 24 24" width={12} height={12} fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
                      Earnings call
                    </button>
                    <button
                      title="Analyst & earnings analysis (FMP)"
                      onClick={() => setAiModalSym(sel)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        background: "var(--surface-2)", border: "1px solid var(--border-soft)",
                        borderRadius: 8, padding: "5px 10px", cursor: "pointer",
                        color: "var(--text)", fontSize: ".75rem", fontWeight: 600,
                      }}
                    >
                      <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19V5m0 14h16M8 15l3-4 3 3 4-6"/></svg>
                      Analysis
                    </button>
                    <VendorTag v="polygon" />
                  </span>
                </div>
                <div className="card-b">
                  {liveCompanySel?.description
                    ? <p style={{ fontSize: ".82rem", lineHeight: 1.6, color: "var(--text)", margin: 0 }}>{liveCompanySel.description}</p>
                    : <DataState loading={!liveCompanySel} label={`No company description synced for ${sel} yet.`} />}
                </div>
              </div>
              <div className="card">
                <div className="card-h"><h3>AI summary <VendorTag v={["fmp", "polygon", "sec"]} /></h3><span className="pill" style={{ background: "var(--surface-3)", color: "var(--ai)" }}>◆ AI</span></div>
                <div className="card-b">
                  <p style={{ fontSize: ".82rem", lineHeight: 1.6, color: "var(--text)", margin: "0 0 10px" }}>{aiRead}</p>
                  <div className="ew-aisum">
                    <div><span>Post-earnings reaction</span><b>{annMatch?.reactionPct != null ? <span className={cls(annMatch.reactionPct)}>{sign(annMatch.reactionPct)}</span> : <NotAvailable />}</b></div>
                    <div><span>Historical EPS beats</span><b>{hasEstimates ? `${beats} / ${hist.length}` : <span style={{ color: "var(--text-dim-solid)", fontWeight: 500 }}>Pending — needs estimates</span>}</b></div>
                    <div><span>What street expects</span><b>{streetExpects ?? <span style={{ color: "var(--text-dim-solid)", fontWeight: 500 }}>Pending — no estimate yet</span>}</b></div>
                    {consensusForSel?.priceTargetConsensus != null && (
                      <div><span>Analyst target</span><b>${consensusForSel.priceTargetConsensus.toFixed(0)}{consensusForSel.consensus ? ` · ${consensusForSel.consensus}` : ""}</b></div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Price chart (full width) — collapsible (show/hide). */}
            <div style={{ marginBottom: 14 }}>
              <button
                onClick={() => setChartOpen(o => !o)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "var(--surface-1)", border: "1px solid var(--border-soft)", borderRadius: 12, padding: "10px 14px", cursor: "pointer", color: "var(--text-hi)", fontWeight: 700, fontSize: ".85rem", marginBottom: chartOpen ? 8 : 0 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{sel} · Chart <VendorTag v="polygon" /></span>
                <span style={{ color: "var(--text-dim-solid)", fontSize: ".75rem", fontWeight: 600 }}>{chartOpen ? "▲ Hide" : "▼ Show"}</span>
              </button>
              {chartOpen && <ChartCard sym={sel} px={liveCompanySel?.price ?? 0} />}
            </div>

            {/* Sales & EPS — bar charts (Quarterly/Annual) + fiscal-year and
                quarterly tables, per the reference layout. */}
            <div style={{ marginBottom: 14 }}>
              <EpsSalesWidget financialsDoc={financialsDoc} />
            </div>

            {/* Reports — how the stock trades when it reports (bottom). */}
            <div className="card">
              <div className="card-h">
                <h3>Earnings Playbook <VendorTag v={["polygon", "fmp"]} /></h3>
                <span style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>how {sel} trades when it reports</span>
              </div>
              <div className="card-b" style={{ paddingTop: 6 }}>
                <EarningsPlaybook
                  sym={sel}
                  reports={(financialsDoc?.quarters ?? [])
                    .filter(q => q.filingDate)
                    .map(q => ({ date: q.filingDate as string, epsActual: q.epsActual, epsEstimate: q.epsEstimate, epsReported: q.epsActualReported ?? null, epsEstimateReported: q.epsEstimateReported ?? null }))}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Legacy inline detail — superseded by detail mode; kept gated ── */}

      {/* ── Legacy detail (EPS history + Income statement) — gated off ── */}

      {/* Earnings call detail drawer — honest not-connected state, no fabricated summary/transcript */}
      {selectedCall && (
        <CallDrawer sym={selectedCall} onClose={() => setSelectedCall(null)} />
      )}

      {/* Analysis modal — compiled from live analyst + earnings data (FMP),
          not an AI/LLM narrative. Opens for `sel`, so it reuses the sel-scoped
          consensus / price-target / beat-miss / estimate variables. */}
      {aiModalSym && (
        <>
          <div className="scrim" style={{ zIndex: 60 }} onClick={() => setAiModalSym(null)} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            background: "var(--surface-1)", border: "1px solid var(--border)",
            borderRadius: "var(--r-lg)", zIndex: 61, width: "min(540px, 92vw)",
            boxShadow: "0 20px 60px rgba(0,0,0,.5)",
          }}>
            {/* Modal header */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "14px 16px", borderBottom: "1px solid var(--border-soft)",
            }}>
              <span style={{ fontWeight: 700, fontSize: ".95rem", color: "var(--text-hi)", flex: 1, display: "inline-flex", alignItems: "center", gap: 8 }}>
                Analysis · {aiModalSym} <VendorTag v={["fmp", "polygon"]} />
              </span>
              <button className="closebtn" onClick={() => setAiModalSym(null)}>✕</button>
            </div>
            {/* Modal body */}
            <div style={{ padding: "16px 18px 20px", maxHeight: "72vh", overflowY: "auto" }}>
              {(() => {
                const c = consensusForSel;
                const px = liveCompanySel?.price ?? null;
                const pt = c?.priceTargetConsensus ?? null;
                const upside = pt != null && px != null && px > 0 ? ((pt - px) / px) * 100 : null;
                const votes = c ? c.strongBuy + c.buy + c.hold + c.sell + c.strongSell : 0;
                const buyPct = votes ? Math.round(((c!.strongBuy + c!.buy) / votes) * 100) : null;
                const rc = c && /buy|outperform|overweight/i.test(c.consensus) ? "var(--up)"
                  : c && /sell|underperform|underweight/i.test(c.consensus) ? "var(--down)" : "var(--text-hi)";
                let streak = 0; for (const q of hist) { if (q.surp >= 0) streak++; else break; }
                const lastSurp = hist.length ? hist[0].surp : null;
                const ptTrend = c?.ptAvgLastMonth != null && c?.ptAvgLastQuarter != null ? c.ptAvgLastMonth - c.ptAvgLastQuarter : null;
                const anyData = !!c || px != null || (hasEstimates && pairedTotal > 0) || !!streetExpects || annMatch?.reactionPct != null;
                if (!anyData) return <DataState label={`No analyst or earnings data synced for ${sel} yet.`} />;
                const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, fontSize: ".82rem", borderBottom: "1px solid var(--border-soft)", padding: "8px 0" }}>
                    <span style={{ color: "var(--text-dim-solid)", whiteSpace: "nowrap" }}>{label}</span>
                    <span style={{ textAlign: "right", color: "var(--text)" }}>{children}</span>
                  </div>
                );
                return (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <p style={{ fontSize: ".86rem", lineHeight: 1.6, color: "var(--text)", margin: "0 0 8px" }}>{aiRead}</p>
                    {c && votes > 0 && (
                      <Row label="Analyst consensus">
                        <b style={{ color: rc }}>{c.consensus}</b>
                        <span style={{ color: "var(--text-dim-solid)" }}> · {votes} analysts · {buyPct}% buy</span>
                      </Row>
                    )}
                    {pt != null && (
                      <Row label="Price target (12-mo)">
                        <b>${pt.toFixed(0)}</b>
                        {upside != null && <span className={cls(upside)}> · {sign(upside)}{px != null ? ` vs $${px.toFixed(2)}` : ""}</span>}
                        {c?.priceTargetLow != null && c?.priceTargetHigh != null && (
                          <span style={{ color: "var(--text-dim-solid)" }}> · range ${c.priceTargetLow.toFixed(0)}–${c.priceTargetHigh.toFixed(0)}</span>
                        )}
                      </Row>
                    )}
                    {ptTrend != null && Math.abs(ptTrend) >= 0.01 && (
                      <Row label="Target trend">
                        <span className={cls(ptTrend)}>{ptTrend >= 0 ? "Rising" : "Falling"}</span>
                        <span style={{ color: "var(--text-dim-solid)" }}> · 1-mo ${c!.ptAvgLastMonth!.toFixed(0)} vs 1-qtr ${c!.ptAvgLastQuarter!.toFixed(0)}</span>
                      </Row>
                    )}
                    {hasEstimates && pairedTotal > 0 && (
                      <Row label="EPS track record">
                        <b>{beats}/{pairedTotal} beats</b>
                        {streak > 0 && <span className="pill up" style={{ marginLeft: 6 }}>{streak}-qtr beat streak</span>}
                        {lastSurp != null && <span style={{ color: "var(--text-dim-solid)" }}> · last {lastSurp >= 0 ? "beat" : "miss"} {Math.abs(lastSurp)}%</span>}
                      </Row>
                    )}
                    {streetExpects && (
                      <Row label="Street expects (next)"><b>{streetExpects}</b></Row>
                    )}
                    {annMatch?.reactionPct != null && (
                      <Row label="Last post-earnings move">
                        <span className={cls(annMatch.reactionPct)}>{sign(annMatch.reactionPct)}</span>
                      </Row>
                    )}
                    {c?.recentGrades && c.recentGrades.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-hi)", marginBottom: 6 }}>Recent rating changes</div>
                        {c.recentGrades.slice(0, 5).map((g, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: ".76rem", padding: "4px 0", borderBottom: "1px solid var(--border-soft)" }}>
                            <span style={{ color: "var(--text-dim-solid)", width: 74, flexShrink: 0 }}>{g.date ? String(g.date).slice(0, 10) : "—"}</span>
                            <span style={{ flex: 1, color: "var(--text-hi)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.firm ?? "—"}</span>
                            <span style={{ color: "var(--text-dim-solid)" }}>{g.previousGrade ? `${g.previousGrade} → ` : ""}{g.newGrade ?? "—"}</span>
                            {g.action && (
                              <span className={/upgrade|initiat/i.test(g.action) ? "pill up" : /downgrade/i.test(g.action) ? "pill dn" : "pill"} style={{ flexShrink: 0 }}>{g.action}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 12, lineHeight: 1.5 }}>
                      Compiled from live analyst &amp; earnings data (FMP · Polygon) — not an AI/LLM narrative.
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </>
      )}
    </>
  );
}
