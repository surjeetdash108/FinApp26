"use client";

import { useState, useEffect, useRef } from "react";
import { screenerPresets, type ScreenerStock } from "../data";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import type { CompanyDoc } from "../types";
import { StockPanelLayout, StockListCard, StockRow } from "../stock-panel";
import { VendorTag, titleCaseLabel} from "../utils";
import { sectorFilterOptions, matchesSector } from "../sector-filter";

// Maps the numeric 1-99 tech rating onto the filter's string categories
// (Strong Buy / Buy / Neutral / Sell / Strong Sell).
function ratingLabel(n: number | null): string {
  if (n == null) return "Neutral";
  if (n >= 90) return "Strong Buy";
  if (n >= 70) return "Buy";
  if (n >= 40) return "Neutral";
  if (n >= 20) return "Sell";
  return "Strong Sell";
}

/**
 * Live-only universe: a ticker appears here only if `companies` has a doc for
 * it (i.e. it has actually been synced — the on-demand redesign retired the
 * fixed 241-ticker mock catalog in favor of this dynamic, usage-driven set).
 * Score fields stay null (never a defaulted 0) when the compute job hasn't
 * reached this ticker yet — a 0 would silently pass "less-than" screens (e.g.
 * RS < 40 laggards) and print a fake "RS 0". Filters below treat null as
 * "unknown" and exclude it; the row renders "—".
 */
type ScreenerRow = Omit<ScreenerStock, "peRatio" | "relativeStrength" | "salesGrowth" | "epsGrowth" | "grossMargin" | "rvolRatio"> & {
  peRatio: number | null;
  relativeStrength: number | null;
  salesGrowth: number | null;
  epsGrowth: number | null;
  grossMargin: number | null;
  rvolRatio: number | null;
  live: boolean;
};

function companiesToScreenerStocks(companies: CompanyDoc[]): ScreenerRow[] {
  return companies.map(c => ({
    ticker: c.ticker,
    name: c.name ?? c.ticker,
    sector: c.sector ?? "—",
    marketCap: c.marketCap != null ? c.marketCap / 1e9 : 0,
    peRatio: c.peRatio ?? null,
    relativeStrength: c.rsRating ?? null,
    salesGrowth: c.revenueGrowthYoY != null ? c.revenueGrowthYoY * 100 : null,
    epsGrowth: c.epsGrowthYoY != null ? c.epsGrowthYoY * 100 : null,
    grossMargin: c.grossMargin != null ? c.grossMargin * 100 : null,
    rvolRatio: c.rvol ?? null,
    techRating: ratingLabel(c.techRating),
    live: c.marketCap != null || c.peRatio != null || c.rsRating != null || c.techRating != null,
  }));
}

function CheckOpt({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <div className={`fopt${on ? " on" : ""}`} onClick={onToggle}>
      <span className="cb">
        {on && (
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 10, height: 10 }}>
            <path d="M20 6L9 17l-5-5" stroke="#fff" strokeWidth="3"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {label}
    </div>
  );
}

