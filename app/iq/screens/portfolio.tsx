"use client";

import { useCallback, useEffect, useState } from "react";
import { firebaseAuth } from "../../firebase";
import { apiGet, apiPost, apiDelete } from "../backend";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import type { CompanyDoc, HoldingDoc } from "../types";
import { cls, arr, sign, DataState, VendorTag } from "../utils";
import { StockPanelLayout, StockListCard, StockRow } from "../stock-panel";
import { TickerSearchField } from "../ticker-search-field";
import { AiSummaryCard } from "../ai-summary-card";

interface Holding {
  ticker: string; shares: number;
  positionSize: "Small" | "Medium" | "Large";
  conviction: "High" | "Medium" | "Low";
  costBasis: number | null;
}

function usd(v: number) {
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${v.toFixed(2)}`;
}

export function PortfolioScreen() {
  const uid = firebaseAuth.currentUser?.uid ?? null;
  const { data: companies, loading: companiesLoading } = useApiList<CompanyDoc>("/market-data/companies");
  const byTicker = new Map(companies.map(c => [c.ticker, c]));

  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [pfSel, setPfSel]       = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [addOpen, setAddOpen]       = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [newSym, setNewSym]         = useState("");
  const [newSize, setNewSize]       = useState<"Small"|"Medium"|"Large">("Small");
  const [newConv, setNewConv]       = useState<"High"|"Medium"|"Low">("Medium");
  const [newCost, setNewCost]       = useState("");

  const refreshHoldings = useCallback(async () => {
    if (!uid) return;
    try {
      const { holdings: rows } = await apiGet<{ holdings: HoldingDoc[] }>("/api/portfolio");
      setHoldings(rows.map(r => ({ ticker: r.ticker, shares: r.shares, positionSize: r.positionSize, conviction: r.conviction, costBasis: r.costBasis ?? null })));
      setPfSel(prev => prev || rows[0]?.ticker || "");
    } catch { /* leave holdings empty */ }
  }, [uid]);

  useEffect(() => { void refreshHoldings(); }, [refreshHoldings]);

  // Live quotes for the holdings (polls /live/quotes every 30s), overlaid on the
  // synced company price so position values/P&L track the live market.
  const quoteTickers = holdings.map(h => h.ticker).slice(0, 25);
  const quotesPath = quoteTickers.length ? `/live/quotes?tickers=${encodeURIComponent(quoteTickers.join(","))}` : null;
  const { data: liveQuotes } = useApiResource<Array<{ ticker: string; price: number | null; pctChange: number | null }>>(quotesPath, 30000);
  const quoteByTicker = new Map((liveQuotes ?? []).map(q => [q.ticker, q]));

  // Every field beyond ticker/shares/positionSize/conviction comes from the
  // live quote (falling back to the synced companies collection) — a holding
  // with no match still lists (it's the user's data), but its price/change
  // render as "not available" and it's excluded from value/P&L totals.
  const merged = holdings.map(h => {
    const live = byTicker.get(h.ticker);
    const q = quoteByTicker.get(h.ticker);
    const price = q?.price ?? live?.price ?? null;
    const hasLive = price != null;
    // Unrealized = (live price − cost basis) × shares; null without a basis.
    const unrealized = price != null && h.costBasis != null && h.costBasis > 0
      ? (price - h.costBasis) * h.shares : null;
    const unrealizedPct = price != null && h.costBasis != null && h.costBasis > 0
      ? (price - h.costBasis) / h.costBasis * 100 : null;
    return {
      ...h,
      name: live?.name ?? h.ticker,
      price,
      pctChange: hasLive ? (live!.pctChange ?? 0) : null,
      live: hasLive,
      unrealized,
      unrealizedPct,
    };
  });
  const priced = merged.filter((h): h is typeof h & { price: number; pctChange: number } => h.price != null);
  // Total unrealized across holdings that carry a basis; null when none do.
  const withBasis = priced.filter(h => h.unrealized != null);
  const unrealizedTotal = withBasis.length ? withBasis.reduce((s, h) => s + (h.unrealized as number), 0) : null;

  const sel      = merged.find(h => h.ticker === pfSel);
  const totalVal = priced.reduce((s, h) => s + h.shares * h.price, 0);
  const dayPL    = priced.reduce((s, h) => s + h.shares * h.price * h.pctChange / 100, 0);
  const green    = priced.filter(h => h.pctChange > 0).length;
  const driver   = priced.length ? [...priced].sort((a, b) => b.shares * b.price - a.shares * a.price)[0] : null;
  const leader   = priced.length ? [...priced].sort((a, b) => b.pctChange - a.pctChange)[0] : null;
  const laggard  = priced.length ? [...priced].sort((a, b) => a.pctChange - b.pctChange)[0] : null;
  const driverWt = driver && totalVal > 0
    ? (driver.shares * driver.price / totalVal * 100).toFixed(0) : "0";

  async function addHolding() {
    if (!newSym.trim()) return;
    const s = newSym.trim().toUpperCase();
    if (holdings.find(h => h.ticker === s)) { setAddOpen(false); return; }
    const parsedCost = parseFloat(newCost);
    const costBasis = Number.isFinite(parsedCost) && parsedCost > 0 ? parsedCost : null;
    setHoldings(prev => [...prev, { ticker: s, shares: 10, positionSize: newSize, conviction: newConv, costBasis }]);
    setNewSym(""); setNewCost(""); setAddOpen(false);
    if (uid) {
      try {
        await apiPost<HoldingDoc>("/api/portfolio/holdings", { ticker: s, positionSize: newSize, conviction: newConv, ...(costBasis != null ? { costBasis } : {}) });
      } catch { /* optimistic add above already applied locally */ }
    }
  }

  async function removeHolding(sym: string) {
    const next = holdings.find(h => h.ticker !== sym);
    setHoldings(prev => prev.filter(h => h.ticker !== sym));
    if (pfSel === sym) setPfSel(next?.ticker ?? "");
    setConfirmDel(null);
    if (uid) {
      try {
        await apiDelete(`/api/portfolio/holdings/${encodeURIComponent(sym)}`);
      } catch { /* optimistic removal above already applied locally */ }
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-sub" style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>
              {merged.length} holdings{priced.length > 0 && <> · {usd(totalVal)} ·{" "}
                <span className={cls(dayPL)}>{dayPL >= 0 ? "+" : ""}{usd(Math.abs(dayPL))} today</span>
              </>}{unrealizedTotal != null && <> ·{" "}
                <span className={cls(unrealizedTotal)}>{unrealizedTotal >= 0 ? "+" : "−"}{usd(Math.abs(unrealizedTotal))} unrealized</span>
              </>}
            </span>
            <VendorTag v="polygon" />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => setImportOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }}>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M4 16l5-5 4 4 3-3 4 4" />
              <circle cx="8.5" cy="8.5" r="1.5" />
            </svg>
            Import from photo
          </button>
          <button className="btn primary" onClick={() => setAddOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Add holding
          </button>
        </div>
      </div>

      <div style={{ padding: "0 18px 18px" }}>

        {/* AI portfolio summary */}
        <AiSummaryCard title="◆ AI portfolio summary" pill={<span className="pill ai">drivers · leaders · laggards</span>}>
            {priced.length === 0 ? (
              <DataState loading={companiesLoading} label="No live price data for any current holding yet." />
            ) : (
              <ul className="wmn-body" style={{ columns: 2 }}>
                <li>
                  <span className="bullet" />
                  <span>
                    <b>Biggest driver:</b>{" "}
                    <b style={{ color: "var(--text-hi)" }}>{driver?.ticker ?? "—"}</b> — {sign(driver?.pctChange ?? 0)} at {driverWt}% weight.
                  </span>
                </li>
                <li>
                  <span className="bullet" />
                  <span>
                    <b>Leader:</b> <b className="up">{leader?.ticker} {sign(leader?.pctChange ?? 0)}</b>;{" "}
                    <b>laggard:</b> <b className="down">{laggard?.ticker} {sign(laggard?.pctChange ?? 0)}</b>.
                  </span>
                </li>
                <li>
                  <span className="bullet" />
                  <span>
                    <b>Net:</b> {green} of {priced.length} green; day P/L{" "}
                    <b className={cls(dayPL)}>{dayPL >= 0 ? "+" : ""}{usd(Math.abs(dayPL))}</b>.
                  </span>
                </li>
                <li>
                  <span className="bullet" />
                  <span>Click any holding on the left to see its full analysis →</span>
                </li>
              </ul>
            )}
        </AiSummaryCard>

        <StockPanelLayout
          selectedSym={pfSel}
          chartPx={sel?.price ?? 0}
          chartEmptyText="Select a holding to see chart"
          detailEmptyText="Add a holding to see its detail here."
          listCard={
            <StockListCard
              title="Holdings"
              headerRight={
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: ".8rem", fontWeight: 700, color: "var(--text-hi)" }}>{usd(totalVal)}</span>
                  <span style={{ fontSize: ".68rem", color: "var(--text-dim-solid)" }}>{merged.length} names</span>
                </div>
              }
              isEmpty={merged.length === 0}
              loading={companiesLoading}
              emptyMessage='No holdings — click "Add holding".'
            >
              {merged.map((f, i) => (
                <StockRow
                  key={f.ticker}
                  sym={f.ticker}
                  name={f.name}
                  seed={i + 3}
                  sparkUp={(f.pctChange ?? 0) >= 0}
                  isSelected={pfSel === f.ticker}
                  onClick={() => setPfSel(f.ticker)}
                  onDelete={() => setConfirmDel(f.ticker)}
                  valueTop={f.price == null ? "—" : f.price >= 1000 ? `$${(f.price / 1000).toFixed(2)}K` : `$${f.price.toFixed(2)}`}
                  valueBottom={f.pctChange == null ? "—" : `${arr(f.pctChange)} ${sign(f.pctChange)}`}
                  valueBottomClass={f.pctChange == null ? "" : f.pctChange >= 0 ? "up" : "down"}
                />
              ))}
            </StockListCard>
          }
        />

      </div>

      {/* ── Add Holding modal ── */}
      {addOpen && (
        <>
          <div className="scrim" onClick={() => setAddOpen(false)} />
          <div className="drawer" style={{ maxHeight: "min(480px,85vh)" }}>
            <div className="drawer-h">
              <div style={{ flex: 1, fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Add Holding</div>
              <button className="closebtn" onClick={() => setAddOpen(false)}>✕</button>
            </div>
            <div className="drawer-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", display: "block", marginBottom: 5 }}>Ticker</label>
                <TickerSearchField value={newSym} onChange={setNewSym} onEnter={addHolding} />
              </div>
              <div>
                <label style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", display: "block", marginBottom: 5 }}>Position size</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["Small","Medium","Large"] as const).map(s => (
                    <button key={s} className={`chip${newSize === s ? " on" : ""}`} onClick={() => setNewSize(s)}>{s}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", display: "block", marginBottom: 5 }}>Conviction</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["High","Medium","Low"] as const).map(c => (
                    <button key={c} className={`chip${newConv === c ? " on" : ""}`} onClick={() => setNewConv(c)}>{c}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", display: "block", marginBottom: 5 }}>Avg cost / share <span style={{ opacity: .7 }}>(optional — enables unrealized P/L)</span></label>
                <input
                  type="number" inputMode="decimal" min="0" step="0.01" placeholder="e.g. 182.50"
                  value={newCost} onChange={e => setNewCost(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addHolding(); }}
                  style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-1)", color: "var(--text)", fontSize: ".9rem" }}
                />
              </div>
              <button className="btn primary" style={{ width: "100%" }} onClick={addHolding}>Add to portfolio</button>
            </div>
          </div>
        </>
      )}

      {/* ── Import from photo modal ── */}
      {importOpen && (
        <>
          <div className="scrim" onClick={() => setImportOpen(false)} />
          <div className="drawer" style={{ maxHeight: "min(320px,85vh)" }}>
            <div className="drawer-h">
              <div style={{ flex: 1, fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Import from photo</div>
              <button className="closebtn" onClick={() => setImportOpen(false)}>✕</button>
            </div>
            <div className="drawer-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <DataState label="Photo import isn't connected to a live OCR service yet. Add holdings manually for now — this will wire up here once a vendor is integrated." />
            </div>
          </div>
        </>
      )}

      {/* ── Confirm remove holding ── */}
      {confirmDel && (
        <>
          <div className="scrim" style={{ zIndex: 60 }} onClick={() => setConfirmDel(null)} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            background: "var(--surface-1)", border: "1px solid var(--border)",
            borderRadius: "var(--r-lg)", padding: 24, zIndex: 61,
            minWidth: 320, boxShadow: "0 16px 48px rgba(0,0,0,.5)",
          }}>
            <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)", marginBottom: 8 }}>Remove holding</div>
            <div style={{ fontSize: ".88rem", color: "var(--text)", marginBottom: 20 }}>
              Remove <b style={{ color: "var(--text-hi)" }}>{confirmDel}</b> from your portfolio?
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="btn primary" style={{ background: "var(--down)", borderColor: "var(--down)" }}
                onClick={() => removeHolding(confirmDel)}>Remove</button>
            </div>
          </div>
        </>
      )}

    </>
  );
}
