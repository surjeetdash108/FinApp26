"use client";

import { useState } from "react";
import { cls, arr, sign, DataState } from "../utils";
import { useApiList } from "../hooks/useApiList";
import type { CompanyDoc } from "../types";
import { StockPanelLayout, StockListCard, StockRow } from "../stock-panel";

interface ThemeStock { s: string; n: string; price: number; c: number; }
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
      return { s, n: c.name ?? s, price: c.price, c: c.pctChange ?? 0 };
    })
    .filter((x): x is ThemeStock => x !== null);
}

export function ThemesScreen() {
  const { data: companies } = useApiList<CompanyDoc>("/market-data/companies");
  const byTicker = new Map(companies.map(c => [c.ticker, c]));

  const [themeId, setThemeId] = useState<string>(THEMES[0].id);
  const [sel, setSel]         = useState<string | null>(null);

  const theme  = THEMES.find(t => t.id === themeId) ?? THEMES[0];
  const stocks = resolveThemeStocks(theme.tickers, byTicker);

  const up      = stocks.filter(s => s.c > 0).length;
  const dn      = stocks.filter(s => s.c < 0).length;
  const avg     = stocks.reduce((acc, s) => acc + s.c, 0) / stocks.length;
  const leader  = [...stocks].sort((a, b) => b.c - a.c)[0];
  const laggard = [...stocks].sort((a, b) => a.c - b.c)[0];

  function handleThemeChange(id: string) {
    setThemeId(id);
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
              <DataState label={`No live price data for any ${theme.name} constituent right now.`} />
            </div>
          </div>
        ) : (
          <>
            {/* AI theme summary */}
            <div className="ai-block" style={{ marginBottom: 14 }}>
              <div className="card-h">
                <h3 className="ai-c">◆ AI theme summary</h3>
                <span className="pill ai">leaders · laggards · momentum</span>
              </div>
              <div className="card-b">
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
              </div>
            </div>

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
