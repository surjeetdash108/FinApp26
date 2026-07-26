"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { movers as mockMovers, analyst, earnings, watch, folio, type Mover } from "../data";
import { fmt, sign, cls, arr, Spark, StockLogo } from "../utils";
import { useApiList } from "../hooks/useApiList";
import type { LiveMoverDoc, CompanyDoc } from "../types";

const StockScreenEmbed = dynamic<{ initialSym?: string }>(
  () => import("./stock").then(m => ({ default: m.StockScreen })),
  { ssr: false, loading: () => <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim-solid)" }}>Loading…</div> }
);

const TABS = [
  ["win",  "Top Gainers"],
  ["lose", "Top Losers"],
  ["vol",  "Unusual Volume"],
  ["week", "Weekly Movers"],
] as const;
type TabKey = "win" | "lose" | "vol" | "week";
const CAPS = ["All", "Mega", "Large", "Mid", "Small"];

/**
 * Merges live Firestore market_movers data into the original mock list —
 * never removes a mock row. Matching tickers get real price/%change/sector/
 * cap; live-only tickers (not in the original mock set) are appended with
 * neutral placeholders for fields that have no real data source yet (RVOL,
 * catalyst, weekly change, technical/news context).
 */
function mergeMovers(
  mock: Mover[],
  live: LiveMoverDoc[],
  companyRvol: Map<string, number | null>,
): { list: Mover[]; liveCount: number } {
  const liveByTicker = new Map(live.map(l => [l.ticker, l]));
  let liveCount = 0;
  // Real relative volume from technical-indicators.job (companies.rvol), when
  // available — otherwise keep the row's existing (mock/placeholder) value.
  const rv = (ticker: string, fallback: number) => companyRvol.get(ticker) ?? fallback;

  const merged = mock.map(m => {
    const l = liveByTicker.get(m.ticker);
    if (!l) return { ...m, rvolRatio: rv(m.ticker, m.rvolRatio) };
    liveByTicker.delete(m.ticker);
    liveCount++;
    return {
      ...m,
      price: l.price,
      pctChange: l.pctChange,
      name: l.name ?? m.name,
      sector: l.sector ?? m.sector,
      cap: (l.cap as Mover["cap"]) ?? m.cap,
      rvolRatio: rv(m.ticker, m.rvolRatio),
    };
  });

  for (const l of liveByTicker.values()) {
    liveCount++;
    merged.push({
      ticker: l.ticker,
      name: l.name ?? l.ticker,
      price: l.price,
      pctChange: l.pctChange,
      rvolRatio: rv(l.ticker, 1),
      relativeStrength: 50,
      catalystLabel: "No known catalyst",
      maPosture: l.pctChange >= 0 ? "Above 50/200" : "Below 50/200",
      owned: false,
      sector: l.sector ?? "Unclassified",
      cap: (l.cap as Mover["cap"]) ?? "Mid",
      weekPct: l.pctChange,
      techContext: `Live EOD data as of ${l.asOfDate}. RVOL/technical context not available for this synced name yet.`,
      newsContext: "Live market data — catalyst not yet available from a connected news source.",
    });
  }

  return { list: merged, liveCount };
}

function computeTrending(movers: Mover[]) {
  const srcs: Record<string, Set<string>> = {};
  const add = (s: string, src: string) => {
    if (!srcs[s]) srcs[s] = new Set();
    srcs[s].add(src);
  };
  movers.forEach(m  => add(m.ticker, "Movers"));
  analyst.forEach(a => add(a.ticker, "Analyst"));
  earnings.forEach(e => add(e.ticker, "Earnings"));
  watch.forEach(w   => add(w.ticker, "Watchlist"));
  folio.forEach(f   => add(f.ticker, "Portfolio"));
  return Object.entries(srcs)
    .map(([s, set]) => ({ s, n: set.size, srcs: [...set], days: 2 + (s.charCodeAt(0) % 4) }))
    .filter(o => o.n >= 2)
    .sort((a, b) => b.n - a.n || b.days - a.days);
}

