"use client";

import { useState } from "react";
import { useIQActions } from "../shell";
import { DataState, StockLogo } from "../utils";
import { useApiList } from "../hooks/useApiList";
import type { AnalystConsensusDoc } from "../types";

// Live source is FMP's grades-consensus snapshot: a current Buy/Hold/Sell vote
// count per ticker, not a per-firm upgrade/downgrade event feed (that needs
// Benzinga, which is not on the current plan). The tab strip, filter bar and
// per-firm table below are kept in place — with NotAvailable cells rather
// than mock rows — so a Benzinga-class feed can be wired straight into this
// same UI once it exists, instead of a screen having to be rebuilt from
// scratch.

const TABS = ["All", "Upgrades", "Downgrades", "Initiations"] as const;
type Tab = typeof TABS[number];

export function AnalystScreen() {
  const { openStock } = useIQActions();
  const { data: liveConsensus, loading: consensusLoading } = useApiList<AnalystConsensusDoc>("/market-data/analyst-actions");
  const [tab, setTab] = useState<Tab>("All");
  const [clustersOnly, setClustersOnly] = useState(false);

  const liveRows = [...liveConsensus].sort((a, b) =>
    (b.strongBuy + b.buy) - (a.strongBuy + a.buy)
  ).slice(0, 8);

  return (
    <>
      {/* ── Signal cards ── */}
      <div className="dash" style={{ marginBottom: 14 }}>
        <div className="col-6">
          <div className="card">
            <div className="card-h"><h3>Cluster alerts</h3></div>
            <div className="card-b">
              <DataState label="Multi-firm cluster detection needs a per-firm event feed (Benzinga-class) — not available on the current plan." />
            </div>
          </div>
        </div>
        <div className="col-6">
          <div className="card">
            <div className="card-h"><h3>◆ AI take</h3></div>
            <div className="card-b">
              <DataState label="An AI narrative summarizing today's analyst actions needs the same per-firm event feed — not available yet." />
            </div>
          </div>
        </div>
      </div>

      {/* ── Live analyst consensus (FMP grades-consensus, real) ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-h">
          <h3>Live analyst consensus</h3>
          {liveRows.length > 0 && <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)" }}>live · FMP</span>}
        </div>
        <div className="card-b" style={{ paddingTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
          {liveRows.length === 0 ? (
            <DataState loading={consensusLoading} label="No live analyst consensus synced yet." />
          ) : liveRows.map(c => {
            const total = c.strongBuy + c.buy + c.hold + c.sell + c.strongSell || 1;
            return (
              <div key={c.ticker} className="minirow" style={{ cursor: "pointer" }} onClick={() => openStock(c.ticker)}>
                <StockLogo sym={c.ticker} size={20} />
                <span className="tkr">{c.ticker}</span>
                <span className="mid" style={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
                  <span style={{ width: `${c.strongBuy / total * 100}%`, minWidth: c.strongBuy ? 3 : 0, height: 6, background: "var(--up)", borderRadius: 2 }} />
                  <span style={{ width: `${c.buy / total * 100}%`, minWidth: c.buy ? 3 : 0, height: 6, background: "var(--up)", opacity: .6, borderRadius: 2 }} />
                  <span style={{ width: `${c.hold / total * 100}%`, minWidth: c.hold ? 3 : 0, height: 6, background: "var(--text-dim-solid)", opacity: .5, borderRadius: 2 }} />
                  <span style={{ width: `${c.sell / total * 100}%`, minWidth: c.sell ? 3 : 0, height: 6, background: "var(--down)", opacity: .6, borderRadius: 2 }} />
                  <span style={{ width: `${c.strongSell / total * 100}%`, minWidth: c.strongSell ? 3 : 0, height: 6, background: "var(--down)", borderRadius: 2 }} />
                </span>
                <span className="r" style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
                  {c.strongBuy + c.buy}B / {c.hold}H / {c.sell + c.strongSell}S
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="fbar" style={{ marginBottom: 12 }}>
        {TABS.map(t => (
          <button key={t} className={`chip${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{t}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button className={`chip${clustersOnly ? " on" : ""}`} onClick={() => setClustersOnly(v => !v)}>Clusters only</button>
      </div>

      {/* ── Per-firm analyst actions ── */}
      <div className="card">
        <div className="card-h">
          <h3>Per-firm analyst actions</h3>
        </div>
        <div className="card-b" style={{ paddingTop: 2, overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Ticker</th><th>Firm</th><th>Action</th>
                <th>Previous → New rating</th><th className="num">PT</th><th className="num">Date</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={6} style={{ padding: 0 }}>
                  <DataState label={`Per-firm upgrades/downgrades, price targets, and cluster detection need a Benzinga-class feed — not available on the current plan (${tab.toLowerCase()}${clustersOnly ? ", clusters only" : ""}). The consensus card above is the real data this screen currently has.`} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
