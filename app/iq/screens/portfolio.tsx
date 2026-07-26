"use client";

import { useEffect, useRef, useState } from "react";
import { TickerSearchInput } from "../ticker-search-input";
import { doc, onSnapshot, setDoc, deleteDoc, collection, Timestamp } from "firebase/firestore";
import { firebaseDb, firebaseAuth } from "../../firebase";
import { useCollection } from "../hooks/useCollection";
import { useLivePrices } from "../live-prices";
import { cls, arr, sign } from "../utils";
import { StockPanelLayout, StockListCard, StockRow } from "../stock-panel";

/** A user holding — the raw record; price/%change are joined live at render. */
interface Holding {
  ticker: string;
  name: string;
  positionSize: "Small" | "Medium" | "Large";
  conviction: "High" | "Medium" | "Low";
}

interface CompanyDoc {
  id: string; ticker: string; name: string | null; price: number | null; pctChange: number | null;
}
interface HoldingDoc {
  id: string; // ticker
  ticker: string;
  shares: number;
  positionSize: "Small" | "Medium" | "Large";
  conviction: "High" | "Medium" | "Low";
}

function portfolioRef(uid: string) {
  return doc(firebaseDb, "users", uid, "portfolios", "default");
}
function holdingsCol(uid: string) {
  return collection(firebaseDb, "users", uid, "portfolios", "default", "holdings");
}

