"use client";

import { useState } from "react";
import { useIQActions } from "../shell";
import { analyst } from "../data";
import { sign, cls, StockLogo } from "../utils";
import { useApiList } from "../hooks/useApiList";
import type { AnalystConsensusDoc } from "../types";

const TABS = ["All", "Upgrades", "Downgrades", "Initiations", "PT changes"];

// Live source is FMP's grades-consensus snapshot: a current Buy/Hold/Sell vote
// count per ticker, not a per-firm upgrade/downgrade event feed (that needs
// Benzinga, blocked on a missing key). So this is additive — a real "what does
// the Street think right now" card — not a replacement for the mock event table,
// which depicts individual firm actions no live source can reconstruct yet.

function dirPill(dir: string) {
  if (dir === "up")   return <span className="pill up">▲ Upgrade</span>;
  if (dir === "down") return <span className="pill dn">▼ Downgrade</span>;
  if (dir === "init") return <span className="pill ai">◆ Initiate</span>;
  return <span className="pill hold">Reiterate</span>;
}

function computeClusters() {
  const byS: Record<string, { name: string; up: number; down: number; init: number; n: number; actionsLast30Days: number }> = {};
  analyst.forEach(a => {
    const o = byS[a.ticker] = byS[a.ticker] || { name: a.name, up: 0, down: 0, init: 0, n: 0, actionsLast30Days: 0 };
    o.n++;
    o.actionsLast30Days = Math.max(o.actionsLast30Days, a.actionsLast30Days);
    if (a.actionType === "up")        o.up++;
    else if (a.actionType === "down") o.down++;
    else if (a.actionType === "init") o.init++;
  });
  const clusters = Object.entries(byS)
    .filter(([, o]) => o.actionsLast30Days >= 5)
    .map(([s, o]) => ({ s, ...o }))
    .sort((a, b) => b.actionsLast30Days - a.actionsLast30Days);
  const upgrades = Object.entries(byS)
    .filter(([, o]) => o.up >= 2)
    .map(([s, o]) => ({ s, ...o }));
  return { byS, clusters, upgrades };
}

