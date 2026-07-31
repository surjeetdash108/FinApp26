"use client";

import { useEffect, useState } from "react";
import { useIQActions } from "../shell";
import { StockLogo, DataState, NotAvailable } from "../utils";
import { apiGet } from "../backend";
import { useApiList } from "../hooks/useApiList";
import type { InsiderTxDoc } from "../types";

// ---- types ----
type InsFilter   = "All" | "Buys" | "Sells";
type InsSort     = "value" | "date";
type InstFilter  = "All" | "Net buying" | "Net selling";
type InstSort    = "owners" | "move";
type DrawerState = { kind: "insider"; sym: string } | { kind: "fund"; fund: FundHoldingDoc } | null;

interface Tx {
  s: string; role: string; det: string; dir: "buy" | "sell";
  valUsd: number | null; date: string;
}

// ---- backend doc shape (see backend/src/sync/sec-13f.job.ts, market-data/insider-positions.controller.ts) ----
interface FundHoldingDoc {
  id: string; fundName: string; latestFilingDate: string; latestAccessionNumber: string;
  totalPositions: number; totalValue: number;
}
interface PositionDoc { id: string; cusip: string; nameOfIssuer: string; value: number; shares: number; }

function fmtValue(v: number) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}
async function fetchPositions(cik: string, accessionNumber: string): Promise<PositionDoc[]> {
  return apiGet<PositionDoc[]>(
    `/market-data/fund-holdings/positions?cik=${encodeURIComponent(cik)}&accession=${encodeURIComponent(accessionNumber)}`,
  );
}

// ---- insider stock drawer ----
function InsiderDrawer({ sym, liveTxns, loading, onClose, onOpenFull }: {
  sym: string; liveTxns: InsiderTxDoc[]; loading: boolean; onClose: () => void; onOpenFull: (s: string) => void;
}) {
  const txns  = liveTxns.filter(x => x.ticker === sym)
    .sort((a, b) => (b.transactionDate ?? "").localeCompare(a.transactionDate ?? ""));
  const nBuy  = txns.filter(x => x.acquiredOrDisposed === "A").length;
  const nSell = txns.filter(x => x.acquiredOrDisposed === "D").length;
  const read  = nBuy > nSell
    ? `Net <b class="up">insider buying</b> in ${sym} — insiders adding is generally a constructive signal.`
    : nSell > nBuy
    ? `Net <b class="down">insider selling</b> in ${sym} — often diversification, but worth monitoring if it clusters.`
    : `Mixed insider activity in ${sym}.`;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="side-drawer">
        <div className="drawer-h">
          <div className="sd-logo" style={{ background: "linear-gradient(135deg,#1f6b4d,#0e3a2a)", color: "#5ff0b3" }}>{sym[0]}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--f-display)" }}>{sym}</div>
            <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Insider activity · Form 4 filings</div>
          </div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-b">
          {txns.length === 0 ? (
            <DataState loading={loading} label={`No Form 4 filings synced for ${sym} yet.`} />
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                <span className="pill up">{nBuy} buy filing{nBuy !== 1 ? "s" : ""}</span>
                <span className="pill dn">{nSell} sell filing{nSell !== 1 ? "s" : ""}</span>
              </div>
              <div className="ai-sec"><div className="h">SEC EDGAR Form 4 filings</div></div>
              {txns.map((x) => (
                <div key={x.id} className="minirow" style={{ alignItems: "flex-start" }}>
                  <span className="tr-badge" style={{ background: x.acquiredOrDisposed === "A" ? "var(--up)22" : "var(--down)22", color: x.acquiredOrDisposed === "A" ? "var(--up)" : "var(--down)", flexShrink: 0 }}>
                    {x.acquiredOrDisposed === "A" ? "BUY" : "SELL"}
                  </span>
                  <span className="mid" style={{ marginLeft: 8 }}>
                    <b style={{ color: "var(--text-hi)" }}>{x.ownerName ?? "Unknown filer"}</b>
                    {x.officerTitle && <span style={{ color: "var(--text-dim-solid)" }}> · {x.officerTitle}</span>}
                    <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
                      {x.shares.toLocaleString()} sh{x.pricePerShare ? ` @ $${x.pricePerShare.toFixed(2)}` : ""} · {x.transactionDate}
                    </div>
                  </span>
                  {x.pricePerShare && (
                    <span className={`r ${x.acquiredOrDisposed === "A" ? "up" : "down"}`}>
                      {x.acquiredOrDisposed === "A" ? "+" : "−"}{fmtValue(x.shares * x.pricePerShare)}
                    </span>
                  )}
                </div>
              ))}
              <div className="ai-block" style={{ marginTop: 16 }}>
                <div className="card-h"><h3 className="ai-c">◆ Read</h3></div>
                <div className="card-b">
                  <p style={{ fontSize: ".84rem", lineHeight: 1.55, color: "var(--text)" }}
                    dangerouslySetInnerHTML={{ __html: read + " Clusters of multiple insiders carry more signal than a single filing." }} />
                </div>
              </div>
            </>
          )}
          <button className="btn primary" style={{ width: "100%", marginTop: 14 }} onClick={() => { onClose(); onOpenFull(sym); }}>
            Open full stock page →
          </button>
        </div>
      </div>
    </>
  );
}