function usd(v: number) {
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${v.toFixed(2)}`;
}

// Headline total — two decimals, and M/K abbreviation for large portfolios.
function usd2(v: number) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  return `$${v.toFixed(2)}`;
}

export function PortfolioScreen() {
  const uid = firebaseAuth.currentUser?.uid ?? null;
  const { data: companies } = useCollection<CompanyDoc>("companies");
  const byTicker = new Map(companies.map(c => [c.ticker, c]));

  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [pfSel, setPfSel]       = useState("");
  const [shares, setShares]     = useState<Record<string, number>>({});
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [addOpen, setAddOpen]       = useState(false);
  const [newSym, setNewSym]         = useState("");
  const [newShares, setNewShares]   = useState<number>(10);
  const [newSize, setNewSize]       = useState<"Small"|"Medium"|"Large">("Small");
  const [newConv, setNewConv]       = useState<"High"|"Medium"|"Low">("Medium");

  // The portfolio is the user's own — it starts empty and is populated from the
  // saved Firestore holdings once signed in. No demo/sample holdings are shown;
  // the company name comes from the live `companies` collection.
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(holdingsCol(uid), (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as HoldingDoc);
      const nextShares: Record<string, number> = {};
      const nextHoldings: Holding[] = rows.map(r => {
        nextShares[r.ticker] = r.shares;
        return {
          ticker: r.ticker,
          name: byTicker.get(r.ticker)?.name ?? r.ticker,
          positionSize: r.positionSize,
          conviction: r.conviction,
        };
      });
      setHoldings(nextHoldings);
      setShares(nextShares);
      setPfSel(prev => prev || nextHoldings[0]?.ticker || "");
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Live delayed prices for every holding, refreshed intraday — takes
  // precedence over the once-a-day EOD `companies` price. totalVal / dayPL below
  // recompute from whatever price wins here, so the portfolio total tracks the
  // live prices automatically.
  const snaps = useLivePrices(holdings.map(h => h.ticker));
  const merged = holdings.map(h => {
    const q = snaps.get(h.ticker.toUpperCase());
    const eod = byTicker.get(h.ticker);
    const price: number | null = q?.price ?? eod?.price ?? null;
    const pctChange: number | null = q?.changePct ?? eod?.pctChange ?? null;
    return { ...h, price, pctChange, live: price != null };
  });
  const liveCount = merged.filter(h => h.live).length;
  const qty = (t: string) => shares[t] ?? 0;

  const sel      = merged.find(h => h.ticker === pfSel);
  // Aggregates count only holdings with a real price — a holding whose price
  // hasn't synced contributes nothing rather than a fabricated value.
  const priced   = merged.filter(h => h.price != null) as { ticker: string; name: string; price: number; pctChange: number | null }[];
  const totalVal = priced.reduce((s, h) => s + qty(h.ticker) * h.price, 0);
  const dayPL    = priced.reduce((s, h) => s + qty(h.ticker) * h.price * (h.pctChange ?? 0) / 100, 0);
  const dayPLPct = totalVal > 0 && totalVal !== dayPL ? (dayPL / (totalVal - dayPL)) * 100 : 0;
  const green    = merged.filter(h => (h.pctChange ?? 0) > 0).length;
  const driver   = [...priced].sort((a, b) => qty(b.ticker) * b.price - qty(a.ticker) * a.price)[0];
  const ranked   = priced.filter(h => h.pctChange != null) as { ticker: string; pctChange: number }[];
  const leader   = [...ranked].sort((a, b) => b.pctChange - a.pctChange)[0];
  const laggard  = [...ranked].sort((a, b) => a.pctChange - b.pctChange)[0];
  const driverWt = driver && totalVal > 0
    ? (qty(driver.ticker) * driver.price / totalVal * 100).toFixed(0) : "0";

  // Materialize the computed summary into Firestore (debounced) so anything
  // outside this browser tab — notifications, a future backend job, historical
  // tracking — can read portfolio value without recomputing it from holdings +
  // live prices. Display above stays purely client-derived/live; this write is
  // a side effect, never the render source, so it adds no latency to the UI.
  const lastWritten = useRef<{ totalVal: number; dayPL: number } | null>(null);
  useEffect(() => {
    if (!uid || merged.length === 0) return;
    const timer = setTimeout(() => {
      const prev = lastWritten.current;
      if (prev && Math.abs(prev.totalVal - totalVal) < 0.01 && Math.abs(prev.dayPL - dayPL) < 0.01) return;
      lastWritten.current = { totalVal, dayPL };
      setDoc(portfolioRef(uid), {
        totalValue: totalVal,
        dayPL,
        dayPLPct,
        holdingsCount: merged.length,
        updatedAt: Timestamp.now(),
      }, { merge: true });
    }, 3000);
    return () => clearTimeout(timer);
  }, [uid, totalVal, dayPL, dayPLPct, merged.length]);

  async function addHolding() {
    if (!newSym.trim()) return;
    const s = newSym.trim().toUpperCase();
    if (holdings.find(h => h.ticker === s)) { setAddOpen(false); return; }
    const q = Number.isFinite(newShares) && newShares > 0 ? newShares : 10;
    setHoldings(prev => [...prev, { ticker: s, name: byTicker.get(s)?.name ?? s, positionSize: newSize, conviction: newConv }]);
    setShares(prev => ({ ...prev, [s]: q }));
    setPfSel(prev => prev || s);
    setNewSym(""); setNewShares(10); setAddOpen(false);
    if (uid) {
      await setDoc(portfolioRef(uid), { name: "My Portfolio", createdAt: Timestamp.now() }, { merge: true });
      await setDoc(doc(holdingsCol(uid), s), { ticker: s, shares: q, positionSize: newSize, conviction: newConv, addedAt: Timestamp.now() });
    }
  }

  // Update the share quantity of an existing holding — the missing "U" in the
  // portfolio's CRUD. Persists to Firestore (merge, so positionSize/conviction
  // survive) so the total recomputes from real share counts, not a fixed 10.
  async function editShares(sym: string, qty: number) {
    const n = Math.max(0, Math.round(qty));
    setShares(prev => ({ ...prev, [sym]: n }));
    if (uid) await setDoc(doc(holdingsCol(uid), sym), { ticker: sym, shares: n }, { merge: true });
  }

  async function removeHolding(sym: string) {
    const next = holdings.find(h => h.ticker !== sym);
    setHoldings(prev => prev.filter(h => h.ticker !== sym));
    if (pfSel === sym) setPfSel(next?.ticker ?? "");
    setConfirmDel(null);
    if (uid) await deleteDoc(doc(holdingsCol(uid), sym));
  }

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

        {/* Editable position for the selected holding — the "U" in CRUD. Shares ×
            the LIVE price = the position's market value; editing shares persists
            to Firestore and the portfolio total above recomputes immediately. */}
        {sel && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", margin: "0 0 12px", background: "var(--surface-1)", border: "1px solid var(--border-soft)", borderRadius: 10 }}>
            <span style={{ fontWeight: 700, color: "var(--text-hi)" }}>{sel.ticker}</span>
            <span style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Shares</span>
            <input
              type="number" min={0} step="any" inputMode="decimal"
              value={shares[sel.ticker] ?? 10}
              onChange={e => editShares(sel.ticker, parseFloat(e.target.value))}
              style={{ width: 90, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-0)", color: "var(--text-hi)", fontSize: ".85rem", fontFamily: "var(--f-mono)" }}
            />
            <span style={{ fontSize: ".8rem", color: "var(--text-dim-solid)" }}>
              {sel.price == null ? (
                <span>× <span className="mono">—</span> · price not synced yet</span>
              ) : (
                <>× <span className="mono">${sel.price.toFixed(2)}</span>{sel.live ? "" : " (EOD)"} =
                {" "}<b className="mono" style={{ color: "var(--text-hi)" }}>{usd(qty(sel.ticker) * sel.price)}</b></>
              )}
            </span>
          </div>
        )}

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
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: "1.35rem", fontWeight: 700, color: "var(--text-hi)", lineHeight: 1.1 }}>{usd2(totalVal)}</span>
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
          <div className="drawer" style={{ maxHeight: "min(360px,85vh)" }}>
            <div className="drawer-h">
              <div style={{ flex: 1, fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Add Holding</div>
              <button className="closebtn" onClick={() => setAddOpen(false)}>✕</button>
            </div>
            <div className="drawer-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", display: "block", marginBottom: 5 }}>Ticker or company name</label>
                <TickerSearchInput
                  placeholder="Ticker or company name — e.g. Nvidia"
                  value={newSym}
                  onChange={v => setNewSym(v.toUpperCase())}
                  onPick={t => { setNewSym(t); }}
                  onEnter={addHolding}
                />
              </div>
              <div>
                <label style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", display: "block", marginBottom: 5 }}>Shares</label>
                <input
                  type="number" min={0} step="any" inputMode="decimal"
                  value={Number.isFinite(newShares) ? newShares : ""}
                  onChange={e => setNewShares(parseFloat(e.target.value))}
                  placeholder="e.g. 25"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-0)", color: "var(--text-hi)", fontSize: ".85rem" }}
                />
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
