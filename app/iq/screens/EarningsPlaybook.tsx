"use client";

import { useMemo } from "react";
import { fmtDate } from "../calendar-range";
import { useBackendBars } from "../hooks/useBackendBars";
import type { OHLCBar } from "../utils";
import { DataState, VendorTag } from "../utils";
import { surprisePct as calcSurprisePct } from "../types";

/** One reported quarter: report date (SEC filing date) + EPS actual/estimate.
 * Sourced from the financials doc's `quarters` (~10 quarters) rather than the
 * live earnings *calendar* feed, which only carries the most recent report. */
export type PlaybookReport = {
  date: string;
  epsActual: number | null;
  epsEstimate: number | null;
  /** FMP's reported (consensus-basis) EPS actual. Beat/miss = THIS vs
   * epsEstimateReported — both from the same FMP surprise row, so identical
   * basis. `epsActual` (Polygon GAAP) only marks a quarter as reported. */
  epsReported?: number | null;
  /** FMP estimate paired with epsReported (same surprise row). */
  epsEstimateReported?: number | null;
};

// ── Earnings Playbook ────────────────────────────────────────────────────────
// "How this stock trades when it reports." All figures are DERIVED from data
// already on hand — the live earnings feed (report dates + EPS actual/estimate)
// and the Polygon daily bars (GET /live/bars?tf=5Y, ~1300 adjusted daily bars).
// Nothing is fabricated: a report with no usable bar window, or no estimate,
// simply leaves that cell blank rather than inventing a number.
//
// Reaction day (D0) is found by VOLUME, not by the report date.
//
// The dates on hand are Polygon's SEC FILING dates — when the 10-Q was lodged,
// not when results were announced. For DELL those are twelve days apart: it
// announced on 28 May after the close, the market reacted on 29 May with 5.3x
// normal volume, and the 10-Q was filed on 9 June. Anchoring on 9 June measured
// an ordinary session — 0.88x volume, a +0.5% "gap" — and reported it as the
// reaction to a 64% beat. Every row read that way: six consecutive gaps under
// 1% and volume BELOW average, which cannot happen on a real earnings day.
//
// An earnings reaction is the most reliably marked event in a daily series: it
// prints 2.5x+ volume. So D0 is the heaviest-volume session in a window around
// the filing date, which lands on the right day for a before-open reporter (the
// announcement day itself) and an after-hours one (the following session)
// without needing to know which it was. When no session in the window clears
// the threshold — a quiet report, or missing bars — it falls back to the old
// filing-date anchor rather than inventing one.
//
// "gap" is D0's open vs the prior close; Day 1/3/5 are its close / +2 / +4
// closes against that same prior close.

type Row = {
  date: string;
  label: string;
  beat: boolean | null;
  surprisePct: number | null;
  epsAct: number | null;
  epsEst: number | null;
  gap: number | null;
  day1: number | null;
  day3: number | null;
  day5: number | null;
  openToClose: number | null;
  volRatio: number | null;
};

type Model = {
  rows: Row[]; // oldest → newest
  typicalMove: number | null; // median |day1|
  fromOpen: number | null; // median |openToClose|
  normalDayX: number | null; // typicalMove / median daily move
  beatAvg: number | null;
  beatCount: number;
  missAvg: number | null;
  missCount: number;
  gapHolds: number;
  gapTotal: number;
  driftAvg: number | null; // mean(day5 - day1)
};

const median = (xs: number[]): number | null => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const mean = (xs: number[]): number | null => {
  const a = xs.filter((x) => Number.isFinite(x));
  return a.length ? a.reduce((p, q) => p + q, 0) / a.length : null;
};
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const fmtLabel = (iso: string) =>
  fmtDate(iso, { month: "short", day: "numeric", year: "2-digit" }).replace(/(\d{2})$/, "'$1");

