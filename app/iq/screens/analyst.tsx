"use client";

import { useMemo, useState } from "react";
import { useIQActions } from "../shell";
import { DataState, StockLogo } from "../utils";
import { useApiList } from "../hooks/useApiList";
import type { AnalystConsensusDoc, CompanyDoc } from "../types";

// Real analyst data from FMP: a current Buy/Hold/Sell consensus per ticker, the
// 12-month price-target consensus (+ rolling-average trend), and the recent
// per-firm rating changes (grades) that drive the actions feed below.

const TABS = ["All", "Upgrades", "Downgrades", "Initiations"] as const;
type Tab = typeof TABS[number];

function actionMatches(action: string | null | undefined, tab: Tab): boolean {
  const a = (action ?? "").toLowerCase();
  if (tab === "Upgrades") return a.includes("upgrade");
  if (tab === "Downgrades") return a.includes("downgrade");
  if (tab === "Initiations") return a.includes("init");
  return true;
}

function actionTone(action: string | null | undefined): string {
  const a = (action ?? "").toLowerCase();
  if (a.includes("upgrade")) return "var(--up)";
  if (a.includes("downgrade")) return "var(--down)";
  if (a.includes("init")) return "var(--brand-2)";
  return "var(--text-dim-solid)";
}

function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const money = (v: number | null | undefined, d = 0): string =>
  v == null ? "—" : `$${v.toFixed(d)}`;