export function ScreenerScreen() {
  const { data: companies, loading: companiesLoading } = useApiList<CompanyDoc>("/market-data/companies");
  const byTicker = new Map(companies.map(c => [c.ticker, c]));
  const universe = companiesToScreenerStocks(companies);

  /* ── Preset multi-select ── */
  const [activePresets, setActivePresets] = useState<Set<number>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(true);

  /* ── Sector/theme filter — one uniform option set app-wide (sectors + themes). ── */
  const [sector, setSector] = useState("All");
  const sectorOptions = sectorFilterOptions(companies);

  /* ── Manual filter state ── */
  const [rs90,       setRs90]       = useState(false);
  const [rs7090,     setRs7090]     = useState(false);
  const [rsLt40,     setRsLt40]     = useState(false);
  const [salesGt20,  setSalesGt20]  = useState(false);
  const [epsGt25,    setEpsGt25]    = useState(false);
  const [marginPos,  setMarginPos]  = useState(false);
  const [ratingBuy,  setRatingBuy]  = useState(false);
  const [mcGt10,     setMcGt10]     = useState(false);
  const [rvolGt15,   setRvolGt15]   = useState(false);
  // Backed by technical-indicators.job fields on the company doc
  // (aboveSma50/aboveSma200, rsi14) + price.
  const [dmaAbove,   setDmaAbove]   = useState(false);
  const [rsiBand,    setRsiBand]    = useState(false);
  const [priceGt5,   setPriceGt5]   = useState(false);

  /* ── Restore the last-used filter set (saved by earlier versions) ── */
  /*
   * The screener opens with EVERY filter off.
   *
   * There used to be a restore here that read "iq-screener-filters" from
   * localStorage on mount. Nothing in the app writes that key any more, so all
   * it did was resurrect state saved by an older build — a user would arrive to
   * find "Sales growth > 20%" already ticked with no memory of setting it, and
   * a results list silently narrowed. It also forced the market-cap filter on
   * via `s.mcGt10 ?? true`, so an absent key still produced an active filter.
   *
   * A screener that starts pre-filtered hides most of the universe before the
   * user has asked for anything, so the default is now a clean slate. The stale
   * key is simply ignored; nothing needs clearing.
   */

  /* ── Export the SELECTED stock's data as a PDF (browser print → Save as PDF) ── */
  function exportPdf() {
    if (!selStock) { alert("Select a stock in the results first."); return; }
    const s = selStock;
    const c = selLive; // richer live company doc (price + technicals)
    const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
    const money = (v: number | null | undefined) => (v == null ? "—" : `$${v.toFixed(2)}`);
    const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
    const nOr = (v: number | null | undefined, suffix = "", d = 1) => (v == null || v === 0 ? "—" : `${v.toFixed(d)}${suffix}`);
    const price = c?.price ?? byTicker.get(s.ticker)?.price ?? null;
    const rows: [string, string][] = [
      ["Price", money(price)],
      ["Day change", pct(c?.pctChange)],
      ["Market cap", s.marketCap ? `$${s.marketCap.toFixed(1)}B` : "—"],
      ["P/E ratio", nOr(s.peRatio, "", 1)],
      ["RS rating", s.relativeStrength ? `${s.relativeStrength}/99` : "—"],
      ["Tech rating", s.techRating || "—"],
      ["Sales growth (YoY)", nOr(s.salesGrowth, "%")],
      ["EPS growth (YoY)", nOr(s.epsGrowth, "%")],
      ["Gross margin", nOr(s.grossMargin, "%")],
      ["Rel. volume", nOr(s.rvolRatio, "×")],
      ["Beta", nOr(c?.beta ?? null, "", 2)],
      ["Dividend yield", c?.dividendYield != null ? `${c.dividendYield.toFixed(2)}%` : "—"],
      ["52-week high", money(c?.high52 ?? null)],
      ["52-week low", money(c?.low52 ?? null)],
      ["SMA 50", money(c?.sma50 ?? null)],
      ["SMA 200", money(c?.sma200 ?? null)],
      ["RSI (14)", nOr(c?.rsi14 ?? null, "", 1)],
    ];
    const metricsHtml = rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.ticker)} — MarketCatalyst</title>
      <style>
        *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;margin:26px;font-size:12px}
        h1{font-size:20px;margin:0} .name{color:#333;font-size:13px;margin:1px 0 2px} .sub{color:#666;font-size:11px;margin-bottom:16px}
        table{border-collapse:collapse;width:100%;max-width:520px} td{padding:6px 8px;border-bottom:1px solid #e8ebf1}
        td.k{color:#555} td.v{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
        .desc{margin-top:16px;max-width:640px;font-size:11.5px;line-height:1.55;color:#333}
        .foot{margin-top:20px;font-size:9.5px;color:#999}
        @page{margin:16mm} @media print{body{margin:0}}
      </style></head>
      <body onload="window.print()">
        <h1>${esc(s.ticker)}</h1>
        <div class="name">${esc(s.name)}</div>
        <div class="sub">${esc(s.sector)} · generated ${new Date().toLocaleString()}</div>
        <table><tbody>${metricsHtml}</tbody></table>
        ${c?.description ? `<div class="desc">${esc(c.description)}</div>` : ""}
        <div class="foot">MarketCatalyst — informational only, not investment advice.</div>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { alert("Please allow pop-ups for this site to export the PDF."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  /* ── More dropdown ── */
  const [ddOpen, setDdOpen] = useState(false);
  const ddRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ddOpen) return;
    function onOutside(e: MouseEvent) {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) {
        setDdOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [ddOpen]);

  /* ── Selection / chart state ── */
  const [scrSel, setScrSel] = useState("");

  function togglePreset(idx: number) {
    setActivePresets(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  function resetAll() {
    setActivePresets(new Set());
    setSector("All");
    setRs90(false); setRs7090(false); setRsLt40(false);
    setSalesGt20(false); setEpsGt25(false); setMarginPos(false);
    setRatingBuy(false); setMcGt10(false); setRvolGt15(false);
    setDmaAbove(false); setRsiBand(false); setPriceGt5(false);
  }

  /* ── Filtered results ── */
  // The results list starts empty: it only populates once the user has picked
  // at least one filter (a preset, the sector, or any manual criterion). This
  // is a screener — an unfiltered "everything" list isn't a useful default.
  const hasActiveFilters =
    activePresets.size > 0 || sector !== "All" ||
    rs90 || rs7090 || rsLt40 || salesGt20 || epsGt25 || marginPos ||
    ratingBuy || mcGt10 || rvolGt15 || dmaAbove || rsiBand || priceGt5;

  const filtered = !hasActiveFilters ? [] : universe.filter(s => {
    // Sector classification filter (from CompanyDoc.sector).
    if (!matchesSector(sector, s.ticker, s.sector)) return false;
    // Preset filters — stock must pass at least one selected preset (OR logic)
    if (activePresets.size > 0) {
      const passesAny = [...activePresets].some(idx => {
        const pf = screenerPresets[idx].f;
        if (pf.relativeStrength_min !== undefined && (s.relativeStrength == null || s.relativeStrength < pf.relativeStrength_min)) return false;
        if (pf.salesGrowth_min      !== undefined && (s.salesGrowth == null || s.salesGrowth < pf.salesGrowth_min))                return false;
        if (pf.epsGrowth_min        !== undefined && (s.epsGrowth == null || s.epsGrowth < pf.epsGrowth_min))                      return false;
        if (pf.rvolRatio_min        !== undefined && (s.rvolRatio == null || s.rvolRatio < pf.rvolRatio_min))                      return false;
        if (pf.marketCap_min        !== undefined && s.marketCap        < pf.marketCap_min)        return false;
        if (pf.techRating           !== undefined && !pf.techRating.includes(s.techRating))        return false;
        return true;
      });
      if (!passesAny) return false;
    }
    // Manual filters — all must pass (AND logic)
    if (rs90      && (s.relativeStrength == null || s.relativeStrength < 90))                              return false;
    if (rs7090    && (s.relativeStrength == null || s.relativeStrength < 70 || s.relativeStrength >= 90))  return false;
    if (rsLt40    && (s.relativeStrength == null || s.relativeStrength >= 40))                             return false;
    if (salesGt20 && (s.salesGrowth == null || s.salesGrowth < 20))                                        return false;
    if (epsGt25   && (s.epsGrowth == null || s.epsGrowth < 25))                                            return false;
    if (marginPos && (s.grossMargin == null || s.grossMargin <= 10))                                       return false;
    if (ratingBuy && !["Strong Buy", "Buy"].includes(s.techRating))           return false;
    if (mcGt10    && s.marketCap < 10)                                        return false;
    if (rvolGt15  && (s.rvolRatio == null || s.rvolRatio < 1.5))                                           return false;
    // Technicals read from the company doc (technical-indicators.job).
    if (dmaAbove || rsiBand || priceGt5) {
      const c = byTicker.get(s.ticker);
      if (dmaAbove  && !(c?.aboveSma50 === true && c?.aboveSma200 === true))   return false;
      if (rsiBand   && !(c?.rsi14 != null && c.rsi14 >= 40 && c.rsi14 <= 70))  return false;
      if (priceGt5  && !(c?.price != null && c.price > 5))                     return false;
    }
    return true;
  });

  /* selected stock — fall back to first result if current sel drops out */
  const selStock = filtered.find(s => s.ticker === scrSel) ?? filtered[0] ?? null;
  const selSym   = selStock?.ticker ?? "";

  /* Live on-demand price for the selected stock — the same source the detail
     panel below uses — so the list row and the detail show the SAME price
     (the list otherwise shows the page-load companies snapshot, which drifts). */
  const { data: selLive } = useApiResource<CompanyDoc>(selSym ? `/live/company?ticker=${encodeURIComponent(selSym)}` : null);
  const selPx = selLive?.price ?? byTicker.get(selSym)?.price ?? 0;

  /* how many "More" presets (index >= 4) are active */

  return (
    <>
      <div className="page-head">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: ".78rem", color: "var(--text-dim-solid)" }}>
          {hasActiveFilters ? `${filtered.length} match${filtered.length !== 1 ? "es" : ""}` : "Select a filter to begin"}
          <VendorTag v="polygon" />
        </span>
        <button className="btn primary" onClick={exportPdf} disabled={!selStock}
          title={selStock ? `Export ${selStock.ticker} data as PDF` : "Select a stock first"}
          style={{ opacity: selStock ? 1 : 0.5 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
            <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Export PDF{selStock ? ` · ${selStock.ticker}` : ""}
        </button>
      </div>

      <div style={{ padding: "0 18px 18px" }}>

        {/* ── Filter card ── */}
        <div className="card" style={{ marginBottom: 14, overflow: "visible" }}>

          <div className="filt-hdr" style={{ cursor: "pointer" }} onClick={() => setFiltersOpen(o => !o)}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <span aria-hidden style={{ display: "inline-block", transition: "transform .2s", transform: filtersOpen ? "rotate(90deg)" : "none", fontSize: ".72rem", color: "var(--text-dim-solid)" }}>▸</span>
              Filters
            </span>
            <span className="link" onClick={e => { e.stopPropagation(); resetAll(); }}>Reset</span>
          </div>

          {filtersOpen && (<>
          {/* Presets row */}
          <div style={{
            display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center",
            padding: "10px 14px", borderBottom: "1px solid var(--border-soft)",
          }}>
            <span style={{
              fontSize: ".66rem", letterSpacing: ".05em", textTransform: "uppercase",
              color: "var(--text-dim-solid)", fontWeight: 600, marginRight: 4,
            }}>Presets</span>

            {/* All presets live in this single dropdown (multi-select, close on outside click).
                zIndex while open lifts the whole wrapper into a high stacking context so the
                menu floats ABOVE the results/chart panels below it (the .dd-menu z-index:40
                was being painted under them). */}
            <div ref={ddRef} style={{ position: "relative", zIndex: ddOpen ? 100 : undefined }}>
              <button
                onClick={() => setDdOpen(o => !o)}
                style={{
                  fontSize: ".72rem", padding: "4px 11px", borderRadius: 6, cursor: "pointer",
                  fontFamily: "var(--f-body)",
                  border: `1px solid ${activePresets.size > 0 ? "var(--ai)" : ddOpen ? "var(--brand)" : "var(--border)"}`,
                  background: activePresets.size > 0 ? "var(--ai-dim)" : ddOpen ? "var(--brand-dim)" : "var(--surface-2)",
                  color: activePresets.size > 0 || ddOpen ? "var(--text-hi)" : "var(--text-dim-solid)",
                }}
              >
                {activePresets.size > 0 ? `Presets (${activePresets.size})` : "Select presets"} {ddOpen ? "▴" : "▾"}
              </button>
              {ddOpen && (
                <div className="dd-menu" style={{ minWidth: 280 }}>
                  <div className="ddlbl">{screenerPresets.length} preset screens — select multiple</div>
                  {screenerPresets.map((p, i) => {
                    const on = activePresets.has(i);
                    return (
                      <button
                        key={p.name}
                        onClick={() => togglePreset(i)}
                        style={{ display: "flex", alignItems: "flex-start", gap: 8, background: on ? "var(--ai-dim)" : undefined }}
                      >
                        <span style={{
                          flexShrink: 0, width: 14, height: 14, marginTop: 2,
                          border: `1.5px solid ${on ? "var(--ai)" : "var(--border-strong)"}`,
                          borderRadius: 4, background: on ? "var(--ai)" : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          {on && (
                            <svg viewBox="0 0 24 24" fill="none" style={{ width: 9, height: 9 }}>
                              <path d="M20 6L9 17l-5-5" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <span>
                          {p.name}<small>{p.desc}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Sector classification filter (CompanyDoc.sector, SIC-derived) */}
            <div style={{ flex: 1 }} />
            <span style={{
              fontSize: ".66rem", letterSpacing: ".05em", textTransform: "uppercase",
              color: "var(--text-dim-solid)", fontWeight: 600,
            }}>Sector</span>
            <select
              className="iq-select"
              value={sector}
              onChange={e => setSector(e.target.value)}
              style={{ width: "auto", minWidth: 150, padding: "4px 10px", fontSize: ".72rem" }}
            >
              {sectorOptions.map(s => <option key={s} value={s}>{titleCaseLabel(s)}</option>)}
            </select>
          </div>

          {/* Filter groups — horizontal */}
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            <div className="fgroup" style={{ flex: 1, borderBottom: "none", borderRight: "1px solid var(--border-soft)" }}>
              <div className="fl">Relative strength (6-mo)</div>
              <CheckOpt label="RS ≥ 90 (leaders)"  on={rs90}   onToggle={() => { setRs90(o => !o); setRs7090(false); setRsLt40(false); }} />
              <CheckOpt label="RS 70–90"            on={rs7090} onToggle={() => { setRs7090(o => !o); setRs90(false); setRsLt40(false); }} />
              <CheckOpt label="RS < 40 (laggards)"  on={rsLt40} onToggle={() => { setRsLt40(o => !o); setRs90(false); setRs7090(false); }} />
            </div>
            <div className="fgroup" style={{ flex: 1, borderBottom: "none", borderRight: "1px solid var(--border-soft)" }}>
              <div className="fl">Growth</div>
              <CheckOpt label="Sales growth > 20%"  on={salesGt20} onToggle={() => setSalesGt20(o => !o)} />
              <CheckOpt label="EPS growth > 25%"    on={epsGt25}   onToggle={() => setEpsGt25(o => !o)} />
              <CheckOpt label="Expanding margins"   on={marginPos} onToggle={() => setMarginPos(o => !o)} />
            </div>
            <div className="fgroup" style={{ flex: 1, borderBottom: "none", borderRight: "1px solid var(--border-soft)" }}>
              <div className="fl">Technical rating</div>
              <CheckOpt label="Strong Buy / Buy"   on={ratingBuy} onToggle={() => setRatingBuy(o => !o)} />
              <CheckOpt label="Above 50 & 200-DMA" on={dmaAbove}  onToggle={() => setDmaAbove(o => !o)} />
              <CheckOpt label="RSI 40–70"          on={rsiBand}   onToggle={() => setRsiBand(o => !o)} />
            </div>
            <div className="fgroup" style={{ flex: 1, borderBottom: "none" }}>
              <div className="fl">Liquidity &amp; cap</div>
              <CheckOpt label="Market cap > $10B"  on={mcGt10}   onToggle={() => setMcGt10(o => !o)} />
              <CheckOpt label="RVOL > 1.5×"        on={rvolGt15} onToggle={() => setRvolGt15(o => !o)} />
              <CheckOpt label="Price > $5"          on={priceGt5} onToggle={() => setPriceGt5(o => !o)} />
            </div>
          </div>
          </>)}

        </div>

        <StockPanelLayout
          selectedSym={selSym}
          chartPx={selPx}
          chartEmptyText="Select a stock from the results"
          detailEmptyText="Select a stock from the results to see its full analysis."
          listCard={
            <StockListCard
              title="Results"
              headerRight={<span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{hasActiveFilters ? `${filtered.length} matches` : "No filters"}</span>}
              isEmpty={filtered.length === 0}
              loading={hasActiveFilters && companiesLoading}
              emptyMessage={hasActiveFilters ? "No matches — try relaxing filters." : "Select a filter to start screening — presets, sector, or any criterion below."}
              maxListHeight={414}
            >
              {filtered.map((s, i) => {
                // The selected row uses the same live price the detail panel shows.
                const px = s.ticker === selSym ? (selLive?.price ?? byTicker.get(s.ticker)?.price ?? null) : (byTicker.get(s.ticker)?.price ?? null);
                return (
                  <StockRow
                    key={s.ticker}
                    sym={s.ticker}
                    name={s.name}
                    seed={i + 11}
                    sparkUp={(s.relativeStrength ?? 0) >= 60}
                    isSelected={selSym === s.ticker}
                    onClick={() => setScrSel(s.ticker)}
                    valueTop={px == null ? "—" : px >= 1000 ? `$${(px / 1000).toFixed(2)}K` : `$${px.toFixed(2)}`}
                    valueBottom={`RS ${s.relativeStrength ?? "—"} · ${s.techRating}`}
                    valueBottomClass={s.techRating.includes("Buy") ? "up" : s.techRating.includes("Sell") ? "down" : ""}
                  />
                );
              })}
            </StockListCard>
          }
        />

      </div>
    </>
  );
}
