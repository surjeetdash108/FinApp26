"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc, arrayUnion, arrayRemove, Timestamp } from "firebase/firestore";
import { firebaseDb, firebaseAuth } from "../../firebase";
import { watch as watchData } from "../data";
import { useCollection } from "../hooks/useCollection";
import { useEnsureCompanies } from "../hooks/useEnsureCompanies";
import { arr, sign } from "../utils";
import { StockPanelLayout, StockListCard, StockRow } from "../stock-panel";

interface CompanyDoc {
  id: string; ticker: string; name: string | null; price: number | null; pctChange: number | null;
}

function watchlistRef(uid: string) {
  return doc(firebaseDb, "users", uid, "watchlists", "default");
}

export function WatchlistScreen() {
  const uid = firebaseAuth.currentUser?.uid ?? null;
  const { data: companies } = useCollection<CompanyDoc>("companies");
  const byTicker = new Map(companies.map(c => [c.ticker, c]));

  const [items, setItems]                 = useState<string[]>(() => watchData.map(w => w.ticker));
  const [sel, setSel]                     = useState<string | null>(() => watchData[0]?.ticker ?? null);
  const [addOpen, setAddOpen]             = useState(false);
  const [newSym, setNewSym]               = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Firestore persistence layered on top of the demo watchlist: once signed in,
  // a saved list (if any) takes over; an empty/missing doc keeps the demo names.
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(watchlistRef(uid), (snap) => {
      const tickers = snap.data()?.tickers as string[] | undefined;
      if (tickers && tickers.length > 0) {
        setItems(tickers);
        setSel(prev => prev ?? tickers[0] ?? null);
      }
    });
    return () => unsub();
  }, [uid]);
  useEnsureCompanies(items);

  const list = items.map(sym => {
    const w = watchData.find(x => x.ticker === sym);
    const c = byTicker.get(sym);
    const live = c?.price != null;
    return {
      ticker: sym,
      name: c?.name ?? w?.name ?? sym,
      price: c?.price ?? w?.price ?? 0,
      pctChange: c?.pctChange ?? w?.pctChange ?? 0,
      live,
    };
  });
  const liveCount = list.filter(w => w.live).length;
  const up   = list.filter(w => w.pctChange > 0).length;
  const dn   = list.filter(w => w.pctChange < 0).length;
  const best  = [...list].sort((a, b) => b.pctChange - a.pctChange)[0];
  const worst = [...list].sort((a, b) => a.pctChange - b.pctChange)[0];

  const sumTxt =
    `Your ${list.length} watched names finished <b class="up">${up} up</b> / <b class="down">${dn} down</b> today.` +
    (best  ? ` <b>${best.ticker}</b> led (${sign(best.pctChange)})` : "") +
    (worst && worst.ticker !== best?.ticker ? `, <b>${worst.ticker}</b> lagged (${sign(worst.pctChange)})` : "") +
    `. Broad market: Nasdaq <b class="up">+1.02%</b>, S&P 500 <b class="up">+0.73%</b>.`;

  async function addStock() {
    const s = newSym.trim().toUpperCase();
    setNewSym("");
    setAddOpen(false);
    if (!s || items.includes(s)) return;
    setItems(prev => [...prev, s]);
    setSel(s);
    if (uid) {
      await setDoc(watchlistRef(uid), { name: "My Watchlist", tickers: arrayUnion(s), createdAt: Timestamp.now() }, { merge: true });
    }
  }

  async function deleteStock(sym: string) {
    setConfirmDelete(null);
    setItems(prev => {
      const next = prev.filter(s => s !== sym);
      if (sel === sym) setSel(next[0] ?? null);
      return next;
    });
    if (uid) {
      await setDoc(watchlistRef(uid), { tickers: arrayRemove(sym) }, { merge: true });
    }
  }

  const selData = list.find(w => w.ticker === sel);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-sub">{items.length} stocks watching · {up} up / {dn} down today</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn primary" onClick={() => setAddOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Add stock
          </button>
        </div>
      </div>

      <div style={{ padding: "0 18px 18px" }}>

        <div className="ai-block" style={{ marginBottom: 14 }}>
          <div className="card-h">
            <h3 className="ai-c">◆ AI watchlist summary</h3>
            <span className="pill ai">leaders · laggards · alerts</span>
          </div>
          <div className="card-b">
            <p dangerouslySetInnerHTML={{ __html: sumTxt }}
              style={{ marginBottom: 10, fontSize: ".88rem", lineHeight: 1.55 }} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span className="src-chip">Up {up}/{list.length}</span>
              <span className="src-chip">Nasdaq +1.02%</span>
              <span className="src-chip">S&amp;P +0.73%</span>
              {liveCount > 0 && <span className="src-chip">{liveCount}/{list.length} live</span>}
              {uid && <span className="src-chip">Synced to your account</span>}
            </div>
          </div>
        </div>

        <StockPanelLayout
          selectedSym={sel ?? ""}
          chartPx={selData?.price ?? 0}
          chartEmptyText="Select a stock to see chart"
          detailEmptyText="Add a stock to see its detail here."
          listCard={
            <StockListCard
              title="Watchlist"
              headerRight={<span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{items.length} stocks</span>}
              isEmpty={items.length === 0}
              emptyMessage='No stocks — click "Add stock".'
            >
              {list.map((w, i) => (
                <StockRow
                  key={w.ticker}
                  sym={w.ticker}
                  name={w.name}
                  seed={i + 3}
                  sparkUp={w.pctChange >= 0}
                  isSelected={sel === w.ticker}
                  onClick={() => setSel(w.ticker)}
                  onDelete={() => setConfirmDelete(w.ticker)}
                  valueTop={w.price >= 1000 ? `$${(w.price / 1000).toFixed(2)}K` : `$${w.price.toFixed(2)}`}
                  valueBottom={`${arr(w.pctChange)} ${sign(w.pctChange)}`}
                  valueBottomClass={w.pctChange >= 0 ? "up" : "down"}
                />
              ))}
            </StockListCard>
          }
        />

      </div>

      {/* Add stock modal */}
      {addOpen && (
        <>
          <div className="scrim" onClick={() => setAddOpen(false)} />
          <div className="drawer" style={{ maxHeight: "min(240px,85vh)" }}>
            <div className="drawer-h">
              <div style={{ flex: 1, fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Add Stock</div>
              <button className="closebtn" onClick={() => setAddOpen(false)}>✕</button>
            </div>
            <div className="drawer-b" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", display: "block", marginBottom: 5 }}>Ticker symbol</label>
                <input
                  autoFocus
                  style={{ width: "100%", background: "var(--surface-3)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontSize: ".9rem" }}
                  placeholder="e.g. TSLA"
                  value={newSym}
                  onChange={e => setNewSym(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === "Enter") addStock(); }}
                />
              </div>
              <button className="btn primary" style={{ width: "100%" }} onClick={addStock}>
                Add to watchlist
              </button>
            </div>
          </div>
        </>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <>
          <div className="scrim" style={{ zIndex: 60 }} onClick={() => setConfirmDelete(null)} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            background: "var(--surface-1)", border: "1px solid var(--border)",
            borderRadius: "var(--r-lg)", padding: 24, zIndex: 61,
            minWidth: 320, boxShadow: "0 16px 48px rgba(0,0,0,.5)",
          }}>
            <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)", marginBottom: 8 }}>
              Remove from watchlist
            </div>
            <div style={{ fontSize: ".88rem", color: "var(--text)", marginBottom: 20 }}>
              Remove <b style={{ color: "var(--text-hi)" }}>{confirmDelete}</b> from your watchlist?
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn primary" onClick={() => deleteStock(confirmDelete)}>Remove</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