function buildModel(reports: PlaybookReport[], bars: OHLCBar[] | undefined, maxReports = 12): Model | null {
  if (!bars || bars.length < 3) return null;
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  const dates = sorted.map((b) => isoOf(b.t));
  const today = new Date().toISOString().slice(0, 10);

  // Baseline "normal day" = median absolute daily close-to-close return.
  const dailyMoves: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].c > 0) dailyMoves.push(Math.abs((sorted[i].c - sorted[i - 1].c) / sorted[i - 1].c) * 100);
  }
  const normalDay = median(dailyMoves);

  /**
   * Index of the session that actually reacted to a report.
   *
   * Searches back from the filing date (the announcement always precedes the
   * filing) with a small forward margin, and takes the heaviest relative volume.
   * The window is narrower than the ~63 sessions between quarters, so it cannot
   * stray into a neighbouring report.
   */
  const findReactionIdx = (reportDate: string): number => {
    const anchor = dates.findIndex((d) => d >= reportDate);
    if (anchor <= 0) return -1;
    const lo = Math.max(1, anchor - 25);
    const hi = Math.min(sorted.length - 1, anchor + 3);
    let best = -1;
    let bestRatio = 0;
    for (let i = lo; i <= hi; i++) {
      const prior = sorted
        .slice(Math.max(0, i - 20), i)
        .map((b) => b.v)
        .filter((v) => v > 0);
      if (prior.length < 5) continue;
      const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
      if (!(avg > 0)) continue;
      const ratio = sorted[i].v / avg;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = i;
      }
    }
    // 2x is well below a typical earnings day and well above ordinary noise.
    return bestRatio >= 2 && best > 0 ? best : anchor;
  };

  const past = reports
    .filter((e) => e.epsActual != null && e.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-maxReports);

  const rows: Row[] = [];
  for (const e of past) {
    const d0 = findReactionIdx(e.date);
    if (d0 <= 0) continue; // need a prior bar to measure against
    const pre = sorted[d0 - 1].c;
    if (!(pre > 0)) continue;
    const b0 = sorted[d0];
    const rel = (c: number) => ((c - pre) / pre) * 100;
    const gap = rel(b0.o);
    const day1 = rel(b0.c);
    const day3 = d0 + 2 < sorted.length ? rel(sorted[d0 + 2].c) : null;
    const day5 = d0 + 4 < sorted.length ? rel(sorted[d0 + 4].c) : null;
    const openToClose = b0.o > 0 ? ((b0.c - b0.o) / b0.o) * 100 : null;
    const priorVols = sorted.slice(Math.max(0, d0 - 20), d0).map((b) => b.v).filter((v) => v > 0);
    const avgVol = priorVols.length ? priorVols.reduce((p, q) => p + q, 0) / priorVols.length : null;
    const volRatio = avgVol && b0.v > 0 ? b0.v / avgVol : null;
    // Beat/miss uses the FMP matched pair ONLY (reported actual + the estimate
    // from the same surprise row) so both share a basis — never Polygon GAAP,
    // and never the patchwork epsEstimate whose old rows can be pre-split.
    // Blank when FMP has no matched pair, rather than inventing a number.
    const reported = e.epsReported;
    const estReported = e.epsEstimateReported;
    const surprisePct = calcSurprisePct(reported, estReported);
    rows.push({
      // The session measured, not the filing date — a row labelled 9 June while
      // describing 29 May would be its own small lie.
      date: dates[d0] ?? e.date,
      label: fmtLabel(dates[d0] ?? e.date),
      beat: surprisePct == null ? null : surprisePct >= 0,
      surprisePct,
      epsAct: reported ?? null,
      epsEst: estReported ?? null,
      gap,
      day1,
      day3,
      day5,
      openToClose,
      volRatio,
    });
  }
  if (!rows.length) return null;

  const day1s = rows.map((r) => r.day1).filter((x): x is number => x != null);
  const typicalMove = median(day1s.map(Math.abs));
  const fromOpen = median(rows.map((r) => r.openToClose).filter((x): x is number => x != null).map(Math.abs));
  const beats = rows.filter((r) => r.beat === true);
  const misses = rows.filter((r) => r.beat === false);
  const gapped = rows.filter((r) => r.gap != null && Math.abs(r.gap) >= 1 && r.day1 != null);
  const gapHolds = gapped.filter((r) => Math.sign(r.gap as number) === Math.sign(r.day1 as number)).length;
  const drift = rows.filter((r) => r.day1 != null && r.day5 != null).map((r) => (r.day5 as number) - (r.day1 as number));

  return {
    rows,
    typicalMove,
    fromOpen,
    normalDayX: typicalMove != null && normalDay ? typicalMove / normalDay : null,
    beatAvg: mean(beats.map((r) => r.day1).filter((x): x is number => x != null)),
    beatCount: beats.length,
    missAvg: mean(misses.map((r) => r.day1).filter((x): x is number => x != null)),
    missCount: misses.length,
    gapHolds,
    gapTotal: gapped.length,
    driftAvg: mean(drift),
  };
}

