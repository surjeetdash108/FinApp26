"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useIQActions } from "../shell";
import { sign, heatCol, fmt, StockLogo, NotAvailable } from "../utils";
import { useApiList } from "../hooks/useApiList";
import { buildSectorList } from "../live-market-indices";
import { INDEX_MEMBERS, HEATMAP_TAB_KEYS } from "../index-constituents";
import type { CompanyDoc, SectorApiDoc } from "../types";

const StockScreenEmbed = dynamic<{ initialSym?: string }>(
  () => import("./stock").then(m => ({ default: m.StockScreen })),
  { ssr: false, loading: () => <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim-solid)" }}>Loading…</div> }
);

const TABS = ["Stocks", "S&P 500", "Nasdaq", "Dow", "Russell 2000"];
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

export function HeatmapScreen() {
  const { openSector } = useIQActions();
  // Clicking a tile opens the stock in a slide-in drawer (same as Movers),
  // rather than navigating away to the full stock page.
  const [selectedSym, setSelectedSym] = useState<string | null>(null);
  const { data: companies } = useApiList<CompanyDoc>("/market-data/companies");
  const { data: sectorsLive } = useApiList<SectorApiDoc>("/market-data/sectors");
  const fullSectorList = buildSectorList(companies, sectorsLive);

  const [tab, setTab]     = useState(0);

  // Tab 0 = all synced stocks; 1-3 filter to the S&P 500 / Nasdaq-100 / Dow-30
  // members that also exist in the live universe; 4 (Russell 2000) has no set.
  const tabKey    = HEATMAP_TAB_KEYS[tab];
  const memberSet = tabKey && tabKey !== "RUT" ? INDEX_MEMBERS[tabKey] : null;
  const mergedSectorList = memberSet
    ? fullSectorList
        .map(g => ({ ...g, items: g.items.filter(([sym]) => memberSet.has(sym)) }))
        .filter(g => g.items.length > 0)
    : fullSectorList;
  const membersShown = mergedSectorList.reduce((n, g) => n + g.items.length, 0);
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
        {/* Single line at all widths: never wrap; scroll horizontally if the five
            index tabs don't fit rather than clipping "Russell 2000". */}
        <div className="tabs" style={{ maxWidth: "100%", overflowX: "auto", flexWrap: "nowrap" }}>
          {TABS.map((t, i) => (
            <button key={t} className={`tab${i === tab ? " on" : ""}`} onClick={() => setTab(i)} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>{t}</button>
          ))}
        </div>
      </div>

      <div className="fbar">
        <button className="chip on">Color: % change</button>
        {tab !== 0 && (
          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
            {tabKey === "RUT"
              ? "Small-cap constituents aren't in the synced universe"
              : `${membersShown} ${TABS[tab]} member${membersShown === 1 ? "" : "s"} in the live universe`}
          </span>
        )}
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
        {mergedSectorList.length === 0 && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 8, textAlign: "center", padding: 24,
          }}>
            <div style={{ fontSize: ".92rem", fontWeight: 700, color: "var(--text-hi)" }}>
              No {TABS[tab]} constituents available
            </div>
            <div style={{ fontSize: ".8rem", color: "var(--text-dim-solid)", maxWidth: 460, lineHeight: 1.55 }}>
              {tabKey === "RUT"
                ? "The Russell 2000 is a small-cap index. The synced universe is large-cap, so there are no overlapping names to plot. The data plan doesn't include index constituents to source them dynamically."
                : "None of this index's members are in the currently synced universe yet."}
            </div>
          </div>
        )}
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
                    color: g.pctChange == null ? "var(--text-dim-solid)" : g.pctChange >= 0 ? "var(--up)" : "var(--down)", flexShrink: 0,
                  }}>{g.pctChange == null ? <NotAvailable /> : sign(g.pctChange)}</span>
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
                        onClick={e => { e.stopPropagation(); setSelectedSym(sym); }}
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
        const c = companies.find(x => x.ticker === hover.sym);
        return (
          <div className="dash-pop"
            style={{ left: hover.x, top: hover.y, cursor: "default", width: 310, maxHeight: `${window.innerHeight - hover.y - 8}px`, overflowY: "auto" }}
            onMouseEnter={cancelHover}
            onMouseLeave={hideHover}
          >
            {/* Hovered stock header */}
            <div className="dp-head" style={{ cursor: "pointer" }} onClick={() => { setHover(null); setSelectedSym(hover.sym); }}>
              <StockLogo sym={hover.sym} size={28} />
              <span className="dp-sym">{hover.sym}</span>
              <span className={`pill ${hover.chg >= 0 ? "up" : "dn"}`}>{sign(hover.chg)}</span>
            </div>
            <div className="dp-row"><span>Mkt Cap</span><b>{capFmt(hover.mcap)}</b></div>
            <div className="dp-row"><span>Price</span><b>{c?.price != null ? `$${fmt(c.price)}` : <NotAvailable />}</b></div>
            <div className="dp-row"><span>RVOL</span><b className={c?.rvol != null && c.rvol >= 2 ? "up" : ""}>{c?.rvol != null ? `${c.rvol.toFixed(1)}×` : <NotAvailable />}</b></div>
            <div className="dp-row"><span>RS Rating</span><b>{c?.rsRating != null ? `${c.rsRating}/99` : <NotAvailable />}</b></div>

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
                    onClick={() => { setHover(null); setSelectedSym(psym); }}
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

      {/* Sliding stock detail drawer (same pattern as Movers) */}
      {selectedSym && (
        <>
          <div className="scrim" onClick={() => setSelectedSym(null)} />
          <div className="stock-side-drawer">
            <div className="drawer-h" style={{ paddingTop: 14, paddingBottom: 14 }}>
              <StockLogo sym={selectedSym} size={32} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)" }}>
                  {selectedSym} · Stock Details
                </div>
                <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
                  Full analysis · chart · technicals · peers
                </div>
              </div>
              <button className="closebtn" onClick={() => setSelectedSym(null)}>✕</button>
            </div>
            <div className="drawer-b">
              <StockScreenEmbed initialSym={selectedSym} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
