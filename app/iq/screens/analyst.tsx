"use client";

import { useMemo, useState } from "react";
import { fmtDate } from "../calendar-range";
import { useIQActions } from "../shell";
import { DataState, StockLogo, VendorTag } from "../utils";
import { useApiList } from "../hooks/useApiList";
import type { AnalystConsensusDoc, CompanyDoc } from "../types";

// Real analyst data from FMP: a current Buy/Hold/Sell consensus per ticker, the
// 12-month price-target consensus (+ rolling-average trend), and the recent
// per-firm rating changes (grades) that drive the actions feed below.

const TABS = ["All", "Upgrades", "Downgrades", "Initiations"] as const;
type Tab = typeof TABS[number];

// Top-level views (the 3 tabs at the top of the screen).
const VIEWS = [
  { key: "consensus", label: "Consensus & price targets" },
  { key: "perfirm", label: "Per-firm analyst actions" },
  { key: "analysts", label: "Analysts" },
] as const;
type View = typeof VIEWS[number]["key"];

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
  // fmtDate keeps a date-only string on its own calendar day; an analyst action
  // dated 2026-09-01 was printing as Aug 31 for readers west of Greenwich.
  return fmtDate(iso, { month: "short", day: "numeric" });
}

const money = (v: number | null | undefined, d = 0): string =>
  v == null ? "—" : `$${v.toFixed(d)}`;