export function AnalystScreen() {
  const { openStock } = useIQActions();
  const { data: liveConsensus } = useApiList<AnalystConsensusDoc>("/market-data/analyst-actions");
  const [tab, setTab]               = useState(0);
  const [clustersOnly, setClustersOnly] = useState(false);
  const [myNames, setMyNames]       = useState(false);
  const [ptMove, setPtMove]         = useState(false);

  const { byS, clusters, upgrades } = computeClusters();
  const consensusByTicker = new Map(liveConsensus.map(c => [c.ticker, c]));
  const liveRows = [...liveConsensus].sort((a, b) =>
    (b.strongBuy + b.buy) - (a.strongBuy + a.buy)
  ).slice(0, 8);

  const filtered = analyst.filter(a => {
    if (clustersOnly && (byS[a.ticker]?.actionsLast30Days ?? 0) < 5) return false;
    if (myNames && !a.owned) return false;
    if (ptMove && !(a.prevPriceTarget > 0 && (a.newPriceTarget - a.prevPriceTarget) / a.prevPriceTarget > 0.15)) return false;
    if (tab === 1) return a.actionType === "up";
    if (tab === 2) return a.actionType === "down";
    if (tab === 3) return a.actionType === "init";
    if (tab === 4) return a.newPriceTarget !== a.prevPriceTarget;
    return true;
  });

  return (
    <>
      <div className="tabs" style={{ alignSelf: "flex-start" }}>
        {TABS.map((t, i) => (
          <button key={t} className={`tab${i === tab ? " on" : ""}`} onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>

      {/* ── Signal cards ── */}
      <div className="dash" style={{ marginBottom: 14 }}>

        {/* Cluster alert — 5+ actions / 30d */}
        <div className="col-6">
          <div className="card" style={{ borderColor: "var(--warn)" }}>
            <div className="card-h">
              <h3>🔥 Cluster alert · 5+ actions / 30d</h3>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--warn)" }}>high conviction</span>
            </div>
            <div className="card-b" style={{ paddingTop: 4 }}>
              {clusters.length === 0
                ? <div className="ec-none">No 5+ clusters in view.</div>
                : clusters.map(c => (
                  <div key={c.s} className="minirow" style={{ cursor: "pointer" }} onClick={() => openStock(c.s)}>
                    <StockLogo sym={c.s} size={20} />
                    <span className="tkr">{c.s}</span>
                    <span className="mid">{c.name} · {c.up} up / {c.down} down</span>
                    <span className="r" style={{ color: "var(--warn)", fontWeight: 700 }}>{c.actionsLast30Days} /30d</span>
                  </div>
                ))
              }
            </div>
          </div>
        </div>

        {/* Multiple upgrades (2–3) */}
        <div className="col-6">
          <div className="card">
            <div className="card-h">
              <h3>▲ Multiple upgrades (2–3)</h3>
              <span className="pill up">trend turning</span>
            </div>
            <div className="card-b" style={{ paddingTop: 4 }}>
              {upgrades.length === 0
                ? <div className="ec-none">No multi-upgrade names today.</div>
                : upgrades.map(c => (
                  <div key={c.s} className="minirow" style={{ cursor: "pointer" }} onClick={() => openStock(c.s)}>
                    <StockLogo sym={c.s} size={20} />
                    <span className="tkr">{c.s}</span>
                    <span className="mid">{c.up} upgrades recently</span>
                    <span className="r up" style={{ fontWeight: 700 }}>▲ {c.up}</span>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      </div>

      {/* ── Live analyst consensus (FMP grades-consensus, real) ── */}
      {liveRows.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-h">
            <h3>Live analyst consensus</h3>
            <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)" }}>live · FMP</span>
          </div>
          <div className="card-b" style={{ paddingTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
            {liveRows.map(c => {
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
      )}

      {/* ── AI take · CRM cluster — full width, between signal cards and filter bar ── */}
      <div className="ai-block" style={{ marginBottom: 14 }}>
        <div className="card-h">
          <h3 className="ai-c">◆ AI take · CRM cluster</h3>
        </div>
        <div className="card-b">
          <p style={{ fontSize: ".85rem", lineHeight: 1.6, color: "var(--text)" }}>
            CRM has drawn <b style={{ color: "var(--text-hi)" }}>two upgrades</b> this week (Morgan Stanley, Citigroup) with PTs to $330–340. NVDA shows a{" "}
            <b style={{ color: "var(--text-hi)" }}>6-action cluster</b> in 30 days — dense coverage that often precedes continued momentum. Clusters matter more than any single call.
          </p>
          <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span className="src-chip">CRM: 2 upgrades</span>
            <span className="src-chip">NVDA: 6 / 30d</span>
            <span className="src-chip">Crowding: low</span>
          </div>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="fbar">
        <button className={`chip${myNames ? " on" : ""}`} onClick={() => setMyNames(o => !o)}>My names</button>
        <button className={`chip${ptMove ? " on" : ""}`} onClick={() => setPtMove(o => !o)}>PT &gt;15% move</button>
        <button className={`chip${clustersOnly ? " on" : ""}`} onClick={() => setClustersOnly(o => !o)}>
          Clusters only
        </button>
        <div className="spacer" />
      </div>

      {/* ── Full-width actions table ── */}
      <div className="card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Company</th>
                <th>Firm</th>
                <th>Action</th>
                <th>Rating</th>
                <th className="num">Price Target</th>
                <th className="num">Reaction</th>
                <th className="num">Activity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => {
                const clusterBadge = (byS[a.ticker]?.actionsLast30Days ?? 0) >= 5;
                return (
                  <tr key={a.ticker + a.firm} className={a.owned ? "owned" : ""}
                    onClick={() => openStock(a.ticker)} style={{ cursor: "pointer" }}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <StockLogo sym={a.ticker} size={26} />
                        <div className="co">
                          <span className="s">
                            {a.owned && <span className="own-dot" />}
                            {a.ticker}
                            {clusterBadge && (
                              <span className="pill" style={{ background: "rgba(245,170,60,.18)", color: "var(--warn)", marginLeft: 4, fontSize: ".62rem" }}>
                                {byS[a.ticker].actionsLast30Days}+ /30d
                              </span>
                            )}
                            {consensusByTicker.has(a.ticker) && (
                              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", marginLeft: 4, fontSize: ".62rem" }}>
                                live consensus: {consensusByTicker.get(a.ticker)!.consensus}
                              </span>
                            )}
                          </span>
                          <span className="n">{a.name}</span>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: ".8rem" }}>{a.firm}</td>
                    <td>{dirPill(a.actionType)}</td>
                    <td>
                      <span style={{ color: "var(--text-dim-solid)" }}>{a.previousRating}</span>
                      {" → "}
                      <b style={{ color: "var(--text-hi)" }}>{a.newRating}</b>
                    </td>
                    <td className="num">
                      {a.prevPriceTarget ? `$${a.prevPriceTarget}` : "—"} → <b style={{ color: "var(--text-hi)" }}>${a.newPriceTarget}</b>
                    </td>
                    <td className={`num ${cls(a.priceChangeSince)}`}>{sign(a.priceChangeSince)}</td>
                    <td className="num">{a.actionsLast30Days}× /30d</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