// ---- 13F fund detail drawer ----
function FundDrawer({ fund, onClose }: { fund: FundHoldingDoc; onClose: () => void }) {
  const [positions, setPositions] = useState<PositionDoc[] | null>(null);
  useEffect(() => {
    const load = fund.latestAccessionNumber
      ? fetchPositions(fund.id, fund.latestAccessionNumber).catch(() => [] as PositionDoc[])
      : Promise.resolve([] as PositionDoc[]);
    load.then(setPositions);
  }, [fund.id, fund.latestAccessionNumber]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="side-drawer">
        <div className="drawer-h">
          <div className="sd-logo" style={{ background: "linear-gradient(135deg,#3a2f6b,#241c44)", color: "var(--brand-2)" }}>{fund.fundName[0]}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--f-display)" }}>{fund.fundName}</div>
            <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>13F filed {fund.latestFilingDate}</div>
          </div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-b">
          <div className="metric-grid" style={{ marginBottom: 14 }}>
            <div className="m"><div className="k">Total value</div><div className="v">{fmtValue(fund.totalValue)}</div></div>
            <div className="m"><div className="k">Positions</div><div className="v">{fund.totalPositions}</div></div>
          </div>
          <div className="ai-sec"><div className="h">Top positions · latest 13F</div></div>
          {positions === null || positions.length === 0 ? (
            <DataState loading={positions === null} label="No position-level detail synced for this filing yet." />
          ) : (
            [...positions].sort((a, b) => b.value - a.value).slice(0, 20).map(p => (
              <div key={p.id} className="minirow">
                <span className="mid">
                  <b style={{ color: "var(--text-hi)" }}>{p.nameOfIssuer}</b>
                  <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>{p.shares.toLocaleString()} sh</div>
                </span>
                <span className="r">{fmtValue(p.value)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

// ============================================================
export function InsiderScreen() {
  const { openStockFull } = useIQActions();
  const [view,       setView]       = useState<"insider" | "13f">("insider");
  const [insFilter,  setInsFilter]  = useState<InsFilter>("All");
  const [insSort,    setInsSort]    = useState<InsSort>("value");
  const [instFilter, setInstFilter] = useState<InstFilter>("All");
  const [instSort,   setInstSort]   = useState<InstSort>("owners");
  const [drawer,     setDrawer]     = useState<DrawerState>(null);

  const { data: liveInsiderTx, loading: liveInsiderTxLoading } = useApiList<InsiderTxDoc>("/market-data/insider-transactions");
  const { data: liveFunds, loading: liveFundsLoading } = useApiList<FundHoldingDoc>("/market-data/fund-holdings");

  // Real cross-fund overlap (CUSIP-matched across live 13F positions).
  const [liveOverlap, setLiveOverlap] = useState<Array<{ cusip: string; name: string; funds: string[] }> | null>(null);
  useEffect(() => {
    if (view !== "13f" || liveOverlap !== null || liveFunds.length === 0) return;
    (async () => {
      const byCusip = new Map<string, { name: string; funds: string[] }>();
      for (const f of liveFunds) {
        if (!f.latestAccessionNumber) continue;
        const positions = await fetchPositions(f.id, f.latestAccessionNumber);
        for (const p of positions) {
          const existing = byCusip.get(p.cusip);
          if (existing) existing.funds.push(f.fundName);
          else byCusip.set(p.cusip, { name: p.nameOfIssuer, funds: [f.fundName] });
        }
      }
      setLiveOverlap([...byCusip.entries()].map(([cusip, v]) => ({ cusip, ...v })).filter(x => x.funds.length >= 2).sort((a, b) => b.funds.length - a.funds.length));
    })();
  }, [view, liveFunds, liveOverlap]);

  const openIns  = (sym: string) => setDrawer({ kind: "insider", sym });

  const FEED: Tx[] = liveInsiderTx.map(x => ({
    s: x.ticker,
    role: x.officerTitle ?? x.ownerName ?? "Filer",
    det: `${x.acquiredOrDisposed === "A" ? "acquired" : "disposed"} ${x.shares.toLocaleString()} sh${x.pricePerShare ? ` @ $${x.pricePerShare.toFixed(2)}` : ""}`,
    dir: x.acquiredOrDisposed === "A" ? "buy" : "sell",
    valUsd: x.pricePerShare != null ? x.shares * x.pricePerShare : null,
    date: x.transactionDate,
  }));

  // ---- insider filter + sort ----
  const filtered = FEED.filter(x => {
    if (insFilter === "Buys")  return x.dir === "buy";
    if (insFilter === "Sells") return x.dir === "sell";
    return true;
  });
  const list = [...filtered].sort((a, b) =>
    insSort === "date" ? b.date.localeCompare(a.date) : (b.valUsd ?? 0) - (a.valUsd ?? 0)
  );

  // most active by real $ volume
  const agg: Record<string, { n: number; buy: number; sell: number }> = {};
  FEED.forEach(x => {
    const v = (x.valUsd ?? 0) / 1e6;
    if (!agg[x.s]) agg[x.s] = { n: 0, buy: 0, sell: 0 };
    agg[x.s].n++;
    if (x.dir === "buy") agg[x.s].buy += v; else agg[x.s].sell += v;
  });
  const active = Object.entries(agg)
    .map(([s, o]) => ({ s, n: o.n, gross: o.buy + o.sell, net: o.buy - o.sell }))
    .sort((a, b) => b.gross - a.gross)
    .slice(0, 6);

  const sortedFunds = [...liveFunds].sort((a, b) => b.totalValue - a.totalValue);

  return (
    <>

      {/* ---- tabs (left-aligned, below header) ---- */}
      <div className="tabs" style={{ marginBottom: 14, alignSelf: "flex-start" }}>
        <button className={`tab${view === "insider" ? " active" : ""}`} onClick={() => setView("insider")}>Insider activity</button>
        <button className={`tab${view === "13f" ? " active" : ""}`} onClick={() => setView("13f")}>13F institutional</button>
      </div>

      {/* ======================================================== INSIDER ACTIVITY */}
      {view === "insider" && (
        <>
          {active.length > 0 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-h">
                <h3>Most active by insider $ volume</h3>
                <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>tap a name for all its filings</span>
              </div>
              <div className="card-b" style={{ paddingTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {active.map(o => (
                  <button key={o.s} className="tr-pill" onClick={() => openIns(o.s)}>
                    <StockLogo sym={o.s} size={18} />
                    <span className="tr-tk">{o.s}</span>
                    <span className="tr-mt">{o.n} filing{o.n > 1 ? "s" : ""} · {o.net >= 0 ? "net +" : "net −"}${Math.abs(o.net).toFixed(1)}M</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="fbar" style={{ marginBottom: 12 }}>
            {(["All", "Buys", "Sells"] as InsFilter[]).map(c => (
              <button key={c} className={`chip${insFilter === c ? " on" : ""}`} onClick={() => setInsFilter(c)}>{c}</button>
            ))}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", alignSelf: "center", marginRight: 6 }}>Sort</span>
            <button className={`chip${insSort === "value" ? " on" : ""}`} onClick={() => setInsSort("value")}>Value</button>
            <button className={`chip${insSort === "date"  ? " on" : ""}`} onClick={() => setInsSort("date")}>Date</button>
          </div>

          <div className="card">
            <div className="card-h">
              <h3>{insFilter === "All" ? "All activity" : insFilter} · {list.length} filings</h3>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)" }}>live · SEC EDGAR Form 4</span>
            </div>
            <div className="card-b" style={{ paddingTop: 2, overflowX: "auto" }}>
              {list.length === 0 ? (
                <DataState loading={liveInsiderTxLoading} label="No Form 4 filings synced yet." />
              ) : (
                <table className="tbl" id="insTbl">
                  <thead>
                    <tr>
                      <th>Ticker</th><th>Side</th><th>Insider / owner</th><th>Transaction</th>
                      <th className="num">Value</th><th className="num">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((x, i) => (
                      <tr key={i} data-sym={x.s} onClick={() => openIns(x.s)} style={{ cursor: "pointer" }}>
                        <td>
                          <div className="co">
                            <span className="s"><StockLogo sym={x.s} size={20} />{x.s}</span>
                          </div>
                        </td>
                        <td>
                          <span className="tr-badge" style={{ background: x.dir==="buy" ? "var(--up)22" : "var(--down)22", color: x.dir==="buy" ? "var(--up)" : "var(--down)" }}>
                            {x.dir === "buy" ? "BUY" : "SELL"}
                          </span>
                        </td>
                        <td style={{ whiteSpace: "normal", lineHeight: 1.4 }}>{x.role}</td>
                        <td style={{ whiteSpace: "normal", lineHeight: 1.4, color: "var(--text-dim-solid)" }}>{x.det}</td>
                        <td className="num">
                          {x.valUsd != null
                            ? <b className={x.dir === "buy" ? "up" : "down"}>{x.dir === "buy" ? "+" : "−"}{fmtValue(x.valUsd)}</b>
                            : <NotAvailable />}
                        </td>
                        <td className="num" style={{ color: "var(--text-dim-solid)" }}>{x.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <p style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", marginTop: 10 }}>
            Click any row for that company&#8217;s full insider history. Real SEC Form 4 filings via EDGAR. Informational only — not investment advice.
          </p>
        </>
      )}

      {/* ======================================================== 13F INSTITUTIONAL */}
      {view === "13f" && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-h">
              <h3>Most active institutional stocks</h3>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>tap a name for fund detail</span>
            </div>
            <div className="card-b" style={{ paddingTop: 8 }}>
              <DataState label="Stock-level institutional ownership (owners count, % owned, buy/sell direction) needs a ticker-indexed 13F aggregation this plan doesn't have yet — SEC 13F positions are keyed by CUSIP, not ticker. The fund-level table and CUSIP-matched overlap below are real." />
            </div>
          </div>

          <div className="fbar" style={{ marginBottom: 12 }}>
            {(["All", "Net buying", "Net selling"] as InstFilter[]).map(c => (
              <button key={c} className={`chip${instFilter === c ? " on" : ""}`} onClick={() => setInstFilter(c)}>{c}</button>
            ))}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", alignSelf: "center", marginRight: 6 }}>Sort</span>
            <button className={`chip${instSort === "owners" ? " on" : ""}`} onClick={() => setInstSort("owners")}>Owners</button>
            <button className={`chip${instSort === "move"   ? " on" : ""}`} onClick={() => setInstSort("move")}>Move</button>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-h">
              <h3>{instFilter === "All" ? "All institutional activity" : instFilter} · by ticker</h3>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>13F · most recent quarter</span>
            </div>
            <div className="card-b" style={{ paddingTop: 2, overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Ticker</th><th className="num">Inst. owners</th><th className="num">Inst. %</th>
                    <th className="num">Buying</th><th className="num">Net QoQ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td colSpan={5} style={{ padding: 0 }}>
                    <DataState label="No live per-ticker institutional ownership feed yet." />
                  </td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-h">
              <h3>Tracked 13F funds · by AUM</h3>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)" }}>live · SEC EDGAR 13F</span>
            </div>
            <div className="card-b" style={{ paddingTop: 2, overflowX: "auto" }}>
              {sortedFunds.length === 0 ? (
                <DataState loading={liveFundsLoading} label="No 13F filings synced yet." />
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Fund</th><th className="num">13F AUM</th><th className="num">Positions</th><th>Latest filing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFunds.map(f => (
                      <tr key={f.id} onClick={() => setDrawer({ kind: "fund", fund: f })} style={{ cursor: "pointer" }}>
                        <td><b style={{ color: "var(--text-hi)" }}>{f.fundName}</b></td>
                        <td className="num">{fmtValue(f.totalValue)}</td>
                        <td className="num">{f.totalPositions}</td>
                        <td style={{ color: "var(--text-dim-solid)" }}>{f.latestFilingDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="dash" style={{ marginTop: 14 }}>
            <div className="col-8">
              <div className="ai-block">
                <div className="card-h">
                  <h3 className="ai-c">◆ AI 13F Summary</h3>
                  <span className="pill ai">Needs per-firm event feed</span>
                </div>
                <div className="card-b">
                  <DataState label="A narrative 13F-quarter summary (what changed, biggest buys/exits, theme shifts) needs the same richer feed as the per-firm insider actions table — not available on the current plan." />
                </div>
              </div>
            </div>

            <div className="col-4">
              <div className="card">
                <div className="card-h"><h3>Cross-fund signals</h3></div>
                <div className="card-b">
                  <div style={{ fontSize: ".7rem", textTransform: "uppercase" as const, letterSpacing: ".06em", color: "var(--up)", fontWeight: 700, margin: "4px 0 6px" }}>
                    Most owned (3+ funds)
                  </div>
                  <DataState label="Needs ticker-indexed 13F data — see note above." />
                  <div style={{ fontSize: ".7rem", textTransform: "uppercase" as const, letterSpacing: ".06em", color: "var(--down)", fontWeight: 700, margin: "12px 0 6px" }}>
                    Most sold (3+ funds)
                  </div>
                  <DataState label="Needs ticker-indexed 13F data — see note above." />
                  <div style={{ fontSize: ".7rem", textTransform: "uppercase" as const, letterSpacing: ".06em", color: "var(--brand-2)", fontWeight: 700, margin: "12px 0 6px" }}>
                    Live overlap (CUSIP-matched, real)
                  </div>
                  {liveOverlap === null || liveOverlap.length === 0 ? (
                    <DataState loading={liveOverlap === null} label="No overlap found yet in synced 13F data." />
                  ) : liveOverlap.slice(0, 5).map(o => (
                    <div key={o.cusip} className="minirow">
                      <span className="mid">
                        <b style={{ color: "var(--text-hi)" }}>{o.name}</b>
                        <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)" }}>{o.funds.join(", ")}</div>
                      </span>
                      <span className="r">{o.funds.length} funds</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ---- drawers ---- */}
      {drawer?.kind === "insider" && (
        <InsiderDrawer sym={drawer.sym} liveTxns={liveInsiderTx} loading={liveInsiderTxLoading} onClose={() => setDrawer(null)} onOpenFull={openStockFull} />
      )}
      {drawer?.kind === "fund" && (
        <FundDrawer key={drawer.fund.id} fund={drawer.fund} onClose={() => setDrawer(null)} />
      )}
    </>
  );
}