export function AnalystScreen() {
  const { openStock } = useIQActions();
  const { data: liveConsensus, loading: consensusLoading } = useApiList<AnalystConsensusDoc>("/market-data/analyst-actions");
  const { data: companies } = useApiList<CompanyDoc>("/market-data/companies");
  const [tab, setTab] = useState<Tab>("All");
  const [clustersOnly, setClustersOnly] = useState(false);

  const priceByTicker = useMemo(
    () => new Map(companies.filter(c => c.ticker).map(c => [c.ticker as string, c.price ?? null])),
    [companies],
  );

  const upside = (pt: number | null | undefined, ticker: string): number | null => {
    const px = priceByTicker.get(ticker);
    if (pt == null || px == null || px <= 0) return null;
    return (pt - px) / px * 100;
  };

  // Flatten every ticker's recent per-firm rating changes into one feed.
  const allActions = useMemo(() => {
    const rows = liveConsensus.flatMap(c =>
      (c.recentGrades ?? []).map(g => ({
        ticker: c.ticker,
        pt: c.priceTargetConsensus ?? null,
        date: g.date,
        firm: g.firm,
        previousGrade: g.previousGrade,
        newGrade: g.newGrade,
        action: g.action,
      })),
    );
    return rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }, [liveConsensus]);

  // Cluster = >=2 distinct firms with a recent action on the same ticker.
  const clusters = useMemo(() => {
    const firms = new Map<string, Set<string>>();
    for (const a of allActions) {
      if (!a.firm) continue;
      if (!firms.has(a.ticker)) firms.set(a.ticker, new Set());
      firms.get(a.ticker)!.add(a.firm);
    }
    return [...firms.entries()]
      .filter(([, s]) => s.size >= 2)
      .map(([ticker, s]) => ({ ticker, firms: s.size }))
      .sort((a, b) => b.firms - a.firms);
  }, [allActions]);
  const clusterSet = useMemo(() => new Set(clusters.map(c => c.ticker)), [clusters]);

  // Activity mix across the recent feed.
  const activity = useMemo(() => {
    let up = 0, down = 0, init = 0;
    for (const a of allActions) {
      const s = (a.action ?? "").toLowerCase();
      if (s.includes("upgrade")) up++;
      else if (s.includes("downgrade")) down++;
      else if (s.includes("init")) init++;
    }
    return { up, down, init, total: allActions.length };
  }, [allActions]);

  const feedRows = allActions
    .filter(a => actionMatches(a.action, tab))
    .filter(a => !clustersOnly || clusterSet.has(a.ticker))
    .slice(0, 40);

  const consensusRows = [...liveConsensus]
    .sort((a, b) => (b.strongBuy + b.buy) - (a.strongBuy + a.buy))
    .slice(0, 8);

  return (
    <>
      {/* ── Signal cards ── */}
      <div className="dash" style={{ marginBottom: 14 }}>
        <div className="col-6">
          <div className="card">
            <div className="card-h"><h3>Cluster alerts</h3>{clusters.length > 0 && <span className="pill" style={{ background: "var(--surface-3)", color: "var(--brand-2)" }}>{clusters.length}</span>}</div>
            <div className="card-b" style={{ paddingTop: 4 }}>
              {clusters.length === 0 ? (
                <DataState loading={consensusLoading} label="No multi-firm clusters in the recent rating-change feed." />
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {clusters.slice(0, 12).map(c => (
                    <button key={c.ticker} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => openStock(c.ticker)}>
                      <StockLogo sym={c.ticker} size={16} /> {c.ticker}
                      <b style={{ color: "var(--brand-2)" }}>{c.firms}</b>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="col-6">
          <div className="card">
            <div className="card-h"><h3>Recent rating activity</h3></div>
            <div className="card-b" style={{ paddingTop: 4 }}>
              {activity.total === 0 ? (
                <DataState loading={consensusLoading} label="No recent per-firm rating changes synced yet." />
              ) : (
                <div style={{ display: "flex", gap: 18, alignItems: "baseline" }}>
                  <div><div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--up)" }}>{activity.up}</div><span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>Upgrades</span></div>
                  <div><div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--down)" }}>{activity.down}</div><span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>Downgrades</span></div>
                  <div><div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--brand-2)" }}>{activity.init}</div><span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>Initiations</span></div>
                  <div style={{ marginLeft: "auto" }}><div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{activity.total}</div><span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>Total changes</span></div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Live analyst consensus + price target ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-h">
          <h3>Consensus &amp; price targets</h3>
          {consensusRows.length > 0 && <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)" }}>live</span>}
        </div>
        <div className="card-b" style={{ paddingTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
          {consensusRows.length === 0 ? (
            <DataState loading={consensusLoading} label="No live analyst consensus synced yet." />
          ) : consensusRows.map(c => {
            const total = c.strongBuy + c.buy + c.hold + c.sell + c.strongSell || 1;
            const up = upside(c.priceTargetConsensus, c.ticker);
            return (
              <div key={c.ticker} className="minirow" style={{ cursor: "pointer" }} onClick={() => openStock(c.ticker)}>
                <StockLogo sym={c.ticker} size={20} />
                <span className="tkr">{c.ticker}</span>
                <span className="mid" style={{ display: "flex", alignItems: "center", gap: 1, flex: 1, minWidth: 60 }}>
                  <span style={{ width: `${c.strongBuy / total * 100}%`, minWidth: c.strongBuy ? 3 : 0, height: 6, background: "var(--up)", borderRadius: 2 }} />
                  <span style={{ width: `${c.buy / total * 100}%`, minWidth: c.buy ? 3 : 0, height: 6, background: "var(--up)", opacity: .6, borderRadius: 2 }} />
                  <span style={{ width: `${c.hold / total * 100}%`, minWidth: c.hold ? 3 : 0, height: 6, background: "var(--text-dim-solid)", opacity: .5, borderRadius: 2 }} />
                  <span style={{ width: `${c.sell / total * 100}%`, minWidth: c.sell ? 3 : 0, height: 6, background: "var(--down)", opacity: .6, borderRadius: 2 }} />
                  <span style={{ width: `${c.strongSell / total * 100}%`, minWidth: c.strongSell ? 3 : 0, height: 6, background: "var(--down)", borderRadius: 2 }} />
                </span>
                <span className="r" style={{ fontSize: ".7rem", color: "var(--text-dim-solid)", width: 92, textAlign: "right" }}>
                  {c.strongBuy + c.buy}B / {c.hold}H / {c.sell + c.strongSell}S
                </span>
                <span className="r" style={{ fontSize: ".72rem", width: 66, textAlign: "right", fontWeight: 600 }}>
                  {money(c.priceTargetConsensus)}
                </span>
                <span className="r" style={{ fontSize: ".72rem", width: 62, textAlign: "right", fontWeight: 700, color: up == null ? "var(--text-dim-solid)" : up >= 0 ? "var(--up)" : "var(--down)" }}>
                  {up == null ? "—" : `${up >= 0 ? "+" : ""}${up.toFixed(0)}%`}
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
          {feedRows.length > 0 && <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>{feedRows.length}</span>}
        </div>
        <div className="card-b" style={{ paddingTop: 2, overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Ticker</th><th>Firm</th><th>Action</th>
                <th>Previous → New</th><th className="num">PT</th><th className="num">Upside</th><th className="num">Date</th>
              </tr>
            </thead>
            <tbody>
              {feedRows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 0 }}>
                    <DataState loading={consensusLoading} label={`No ${tab.toLowerCase() === "all" ? "" : tab.toLowerCase() + " "}rating changes${clustersOnly ? " in clusters" : ""} in the recent feed.`} />
                  </td>
                </tr>
              ) : feedRows.map((a, i) => {
                const up = upside(a.pt, a.ticker);
                return (
                  <tr key={`${a.ticker}-${a.firm}-${a.date}-${i}`} style={{ cursor: "pointer" }} onClick={() => openStock(a.ticker)}>
                    <td style={{ display: "flex", alignItems: "center", gap: 6 }}><StockLogo sym={a.ticker} size={16} /> {a.ticker}</td>
                    <td>{a.firm ?? "—"}</td>
                    <td><span style={{ color: actionTone(a.action), fontWeight: 600, textTransform: "capitalize" }}>{a.action ?? "—"}</span></td>
                    <td style={{ color: "var(--text-dim-solid)" }}>{a.previousGrade ?? "—"} <span style={{ opacity: .6 }}>→</span> <b style={{ color: "var(--text)" }}>{a.newGrade ?? "—"}</b></td>
                    <td className="num">{money(a.pt)}</td>
                    <td className="num" style={{ color: up == null ? "var(--text-dim-solid)" : up >= 0 ? "var(--up)" : "var(--down)", fontWeight: 600 }}>{up == null ? "—" : `${up >= 0 ? "+" : ""}${up.toFixed(0)}%`}</td>
                    <td className="num" style={{ color: "var(--text-dim-solid)" }}>{shortDate(a.date)}</td>
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