export function AnalystScreen() {
  const { openStock } = useIQActions();
  const { data: liveConsensus, loading: consensusLoading } = useApiList<AnalystConsensusDoc>("/market-data/analyst-actions");
  const { data: companies } = useApiList<CompanyDoc>("/market-data/companies");
  const [view, setView] = useState<View>("consensus"); // top-level tab
  const [tab, setTab] = useState<Tab>("All"); // action-type filter (per-firm + analysts)
  const [clustersOnly, setClustersOnly] = useState(false);
  const [consQuery, setConsQuery] = useState(""); // search within Consensus & price targets
  const [actQuery, setActQuery] = useState(""); // search within Per-firm analyst actions
  const [analystQuery, setAnalystQuery] = useState(""); // search within Analysts
  const [selAnalyst, setSelAnalyst] = useState<string | null>(null); // firm clicked → drawer of its tickers
  const [shown, setShown] = useState(40); // paginate the feed 40 rows at a time
  const [showAllClusters, setShowAllClusters] = useState(false);

  const priceByTicker = useMemo(
    () => new Map(companies.filter(c => c.ticker).map(c => [c.ticker as string, c.price ?? null])),
    [companies],
  );

  /** A price target more than 10x above, or below a tenth of, the live price is
   *  a stale/unadjusted target rather than a real call — the vendor doesn't
   *  restate targets after a reverse split, so BOXL (two 6:1 splits) carries a
   *  $0.125 target against a $6.80 price. Treated as absent, not as -98% downside. */
  const targetIsSane = (pt: number | null | undefined, px: number | null | undefined): boolean =>
    pt != null && px != null && px > 0 && pt <= px * 10 && pt >= px * 0.1;

  const upside = (pt: number | null | undefined, ticker: string): number | null => {
    const px = priceByTicker.get(ticker);
    if (!targetIsSane(pt, px)) return null;
    return (pt! - px!) / px! * 100;
  };

  // Flatten every ticker's recent per-firm rating changes into one feed.
  const allActions = useMemo(() => {
    const rows = liveConsensus.flatMap(c =>
      (c.recentGrades ?? []).map(g => ({
        ticker: c.ticker,
        // THIS firm's own target (not the ticker consensus — that made every
        // row identical). null shows "—" when the firm posted no target.
        pt: g.priceTarget ?? null,
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

  const actQ = actQuery.trim().toUpperCase();
  const filteredActions = allActions
    .filter(a => actionMatches(a.action, tab))
    .filter(a => !clustersOnly || clusterSet.has(a.ticker))
    .filter(a => !actQ || a.ticker.toUpperCase().includes(actQ));
  const feedRows = filteredActions.slice(0, shown);

  const consQ = consQuery.trim().toUpperCase();
  const consensusRows = [...liveConsensus]
    .filter(c => !consQ || c.ticker.toUpperCase().includes(consQ))
    .sort((a, b) => (b.strongBuy + b.buy) - (a.strongBuy + a.buy))
    .slice(0, consQ ? 50 : 8); // top 8 by default; up to 50 matches when searching

  // ── Analysts view: the same actions grouped BY analyst firm, honoring the
  // action-type filter (tab). Each row is one firm with its activity mix. ──
  const analystQ = analystQuery.trim().toLowerCase();
  const analystRows = useMemo(() => {
    const m = new Map<string, { firm: string; total: number; up: number; down: number; init: number; tickers: Set<string>; latest: string }>();
    for (const a of allActions) {
      if (!a.firm) continue;
      if (!actionMatches(a.action, tab)) continue; // action filter applies here too
      let e = m.get(a.firm);
      if (!e) { e = { firm: a.firm, total: 0, up: 0, down: 0, init: 0, tickers: new Set(), latest: "" }; m.set(a.firm, e); }
      e.total++;
      const s = (a.action ?? "").toLowerCase();
      if (s.includes("upgrade")) e.up++;
      else if (s.includes("downgrade")) e.down++;
      else if (s.includes("init")) e.init++;
      e.tickers.add(a.ticker);
      if ((a.date ?? "") > e.latest) e.latest = a.date ?? "";
    }
    return [...m.values()].sort((x, y) => y.total - x.total);
  }, [allActions, tab]);
  const analystFiltered = analystRows.filter(a => !analystQ || a.firm.toLowerCase().includes(analystQ));

  // Every recent rating change by the analyst clicked in the Analysts table —
  // powers the slide drawer (allActions is already newest-first).
  const selAnalystActions = selAnalyst ? allActions.filter(a => a.firm === selAnalyst) : [];

  // Reusable action-type filter chips (used by Per-firm + Analysts views).
  const actionFilterBar = (withClusters: boolean) => (
    <div className="fbar" style={{ marginBottom: 12 }}>
      {TABS.map(t => (
        <button key={t} className={`chip${tab === t ? " on" : ""}`} onClick={() => { setTab(t); setShown(40); }}>{t}</button>
      ))}
      {withClusters && <>
        <div style={{ flex: 1 }} />
        <button className={`chip${clustersOnly ? " on" : ""}`} onClick={() => { setClustersOnly(v => !v); setShown(40); }}>Clusters only</button>
      </>}
    </div>
  );

  return (
    <>
      {/* ── Top-level tabs ── */}
      <div className="page-head">
        <div className="tabs" style={{ maxWidth: "100%", overflowX: "auto", flexWrap: "nowrap" }}>
          {VIEWS.map(v => (
            <button key={v.key} className={`tab${view === v.key ? " on" : ""}`} onClick={() => setView(v.key)} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>{v.label}</button>
          ))}
        </div>
      </div>

      {view === "consensus" && (<>
      {/* ── Signal cards ── */}
      <div className="dash" style={{ marginBottom: 14 }}>
        <div className="col-6">
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h">
              <h3>Cluster alerts <VendorTag v={["fmp", "polygon"]} /></h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {clusters.length > 0 && <span className="pill" style={{ background: "var(--surface-3)", color: "var(--brand-2)" }}>{clusters.length}</span>}
                {clusters.length > 0 && <span className="link" onClick={() => setShowAllClusters(true)}>View all →</span>}
              </div>
            </div>
            <div className="card-b" style={{ paddingTop: 4 }}>
              {clusters.length === 0 ? (
                <DataState loading={consensusLoading} label="No multi-firm clusters in the recent rating-change feed." />
              ) : (
                // Show ~two rows of chips (no pixel clip, so nothing is cut
                // mid-chip); the rest live behind View all. Both cards use
                // height:100% so they stretch to equal height in the grid.
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {clusters.slice(0, 10).map(c => (
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
          <div className="card" style={{ height: "100%" }}>
            <div className="card-h"><h3>Recent rating activity <VendorTag v={["fmp", "polygon"]} /></h3></div>
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
          {/* Search sits on the LEFT, next to the title (left-aligned). */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h3>Consensus &amp; price targets <VendorTag v={["fmp", "polygon"]} /></h3>
            <input
              value={consQuery}
              onChange={e => setConsQuery(e.target.value.toUpperCase())}
              placeholder="Search ticker…"
              style={{ width: 230, boxSizing: "border-box", background: "var(--surface-3)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: "5px 9px", fontSize: ".74rem", color: "var(--text-hi)", outline: "none", fontFamily: "var(--f-mono)", textAlign: "left" }}
            />
          </div>
          {consensusRows.length > 0 && <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)" }}>live</span>}
        </div>
        <div className="card-b" style={{ paddingTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
          {consensusRows.length === 0 ? (
            <DataState loading={consensusLoading} label={consQ ? `No analyst consensus for “${consQuery}”.` : "No live analyst consensus synced yet."} />
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
                  {/* Suppress the target too, not just its upside — printing
                      "$0.13" beside a $6.80 stock is the misleading part. */}
                  {targetIsSane(c.priceTargetConsensus, priceByTicker.get(c.ticker))
                    ? money(c.priceTargetConsensus)
                    : "—"}
                </span>
                <span className="r" style={{ fontSize: ".72rem", width: 62, textAlign: "right", fontWeight: 700, color: up == null ? "var(--text-dim-solid)" : up >= 0 ? "var(--up)" : "var(--down)" }}>
                  {up == null ? "—" : `${up >= 0 ? "+" : ""}${up.toFixed(0)}%`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      </>)}

      {view === "perfirm" && (<>
      {actionFilterBar(true)}

      {/* ── Per-firm analyst actions ── */}
      <div className="card">
        <div className="card-h">
          {/* Search sits on the LEFT, next to the title — filters THIS table's rows by ticker. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h3>Per-firm analyst actions <VendorTag v={["fmp", "polygon"]} /></h3>
            <input
              value={actQuery}
              onChange={e => { setActQuery(e.target.value.toUpperCase()); setShown(40); }}
              placeholder="Search ticker…"
              style={{ width: 230, boxSizing: "border-box", background: "var(--surface-3)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: "5px 9px", fontSize: ".74rem", color: "var(--text-hi)", outline: "none", fontFamily: "var(--f-mono)", textAlign: "left" }}
            />
          </div>
          {filteredActions.length > 0 && <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>{feedRows.length} / {filteredActions.length}</span>}
        </div>
        <div className="card-b" style={{ paddingTop: 2, overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Ticker</th><th>Firm</th><th>Action</th>
                <th>Previous → New</th>
                <th className="num">PT</th><th className="num">Upside</th>
                <th className="num">Date</th>
              </tr>
            </thead>
            <tbody>
              {feedRows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 0 }}>
                    <DataState loading={consensusLoading} label={actQ ? `No ${tab.toLowerCase() === "all" ? "" : tab.toLowerCase() + " "}rating changes for “${actQuery}”.` : `No ${tab.toLowerCase() === "all" ? "" : tab.toLowerCase() + " "}rating changes${clustersOnly ? " in clusters" : ""} in the recent feed.`} />
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
                    <td className="num" style={{ fontWeight: 600 }}>{money(a.pt)}</td>
                    <td className="num" style={{ fontWeight: 700, color: up == null ? "var(--text-dim-solid)" : up >= 0 ? "var(--up)" : "var(--down)" }}>
                      {up == null ? "—" : `${up >= 0 ? "+" : ""}${up.toFixed(0)}%`}
                    </td>
                    <td className="num" style={{ color: "var(--text-dim-solid)" }}>{shortDate(a.date)}</td>
                  </tr>
                  );
                })}
            </tbody>
          </table>
          {feedRows.length < filteredActions.length && (
            <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
              <button className="btn" style={{ padding: "6px 16px", fontSize: ".78rem" }} onClick={() => setShown(s => s + 40)}>
                Show more · {filteredActions.length - feedRows.length} more
              </button>
            </div>
          )}
        </div>
      </div>
      </>)}

      {view === "analysts" && (<>
        {/* Search analyst + the same action-type filter, so the table is per-analyst. */}
        <div className="fbar" style={{ marginBottom: 12 }}>
          <input
            value={analystQuery}
            onChange={e => setAnalystQuery(e.target.value)}
            placeholder="Search analyst…"
            style={{ width: 260, boxSizing: "border-box", background: "var(--surface-3)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: "6px 10px", fontSize: ".78rem", color: "var(--text-hi)", outline: "none" }}
          />
        </div>
        {actionFilterBar(false)}
        <div className="card">
          <div className="card-h">
            <h3>Analysts <VendorTag v={["fmp", "polygon"]} /></h3>
            {analystFiltered.length > 0 && <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>{analystFiltered.length} firms</span>}
          </div>
          <div className="card-b" style={{ paddingTop: 2, overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Analyst / firm</th><th className="num">Actions</th><th className="num">Upgrades</th>
                  <th className="num">Downgrades</th><th className="num">Initiations</th><th className="num">Tickers</th><th className="num">Latest</th>
                </tr>
              </thead>
              <tbody>
                {analystFiltered.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 0 }}>
                      <DataState loading={consensusLoading} label={analystQ ? `No analysts match “${analystQuery}”.` : "No analyst activity in the recent feed."} />
                    </td>
                  </tr>
                ) : analystFiltered.map(a => (
                  <tr key={a.firm} style={{ cursor: "pointer" }} onClick={() => setSelAnalyst(a.firm)} title={`See all ${a.firm} rating changes`}>
                    <td><b style={{ color: "var(--text-hi)" }}>{a.firm}</b></td>
                    <td className="num" style={{ fontWeight: 700 }}>{a.total}</td>
                    <td className="num" style={{ color: a.up ? "var(--up)" : "var(--text-dim-solid)", fontWeight: a.up ? 600 : 400 }}>{a.up}</td>
                    <td className="num" style={{ color: a.down ? "var(--down)" : "var(--text-dim-solid)", fontWeight: a.down ? 600 : 400 }}>{a.down}</td>
                    <td className="num" style={{ color: a.init ? "var(--brand-2)" : "var(--text-dim-solid)", fontWeight: a.init ? 600 : 400 }}>{a.init}</td>
                    <td className="num">{a.tickers.size}</td>
                    <td className="num" style={{ color: "var(--text-dim-solid)" }}>{shortDate(a.latest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>)}

      {/* ── All clusters modal ── */}
      {showAllClusters && (
        <div className="chart-modal-overlay" onClick={() => setShowAllClusters(false)}>
          <div className="chart-modal" onClick={e => e.stopPropagation()}>
            <div className="chart-modal-head">
              <h3>Cluster alerts · {clusters.length} tickers <VendorTag v={["fmp", "polygon"]} /></h3>
              <button className="chart-modal-close" onClick={() => setShowAllClusters(false)}>✕</button>
            </div>
            <div className="chart-modal-body">
              <div style={{ fontSize: ".76rem", color: "var(--text-dim-solid)", marginBottom: 14 }}>
                Tickers with rating changes from 2+ firms in the recent feed. The number is how many distinct firms acted.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {clusters.map(c => (
                  <button key={c.ticker} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => { openStock(c.ticker); setShowAllClusters(false); }}>
                    <StockLogo sym={c.ticker} size={16} /> {c.ticker}
                    <b style={{ color: "var(--brand-2)" }}>{c.firms}</b>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Analyst drawer: all of one firm's recent rating changes ── */}
      {selAnalyst && (
        <>
          <div className="scrim" onClick={() => setSelAnalyst(null)} />
          <div className="side-drawer">
            <div className="drawer-h">
              <div>
                <div className="drawer-title">{selAnalyst}</div>
                <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
                  {selAnalystActions.length} rating change{selAnalystActions.length === 1 ? "" : "s"} · {new Set(selAnalystActions.map(a => a.ticker)).size} tickers <VendorTag v={["fmp", "polygon"]} />
                </div>
              </div>
              <button className="closebtn" onClick={() => setSelAnalyst(null)}>✕</button>
            </div>
            <div className="drawer-b">
              {selAnalystActions.length === 0 ? (
                <DataState loading={consensusLoading} label="No recent rating changes for this analyst." />
              ) : (
                <div style={{ overflowX: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr><th>Ticker</th><th>Action</th><th>Previous → New</th><th className="num">Date</th></tr>
                  </thead>
                  <tbody>
                    {selAnalystActions.map((a, i) => (
                      <tr key={`${a.ticker}-${a.date}-${i}`} style={{ cursor: "pointer" }} onClick={() => { openStock(a.ticker); setSelAnalyst(null); }}>
                        <td><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><StockLogo sym={a.ticker} size={16} /> {a.ticker}</span></td>
                        <td style={{ color: actionTone(a.action), fontWeight: 600, textTransform: "capitalize" }}>{a.action ?? "—"}</td>
                        <td style={{ color: "var(--text-dim-solid)" }}>{a.previousGrade ?? "—"} → {a.newGrade ?? "—"}</td>
                        <td className="num" style={{ color: "var(--text-dim-solid)" }}>{shortDate(a.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
