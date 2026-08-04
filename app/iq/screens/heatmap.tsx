"use client";

import { useRef, useState } from "react";
import { useIQActions } from "../shell";
import { type SectorRow } from "../data";
import { sign, heatCol, fmt, cls, StockLogo } from "../utils";
import { useApiList } from "../hooks/useApiList";
import type { CompanyDoc, SectorApiDoc } from "../types";

const TABS = ["Stocks", "S&P 500"];
const HEADER_H = 24;
const APPROX_W = 1100;
const APPROX_H = 620;

interface LItem { key: string; weight: number; }
interface LRect  { key: string; x: number; y: number; w: number; h: number; }

function bisect(items: LItem[], x: number, y: number, w: number, h: number): LRect[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ key: items[0].key, x, y, w, h }];
  if (items.length === 2) {
    const total = items[0].weight + items[1].weight;
    const f = items[0].weight / total;
    return w >= h
      ? [{ key: items[0].key, x, y, w: w * f, h }, { key: items[1].key, x: x + w * f, y, w: w * (1 - f), h }]
      : [{ key: items[0].key, x, y, w, h: h * f }, { key: items[1].key, x, y: y + h * f, w, h: h * (1 - f) }];
  }
  const total = items.reduce((s, i) => s + i.weight, 0);
  let cum = 0; let split = 0;
  for (let i = 0; i < items.length - 1; i++) {
    cum += items[i].weight; split = i;
    if (cum >= total / 2) break;
  }
  const first = items.slice(0, split + 1);
  const rest  = items.slice(split + 1);
  const frac  = first.reduce((s, i) => s + i.weight, 0) / total;
  return w >= h
    ? [...bisect(first, x, y, w * frac, h), ...bisect(rest, x + w * frac, y, w * (1 - frac), h)]
    : [...bisect(first, x, y, w, h * frac), ...bisect(rest, x, y + h * frac, w, h * (1 - frac))];
}

function capFmt(mcap: number) {
  return mcap >= 1000 ? `$${(mcap / 1000).toFixed(1)}T` : `$${Math.round(mcap)}B`;
}

interface HoverStock {
  sym: string; chg: number; mcap: number; x: number; y: number;
  sector: string;
  peers: [string, number, number][];
}

function sectorTrend(pctChange: number): string {
  return pctChange > 0.5 ? "Improving" : pctChange < -0.5 ? "Deteriorating" : "Flat";
}

/**
 * Builds the sector heatmap entirely from live data — companies grouped by
 * their reported `sector`, sector-level %change from the sectors feed (or
 * averaged from constituents when a sector doc hasn't synced yet). No mock
 * universe of tickers-per-sector; a sector only appears once it has at least
 * one live company or a live sector doc.
 */