export function MoversScreen() {
  const { data: liveMovers } = useApiList<LiveMoverDoc>("/market-data/movers");
  const { data: rvolCompanies } = useApiList<CompanyDoc>("/market-data/companies");
  const companyRvol = new Map(rvolCompanies.map(c => [c.ticker, c.rvol ?? null]));
  const { list: movers, liveCount } = mergeMovers(mockMovers, liveMovers, companyRvol);

  const [tab,          setTab]          = useState<TabKey>("win");
  const [sector,       setSector]       = useState("All");
  const [cap,          setCap]          = useState("All");
  const [selectedSym,  setSelectedSym]  = useState<string | null>(null);

  const sectors = ["All", ...Array.from(new Set(movers.map(m => m.sector))).sort()];

  const filtered = movers
    .filter(m => {
      if (sector !== "All" && m.sector !== sector) return false;
      if (cap    !== "All" && m.cap    !== cap)    return false;
      if (tab === "win")  return m.pctChange > 0;
      if (tab === "lose") return m.pctChange < 0;
      return true;
    })
    .sort((a, b) => {
      if (tab === "win")  return b.pctChange    - a.pctChange;
      if (tab === "lose") return a.pctChange    - b.pctChange;
      if (tab === "vol")  return b.rvolRatio - a.rvolRatio;
      return Math.abs(b.weekPct) - Math.abs(a.weekPct);
    })
    .slice(0, 15);

  const tally: Record<string, number> = {};
  filtered.forEach(m => { tally[m.sector] = (tally[m.sector] || 0) + 1; });
  const sectorTally = Object.entries(tally).sort((a, b) => b[1] - a[1]);

  const trending = computeTrending(movers);
  const val = (m: Mover) => tab === "week" ? m.weekPct : m.pctChange;

  return (
    <>
      <div className="page-head">
        <div className="tabs">
          {TABS.map(([k, l]) => (
            <button key={k} className={`tab${k === tab ? " on" : ""}`} onClick={() => setTab(k as TabKey)}>{l}</button>
          ))}
        </div>
        {liveCount > 0 && (
          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
            {liveCount} names backed by live EOD data
          </span>
        )}
      </div>

      {/* Trending across reports */}
      {trending.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-h">
            <h3>🔥 Trending across reports</h3>
            <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>
              {trending.length} names · in 2+ of today&apos;s reports
            </span>
          </div>
          <div className="card-b" style={{ paddingTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {trending.map(o => {
              const mv = movers.find(m => m.ticker === o.s);
              const isUp = (mv?.pctChange ?? 0) >= 0;
              return (
                <button key={o.s} className="tr-pill" onClick={() => setSelectedSym(o.s)}>
                  <StockLogo sym={o.s} size={18} />
                  <span className="tr-tk">{o.s}</span>
                  <span className="tr-mt">{o.n} reports · {o.days}d</span>
                  <Spark seed={o.s.charCodeAt(0)} up={isUp} w={52} h={16} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="fbar">
        <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", alignSelf: "center" }}>Sector</span>
        <select className="mv-sel" value={sector} onChange={e => setSector(e.target.value)}>
          {sectors.map(s => <option key={s}>{s}</option>)}
        </select>
        <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", alignSelf: "center", marginLeft: 10 }}>Market cap</span>
        <select className="mv-sel" value={cap} onChange={e => setCap(e.target.value)}>
          {CAPS.map(c => <option key={c}>{c}</option>)}
        </select>
        <div className="spacer" />
        <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{filtered.length} stocks</span>
      </div>

      {/* Sector tally */}
      {sectorTally.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {sectorTally.map(([sec, count]) => (
            <span key={sec} className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>
              {sec} <b style={{ color: "var(--text-hi)" }}>{count}</b>
            </span>
          ))}
        </div>
      )}

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Company</th>
              <th className="num">Price</th>
              <th className="num">{tab === "week" ? "5-day" : "Change"}</th>
              <th className="num">RVOL</th>
              <th>Cap · Sector</th>
              <th>Catalyst</th>
              <th className="num">Intraday</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 16, color: "var(--text-dim-solid)" }}>No stocks match these filters.</td>
              </tr>
            ) : filtered.map(m => {
              const v = val(m);
              return (
                <tr
                  key={m.ticker}
                  className={m.owned ? "owned" : ""}
                  onClick={() => setSelectedSym(m.ticker)}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <StockLogo sym={m.ticker} size={26} />
                      <div className="co">
                        <span className="s">
                          {m.owned && <span className="own-dot" />}
                          {m.ticker}
                        </span>
                        <span className="n">{m.name}</span>
                      </div>
                    </div>
                  </td>
                  <td className="num">${fmt(m.price)}</td>
                  <td className={`num ${cls(v)}`}>{arr(v)} {sign(v)}</td>
                  <td className="num">
                    <b style={{ color: m.rvolRatio > 3 ? "var(--warn)" : "var(--text)" }}>{m.rvolRatio.toFixed(1)}×</b>
                  </td>
                  <td>
                    <span style={{ fontSize: ".74rem" }}>
                      <b style={{ color: "var(--text-hi)" }}>{m.cap}</b>
                      {" · "}
                      <span style={{ color: "var(--text-dim-solid)" }}>{m.sector}</span>
                    </span>
                  </td>
                  <td className="mv-reason">
                    {m.catalystLabel === "No known catalyst"
                      ? <span style={{ color: "var(--text-dim-solid)" }}>{m.catalystLabel}</span>
                      : <span className="pill" style={{ background: "var(--surface-3)", color: "var(--brand-2)" }}>{m.catalystLabel}</span>
                    }
                  </td>
                  <td className="num">
                    <Spark seed={m.ticker.charCodeAt(0)} up={v >= 0} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sliding stock detail drawer */}
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
