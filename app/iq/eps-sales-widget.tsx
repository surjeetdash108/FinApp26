"use client";

import { useState } from "react";
import { NotAvailable } from "./utils";
import type { FinancialsDoc, AnnualFinancials, QuarterFinancials } from "./types";

/** "+12%" / "-4%" / "—" — rounded YoY %change, blank when either side is missing. */
function pctChangeStr(curr: number | null | undefined, prev: number | null | undefined): string {
  if (curr == null || prev == null || Math.abs(prev) < 0.005) return "—";
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  return `${pct >= 0 ? "+" : ""}${Math.round(pct)}%`;
}

type EpsSalesPt = { label: string; eps: number | null; sales: number | null };
type AnnualRow = { year: string; eps: number | null; epsChg: string; sales: number | null; salesChg: string };
type QuarterRow = {
  label: string; eps: number | null; epsChg: string; epsSurp: string;
  sales: number | null; salesChg: string; salesSurp: string;
};

/** EPS + Sales(M) per period, oldest→newest, for the dual bar charts. Actuals only. */
function epsSalesSeries(period: "Q" | "A", doc: FinancialsDoc | null): EpsSalesPt[] {
  if (!doc) return [];
  if (period === "Q") {
    return [...doc.quarters]
      .filter(r => r.endDate)
      .sort((a, b) => (a.endDate as string).localeCompare(b.endDate as string))
      .slice(-12)
      .map(r => ({
        label: new Date(r.endDate + "T00:00:00")
          .toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", "-"),
        eps: r.epsActual,
        sales: r.revenue != null ? r.revenue / 1e6 : null,
      }));
  }
  return [...doc.annual]
    .filter(r => r.fiscalYear)
    .sort((a, b) => Number(a.fiscalYear) - Number(b.fiscalYear))
    .slice(-10)
    .map(r => ({ label: r.fiscalYear as string, eps: r.epsActual, sales: r.revenue != null ? r.revenue / 1e6 : null }));
}

/** One row per reported fiscal year, oldest first, with EPS/Sales YoY %change. */
function annualEpsSalesRows(annual: AnnualFinancials[]): AnnualRow[] {
  const asc = [...annual].filter(r => r.fiscalYear).sort((a, b) => Number(a.fiscalYear) - Number(b.fiscalYear));
  return asc.map((r, i) => {
    const prev = i > 0 ? asc[i - 1] : null;
    return {
      year: r.fiscalYear as string,
      eps: r.epsActual,
      epsChg: pctChangeStr(r.epsActual, prev?.epsActual),
      sales: r.revenue != null ? r.revenue / 1e6 : null,
      salesChg: pctChangeStr(r.revenue, prev?.revenue),
    };
  });
}

/** One row per reported quarter, oldest first. %chg is YoY (4 back); %surp is
 *  actual-vs-estimate (blank "—" until an estimate feed is wired). */
