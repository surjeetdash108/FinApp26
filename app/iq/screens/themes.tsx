"use client";

import { useState } from "react";
import { cls, arr, sign, DataState, VendorTag } from "../utils";
import { useApiList } from "../hooks/useApiList";
import type { CompanyDoc } from "../types";
import { StockPanelLayout, StockListCard, StockRow } from "../stock-panel";
import { THEMES, themeFor, sectorFilterOptions, matchesSector } from "../sector-filter";

interface ThemeStock { s: string; n: string; price: number; c: number; sector: string | null; }

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

  // ONE unified filter (a GICS sector OR a theme), defaulting to the first theme.
  // The pills below are just quick-access shortcuts into the SAME values the
  // dropdown carries — the dropdown and pills drive this single state together.
  const [selected, setSelected] = useState<string>(THEMES[0].name);
  const [sel, setSel] = useState<string | null>(null);

  const selectedTheme = themeFor(selected);
  const sectorOptions = sectorFilterOptions(companies);

  // A theme → its curated constituents; a sector / "All" → the matching companies.
  const stocks: ThemeStock[] = selectedTheme
    ? resolveThemeStocks(selectedTheme.tickers, byTicker)
    : companies
        .filter(c => c.price != null && matchesSector(selected, c.ticker, c.sector))
        .map(c => ({ s: c.ticker, n: c.name ?? c.ticker, price: c.price as number, c: c.pctChange ?? 0, sector: c.sector ?? null }))
        .sort((a, b) => b.c - a.c);

  const heading = selectedTheme ? selectedTheme.name : (selected === "All" ? "All tracked names" : selected);
  const avg     = stocks.length ? stocks.reduce((acc, s) => acc + s.c, 0) / stocks.length : 0;
  const leader  = [...stocks].sort((a, b) => b.c - a.c)[0];
  const laggard = [...stocks].sort((a, b) => a.c - b.c)[0];
  const avgLabel = (avg >= 0 ? "+" : "") + avg.toFixed(2) + "%";

  function pick(value: string) {
    setSelected(value);
    setSel(null);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div style={{ fontWeight: 700, fontSize: ".92rem", color: "var(--text-hi)", marginBottom: 2 }}>
            {heading}
          </div>
          <div className="page-sub" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>
              {stocks.length} stocks · avg <span className={avg >= 0 ? "up" : "down"}>{avgLabel}</span>
              {leader  && <> · Leader: <b>{leader.s}</b> <span className="up">{sign(leader.c)}</span></>}
              {laggard && laggard.s !== leader?.s && <> · Laggard: <b>{laggard.s}</b> <span className="down">{sign(laggard.c)}</span></>}
            </span>
            <VendorTag v="polygon" />
          </div>
        </div>

        {/* Unified sector/theme dropdown — the SAME option set as every other
            screen (GICS sectors + the curated themes), lowercase. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: ".66rem", letterSpacing: ".05em", textTransform: "uppercase",
            color: "var(--text-dim-solid)", fontWeight: 600,
          }}>Sector</span>
          <select
            className="iq-select"
            value={selected}
            onChange={e => pick(e.target.value)}
            style={{ width: "auto", minWidth: 160, padding: "4px 10px", fontSize: ".72rem" }}
          >
            {sectorOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div style={{ padding: "0 18px 18px" }}>

        {/* Theme quick-access pills — shortcuts into the same unified filter. */}
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => pick(t.name)}
              style={{
                padding: "5px 13px", borderRadius: 20, border: "1px solid",
                fontSize: ".72rem", fontWeight: 700, cursor: "pointer", transition: "all .15s",
                borderColor: selected === t.name ? "var(--brand)" : "var(--border)",
                background:  selected === t.name ? "var(--brand)" : "var(--surface-2)",
                color:       selected === t.name ? "#fff" : "var(--text-dim-solid)",
              }}
            >
              {t.name}
            </button>
          ))}
        </div>

        {stocks.length === 0 ? (
          <div className="card">
            <div className="card-b">
              <DataState loading={companiesLoading} label={`No live names for ${heading} right now.`} />
            </div>
          </div>
        ) : (
          <>
            <StockPanelLayout
              selectedSym={sel ?? ""}
              chartPx={stocks.find(s => s.s === sel)?.price ?? 0}
              chartEmptyText="Select a stock to see chart"
              detailEmptyText="Select a stock to see its detail here."
              listCard={
                <StockListCard
                  title={heading}
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
