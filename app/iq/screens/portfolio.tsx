"use client";

import { useCallback, useEffect, useState } from "react";
import { firebaseAuth } from "../../firebase";
import { folio as folioData, type FolioItem } from "../data";
import { apiGet, apiPost, apiDelete } from "../backend";
import { useApiList } from "../hooks/useApiList";
import type { CompanyDoc, HoldingDoc } from "../types";
import { cls, arr, sign } from "../utils";
import { StockPanelLayout, StockListCard, StockRow } from "../stock-panel";

const DEFAULT_SHARES: Record<string, number> = {
  NVDA: 15, AAPL: 120, TSLA: 40, META: 30,
  HD: 15, MSFT: 60, AMZN: 80, PLTR: 1000,
};

function usd(v: number) {
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${v.toFixed(2)}`;
}

export function PortfolioScreen() {
  const uid = firebaseAuth.currentUser?.uid ?? null;
  const { data: companies } = useApiList<CompanyDoc>("/market-data/companies");
  const byTicker = new Map(companies.map(c => [c.ticker, c]));

  const [holdings, setHoldings] = useState<FolioItem[]>(() => [...folioData]);
  const [pfSel, setPfSel]       = useState(folioData[0]?.ticker ?? "");
  const [shares, setShares]     = useState<Record<string, number>>(() => {
    const base = { ...DEFAULT_SHARES };
    folioData.forEach(f => { if (!(f.ticker in base)) base[f.ticker] = 10; });
    return base;
  });
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [addOpen, setAddOpen]       = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting]   = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [newSym, setNewSym]         = useState("");
  const [newSize, setNewSize]       = useState<"Small"|"Medium"|"Large">("Small");
  const [newConv, setNewConv]       = useState<"High"|"Medium"|"Low">("Medium");

  // Backend persistence layered on top of the demo portfolio: once signed in,
  // saved holdings (if any) take over; an empty/missing set keeps the demo names.
  const refreshHoldings = useCallback(async () => {
    if (!uid) return;
    try {
      const { holdings: rows } = await apiGet<{ holdings: HoldingDoc[] }>("/api/portfolio");
      if (rows.length === 0) return;
      const nextShares: Record<string, number> = {};
      const nextHoldings: FolioItem[] = rows.map(r => {
        nextShares[r.ticker] = r.shares;
        const mock = folioData.find(f => f.ticker === r.ticker);
        return mock ?? {
          ticker: r.ticker, name: r.ticker, price: 100, pctChange: 0, gainLossPct: 0,
          positionSize: r.positionSize, conviction: r.conviction, eventNote: "—",
        };
      });
      setHoldings(nextHoldings);
      setShares(nextShares);
      setPfSel(prev => prev || nextHoldings[0]?.ticker || "");
    } catch { /* stay on demo data */ }
  }, [uid]);

  useEffect(() => { void refreshHoldings(); }, [refreshHoldings]);

  // Live price/% overlay — merged on top of the mock/demo holdings, never dropping a row.
  const merged = holdings.map(h => {
    const live = byTicker.get(h.ticker);
    if (!live || live.price == null) return { ...h, live: false as const };
    return { ...h, price: live.price, pctChange: live.pctChange ?? h.pctChange, live: true as const };
  });
  const liveCount = merged.filter(h => h.live).length;

  const sel      = merged.find(h => h.ticker === pfSel);
  const totalVal = merged.reduce((s, h) => s + (shares[h.ticker] ?? 10) * h.price, 0);
  const dayPL    = merged.reduce((s, h) => s + (shares[h.ticker] ?? 10) * h.price * h.pctChange / 100, 0);
  const green    = merged.filter(h => h.pctChange > 0).length;
  const driver   = [...merged].sort((a, b) => (shares[b.ticker] ?? 10) * b.price - (shares[a.ticker] ?? 10) * a.price)[0];
  const leader   = [...merged].sort((a, b) => b.pctChange - a.pctChange)[0];
  const laggard  = [...merged].sort((a, b) => a.pctChange - b.pctChange)[0];
  const driverWt = driver && totalVal > 0
    ? ((shares[driver.ticker] ?? 10) * driver.price / totalVal * 100).toFixed(0) : "0";

  async function addHolding() {
    if (!newSym.trim()) return;
    const s = newSym.trim().toUpperCase();
    if (holdings.find(h => h.ticker === s)) { setAddOpen(false); return; }
    setHoldings(prev => [...prev, { ticker: s, name: s, price: 100, pctChange: 0, gainLossPct: 0, positionSize: newSize, conviction: newConv, eventNote: "—" }]);
    setShares(prev => ({ ...prev, [s]: 10 }));
    setNewSym(""); setAddOpen(false);
    if (uid) {
      try {
        await apiPost<HoldingDoc>("/api/portfolio/holdings", { ticker: s, positionSize: newSize, conviction: newConv });
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

  function startImport() {
    setImporting(true);
    setTimeout(() => { setImporting(false); setImportDone(true); }, 1400);
  }

  const PARSED = [{ s: "NVDA", sh: 15 }, { s: "AAPL", sh: 120 }, { s: "MSFT", sh: 60 }];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-sub">
            {merged.length} holdings · {usd(totalVal)} ·{" "}
            <span className={cls(dayPL)}>
              {dayPL >= 0 ? "+" : ""}{usd(Math.abs(dayPL))} today
            </span>
            {liveCount > 0 && <> · <span style={{ color: "var(--up)" }}>{liveCount} live</span></>}
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
        <div className="ai-block" style={{ marginBottom: 14 }}>
          <div className="card-h">
            <h3 className="ai-c">◆ AI portfolio summary</h3>
            <span className="pill ai">drivers · leaders · laggards</span>
          </div>
          <div className="card-b">
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
                  <b>Net:</b> {green} of {merged.length} green; day P/L{" "}
                  <b className={cls(dayPL)}>{dayPL >= 0 ? "+" : ""}{usd(Math.abs(dayPL))}</b>.
                </span>
              </li>
              <li>
                <span className="bullet" />
                <span>Click any holding on the left to see its full analysis →</span>
              </li>
            </ul>
          </div>
        </div>

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
              emptyMessage='No holdings — click "Add holding".'
            >
              {merged.map((f, i) => (
                <StockRow
                  key={f.ticker}
                  sym={f.ticker}
                  name={f.name}
                  seed={i + 3}
                  sparkUp={f.pctChange >= 0}
                  isSelected={pfSel === f.ticker}
                  onClick={() => setPfSel(f.ticker)}
                  onDelete={() => setConfirmDel(f.ticker)}
                  valueTop={f.price >= 1000 ? `$${(f.price / 1000).toFixed(2)}K` : `$${f.price.toFixed(2)}`}
                  valueBottom={`${arr(f.pctChange)} ${sign(f.pctChange)}`}
                  valueBottomClass={f.pctChange >= 0 ? "up" : "down"}
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
          <div className="drawer" style={{ maxHeight: "min(360px,85vh)" }}>
            <div className="drawer-h">
              <div style={{ flex: 1, fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Add Holding</div>
              <button className="closebtn" onClick={() => setAddOpen(false)}>✕</button>
            </div>
            <div className="drawer-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", display: "block", marginBottom: 5 }}>Ticker</label>
                <input className="inp"
                  style={{ width: "100%", background: "var(--surface-3)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontSize: ".9rem" }}
                  placeholder="e.g. NVDA"
                  value={newSym} onChange={e => setNewSym(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === "Enter") addHolding(); }} />
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
              <button className="btn primary" style={{ width: "100%" }} onClick={addHolding}>Add to portfolio</button>
            </div>
          </div>
        </>
      )}

      {/* ── Import from photo modal ── */}
      {importOpen && (
        <>
          <div className="scrim" onClick={() => { setImportOpen(false); setImportDone(false); setImporting(false); }} />
          <div className="drawer" style={{ maxHeight: "min(480px,88vh)" }}>
            <div className="drawer-h">
              <div style={{ flex: 1, fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Import from photo</div>
              <button className="closebtn" onClick={() => { setImportOpen(false); setImportDone(false); setImporting(false); }}>✕</button>
            </div>
            <div className="drawer-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {!importing && !importDone && (
                <div className="imp-drop" onClick={startImport}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ width: 30, height: 30, color: "var(--brand-2)", flexShrink: 0 }}>
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="M4 16l5-5 4 4 3-3 4 4" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                  </svg>
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--text-hi)" }}>Upload a screenshot</div>
                    <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Tap to pick a photo of your brokerage holdings</div>
                  </div>
                </div>
              )}
              {importing && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 0", color: "var(--text-dim-solid)" }}>
                  <span className="imp-spin" />
                  <span>Scanning image with AI…</span>
                </div>
              )}
              {importDone && (
                <>
                  <div style={{ fontSize: ".82rem", color: "var(--up)", fontWeight: 600 }}>✓ Found {PARSED.length} holdings</div>
                  {PARSED.map(row => (
                    <div key={row.s} className="imp-row">
                      <span className="s" style={{ flex: 1, fontWeight: 700 }}>{row.s}</span>
                      <span style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Shares:</span>
                      <input className="sh-edit" type="number" defaultValue={row.sh} />
                    </div>
                  ))}
                  <button className="btn primary" style={{ width: "100%" }}
                    onClick={() => { setImportOpen(false); setImportDone(false); }}>
                    Add to portfolio
                  </button>
                </>
              )}
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
