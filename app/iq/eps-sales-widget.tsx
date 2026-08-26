"use client";

import { useState } from "react";
import { NotAvailable, VendorTag } from "./utils";
import type { FinancialsDoc, AnnualFinancials, QuarterFinancials, EpsHistoryRow } from "./types";
import { reportedQuarterEps, quarterEpsSurprisePct, reportedAnnualEps, estimatedAnnualEps } from "./types";
import { pctChangeStr, epsSalesSeries, annualEpsSalesRows, quarterlyEpsSalesRows, type AnnualRow } from "./eps-sales-data";






/** One zero-baselined bar chart (EPS or Sales), value labelled on top, period
 *  label angled underneath — the reference layout's headline chart. */
/**
 * Round axis ticks covering [min, max].
 *
 * Steps snap to 1 / 2 / 5 × a power of ten, so an axis reads 0 · 2 · 4 · 6
 * rather than 0 · 2.85 · 5.7. The bounds are widened OUT to the nearest step,
 * which is what gives the tallest bar headroom instead of letting it touch the
 * top edge with its value label crammed against the frame.
 */
function niceTicks(min: number, max: number, target = 5): { ticks: number[]; lo: number; hi: number } {
  const span = (max - min) || Math.abs(max) || 1;
  const rough = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  // The epsilon stops a float remainder dropping the final tick.
  for (let v = lo; v <= hi + step * 1e-9; v += step) ticks.push(v);
  return { ticks, lo, hi };
}

