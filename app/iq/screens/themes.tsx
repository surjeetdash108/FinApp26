"use client";

import { useEffect, useRef, useState } from "react";
import { cls, arr, sign, DataState, VendorTag, titleCaseLabel} from "../utils";
import { useApiList } from "../hooks/useApiList";
import type { CompanyDoc } from "../types";
import { StockPanelLayout, StockListCard, StockRow } from "../stock-panel";
import { THEMES, themeFor, sectorNames } from "../sector-filter";

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
  // Themes are MULTI-select (mirroring the sector filter): the list shows the
  // UNION of the selected themes' constituents. Defaults to the first theme.
  const [selectedThemes, setSelectedThemes] = useState<string[]>([THEMES[0].name]);
  const [sel, setSel] = useState<string | null>(null);
  /** Sectors are MULTI-select; a theme is a curated basket and stays exclusive.
   *  Non-empty here means sector mode, and the theme choice is set aside. */
  const [sectorSel, setSectorSel] = useState<string[]>([]);
  const [secOpen, setSecOpen] = useState(false);
  const secRef = useRef<HTMLDivElement>(null);

  // Close the sector panel on an outside click, so it behaves like a dropdown
  // rather than a panel you have to toggle off from the same button.
  useEffect(() => {
    if (!secOpen) return;
    const onDown = (e: MouseEvent) => {
      if (secRef.current && !secRef.current.contains(e.target as Node)) setSecOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [secOpen]);

  const allSectors = sectorNames(companies);
  // Themes apply only while no sector is chosen — the two are alternatives.
  // Multi-select: every selected theme that resolves is active.
  const activeThemes = sectorSel.length === 0
    ? selectedThemes.map(themeFor).filter((t): t is NonNullable<typeof t> => t != null)
    : [];

  // Themes → the UNION of their curated constituents (deduped, original order
  // preserved); a sector / "All" → the matching companies.
  const stocks: ThemeStock[] = activeThemes.length > 0
    ? (() => {
        const seen = new Set<string>();
        const tickers: string[] = [];
        for (const t of activeThemes)
          for (const tk of t.tickers)
            if (!seen.has(tk)) { seen.add(tk); tickers.push(tk); }
        return resolveThemeStocks(tickers, byTicker);
      })()
    : companies
        .filter(c => c.price != null
          && (sectorSel.length === 0 || (c.sector != null && sectorSel.includes(c.sector))))
        .map(c => ({ s: c.ticker, n: c.name ?? c.ticker, price: c.price as number, c: c.pctChange ?? 0, sector: c.sector ?? null }))
        .sort((a, b) => b.c - a.c);

  const heading = activeThemes.length > 0
    ? (activeThemes.length === 1 ? activeThemes[0].name : `${activeThemes.length} themes`)
    : sectorSel.length === 0
      ? "All tracked names"
      : sectorSel.length === 1
        ? titleCaseLabel(sectorSel[0])
        : `${sectorSel.length} sectors`;
  const avg     = stocks.length ? stocks.reduce((acc, s) => acc + s.c, 0) / stocks.length : 0;
  const leader  = [...stocks].sort((a, b) => b.c - a.c)[0];
  const laggard = [...stocks].sort((a, b) => a.c - b.c)[0];
  const avgLabel = (avg >= 0 ? "+" : "") + avg.toFixed(2) + "%";

  /** Toggle one theme (multi-select, like sectors). Selecting a theme leaves
   *  sector mode; deselecting the last theme falls back to "all tracked names". */
  function pick(name: string) {
    setSelectedThemes(cur => cur.includes(name) ? cur.filter(x => x !== name) : [...cur, name]);
    setSectorSel([]);
    setSel(null);
  }

  /** Toggle one sector. Leaves theme mode as soon as a sector is on. */
  function toggleSector(name: string) {
    setSectorSel(cur =>
      cur.includes(name) ? cur.filter(x => x !== name) : [...cur, name],
    );
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

        {/* Sectors are multi-select. A native <select multiple> renders a tall
            list box inline, so this is a button + checkbox panel instead. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }} ref={secRef}>
          <span style={{
            fontSize: ".66rem", letterSpacing: ".05em", textTransform: "uppercase",
            color: "var(--text-dim-solid)", fontWeight: 600,
          }}>Sectors</span>
          <div style={{ position: "relative" }}>
            <button
              className="iq-select"
              onClick={() => setSecOpen(o => !o)}
              style={{ width: "auto", minWidth: 160, padding: "4px 10px", fontSize: ".72rem",
                textAlign: "left", cursor: "pointer" }}
            >
              {sectorSel.length === 0
                ? "All sectors"
                : sectorSel.length === 1
                  ? titleCaseLabel(sectorSel[0])
                  : `${sectorSel.length} selected`} ▾
            </button>
            {secOpen && (
              <div className="theme-secpanel">
                <div className="theme-secpanel-h">
                  <span>{sectorSel.length} of {allSectors.length}</span>
                  <button onClick={() => setSectorSel([])} disabled={sectorSel.length === 0}>Clear</button>
                </div>
                {allSectors.map(name => (
                  <label key={name} className="theme-secrow">
                    <input type="checkbox" checked={sectorSel.includes(name)}
                      onChange={() => toggleSector(name)} />
                    <span>{titleCaseLabel(name)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: "0 18px 18px" }}>

        {/* Chosen sectors, shown OUTSIDE the dropdown so a multi-selection is
            visible without reopening it. Each chip removes just that sector —
            this row is the multi-select made explicit; the theme pills below
            stay exclusive. */}
        {sectorSel.length > 0 && (
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
            {sectorSel.map(name => (
              <button
                key={name}
                onClick={() => toggleSector(name)}
                title={`Remove ${titleCaseLabel(name)}`}
                style={{
                  padding: "5px 10px 5px 13px", borderRadius: 20, cursor: "pointer",
                  border: "1px solid var(--brand)", background: "var(--brand-dim)",
                  color: "var(--text-hi)", fontSize: ".72rem", fontWeight: 700,
                  display: "inline-flex", alignItems: "center", gap: 7,
                }}
              >
                {titleCaseLabel(name)}
                <span style={{ color: "var(--text-dim-solid)", fontSize: ".8em" }}>✕</span>
              </button>
            ))}
            <button
              onClick={() => setSectorSel([])}
              style={{
                background: "none", border: 0, cursor: "pointer",
                fontSize: ".68rem", fontWeight: 700, color: "var(--brand-2)", padding: "0 4px",
              }}
            >Clear all</button>
          </div>
        )}

        {/* Theme quick-access pills — MULTI-select (toggle in/out); the list
            shows the union of the selected themes. Sector chips above are the
            alternate multi-select mode. */}
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => pick(t.name)}
              style={{
                padding: "5px 13px", borderRadius: 20, border: "1px solid",
                fontSize: ".72rem", fontWeight: 700, cursor: "pointer", transition: "all .15s",
                // activeThemes (not the raw selection): a pill lights up only
                // when it's actually driving the list — i.e. no sector filter is
                // active. Multi-select, so any number of pills can be lit.
                borderColor: activeThemes.some(a => a.name === t.name) ? "var(--brand)" : "var(--border)",
                background:  activeThemes.some(a => a.name === t.name) ? "var(--brand)" : "var(--surface-2)",
                color:       activeThemes.some(a => a.name === t.name) ? "#fff" : "var(--text-dim-solid)",
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
