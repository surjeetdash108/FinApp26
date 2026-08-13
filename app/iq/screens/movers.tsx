"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { type Mover, maPostureLabel } from "../data";
import { fmt, sign, arr, Spark, StockLogo, DataState } from "../utils";
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
] as const;
type TabKey = "win" | "lose" | "vol" | "week";
// Largest → smallest. The dropdown only offers tiers that actually have movers
// right now — the day's top movers are almost never mega-caps, so "Mega" would
// otherwise sit there returning nothing; "Micro" (which the feed does produce)
// was missing entirely before.
const CAP_ORDER = ["Mega", "Large", "Mid", "Small", "Micro"];

/**
 * Live-only: a row exists here only if a real `market_movers` doc exists for
 * it. RVOL comes from `companies.rvol` (technical-indicators.job) when
 * synced. MA posture is derived from `companies.aboveSma50/aboveSma200`
 * (technical-indicators.job), "—" until synced. (Catalyst was removed — Polygon
 * has no catalyst feed, so it only ever showed "—".)
 */
function mergeMovers(
  live: LiveMoverDoc[],
  companyByTicker: Map<string, CompanyDoc>,
): Mover[] {
  return live.map(l => {
    const c = companyByTicker.get(l.ticker);
    return {
      ticker: l.ticker,
      name: l.name ?? l.ticker,
      price: l.price,
      pctChange: l.pctChange,
      rvolRatio: c?.rvol ?? 0,
      relativeStrength: 0,
      maPosture: maPostureLabel(c?.aboveSma50, c?.aboveSma200),
      owned: false,
      sector: l.sector ?? "—",
      cap: (l.cap as Mover["cap"]) ?? "Mid",
      // Real 5-session change from technical-indicators.job; null → "—".
      weekPct: c?.week5ChangePct ?? null,
      techContext: `Live EOD data as of ${l.asOfDate}.`,
      newsContext: "",
    };
  });
}

export function MoversScreen() {
  const { data: liveMovers, loading: moversLoading } = useApiList<LiveMoverDoc>("/market-data/movers");
  const { data: rvolCompanies } = useApiList<CompanyDoc>("/market-data/companies");
  const companyByTicker = new Map(rvolCompanies.map(c => [c.ticker, c]));
  const movers = mergeMovers(liveMovers, companyByTicker);
  const liveCount = movers.length;

  const [tab,          setTab]          = useState<TabKey>("win");
  const [sector,       setSector]       = useState("All");
  const [cap,          setCap]          = useState("All");
  const [selectedSym,  setSelectedSym]  = useState<string | null>(null);

  const sectors = ["All", ...Array.from(new Set(movers.map(m => m.sector))).sort()];

  // Only the cap tiers present in the current feed are selectable; if the chosen
  // tier is no longer present (data refreshed), behave as "All".
  const availableCaps = ["All", ...CAP_ORDER.filter(c => movers.some(m => m.cap === c))];
  const effCap = availableCaps.includes(cap) ? cap : "All";

  // Rows matching the current tab + cap, but NOT the sector filter — this feeds
  // the clickable sector tags below so every available sector stays selectable
  // (a sector-filtered tally would collapse to a single tag after one click).
  const tabCapRows = movers.filter(m => {
    if (effCap !== "All" && m.cap !== effCap) return false;
    if (tab === "win")  return m.pctChange > 0;
    if (tab === "lose") return m.pctChange < 0;
    return true;
  });

  const filtered = tabCapRows
    .filter(m => sector === "All" || m.sector === sector)
    .sort((a, b) => {
      if (tab === "win")  return b.pctChange    - a.pctChange;
      if (tab === "lose") return a.pctChange    - b.pctChange;
      if (tab === "vol")  return b.rvolRatio - a.rvolRatio;
      return Math.abs(b.weekPct ?? 0) - Math.abs(a.weekPct ?? 0);
    })
    .slice(0, 20);

  const tally: Record<string, number> = {};
  tabCapRows.forEach(m => { tally[m.sector] = (tally[m.sector] || 0) + 1; });
  const sectorTally = Object.entries(tally).sort((a, b) => b[1] - a[1]);

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
            {liveCount} names · top 20 gainers + 20 losers · live EOD
          </span>
        )}
      </div>

      {/* Filter bar */}
      <div className="fbar">
        <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", alignSelf: "center" }}>Sector</span>
        <select className="mv-sel" style={{ textTransform: "lowercase" }} value={sector} onChange={e => setSector(e.target.value)}>
          {sectors.map(s => <option key={s} value={s}>{s.toLowerCase()}</option>)}
        </select>
        <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", alignSelf: "center", marginLeft: 10 }}>Market cap</span>
        <select className="mv-sel" style={{ textTransform: "lowercase" }} value={effCap} onChange={e => setCap(e.target.value)}>
          {availableCaps.map(c => <option key={c} value={c}>{c.toLowerCase()}</option>)}
        </select>
        <div className="spacer" />
        <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{filtered.length} stocks</span>
      </div>

      {/* Clickable sector tags — click to filter the movers by that sector,
          click the active one again to clear back to All. */}
      {sectorTally.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {sectorTally.map(([sec, count]) => {
            const active = sector === sec;
            return (
              <span key={sec} className="pill"
                onClick={() => setSector(active ? "All" : sec)}
                style={{
                  cursor: "pointer",
                  background: active ? "var(--brand-2)" : "var(--surface-3)",
                  color: active ? "#fff" : "var(--text-dim-solid)",
                }}
              >
                {sec} <b style={{ color: active ? "#fff" : "var(--text-hi)" }}>{count}</b>
              </span>
            );
          })}
        </div>
      )}

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Company</th>
              <th className="num">Price</th>
              <th className="num">Change</th>
              <th className="num">RVOL</th>
              <th>Cap · Sector</th>
              <th className="num">Intraday</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 16, color: "var(--text-dim-solid)" }}>
                  {moversLoading ? <DataState loading label="" /> : "No stocks match these filters."}
                </td>
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
                  <td className="num" style={{ color: v == null ? undefined : v >= 0 ? "var(--up)" : "var(--down)", fontWeight: 600 }}>{v == null ? "—" : <>{arr(v)} {sign(v)}</>}</td>
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
                  <td className="num">
                    <Spark seed={m.ticker.charCodeAt(0)} up={(v ?? 0) >= 0} />
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