function quarterlyEpsSalesRows(quarters: QuarterFinancials[]): QuarterRow[] {
  const asc = [...quarters].filter(r => r.endDate).sort((a, b) => (a.endDate as string).localeCompare(b.endDate as string));
  return asc.map((r, i) => {
    const yoy = i >= 4 ? asc[i - 4] : null;
    return {
      label: new Date(r.endDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      eps: r.epsActual,
      epsChg: pctChangeStr(r.epsActual, yoy?.epsActual),
      epsSurp: pctChangeStr(r.epsActual, r.epsEstimate),
      sales: r.revenue != null ? r.revenue / 1e6 : null,
      salesChg: pctChangeStr(r.revenue, yoy?.revenue),
      salesSurp: "—",
    };
  });
}

/** One zero-baselined bar chart (EPS or Sales), value labelled on top, period
 *  label angled underneath — the reference layout's headline chart. */
function MetricBars({ title, data, fmt }: {
  title: string; data: Array<{ label: string; v: number | null }>; fmt: (v: number) => string;
}) {
  const gid = "esw-" + title.replace(/\W/g, "");
  const vals = data.map(d => d.v).filter((v): v is number => v != null);
  const W = 360, H = 260, PADT = 26, PADB = 52, PADX = 6;
  const LABEL_Y = H - 34;
  const iw = W - PADX * 2, ih = H - PADT - PADB;
  const maxV = Math.max(0, ...vals);
  const minV = Math.min(0, ...vals);
  const span = (maxV - minV) || 1;
  const yOf = (v: number) => PADT + ((maxV - v) / span) * ih;
  const zeroY = yOf(0);
  const gw = iw / Math.max(1, data.length);
  const bw = Math.min(gw * 0.62, 30);
  return (
    <div>
      <div style={{ fontSize: ".82rem", fontWeight: 700, color: "var(--text-dim-solid)", marginBottom: 4 }}>{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand-2)" />
            <stop offset="100%" stopColor="var(--brand)" />
          </linearGradient>
        </defs>
        {data.map((d, i) => {
          if (d.v == null) return null;
          const cx = PADX + gw * i + gw / 2;
          const yv = yOf(d.v);
          const y = Math.min(zeroY, yv);
          const h = Math.max(2, Math.abs(yv - zeroY));
          const above = d.v >= 0;
          return (
            <g key={d.label + i}>
              <rect x={(cx - bw / 2).toFixed(1)} y={y.toFixed(1)} width={bw.toFixed(1)} height={h.toFixed(1)} rx="2.5" fill={`url(#${gid})`} />
              <text x={cx.toFixed(1)} y={(above ? y - 5 : y + h + 11).toFixed(1)} textAnchor="middle" fontSize="9.5"
                fontFamily="JetBrains Mono,monospace" fill="var(--text-hi)">{fmt(d.v)}</text>
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
 * Fiscal-year and Quarterly tables, matching the reference layout. Actuals are
 * real; the quarterly %surp columns stay "—" until an earnings-estimate feed is
 * wired (Polygon has none), and there are no forward-estimate rows for the same
 * reason.
 */
export function EpsSalesWidget({ financialsDoc }: { financialsDoc: FinancialsDoc | null }) {
  const [period, setPeriod] = useState<"Q" | "A">("Q");
  const series = epsSalesSeries(period, financialsDoc);
  const annualRows = annualEpsSalesRows(financialsDoc?.annual ?? []);
  const quarterlyRows = quarterlyEpsSalesRows(financialsDoc?.quarters ?? []);

  return (
    <div className="card">
      <div className="card-h">
        <h3>Sales &amp; EPS</h3>
        <div className="ecal-seg">
          <button className={`ecal-segbtn${period === "Q" ? " on" : ""}`} onClick={() => setPeriod("Q")}>Quarterly</button>
          <button className={`ecal-segbtn${period === "A" ? " on" : ""}`} onClick={() => setPeriod("A")}>Annual</button>
        </div>
      </div>
      <div className="card-b" style={{ paddingTop: 8 }}>
        {series.length === 0 ? (
          <div style={{ fontSize: ".8rem", color: "var(--text-dim-solid)", padding: "6px 0" }}>No financials synced yet.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid var(--border-soft)" }}>
            <MetricBars title="EPS" data={series.map(d => ({ label: d.label, v: d.eps }))} fmt={v => v.toFixed(2)} />
            <MetricBars title="Sales ($Mil)" data={series.map(d => ({ label: d.label, v: d.sales }))} fmt={v => Math.round(v).toLocaleString()} />
          </div>
        )}

        {/* Fiscal-year table */}
        {annualRows.length > 0 && (
          <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid var(--border-soft)" }}>
            <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--text-hi)", marginBottom: 8 }}>Fiscal year</div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr><th>Fiscal year</th><th className="num">EPS</th><th className="num">%chg</th><th className="num">Sales (M)</th><th className="num">%chg</th></tr>
                </thead>
                <tbody>
                  {annualRows.map(r => (
                    <tr key={r.year}>
                      <td style={{ fontWeight: 700, color: "var(--text-hi)" }}>{r.year}</td>
                      <td className="num">{r.eps != null ? `$${r.eps.toFixed(2)}` : <NotAvailable />}</td>
                      <td className={`num${chgCls(r.epsChg)}`}>{r.epsChg}</td>
                      <td className="num">{r.sales != null ? r.sales.toFixed(1) : <NotAvailable />}</td>
                      <td className={`num${chgCls(r.salesChg)}`}>{r.salesChg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Quarterly table */}
        {quarterlyRows.length > 0 && (
          <div>
            <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--text-hi)", marginBottom: 8 }}>Quarter</div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr><th>Quarter</th><th className="num">EPS</th><th className="num">%chg</th><th className="num">%surp</th><th className="num">Sales (M)</th><th className="num">%chg</th><th className="num">%surp</th></tr>
                </thead>
                <tbody>
                  {quarterlyRows.map((r, i) => (
                    <tr key={`${r.label}-${i}`}>
                      <td style={{ fontWeight: 700, color: "var(--text-hi)" }}>{r.label}</td>
                      <td className="num">{r.eps != null ? `$${r.eps.toFixed(2)}` : <NotAvailable />}</td>
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
  );
}
