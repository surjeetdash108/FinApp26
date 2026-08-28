"use client";

import { useEffect, useState } from "react";
import { useIQActions } from "../shell";
import { StockLogo, DataState, NotAvailable, VendorTag } from "../utils";
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

// Ticker-indexed 13F ownership rollup from FMP (see backend/src/sync/
// institutional-ownership.job.ts, market-data/institutional-ownership.controller.ts).
interface InstOwnDoc {
  id: string; ticker: string;
  /** Reporting period these figures are filed for — 13-F carries a quarter,
   *  not a date, and the backend has always written it. */
  year?: number | null; quarter?: number | null;
  investorsHolding: number | null; lastInvestorsHolding: number | null;
  investorsHoldingChange: number | null;
  numberOf13Fshares: number | null; numberOf13FsharesChange: number | null;
  totalInvested: number | null; ownershipPercent: number | null; putCallRatio: number | null;
  /** Newest-first filer history written by institutional-ownership.job. */
  history?: Array<{
    year: number; quarter: number;
    investorsHolding: number | null; ownershipPercent: number | null;
  }> | null;
}

/** "Q2 '26" — compact enough for eight columns side by side. */
function qLabel(year: number, quarter: number): string {
  return `Q${quarter} '${String(year).slice(2)}`;
}