const pct = (v: number | null | undefined, signed = true) =>
  v == null || !Number.isFinite(v) ? "—" : `${signed && v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const colorOf = (v: number | null | undefined) =>
  v == null ? "var(--text-dim-solid)" : v > 0 ? "var(--up)" : v < 0 ? "var(--down)" : "var(--text-dim-solid)";

function Spark({ rows }: { rows: Row[] }) {
  const d = rows.map((r) => r.day1 ?? 0);
  const max = Math.max(1, ...d.map((x) => Math.abs(x)));
  const W = 180, H = 46, gw = W / Math.max(1, d.length), bw = Math.min(gw * 0.6, 9);
  const mid = H / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block", flexShrink: 0 }}>
      <line x1={0} y1={mid} x2={W} y2={mid} stroke="var(--border)" strokeDasharray="2 3" />
      {d.map((v, i) => {
        const h = Math.max(2, (Math.abs(v) / max) * (mid - 3));
        const up = v >= 0;
        return (
          <rect key={i} x={(i * gw + (gw - bw) / 2).toFixed(1)} y={(up ? mid - h : mid).toFixed(1)}
            width={bw.toFixed(1)} height={h.toFixed(1)} rx={1.5}
            fill={up ? "var(--up)" : "var(--down)"} />
        );
      })}
    </svg>
  );
}

function Stat({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ font: "600 .62rem var(--f-mono)", letterSpacing: ".08em", color: "var(--text-dim-solid)", textTransform: "uppercase" }}>{k}</div>
      <div style={{ marginTop: 5 }}>{children}</div>
    </div>
  );
}

export function EarningsPlaybook({ sym, reports }: { sym: string; reports: PlaybookReport[] }) {
  const { bars, loading } = useBackendBars(sym, "5Y");
  const model = useMemo(() => buildModel(reports, bars), [reports, bars]);

  if (loading && !bars) return <DataState loading label={`Loading ${sym} earnings-reaction history…`} />;
  if (!model) return <DataState label={`No earnings-reaction history for ${sym} yet.`} />;

  const { rows, typicalMove, fromOpen, normalDayX, beatAvg, beatCount, missAvg, missCount, gapHolds, gapTotal, driftAvg } = model;
  const hasBeatMiss = beatCount + missCount > 0;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: ".62rem", color: "var(--text-dim-solid)" }}>Price reaction</span>
        <VendorTag v="polygon" />
        {hasBeatMiss && (
          <>
            <span style={{ fontSize: ".62rem", color: "var(--text-dim-solid)", marginLeft: 6 }}>Beat / miss</span>
            <VendorTag v="fmp" />
          </>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "20px 34px" }}>
        <Stat k="Typical move">
          <div style={{ font: "700 1.7rem var(--f-display, inherit)", color: "var(--text-hi)", letterSpacing: "-.02em", lineHeight: 1 }}>
            ±{typicalMove != null ? typicalMove.toFixed(1) : "—"}%
          </div>
          <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 6, lineHeight: 1.5 }}>
            median 1-day move, close to close<br />
            {normalDayX != null && <>≈ {normalDayX.toFixed(1)}x a normal day<br /></>}
            {fromOpen != null && <>±{fromOpen.toFixed(1)}% from the open</>}
          </div>
        </Stat>

        {hasBeatMiss && (
          <Stat k="On a beat">
            <div style={{ font: "700 1.15rem var(--f-mono)", color: colorOf(beatAvg) }}>{pct(beatAvg)}</div>
            <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 4 }}>{beatCount} beat{beatCount === 1 ? "" : "s"}</div>
          </Stat>
        )}
        {hasBeatMiss && (
          <Stat k="On a miss">
            <div style={{ font: "700 1.15rem var(--f-mono)", color: colorOf(missAvg) }}>{pct(missAvg)}</div>
            <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 4 }}>{missCount} miss{missCount === 1 ? "" : "es"}</div>
          </Stat>
        )}
        {gapTotal > 0 && (
          <Stat k="Gap holds">
            <div style={{ font: "700 1.15rem var(--f-mono)", color: "var(--text-hi)" }}>{gapHolds} of {gapTotal}</div>
            <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 4 }}>closed the way it gapped</div>
          </Stat>
        )}
      </div>

      {driftAvg != null && Math.abs(driftAvg) >= 0.1 && (
        <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)", marginTop: 16 }}>
          After the first day, tends to keep {driftAvg >= 0 ? "moving the same way" : "fading back"} ({pct(driftAvg)} {driftAvg >= 0 ? "more" : ""} by day 5).
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
        <Spark rows={rows} />
        <span style={{ fontSize: ".68rem", color: "var(--text-dim-solid)" }}>Day-1 move · oldest → newest</span>
      </div>

      <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Report</th>
                {hasBeatMiss && <th>Result</th>}
                {hasBeatMiss && <th className="num">EPS act</th>}
                {hasBeatMiss && <th className="num">EPS est</th>}
                <th className="num">Gap</th>
                <th className="num">Day 1</th>
                <th className="num">Day 3</th>
                <th className="num">Day 5</th>
                <th className="num">Volume</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.date}>
                  <td style={{ fontWeight: 700, color: "var(--text-hi)", whiteSpace: "nowrap" }}>{r.label}</td>
                  {hasBeatMiss && (
                    <td style={{ whiteSpace: "nowrap", color: r.beat == null ? "var(--text-dim-solid)" : r.beat ? "var(--up)" : "var(--down)" }}>
                      {r.beat == null ? "—" : `${r.beat ? "Beat" : "Miss"} ${pct(r.surprisePct)}`}
                    </td>
                  )}
                  {hasBeatMiss && <td className="num">{r.epsAct != null ? `$${r.epsAct.toFixed(2)}` : "—"}</td>}
                  {hasBeatMiss && <td className="num" style={{ color: "var(--text-dim-solid)" }}>{r.epsEst != null ? `$${r.epsEst.toFixed(2)}` : "—"}</td>}
                  <td className="num" style={{ color: colorOf(r.gap) }}>{pct(r.gap)}</td>
                  <td className="num" style={{ color: colorOf(r.day1) }}>{pct(r.day1)}</td>
                  <td className="num" style={{ color: colorOf(r.day3) }}>{pct(r.day3)}</td>
                  <td className="num" style={{ color: colorOf(r.day5) }}>{pct(r.day5)}</td>
                  <td className="num" style={{ color: "var(--text-dim-solid)" }}>{r.volRatio != null ? `${r.volRatio.toFixed(1)}x` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
            Gap is the open vs the prior close. Day 1, Day 3 and Day 5 are closing prices vs the close before the report.
          </div>
        </div>
    </div>
  );
}