function MetricBars({ title, data, fmt }: {
  title: string; data: Array<{ label: string; v: number | null }>; fmt: (v: number) => string;
}) {
  const gid = "esw-" + title.replace(/\W/g, "");
  const vals = data.map(d => d.v).filter((v): v is number => v != null);
  // PADL is a gutter for the Y-axis tick labels — the chart had no axis at all
  // before, so every bar's magnitude had to be read from the number printed on
  // top of it and no two charts could be compared at a glance.
  const W = 360, H = 260, PADT = 20, PADB = 52, PADL = 38, PADR = 8;
  const LABEL_Y = H - 34;
  const iw = W - PADL - PADR, ih = H - PADT - PADB;

  const { ticks, lo, hi } = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const span = (hi - lo) || 1;
  const yOf = (v: number) => PADT + ((hi - v) / span) * ih;
  const zeroY = yOf(0);
  const gw = iw / Math.max(1, data.length);
  // Slightly slimmer than before: with an axis behind them the bars no longer
  // have to carry the chart on their own, and the gaps make the gridlines read.
  const bw = Math.min(gw * 0.56, 26);

  // Print the value on each bar only when every one of them fits its slot.
  // Five-digit revenue in an 11-bar quarter view does not — the labels ran into
  // each other and read as "12,79112,702". Showing only some would look
  // arbitrary, so it is all or nothing, and the Y axis carries the magnitude
  // when they are dropped. 0.6em per glyph approximates the mono advance width.
  const VAL_FONT = 9.5;
  const widest = Math.max(0, ...vals.map(v => fmt(v).length)) * VAL_FONT * 0.6;
  const showValues = widest <= gw - 3;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand-2)" />
            <stop offset="100%" stopColor="var(--brand)" />
          </linearGradient>
        </defs>

        {/* Y axis — gridlines behind the bars, values in the left gutter. */}
        {ticks.map(t => {
          const y = yOf(t);
          const isZero = Math.abs(t) < 1e-9;
          return (
            <g key={`t${t}`}>
              <line
                x1={PADL} x2={W - PADR} y1={y.toFixed(1)} y2={y.toFixed(1)}
                stroke={isZero ? "var(--border)" : "var(--border-soft)"}
                strokeWidth={isZero ? 1 : 0.8}
              />
              <text
                x={(PADL - 6).toFixed(1)} y={(y + 3).toFixed(1)} textAnchor="end" fontSize="8.5"
                fontFamily="JetBrains Mono,monospace" fill="var(--text-dim-solid)"
              >{fmt(t)}</text>
            </g>
          );
        })}

        {data.map((d, i) => {
          if (d.v == null) return null;
          const cx = PADL + gw * i + gw / 2;
          const yv = yOf(d.v);
          const y = Math.min(zeroY, yv);
          const h = Math.max(2, Math.abs(yv - zeroY));
          const above = d.v >= 0;
          return (
            <g key={d.label + i}>
              <rect x={(cx - bw / 2).toFixed(1)} y={y.toFixed(1)} width={bw.toFixed(1)} height={h.toFixed(1)} rx="2.5" fill={`url(#${gid})`}>
                <title>{`${d.label}: ${fmt(d.v)}`}</title>
              </rect>
              {showValues && (
                <text x={cx.toFixed(1)} y={(above ? y - 5 : y + h + 11).toFixed(1)} textAnchor="middle" fontSize={VAL_FONT}
                  fontFamily="JetBrains Mono,monospace" fill="var(--text-hi)">{fmt(d.v)}</text>
              )}
              <text x={cx.toFixed(1)} y={LABEL_Y.toFixed(1)} textAnchor="end" fontSize="9" fill="var(--text-dim-solid)"
                transform={`rotate(-45 ${cx.toFixed(1)} ${LABEL_Y.toFixed(1)})`}>{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const chgCls = (s: string) => s.startsWith("+") ? " up" : s.startsWith("-") ? " down" : "";

/**
 * Sales & EPS widget — dual bar charts (Quarterly/Annual toggle) plus the
 * Fiscal-year and Quarterly tables, matching the reference layout. Actuals come
 * from Polygon; the quarterly %surp columns and the forward `*YYYY` estimate
 * rows are populated from the FMP estimate feed (financialsDoc.annualEstimates +
 * per-quarter epsEstimate), and degrade to "—" for tickers not yet synced.
 */
export function EpsSalesWidget({ financialsDoc }: { financialsDoc: FinancialsDoc | null }) {
  const [period, setPeriod] = useState<"Q" | "A">("Q");
  const series = epsSalesSeries(period, financialsDoc);
  const annualRows = annualEpsSalesRows(financialsDoc?.annual ?? [], financialsDoc?.epsHistory ?? []);
  const quarterlyRows = quarterlyEpsSalesRows(financialsDoc?.quarters ?? []);

  // Forward analyst estimates (the `*YYYY` rows) — only present when an estimate
  // vendor is wired. %chg is vs the immediately prior year (last reported year
  // for the first estimate, then the prior estimate).
  const reportedYears = new Set(annualRows.map(r => r.year));
  const fwd = [...(financialsDoc?.annualEstimates ?? [])]
    .filter(e => !reportedYears.has(e.fiscalYear))
    .sort((a, b) => Number(a.fiscalYear) - Number(b.fiscalYear));
  const startEps = annualRows.length ? annualRows[annualRows.length - 1].eps : null;
  const startSales = annualRows.length ? annualRows[annualRows.length - 1].sales : null;
  const salesM = (v: number | null | undefined) => (v != null ? v / 1e6 : null);
  const forwardRows: AnnualRow[] = fwd.map((e, i) => {
    const prevEps = i === 0 ? startEps : fwd[i - 1].epsEstimate;
    const prevSales = i === 0 ? startSales : salesM(fwd[i - 1].revenueEstimate);
    return {
      year: `*${e.fiscalYear}`,
      // For a future year the reported "EPS" cell IS the consensus estimate, so
      // the separate Est./%surp columns stay blank (there's no actual to compare).
      eps: e.epsEstimate,
      epsEst: null,
      epsChg: pctChangeStr(e.epsEstimate, prevEps),
      epsSurp: "—",
      sales: salesM(e.revenueEstimate),
      salesChg: pctChangeStr(salesM(e.revenueEstimate), prevSales),
    };
  });

  // A pre-revenue / blank-check (SPAC) company has filing periods but every EPS
  // and revenue value is null — detect that so we show a clear message rather
  // than empty labelled bars and "—" tables.
  const hasData =
    series.some(d => d.eps != null || d.sales != null) ||
    annualRows.some(r => r.eps != null || r.sales != null) ||
    quarterlyRows.some(r => r.eps != null || r.sales != null) ||
    forwardRows.length > 0;

  // Shared Quarter/Annual toggle, placed on each of the two boxes.
  const seg = (
    <div className="ecal-seg">
      <button className={`ecal-segbtn${period === "Q" ? " on" : ""}`} onClick={() => setPeriod("Q")}>Quarter</button>
      <button className={`ecal-segbtn${period === "A" ? " on" : ""}`} onClick={() => setPeriod("A")}>Annual</button>
    </div>
  );

  if (!hasData) {
    return (
      <div className="card">
        <div className="card-h">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><h3>EPS &amp; Sales</h3><VendorTag v="polygon" /></span>
        </div>
        <div className="card-b" style={{ paddingTop: 8 }}>
          <div style={{ fontSize: ".82rem", color: "var(--text-dim-solid)", padding: "10px 0", lineHeight: 1.55 }}>
            No reported financials — this looks like a pre-revenue or blank-check (SPAC) company, so there&apos;s no revenue, EPS, or earnings history to chart yet.
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* EPS and Sales in SEPARATE boxes, each with its own bar chart. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div className="card">
          <div className="card-h">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><h3>EPS</h3><VendorTag v="polygon" /></span>
            {seg}
          </div>
          <div className="card-b" style={{ paddingTop: 8 }}>
            <MetricBars title="EPS" data={series.map(d => ({ label: d.label, v: d.eps }))} fmt={v => v.toFixed(2)} />
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><h3>Sales ($Mil)</h3><VendorTag v="polygon" /></span>
            {seg}
          </div>
          <div className="card-b" style={{ paddingTop: 8 }}>
            <MetricBars title="Sales ($Mil)" data={series.map(d => ({ label: d.label, v: d.sales }))} fmt={v => Math.round(v).toLocaleString()} />
          </div>
        </div>
      </div>

      {(annualRows.length > 0 || forwardRows.length > 0 || quarterlyRows.length > 0) && (
      <div className="card">
        <div className="card-b" style={{ paddingTop: 12 }}>

        {/* Fiscal-year table (reported years, then forward `*YYYY` estimates) */}
        {hasData && (annualRows.length > 0 || forwardRows.length > 0) && (
          <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid var(--border-soft)" }}>
            <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--text-hi)", marginBottom: 8 }}>Fiscal year</div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr><th>Fiscal year</th><th className="num">EPS</th><th className="num">Est.</th><th className="num">%chg</th><th className="num">%surp</th><th className="num">Sales (M)</th><th className="num">%chg</th></tr>
                </thead>
                <tbody>
                  {/* Newest first: forward `*YYYY` estimates (future) on top — dimmed,
                      `*` marks them consensus — then reported years newest → oldest. */}
                  {[...forwardRows].reverse().map(r => (
                    <tr key={r.year} style={{ opacity: 0.75, fontStyle: "italic" }}>
                      <td style={{ fontWeight: 700, color: "var(--brand-2)" }}>{r.year}</td>
                      <td className="num">{r.eps != null ? `$${r.eps.toFixed(2)}` : <NotAvailable />}</td>
                      <td className="num">{r.epsEst != null ? `$${r.epsEst.toFixed(2)}` : <NotAvailable />}</td>
                      <td className={`num${chgCls(r.epsChg)}`}>{r.epsChg}</td>
                      <td className={`num${chgCls(r.epsSurp)}`}>{r.epsSurp}</td>
                      <td className="num">{r.sales != null ? r.sales.toFixed(1) : <NotAvailable />}</td>
                      <td className={`num${chgCls(r.salesChg)}`}>{r.salesChg}</td>
                    </tr>
                  ))}
                  {[...annualRows].reverse().map(r => (
                    <tr key={r.year}>
                      <td style={{ fontWeight: 700, color: "var(--text-hi)" }}>{r.year}</td>
                      <td className="num">{r.eps != null ? `$${r.eps.toFixed(2)}` : <NotAvailable />}</td>
                      <td className="num" style={{ color: "var(--text-dim-solid)" }}>{r.epsEst != null ? `$${r.epsEst.toFixed(2)}` : <NotAvailable />}</td>
                      <td className={`num${chgCls(r.epsChg)}`}>{r.epsChg}</td>
                      <td className={`num${chgCls(r.epsSurp)}`}>{r.epsSurp}</td>
                      <td className="num">{r.sales != null ? r.sales.toFixed(1) : <NotAvailable />}</td>
                      <td className={`num${chgCls(r.salesChg)}`}>{r.salesChg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {forwardRows.length > 0 && (
              <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 6 }}>
                * forward analyst consensus (estimate).
              </div>
            )}
          </div>
        )}

        {/* Quarterly table */}
        {hasData && quarterlyRows.length > 0 && (
          <div>
            <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--text-hi)", marginBottom: 8 }}>Quarter</div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr><th>Quarter</th><th className="num">EPS act</th><th className="num">EPS est</th><th className="num">%chg</th><th className="num">%surp</th><th className="num">Sales (M)</th><th className="num">%chg</th><th className="num">%surp</th></tr>
                </thead>
                <tbody>
                  {/* Newest quarter first. */}
                  {[...quarterlyRows].reverse().map((r, i) => (
                    <tr key={`${r.label}-${i}`}>
                      <td style={{ fontWeight: 700, color: "var(--text-hi)" }}>{r.label}</td>
                      <td className="num">{r.eps != null ? `$${r.eps.toFixed(2)}` : <NotAvailable />}</td>
                      <td className="num">{r.epsEst != null ? `$${r.epsEst.toFixed(2)}` : <NotAvailable />}</td>
                      <td className={`num${chgCls(r.epsChg)}`}>{r.epsChg}</td>
                      <td className={`num${chgCls(r.epsSurp)}`}>{r.epsSurp}</td>
                      <td className="num">{r.sales != null ? r.sales.toFixed(1) : <NotAvailable />}</td>
                      <td className={`num${chgCls(r.salesChg)}`}>{r.salesChg}</td>
                      <td className="num">{r.salesSurp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
              %chg is year-over-year. %surp is actual vs analyst estimate — blank until an estimate feed is wired.
            </div>
          </div>
        )}
        </div>
      </div>
      )}
    </>
  );
}
