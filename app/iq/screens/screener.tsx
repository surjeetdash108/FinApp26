"use client";

import { useState, useEffect, useRef } from "react";
import { screenerPresets, type ScreenerStock } from "../data";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import type { CompanyDoc } from "../types";
import { StockPanelLayout, StockListCard, StockRow } from "../stock-panel";

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
 * Individual score fields render a neutral 0/"Neutral" only when that
 * specific compute job hasn't reached this ticker yet, never a mock number.
 */
function companiesToScreenerStocks(companies: CompanyDoc[]): (ScreenerStock & { live: boolean })[] {
  return companies.map(c => ({
    ticker: c.ticker,
    name: c.name ?? c.ticker,
    sector: c.sector ?? "—",
    marketCap: c.marketCap != null ? c.marketCap / 1e9 : 0,
    peRatio: c.peRatio ?? 0,
    relativeStrength: c.rsRating ?? 0,
    salesGrowth: c.revenueGrowthYoY != null ? c.revenueGrowthYoY * 100 : 0,
    epsGrowth: c.epsGrowthYoY != null ? c.epsGrowthYoY * 100 : 0,
    grossMargin: c.grossMargin != null ? c.grossMargin * 100 : 0,
    rvolRatio: c.rvol ?? 0,
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

  /* ── Sector filter (SIC-derived sector on each company doc) ── */
  const [sector, setSector] = useState("All");
  const sectorOptions = ["All", ...Array.from(
    new Set(companies.map(c => c.sector).filter((s): s is string => !!s && s !== "—")),
  ).sort()];

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

  /* ── Save / restore the current screen (filter set) to localStorage ── */
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("iq-screener-filters");
      if (!raw) return;
      const s = JSON.parse(raw);
      if (Array.isArray(s.activePresets)) setActivePresets(new Set(s.activePresets));
      setRs90(!!s.rs90); setRs7090(!!s.rs7090); setRsLt40(!!s.rsLt40);
      setSalesGt20(!!s.salesGt20); setEpsGt25(!!s.epsGt25); setMarginPos(!!s.marginPos);
      setRatingBuy(!!s.ratingBuy); setMcGt10(s.mcGt10 ?? true); setRvolGt15(!!s.rvolGt15);
      setDmaAbove(!!s.dmaAbove); setRsiBand(!!s.rsiBand); setPriceGt5(!!s.priceGt5);
    } catch { /* ignore malformed saved filters */ }
  }, []);
  function saveScreen() {
    const state = { activePresets: [...activePresets], rs90, rs7090, rsLt40, salesGt20, epsGt25, marginPos, ratingBuy, mcGt10, rvolGt15, dmaAbove, rsiBand, priceGt5 };
    try { localStorage.setItem("iq-screener-filters", JSON.stringify(state)); } catch { /* storage full/blocked */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  /* ── Export the current matches as a PDF (via the browser's print → Save as PDF) ── */
  function exportPdf() {
    const esc = (s: string) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
    const active: string[] = [];
    if (sector !== "All") active.push(`Sector: ${sector}`);
    if (rs90) active.push("RS ≥ 90"); if (rs7090) active.push("RS 70–90"); if (rsLt40) active.push("RS < 40");
    if (salesGt20) active.push("Sales growth > 20%"); if (epsGt25) active.push("EPS growth > 25%"); if (marginPos) active.push("Positive gross margin");
    if (ratingBuy) active.push("Tech rating Buy"); if (mcGt10) active.push("Market cap > $10B"); if (rvolGt15) active.push("RVOL > 1.5×");
    if (dmaAbove) active.push("Above key MAs"); if (rsiBand) active.push("RSI 40–70"); if (priceGt5) active.push("Price > $5");
    [...activePresets].forEach(p => active.push(`Preset: ${p}`));
    const num = (v: number, suffix = "", d = 1) => (v ? `${v.toFixed(d)}${suffix}` : "—");
    const rows = filtered.map(s => `<tr>
      <td class="tk">${esc(s.ticker)}</td><td>${esc(s.name)}</td><td>${esc(s.sector)}</td>
      <td class="n">${s.marketCap ? "$" + s.marketCap.toFixed(1) + "B" : "—"}</td>
      <td class="n">${num(s.peRatio)}</td><td class="n">${s.relativeStrength || "—"}</td>
      <td class="n">${num(s.salesGrowth, "%")}</td><td class="n">${num(s.epsGrowth, "%")}</td>
      <td class="n">${num(s.grossMargin, "%")}</td><td class="n">${num(s.rvolRatio, "×")}</td>
      <td>${esc(s.techRating)}</td></tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>MarketCatalyst Screener</title>
      <style>
        *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;margin:24px;font-size:11px}
        h1{font-size:17px;margin:0 0 2px} .sub{color:#666;font-size:11px;margin-bottom:10px}
        .filters{margin:0 0 12px;font-size:10.5px;color:#333}
        .chip{display:inline-block;background:#eef1f6;border:1px solid #d7dce6;border-radius:10px;padding:2px 8px;margin:0 4px 4px 0}
        table{width:100%;border-collapse:collapse} th,td{padding:4px 6px;border-bottom:1px solid #e5e8ef;text-align:left}
        th{font-size:9px;text-transform:uppercase;letter-spacing:.04em;color:#666;border-bottom:1.5px solid #c8ccd6}
        td.n,th.n{text-align:right;font-variant-numeric:tabular-nums} td.tk{font-weight:700}
        tr:nth-child(even) td{background:#fafbfd}
        @page{margin:14mm} @media print{body{margin:0}}
      </style></head>
      <body onload="window.print()">
        <h1>MarketCatalyst — Stock Screener</h1>
        <div class="sub">${filtered.length} matches · generated ${new Date().toLocaleString()}</div>
        <div class="filters">${active.length ? active.map(a => `<span class="chip">${esc(a)}</span>`).join("") : '<span class="chip">No filters — full universe</span>'}</div>
        <table><thead><tr>
          <th>Ticker</th><th>Company</th><th>Sector</th><th class="n">Mkt Cap</th><th class="n">P/E</th><th class="n">RS</th>
          <th class="n">Sales Gr</th><th class="n">EPS Gr</th><th class="n">Gr Margin</th><th class="n">RVOL</th><th>Tech</th>
        </tr></thead><tbody>${rows}</tbody></table>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { alert("Please allow pop-ups for this site to export the screener as a PDF."); return; }
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
  const filtered = universe.filter(s => {
    // Sector classification filter (from CompanyDoc.sector).
    if (sector !== "All" && s.sector !== sector) return false;
    // Preset filters — stock must pass at least one selected preset (OR logic)
    if (activePresets.size > 0) {
      const passesAny = [...activePresets].some(idx => {
        const pf = screenerPresets[idx].f;
        if (pf.relativeStrength_min !== undefined && s.relativeStrength < pf.relativeStrength_min) return false;
        if (pf.salesGrowth_min      !== undefined && s.salesGrowth      < pf.salesGrowth_min)      return false;
        if (pf.epsGrowth_min        !== undefined && s.epsGrowth        < pf.epsGrowth_min)        return false;
        if (pf.rvolRatio_min        !== undefined && s.rvolRatio        < pf.rvolRatio_min)        return false;
        if (pf.marketCap_min        !== undefined && s.marketCap        < pf.marketCap_min)        return false;
        if (pf.techRating           !== undefined && !pf.techRating.includes(s.techRating))        return false;
        return true;
      });
      if (!passesAny) return false;
    }
    // Manual filters — all must pass (AND logic)
    if (rs90      && s.relativeStrength < 90)                                 return false;
    if (rs7090    && (s.relativeStrength < 70 || s.relativeStrength >= 90))   return false;
    if (rsLt40    && s.relativeStrength >= 40)                                return false;
    if (salesGt20 && s.salesGrowth < 20)                                      return false;
    if (epsGt25   && s.epsGrowth   < 25)                                      return false;
    if (marginPos && s.grossMargin <= 10)                                      return false;
    if (ratingBuy && !["Strong Buy", "Buy"].includes(s.techRating))           return false;
    if (mcGt10    && s.marketCap < 10)                                        return false;
    if (rvolGt15  && s.rvolRatio < 1.5)                                       return false;
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
        <span style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>
          {filtered.length} match{filtered.length !== 1 ? "es" : ""}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={exportPdf} title="Export the current matches as a PDF">
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Export PDF
          </button>
          <button className="btn primary" onClick={saveScreen}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
              <path d="M5 5h14v14l-7-4-7 4z" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
            </svg>
            {saved ? "Saved ✓" : "Save screen"}
          </button>
        </div>
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

            {/* All presets live in this single dropdown (multi-select, close on outside click) */}
            <div ref={ddRef} style={{ position: "relative" }}>
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
              {sectorOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Filter groups — horizontal */}
          <div style={{ display: "flex" }}>
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
              headerRight={<span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{filtered.length} matches</span>}
              isEmpty={filtered.length === 0}
              loading={companiesLoading}
              emptyMessage="No matches — try relaxing filters."
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
                    sparkUp={s.relativeStrength >= 60}
                    isSelected={selSym === s.ticker}
                    onClick={() => setScrSel(s.ticker)}
                    valueTop={px == null ? "—" : px >= 1000 ? `$${(px / 1000).toFixed(2)}K` : `$${px.toFixed(2)}`}
                    valueBottom={`RS ${s.relativeStrength} · ${s.techRating}`}
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