function buildSectorList(companies: CompanyDoc[], sectorsLive: SectorApiDoc[]): SectorRow[] {
  const bySector = new Map<string, CompanyDoc[]>();
  for (const c of companies) {
    if (!c.sector) continue;
    if (!bySector.has(c.sector)) bySector.set(c.sector, []);
    bySector.get(c.sector)!.push(c);
  }
  const sectorPctByName = new Map(sectorsLive.map(s => [s.sector, s.pctChange]));
  const names = new Set<string>([...bySector.keys(), ...sectorsLive.map(s => s.sector)]);

  const rows = [...names].map(name => {
    const members = bySector.get(name) ?? [];
    const pctChange = sectorPctByName.get(name) ?? (
      members.length > 0
        ? members.reduce((s, c) => s + (c.pctChange ?? 0), 0) / members.length
        : 0
    );
    const items: [string, number, number][] = members.map(c =>
      [c.ticker, c.marketCap != null ? c.marketCap / 1e9 : 0, c.pctChange ?? 0]);
    return { name, rank: 0, trend: sectorTrend(pctChange), pctChange, items };
  });

  return rows
    .sort((a, b) => b.pctChange - a.pctChange)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

export function HeatmapScreen() {
  const { openSector, openStockFull } = useIQActions();
  const { data: companies } = useApiList<CompanyDoc>("/market-data/companies");
  const { data: sectorsLive } = useApiList<SectorApiDoc>("/market-data/sectors");
  const mergedSectorList = buildSectorList(companies, sectorsLive);

  const [tab, setTab]     = useState(0);
  const [hover, setHover] = useState<HoverStock | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHover = (e: React.MouseEvent, sym: string, chg: number, mcap: number) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    const sector = mergedSectorList.find(g => g.items.some(([s]) => s === sym));
    const peers  = sector ? [...sector.items].sort((a, b) => b[1] - a[1]) : [];
    const estH   = 160 + 34 + peers.length * 27; // header rows + label + peer rows
    const maxH   = Math.min(estH, window.innerHeight - 16);
    const x = e.clientX + 14 + 318 > window.innerWidth ? e.clientX - 326 : e.clientX + 14;
    const y = Math.max(8, Math.min(e.clientY - 10, window.innerHeight - maxH - 8));
    setHover({ sym, chg, mcap, x, y, sector: sector?.name ?? "", peers });
  };
  const hideHover   = () => { hoverTimer.current = setTimeout(() => setHover(null), 200); };
  const cancelHover = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); };

  const sorted = [...mergedSectorList].sort(
    (a, b) => b.items.reduce((s, i) => s + i[1], 0) - a.items.reduce((s, i) => s + i[1], 0)
  );
  const sectorItems   = sorted.map(g => ({ key: g.name, weight: g.items.reduce((s, i) => s + i[1], 0) }));
  const sectorLayout  = bisect(sectorItems, 0, 0, 100, 100);
  const sectorRectMap = Object.fromEntries(sectorLayout.map(r => [r.key, r]));

  return (
    <>
      <div className="page-head">
        <div className="tabs">
          {TABS.map((t, i) => (
            <button key={t} className={`tab${i === tab ? " on" : ""}`} onClick={() => setTab(i)}>{t}</button>
          ))}
        </div>
      </div>

      <div className="fbar">
        <button className="chip on">Color: % change</button>
        <div className="spacer" />
        <div className="legend" style={{ gap: 4 }}>
          <span style={{ fontSize: ".66rem", color: "var(--down)" }}>−3%</span>
          {(["rgba(208,52,76,.85)", "rgba(208,52,76,.4)", "#3a4658", "rgba(28,170,112,.4)", "rgba(28,170,112,.85)"] as const).map((bg, i) => (
            <i key={i} style={{ width: 22, height: 12, display: "inline-block", borderRadius: 2, background: bg }} />
          ))}
          <span style={{ fontSize: ".66rem", color: "var(--up)" }}>+3%</span>
        </div>
      </div>

      {/* ── Treemap ── */}
      <div style={{
        position: "relative", width: "100%",
        height: "calc(100vh - 220px)", minHeight: 520,
        borderRadius: 10, overflow: "hidden",
        border: "1px solid var(--border)", background: "var(--bg)",
      }}>
        {sorted.map(g => {
          const lr = sectorRectMap[g.name];
          if (!lr) return null;
          const stocksSorted = [...g.items].sort((a, b) => b[1] - a[1]);
          const stockLayout  = bisect(stocksSorted.map(([sym, mc]) => ({ key: sym, weight: mc })), 0, 0, 100, 100);
          const stockMap     = Object.fromEntries(stockLayout.map(r => [r.key, r]));
          const sectPxW      = (lr.w / 100) * APPROX_W;
          const sectPxH      = (lr.h / 100) * APPROX_H;

          return (
            <div key={g.name} style={{
              position: "absolute",
              left: `${lr.x}%`, top: `${lr.y}%`,
              width: `${lr.w}%`, height: `${lr.h}%`,
              padding: 2, boxSizing: "border-box",
            }}>
              <div style={{
                width: "100%", height: "100%", borderRadius: 6,
                overflow: "hidden", border: "1px solid rgba(255,255,255,.07)",
                position: "relative", background: "var(--surface-0)",
                display: "flex", flexDirection: "column",
              }}>
                {/* Sector header */}
                <div onClick={() => openSector(g.name)} style={{
                  height: HEADER_H, minHeight: HEADER_H, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "0 7px", cursor: "pointer",
                  background: "rgba(0,0,0,.3)", borderBottom: "1px solid rgba(255,255,255,.06)", gap: 4,
                }}>
                  <span style={{
                    fontSize: ".6rem", fontWeight: 700, letterSpacing: ".05em",
                    textTransform: "uppercase", color: "var(--text-dim-solid)",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{g.name}</span>
                  <span style={{
                    fontSize: ".62rem", fontFamily: "var(--f-mono)", fontWeight: 700,
                    color: g.pctChange >= 0 ? "var(--up)" : "var(--down)", flexShrink: 0,
                  }}>{sign(g.pctChange)}</span>
                </div>

                {/* Stock cells */}
                <div style={{ position: "relative", flex: 1 }}>
                  {stocksSorted.map(([sym, mcap, chg]) => {
                    const sr = stockMap[sym];
                    if (!sr) return null;
                    const hc      = heatCol(chg);
                    const cellPxW = (sr.w / 100) * sectPxW;
                    const cellPxH = (sr.h / 100) * (sectPxH - HEADER_H);
                    const minDim  = Math.min(cellPxW, cellPxH);
                    const showText   = minDim > 18 && cellPxW > 24;
                    const showChange = minDim > 32 && cellPxW > 40;
                    const fs = Math.max(0.56, Math.min(1.05, Math.sqrt(cellPxW * cellPxH) / 72));

                    return (
                      <div key={sym}
                        onClick={e => { e.stopPropagation(); openStockFull(sym); }}
                        onMouseEnter={e => showHover(e, sym, chg, mcap)}
                        onMouseLeave={hideHover}
                        title={`${sym}  ${sign(chg)}`}
                        style={{
                          position: "absolute",
                          left: `${sr.x}%`, top: `${sr.y}%`,
                          width: `${sr.w}%`, height: `${sr.h}%`,
                          background: hc.bg, cursor: "pointer",
                          display: "flex", flexDirection: "column",
                          justifyContent: "center", alignItems: "center",
                          boxSizing: "border-box", border: "1px solid rgba(0,0,0,.18)",
                          overflow: "hidden", padding: 2, transition: "filter .1s",
                        }}
                        onMouseOver={e => (e.currentTarget.style.filter = "brightness(1.25)")}
                        onMouseOut={e => (e.currentTarget.style.filter = "")}
                      >
                        {showText && (
                          <>
                            <span style={{
                              fontFamily: "var(--f-mono)", fontWeight: 700,
                              color: hc.fg, fontSize: `${fs}rem`,
                              lineHeight: 1, textAlign: "center", whiteSpace: "nowrap",
                            }}>{sym}</span>
                            {showChange && (
                              <span style={{
                                fontFamily: "var(--f-mono)", color: hc.fg, opacity: .82,
                                fontSize: `${fs * 0.82}rem`, lineHeight: 1, marginTop: 3,
                              }}>{sign(chg)}</span>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Hover tooltip ── */}
      {hover && (() => {
        const co = companies.find(c => c.ticker === hover.sym);
        return (
          <div className="dash-pop"
            style={{ left: hover.x, top: hover.y, cursor: "default", width: 310, maxHeight: `${window.innerHeight - hover.y - 8}px`, overflowY: "auto" }}
            onMouseEnter={cancelHover}
            onMouseLeave={hideHover}
          >
            {/* Hovered stock header */}
            <div className="dp-head" style={{ cursor: "pointer" }} onClick={() => { setHover(null); openStockFull(hover.sym); }}>
              <StockLogo sym={hover.sym} size={28} />
              <span className="dp-sym">{hover.sym}</span>
              <span className={`pill ${hover.chg >= 0 ? "up" : "dn"}`}>{sign(hover.chg)}</span>
            </div>
            <div className="dp-row"><span>Mkt Cap</span><b>{capFmt(hover.mcap)}</b></div>
            {co?.price != null && <div className="dp-row"><span>Price</span><b>${fmt(co.price)}</b></div>}
            {co?.rvol != null && <div className="dp-row"><span>RVOL</span><b className={co.rvol >= 2 ? "up" : ""}>{co.rvol}×</b></div>}
            {co?.rsRating != null && <div className="dp-row"><span>RS Rating</span><b>{co.rsRating}/99</b></div>}

            {/* Same-sector stock list */}
            {hover.peers.length > 0 && (
              <>
                <div className="hpop-label" onClick={() => { setHover(null); openSector(hover.sector); }}>
                  <span>{hover.sector}</span>
                  <span className="link" style={{ fontSize: ".62rem" }}>View sector →</span>
                </div>
                {hover.peers.map(([psym, pmcap, pchg]) => (
                  <div key={psym}
                    className={`hpop-row${psym === hover.sym ? " hpop-row-hi" : ""}`}
                    onClick={() => { setHover(null); openStockFull(psym); }}
                  >
                    <StockLogo sym={psym} size={16} />
                    <span className="hpop-sym">{psym}</span>
                    <span className="hpop-mcap">{capFmt(pmcap)}</span>
                    <span className={`hpop-chg ${pchg >= 0 ? "up" : "down"}`}>{sign(pchg)}</span>
                    <i className="hpop-bar" style={{ background: heatCol(pchg).bg, width: `${Math.min(56, Math.abs(pchg) * 14)}px` }} />
                  </div>
                ))}
              </>
            )}
          </div>
        );
      })()}
    </>
  );
}