function fmtValue(v: number) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}
/** Compact signed integer (holder/share counts): 1234 → "1.2K", −5.0M. */
function fmtCompact(v: number | null): string {
  if (v == null) return "—";
  const s = v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a}`;
}
/** Same, with an explicit + sign for positives (QoQ deltas). */
function fmtDelta(v: number | null): string {
  if (v == null) return "—";
  return (v > 0 ? "+" : "") + fmtCompact(v);
}
/**
 * Exact integer with thousands separators — for HOLDER counts.
 *
 * Do NOT use fmtCompact here: holder counts sit in the low thousands, where its
 * single decimal collapses genuinely different values into the same string
 * (6,423 / 6,404 / 6,390 all render "6.4K"). In a table sorted by that column
 * the result reads as duplicated data and a broken sort. Share counts, which
 * run to millions/billions, stay compact.
 */
function fmtCount(v: number | null): string {
  if (v == null) return "—";
  return Math.round(v).toLocaleString("en-US");
}
/** Signed exact integer, for holder-count QoQ deltas. */
function fmtCountDelta(v: number | null): string {
  if (v == null) return "—";
  const s = v > 0 ? "+" : v < 0 ? "−" : "";
  return s + Math.abs(Math.round(v)).toLocaleString("en-US");
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
  // JSX rather than an HTML string — `sym` is vendor-supplied, so hand-built
  // markup made this an injection surface for two bold spans.
  const read = nBuy > nSell ? (
    <>Net <b className="up">insider buying</b> in {sym} — insiders adding is generally a constructive signal.</>
  ) : nSell > nBuy ? (
    <>Net <b className="down">insider selling</b> in {sym} — often diversification, but worth monitoring if it clusters.</>
  ) : (
    <>Mixed insider activity in {sym}.</>
  );

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="side-drawer">
        <div className="drawer-h">
          <div className="sd-logo" style={{ background: "linear-gradient(135deg,#1f6b4d,#0e3a2a)", color: "#5ff0b3" }}>{sym[0]}</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--f-display)" }}>{sym}</div>
              <VendorTag v="sec" />
            </div>
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
                  {(x.transactionCode === "P" || x.transactionCode === "S") && x.pricePerShare && (
                    <span className={`r ${x.acquiredOrDisposed === "A" ? "up" : "down"}`}>
                      {x.acquiredOrDisposed === "A" ? "+" : "−"}{fmtValue(x.shares * x.pricePerShare)}
                    </span>
                  )}
                </div>
              ))}
              <div className="ai-block" style={{ marginTop: 16 }}>
                <div className="card-h"><h3 className="ai-c">◆ Read</h3></div>
                <div className="card-b">
                  <p style={{ fontSize: ".84rem", lineHeight: 1.55, color: "var(--text)" }}>
                    {read} Clusters of multiple insiders carry more signal than a single filing.
                  </p>
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
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--f-display)" }}>{fund.fundName}</div>
              <VendorTag v="sec" />
            </div>
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
  const [insDir,     setInsDir]     = useState<"asc" | "desc">("desc");
  const [insQuery,   setInsQuery]   = useState("");
  const [insPage,    setInsPage]    = useState(0);
  const [instFilter, setInstFilter] = useState<InstFilter>("All");
  const [instSort,   setInstSort]   = useState<InstSort>("owners");
  // Cross-fund signals: which of the 3 sub-panels is showing.
  const [xfTab,      setXfTab]      = useState<0 | 1 | 2>(0);
  const [drawer,     setDrawer]     = useState<DrawerState>(null);

  const { data: liveInsiderTxRaw, loading: liveInsiderTxLoading } = useApiList<InsiderTxDoc>("/market-data/insider-transactions");
  // Discard implausible per-share prices (Form 4 garbage — e.g. $2.1M/sh) at the
  // source so no fabricated dollar value reaches the feed, the drawer, or the
  // "$ volume" leaderboard. No US equity trades near $1M/sh (BRK.A is well under).
  const liveInsiderTx = liveInsiderTxRaw.map(x =>
    x.pricePerShare != null && !(x.pricePerShare > 0 && x.pricePerShare <= 1_000_000)
      ? { ...x, pricePerShare: null }
      : x,
  );
  const { data: liveFunds, loading: liveFundsLoading } = useApiList<FundHoldingDoc>("/market-data/fund-holdings");
  // Ticker-indexed institutional (13F) ownership from FMP — the per-ticker
  // rollup SEC 13F (CUSIP-keyed) cannot produce.
  const { data: instOwn, loading: instOwnLoading } = useApiList<InstOwnDoc>("/market-data/institutional-ownership");

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

  // "Recent activity" window — a late/amended Form 4 can report a decade-old
  // transaction (e.g. a 2010 date) that otherwise headlines the value-sorted feed.
  const insCutoff = Date.now() - 730 * 86_400_000; // ~24 months
  const FEED: Tx[] = liveInsiderTx
    .filter(x => {
      const t = Date.parse(x.transactionDate);
      return !Number.isFinite(t) || t >= insCutoff;
    })
    .map(x => {
      // Only OPEN-MARKET buys (P) / sales (S) carry a real dollar value. Option
      // exercises (M), grants (A), gifts (G), tax withholding (F) etc. aren't
      // market trades — a $ value on them fabricates the "$ volume" leaderboard
      // (a $7B option exercise showing as an insider "BUY").
      const openMarket = x.transactionCode === "P" || x.transactionCode === "S";
      return {
        s: x.ticker,
        role: x.officerTitle ?? x.ownerName ?? "Filer",
        det: `${x.acquiredOrDisposed === "A" ? "acquired" : "disposed"} ${x.shares.toLocaleString()} sh${x.pricePerShare ? ` @ $${x.pricePerShare.toFixed(2)}` : ""}`,
        dir: x.acquiredOrDisposed === "A" ? "buy" : "sell",
        valUsd: openMarket && x.pricePerShare != null ? x.shares * x.pricePerShare : null,
        date: x.transactionDate,
      };
    });

  // Click a sort field: re-clicking the active field flips direction, a new
  // field activates it descending (largest value / most recent date first).
  function toggleInsSort(field: InsSort) {
    if (insSort === field) setInsDir(d => (d === "desc" ? "asc" : "desc"));
    else { setInsSort(field); setInsDir("desc"); }
  }

  // ---- insider search + filter + sort ----
  const insQ = insQuery.trim().toUpperCase();
  const filtered = FEED.filter(x => {
    if (insQ && !x.s.toUpperCase().includes(insQ)) return false;
    if (insFilter === "Buys")  return x.dir === "buy";
    if (insFilter === "Sells") return x.dir === "sell";
    return true;
  });
  const list = [...filtered].sort((a, b) => {
    const cmp = insSort === "date"
      ? (a.date ?? "").localeCompare(b.date ?? "")
      : (a.valUsd ?? 0) - (b.valUsd ?? 0);
    return insDir === "desc" ? -cmp : cmp;
  });
  // Paginate the feed — 2000+ filings should not all render at once.
  const INS_PAGE_SIZE = 50;
  const insPageCount = Math.max(1, Math.ceil(list.length / INS_PAGE_SIZE));
  const insPageClamped = Math.min(insPage, insPageCount - 1);
  const pageRows = list.slice(insPageClamped * INS_PAGE_SIZE, insPageClamped * INS_PAGE_SIZE + INS_PAGE_SIZE);
  // Reset to the first page whenever the search, filter or sort changes.
  useEffect(() => { setInsPage(0); }, [insFilter, insSort, insDir, insQuery]);

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

  // ---- institutional ownership (FMP) filter + sort + rankings ----
  const instRows = instOwn.filter(d => d.investorsHolding != null);
  const instFiltered = instRows.filter(d => {
    const chg = d.investorsHoldingChange ?? 0;
    if (instFilter === "Net buying")  return chg > 0;
    if (instFilter === "Net selling") return chg < 0;
    return true;
  });
  const instSorted = [...instFiltered].sort((a, b) =>
    instSort === "owners"
      ? (b.investorsHolding ?? 0) - (a.investorsHolding ?? 0)
      : Math.abs(b.investorsHoldingChange ?? 0) - Math.abs(a.investorsHoldingChange ?? 0),
  ).slice(0, 50);
  // Last 4 reporting quarters, newest first, derived from the data rather than
  // hardcoded so the header follows the 13F cycle on its own. Empty until the
  // sync has backfilled history, in which case the table renders as before.
  const instQuarters = (() => {
    const seen = new Map<string, { year: number; quarter: number }>();
    for (const d of instSorted) {
      for (const h of d.history ?? []) {
        if (h?.year != null && h?.quarter != null) {
          seen.set(qLabel(h.year, h.quarter), { year: h.year, quarter: h.quarter });
        }
      }
    }
    return [...seen.entries()]
      .sort((a, b) => b[1].year - a[1].year || b[1].quarter - a[1].quarter)
      .slice(0, 4)
      .map(([label]) => label);
  })();
  const instActive = [...instRows]
    .sort((a, b) => (b.investorsHolding ?? 0) - (a.investorsHolding ?? 0))
    .slice(0, 6);
  const mostBought = [...instRows]
    .filter(d => (d.investorsHoldingChange ?? 0) > 0)
    .sort((a, b) => (b.investorsHoldingChange ?? 0) - (a.investorsHoldingChange ?? 0))
    .slice(0, 5);
  const mostSold = [...instRows]
    .filter(d => (d.investorsHoldingChange ?? 0) < 0)
    .sort((a, b) => (a.investorsHoldingChange ?? 0) - (b.investorsHoldingChange ?? 0))
    .slice(0, 5);

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
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Most active by insider $ volume</h3><VendorTag v="sec" /></div>
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
            <input
              value={insQuery}
              onChange={e => setInsQuery(e.target.value.toUpperCase())}
              placeholder="Search ticker…"
              style={{ width: 230, boxSizing: "border-box", alignSelf: "center", marginLeft: 4, background: "var(--surface-3)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: "6px 10px", fontSize: ".76rem", color: "var(--text-hi)", outline: "none", fontFamily: "var(--f-mono)" }}
            />
          </div>

          <div className="card">
            <div className="card-h">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>{insFilter === "All" ? "All activity" : insFilter} · {list.length} filings</h3><VendorTag v="sec" /></div>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)" }}>live · SEC EDGAR Form 4</span>
            </div>
            <div className="card-b" style={{ paddingTop: 2, overflowX: "auto" }}>
              {list.length === 0 ? (
                <DataState loading={liveInsiderTxLoading} label={insQ ? `No filings match “${insQuery}”.` : "No Form 4 filings synced yet."} />
              ) : (
                <table className="tbl" id="insTbl">
                  <thead>
                    <tr>
                      <th>Ticker</th><th>Side</th><th>Insider / owner</th><th>Transaction</th>
                      <th className="num" style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleInsSort("value")} title="Sort by value">
                        Value <span style={{ fontSize: ".82em", color: "var(--brand-2)", opacity: insSort === "value" ? 1 : 0.3 }}>{insSort === "value" && insDir === "asc" ? "▲" : "▼"}</span>
                      </th>
                      <th className="num" style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleInsSort("date")} title="Sort by date">
                        Date <span style={{ fontSize: ".82em", color: "var(--brand-2)", opacity: insSort === "date" ? 1 : 0.3 }}>{insSort === "date" && insDir === "asc" ? "▲" : "▼"}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((x, i) => (
                      <tr key={`${insPageClamped}-${i}`} data-sym={x.s} onClick={() => openIns(x.s)} style={{ cursor: "pointer" }}>
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
              {list.length > INS_PAGE_SIZE && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, paddingTop: 12, marginTop: 4, borderTop: "1px solid var(--border-soft)" }}>
                  <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
                    {insPageClamped * INS_PAGE_SIZE + 1}–{Math.min((insPageClamped + 1) * INS_PAGE_SIZE, list.length)} of {list.length}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button className="chip" disabled={insPageClamped === 0} onClick={() => setInsPage(p => Math.max(0, p - 1))} style={{ opacity: insPageClamped === 0 ? 0.4 : 1, cursor: insPageClamped === 0 ? "default" : "pointer" }}>← Prev</button>
                    <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", minWidth: 74, textAlign: "center" }}>Page {insPageClamped + 1} / {insPageCount}</span>
                    <button className="chip" disabled={insPageClamped >= insPageCount - 1} onClick={() => setInsPage(p => Math.min(insPageCount - 1, p + 1))} style={{ opacity: insPageClamped >= insPageCount - 1 ? 0.4 : 1, cursor: insPageClamped >= insPageCount - 1 ? "default" : "pointer" }}>Next →</button>
                  </div>
                </div>
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
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Most held by institutions</h3><VendorTag v="fmp" /></div>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>tap a ticker for its stock page</span>
            </div>
            <div className="card-b" style={{ paddingTop: 8 }}>
              {instActive.length === 0 ? (
                <DataState loading={instOwnLoading} label="No institutional-ownership data synced yet." />
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {instActive.map(o => (
                    <button key={o.ticker} className="tr-pill" onClick={() => openStockFull(o.ticker)}>
                      <StockLogo sym={o.ticker} size={18} />
                      <span className="tr-tk">{o.ticker}</span>
                      <span className="tr-mt">
                        {fmtCount(o.investorsHolding)} filers
                        {o.ownershipPercent != null ? ` · ${o.ownershipPercent.toFixed(1)}%` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
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
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>{instFilter === "All" ? "All institutional activity" : instFilter} · by ticker</h3><VendorTag v="fmp" /></div>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>13F · most recent quarter</span>
            </div>
            <div className="card-b" style={{ paddingTop: 2, overflowX: "auto" }}>
              {instSorted.length === 0 ? (
                <DataState loading={instOwnLoading} label={
                  instFilter === "All"
                    ? "No institutional-ownership data synced yet."
                    : `No tickers with net institutional ${instFilter === "Net buying" ? "buying" : "selling"} this quarter.`
                } />
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      {/* Which filing period the row's figures are FROM. 13-F is
                          filed up to 45 days after quarter end, so a reader
                          needs the period to judge how current the numbers are
                          — the quarter columns to the right are history, not
                          the as-of date of the headline figures. */}
                      <th>Ticker</th><th>As of</th><th className="num">13F filers</th><th className="num">Inst. %</th>
                      {instQuarters.map(q => (
                        <th key={q} className="num" style={{ whiteSpace: "nowrap", fontWeight: 500 }}>{q}</th>
                      ))}
                      <th className="num">Filers QoQ</th><th className="num">Shares QoQ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {instSorted.map(d => (
                      <tr key={d.ticker} data-sym={d.ticker} onClick={() => openStockFull(d.ticker)} style={{ cursor: "pointer" }}>
                        <td>
                          <div className="co"><span className="s"><StockLogo sym={d.ticker} size={20} />{d.ticker}</span></div>
                        </td>
                        <td style={{ whiteSpace: "nowrap", color: "var(--text-dim-solid)" }}
                            title={d.year != null && d.quarter != null
                              ? `Positions as filed for Q${d.quarter} ${d.year}. 13-F is filed up to 45 days after quarter end and excludes short positions.`
                              : "No reporting period on this record"}>
                          {d.year != null && d.quarter != null ? qLabel(d.year, d.quarter) : <NotAvailable />}
                        </td>
                        <td className="num">{fmtCount(d.investorsHolding)}</td>
                        <td className="num">{d.ownershipPercent != null ? `${d.ownershipPercent.toFixed(1)}%` : <NotAvailable />}</td>
                        {instQuarters.map(q => {
                          const pt = (d.history ?? []).find(h => qLabel(h.year, h.quarter) === q);
                          return (
                            <td key={q} className="num" style={{ color: "var(--text-dim-solid)" }}>
                              {pt?.investorsHolding != null ? fmtCount(pt.investorsHolding) : <NotAvailable />}
                            </td>
                          );
                        })}
                        <td className="num">
                          {d.investorsHoldingChange == null ? <NotAvailable /> : (
                            <b className={d.investorsHoldingChange > 0 ? "up" : d.investorsHoldingChange < 0 ? "down" : ""}>
                              {fmtCountDelta(d.investorsHoldingChange)}
                            </b>
                          )}
                        </td>
                        <td className="num">
                          {d.numberOf13FsharesChange == null ? <NotAvailable /> : (
                            <span className={d.numberOf13FsharesChange > 0 ? "up" : d.numberOf13FsharesChange < 0 ? "down" : ""}>
                              {fmtDelta(d.numberOf13FsharesChange)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {instSorted.length > 0 && (
                <div style={{ marginTop: 8, fontSize: ".68rem", color: "var(--text-dim-solid)" }}>
                  A 13F filer is an institutional manager, not a single fund — one
                  filer (e.g. BlackRock) files once for many funds, so this count
                  runs lower than a &ldquo;number of funds&rdquo; figure. Inst. %
                  is all 13F shares over shares outstanding, so it runs higher
                  than a fund-only ownership figure.
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-h">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Tracked 13F funds · by AUM</h3><VendorTag v="sec" /></div>
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3 className="ai-c">◆ AI 13F Summary</h3><VendorTag v="sec" /></div>
                  <span className="pill ai">Needs per-firm event feed</span>
                </div>
                <div className="card-b">
                  <DataState label="A narrative 13F-quarter summary (what changed, biggest buys/exits, theme shifts) needs the same richer feed as the per-firm insider actions table — not available on the current plan." />
                </div>
              </div>
            </div>

            <div className="col-4">
              <div className="card">
                <div className="card-h"><div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Cross-fund signals</h3><VendorTag v={["fmp", "sec"]} /></div></div>
                <div className="card-b">
                  <div className="tabs" style={{ marginBottom: 12, flexWrap: "wrap" }}>
                    <button className={`tab${xfTab === 0 ? " on" : ""}`} onClick={() => setXfTab(0)}>Adding most</button>
                    <button className={`tab${xfTab === 1 ? " on" : ""}`} onClick={() => setXfTab(1)}>Trimming most</button>
                    <button className={`tab${xfTab === 2 ? " on" : ""}`} onClick={() => setXfTab(2)}>Live overlap</button>
                  </div>

                  {xfTab === 0 && (<>
                    <div style={{ fontSize: ".7rem", textTransform: "uppercase" as const, letterSpacing: ".06em", color: "var(--up)", fontWeight: 700, margin: "0 0 6px" }}>
                      Institutions adding most (QoQ)
                    </div>
                    {mostBought.length === 0 ? (
                      <DataState loading={instOwnLoading} label="No net-buying data synced yet." />
                    ) : mostBought.map(d => (
                      <div key={d.ticker} className="minirow" onClick={() => openStockFull(d.ticker)} style={{ cursor: "pointer" }}>
                        <span className="mid"><b style={{ color: "var(--text-hi)" }}>{d.ticker}</b></span>
                        <span className="r up">{fmtCountDelta(d.investorsHoldingChange)} filers</span>
                      </div>
                    ))}
                  </>)}

                  {xfTab === 1 && (<>
                    <div style={{ fontSize: ".7rem", textTransform: "uppercase" as const, letterSpacing: ".06em", color: "var(--down)", fontWeight: 700, margin: "0 0 6px" }}>
                      Institutions trimming most (QoQ)
                    </div>
                    {mostSold.length === 0 ? (
                      <DataState loading={instOwnLoading} label="No net-selling data synced yet." />
                    ) : mostSold.map(d => (
                      <div key={d.ticker} className="minirow" onClick={() => openStockFull(d.ticker)} style={{ cursor: "pointer" }}>
                        <span className="mid"><b style={{ color: "var(--text-hi)" }}>{d.ticker}</b></span>
                        <span className="r down">{fmtCountDelta(d.investorsHoldingChange)} filers</span>
                      </div>
                    ))}
                  </>)}

                  {xfTab === 2 && (<>
                    <div style={{ fontSize: ".7rem", textTransform: "uppercase" as const, letterSpacing: ".06em", color: "var(--brand-2)", fontWeight: 700, margin: "0 0 6px" }}>
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
                  </>)}
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
