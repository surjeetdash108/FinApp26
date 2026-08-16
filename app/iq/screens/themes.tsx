"use client";

import { useState } from "react";
import { cls, arr, sign, DataState } from "../utils";
import { useApiList } from "../hooks/useApiList";
import type { CompanyDoc } from "../types";
import { StockPanelLayout, StockListCard, StockRow } from "../stock-panel";
import { AiSummaryCard } from "../ai-summary-card";

interface ThemeStock { s: string; n: string; price: number; c: number; sector: string | null; }
interface Theme { id: string; name: string; desc: string; tickers: string[]; }

// Theme membership (which tickers belong to which theme) is editorial
// curation, same as the sector groupings on the Heatmap screen — there is no
// live "theme classification" feed. Price/change for each member always
// comes from the live companies collection; a ticker with no live match is
// dropped rather than shown with a stale price.
const THEMES: Theme[] = [
  { id: "mag7", name: "Magnificent Seven", desc: "The 7 mega-caps driving market returns",
    tickers: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"] },
  { id: "ai", name: "AI & Semiconductors", desc: "Chips, models and infrastructure powering AI",
    tickers: ["NVDA", "AMD", "AVGO", "INTC", "MU", "ARM", "QCOM", "MRVL"] },
  { id: "software", name: "Software & Cloud", desc: "Enterprise SaaS and cloud platforms",
    tickers: ["PLTR", "CRM", "NOW", "MSFT", "ADSK", "SNOW", "DDOG"] },
  { id: "internet", name: "Internet & Media", desc: "Digital advertising, streaming and social",
    tickers: ["META", "GOOGL", "AMZN", "NFLX", "PINS", "SNAP"] },
  { id: "consumer", name: "Consumer & Retail", desc: "Brands, retail and consumer discretionary",
    tickers: ["AMZN", "TSLA", "SBUX", "NKE", "MCD", "HD", "TGT", "WBA"] },
  { id: "fintech", name: "Fintech", desc: "Payments, crypto and financial innovation",
    tickers: ["PYPL", "SQ", "V", "MA", "SOFI", "COIN", "AFRM"] },
  { id: "hardware", name: "Devices & Hardware", desc: "Physical compute, servers and peripherals",
    tickers: ["AAPL", "DELL", "SMCI", "HPQ", "NTAP", "WDC"] },
  { id: "value", name: "Deep Value", desc: "Low-multiple, out-of-favor names with recovery potential",
    tickers: ["INTC", "WBA", "DELL", "F", "BAC", "C", "T"] },
];

/** Resolves theme tickers against live company data. Drops tickers with no live price match. */
function resolveThemeStocks(tickers: string[], byTicker: Map<string, CompanyDoc>): ThemeStock[] {
  return tickers
    .map((s): ThemeStock | null => {
      const c = byTicker.get(s);
      if (!c || c.price == null) return null;
      return { s, n: c.name ?? s, price: c.price, c: c.pctChange ?? 0, sector: c.sector ?? null };
    })
    .filter((x): x is ThemeStock => x !== null);
}

export function ThemesScreen() {
  const { data: companies, loading: companiesLoading } = useApiList<CompanyDoc>("/market-data/companies");
  const byTicker = new Map(companies.map(c => [c.ticker, c]));

  const [themeId, setThemeId] = useState<string>(THEMES[0].id);
  const [sector, setSector]   = useState("All");
  const [sel, setSel]         = useState<string | null>(null);

  const theme     = THEMES.find(t => t.id === themeId) ?? THEMES[0];
  const allStocks = resolveThemeStocks(theme.tickers, byTicker);

  /* ── Sector filter (SIC-derived sector on each company doc, same as the
     Screener) — options are the sectors actually present in this theme. ── */
  const sectorOptions = ["All", ...Array.from(
    new Set(allStocks.map(s => s.sector).filter((s): s is string => !!s)),
  ).sort()];
  const stocks = sector === "All" ? allStocks : allStocks.filter(s => s.sector === sector);

  const up      = stocks.filter(s => s.c > 0).length;
  const dn      = stocks.filter(s => s.c < 0).length;
  const avg     = stocks.length ? stocks.reduce((acc, s) => acc + s.c, 0) / stocks.length : 0;
  const leader  = [...stocks].sort((a, b) => b.c - a.c)[0];
  const laggard = [...stocks].sort((a, b) => a.c - b.c)[0];

  function handleThemeChange(id: string) {
    setThemeId(id);
    setSector("All"); // sectors differ per theme — a stale pick could show nothing
    setSel(null);
  }

  const avgLabel = (avg >= 0 ? "+" : "") + avg.toFixed(2) + "%";

  return (
    <>
      <div className="page-head">
        <div>
          <div style={{ fontWeight: 700, fontSize: ".92rem", color: "var(--text-hi)", marginBottom: 2 }}>
            {theme.name}
          </div>
          <div className="page-sub">
            {stocks.length} stocks · avg <span className={avg >= 0 ? "up" : "down"}>{avgLabel}</span>
            {leader  && <> · Leader: <b>{leader.s}</b> <span className="up">{sign(leader.c)}</span></>}
            {laggard && laggard.s !== leader?.s && <> · Laggard: <b>{laggard.s}</b> <span className="down">{sign(laggard.c)}</span></>}
          </div>
        </div>

        {/* Sector classification filter (CompanyDoc.sector, SIC-derived) — same control as the Screener */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: ".66rem", letterSpacing: ".05em", textTransform: "uppercase",
            color: "var(--text-dim-solid)", fontWeight: 600,
          }}>Sector</span>
          <select
            className="iq-select"
            value={sector}
            onChange={e => { setSector(e.target.value); setSel(null); }}
            style={{ width: "auto", minWidth: 150, padding: "4px 10px", fontSize: ".72rem" }}
          >
            {sectorOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div style={{ padding: "0 18px 18px" }}>

        {/* Theme filter pills */}
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => handleThemeChange(t.id)}
              style={{
                padding: "5px 13px", borderRadius: 20, border: "1px solid",
                fontSize: ".72rem", fontWeight: 700, cursor: "pointer", transition: "all .15s",
                borderColor: themeId === t.id ? "var(--brand)" : "var(--border)",
                background:  themeId === t.id ? "var(--brand)" : "var(--surface-2)",
                color:       themeId === t.id ? "#fff" : "var(--text-dim-solid)",
              }}
            >
              {t.name}
            </button>
          ))}
        </div>

        {stocks.length === 0 ? (
          <div className="card">
            <div className="card-b">
              <DataState loading={companiesLoading} label={
                sector !== "All"
                  ? `No ${theme.name} constituents in ${sector}.`
                  : `No live price data for any ${theme.name} constituent right now.`
              } />
            </div>
          </div>
        ) : (
          <>
            {/* AI theme summary */}
            <AiSummaryCard title="◆ AI theme summary" pill={<span className="pill ai">leaders · laggards · momentum</span>}>
                <p style={{ marginBottom: 10, fontSize: ".88rem", lineHeight: 1.55 }}>
                  <b style={{ color: "var(--text-hi)" }}>{theme.name}</b> — {theme.desc}.{" "}
                  {stocks.length} constituents finished{" "}
                  <b className="up">{up} up</b> / <b className="down">{dn} down</b> today (avg {avgLabel}).
                  {leader && <> <b>{leader.s}</b> led the group (<span className="up">{sign(leader.c)}</span>).</>}
                  {laggard && laggard.s !== leader?.s && <> <b>{laggard.s}</b> was the laggard (<span className="down">{sign(laggard.c)}</span>).</>}
                </p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span className="src-chip">Up {up}/{stocks.length}</span>
                  <span className="src-chip">Avg {avgLabel}</span>
                  {leader && <span className="src-chip">Leader {leader.s}</span>}
                </div>
            </AiSummaryCard>

            <StockPanelLayout
              selectedSym={sel ?? ""}
              chartPx={stocks.find(s => s.s === sel)?.price ?? 0}
              chartEmptyText="Select a stock to see chart"
              detailEmptyText="Select a stock to see its detail here."
              listCard={
                <StockListCard
                  title={theme.name}
                  headerRight={<span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{stocks.length} stocks</span>}
                >
                  {stocks.map((stock, i) => (
                    <StockRow
                      key={stock.s}
                      sym={stock.s}
                      name={stock.n}
                      seed={i + 7}
                      sparkUp={stock.c >= 0}
                      isSelected={sel === stock.s}
                      onClick={() => setSel(stock.s)}
                      valueTop={stock.price >= 1000 ? `$${(stock.price / 1000).toFixed(2)}K` : `$${stock.price.toFixed(2)}`}
                      valueBottom={`${arr(stock.c)} ${sign(stock.c)}`}
                      valueBottomClass={cls(stock.c)}
                    />
                  ))}
                </StockListCard>
              }
            />
          </>
        )}

      </div>
    </>
  );
}
