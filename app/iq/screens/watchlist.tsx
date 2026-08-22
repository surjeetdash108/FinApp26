"use client";

import { useEffect, useMemo, useState } from "react";
import { useApiList } from "../hooks/useApiList";
import { useApiResource } from "../hooks/useApiResource";
import { useLiveQuotes } from "../live-quotes-context";
import { useWatchlistsContext } from "../hooks/useWatchlists";
import type { CompanyDoc } from "../types";
import { arr, sign, DataState, VendorTag } from "../utils";
import { StockPanelLayout, StockListCard, StockRow } from "../stock-panel";
import { TickerSearchField } from "../ticker-search-field";
import { AiSummaryCard } from "../ai-summary-card";
import { AiAggregateBlock } from "../ai-aggregate-block";

export function WatchlistScreen() {
  const { uid, watchlists, loading: wlLoading, createList, renameList, deleteList, addTicker, removeTicker } = useWatchlistsContext();
  const { data: companies, loading: companiesLoading } = useApiList<CompanyDoc>("/market-data/companies");
  const byTicker = useMemo(() => new Map(companies.map(c => [c.ticker, c])), [companies]);

  const [activeId, setActiveId]           = useState<string | null>(null);
  const [sel, setSel]                     = useState<string | null>(null);
  const [addOpen, setAddOpen]             = useState(false);
  const [newSym, setNewSym]               = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [nameModal, setNameModal]         = useState<{ mode: "create" | "rename"; value: string } | null>(null);
  const [confirmDeleteList, setConfirmDeleteList] = useState(false);

  // Keep an active list selected as lists load/change.
  useEffect(() => {
    if (watchlists.length === 0) { setActiveId(null); return; }
    setActiveId(prev => (prev && watchlists.some(w => w.id === prev) ? prev : watchlists[0].id));
  }, [watchlists]);

  const active = watchlists.find(w => w.id === activeId) ?? null;

  // Cumulative AI read for the list currently on screen. Deferred until the
  // summary card is expanded (it starts collapsed), and keyed per list so each
  // one caches — and is cleaned up — independently.
  const [aiOpen, setAiOpen] = useState(false);
  const aiPath =
    aiOpen && activeId
      ? `/api/ai/watchlist?listId=${encodeURIComponent(activeId)}`
      : null;
  const items = active?.tickers ?? [];

  // Live quotes for the active list (polls /live/quotes every 30s), overlaid on
  // top of the synced company price so watchlist rows track the live market.
  const quoteTickers = items.slice(0, 25);
  // Shared app-wide poll — identical values to every other live surface.
  const quoteByTickerShared = useLiveQuotes(quoteTickers);
  const quoteByTicker = quoteByTickerShared;

  const list = items.map(sym => {
    const c = byTicker.get(sym);
    const q = quoteByTicker.get(sym);
    const price = q?.price ?? c?.price ?? null;
    const pctChange = q?.pctChange ?? c?.pctChange ?? null;
    const hasLive = price != null;
    return {
      ticker: sym,
      name: c?.name ?? sym,
      price: hasLive ? price : null,
      pctChange: hasLive ? (pctChange ?? 0) : null,
      live: hasLive,
    };
  });
  const priced = list.filter((w): w is typeof w & { price: number; pctChange: number } => w.price != null);
  const up = priced.filter(w => w.pctChange > 0).length;
  const dn = priced.filter(w => w.pctChange < 0).length;
  const best  = priced.length ? [...priced].sort((a, b) => b.pctChange - a.pctChange)[0] : null;
  const worst = priced.length ? [...priced].sort((a, b) => a.pctChange - b.pctChange)[0] : null;

  // Built as JSX, not an HTML string: this interpolates vendor-supplied tickers,
  // so assembling markup by hand made it an injection surface for no benefit —
  // the markup is two bold spans.
  const summary = priced.length === 0 ? null : (
    <>
      Your {priced.length} priced watched names finished{" "}
      <b className="up">{up} up</b> / <b className="down">{dn} down</b> today.
      {best ? (<>{" "}<b>{best.ticker}</b> led ({sign(best.pctChange)})</>) : null}
      {worst && worst.ticker !== best?.ticker
        ? (<>, <b>{worst.ticker}</b> lagged ({sign(worst.pctChange)})</>)
        : null}
      .
    </>
  );

  // Keep the row selection valid for the active list.
  useEffect(() => {
    setSel(prev => (prev && items.includes(prev) ? prev : items[0] ?? null));
  }, [activeId, items.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addStock() {
    const s = newSym.trim().toUpperCase();
    setNewSym("");
    setAddOpen(false);
    if (!s || !activeId || items.includes(s)) return;
    setSel(s);
    await addTicker(activeId, s);
  }

  async function deleteStock(sym: string) {
    setConfirmDelete(null);
    if (!activeId) return;
    if (sel === sym) setSel(items.filter(t => t !== sym)[0] ?? null);
    await removeTicker(activeId, sym);
  }

  async function submitName() {
    if (!nameModal) return;
    const name = nameModal.value.trim();
    const mode = nameModal.mode;
    setNameModal(null);
    if (!name) return;
    if (mode === "create") {
      const created = await createList(name);
      if (created) setActiveId(created.id);
    } else if (active) {
      await renameList(active.id, name);
    }
  }

  const selData = list.find(w => w.ticker === sel);
  const totalWatched = new Set(watchlists.flatMap(w => w.tickers)).size;

  return (
    <>
      {/* AI watchlist summary sits at the very top of the page — directly under
          the global ticker tape, above the watchlist toolbar. */}
      {uid && (
        <div style={{ padding: "14px 18px 0" }}>
          <AiSummaryCard title="◆ AI watchlist summary" pill={<span className="pill ai">leaders · laggards · alerts</span>} onOpenChange={(o) => o && setAiOpen(true)}>
            {summary == null ? (
              <DataState loading={companiesLoading || wlLoading} label="No live price data for any watched ticker yet." />
            ) : (
              <>
                <p style={{ marginBottom: 10, fontSize: ".88rem", lineHeight: 1.55 }}>{summary}</p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span className="src-chip">Up {up}/{priced.length}</span>
                  <span className="src-chip">Synced to your account</span>
                </div>
              </>
            )}
            <AiAggregateBlock path={aiPath} label="watchlist" />
          </AiSummaryCard>
        </div>
      )}

      <div className="page-head">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Active-watchlist dropdown */}
          <select
            value={activeId ?? ""}
            onChange={e => setActiveId(e.target.value)}
            disabled={!uid || watchlists.length === 0}
            style={{
              background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)",
              padding: "6px 10px", fontSize: ".84rem", color: "var(--text-hi)", fontWeight: 600, outline: "none", cursor: "pointer",
            }}
          >
            {watchlists.map(w => (
              <option key={w.id} value={w.id}>{w.name} ({w.tickers.length})</option>
            ))}
          </select>

          {/* Create a new watchlist */}
          <button
            className="btn"
            title="New watchlist"
            disabled={!uid}
            onClick={() => setNameModal({ mode: "create", value: "" })}
            style={{ padding: "6px 9px" }}
          >
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          {active && (
            <>
              <button className="btn" title="Rename this watchlist" onClick={() => setNameModal({ mode: "rename", value: active.name })} style={{ padding: "6px 9px", fontSize: ".76rem" }}>Rename</button>
              <button className="btn" title="Delete this watchlist" disabled={watchlists.length <= 1} onClick={() => setConfirmDeleteList(true)} style={{ padding: "6px 9px", fontSize: ".76rem", opacity: watchlists.length <= 1 ? 0.4 : 1 }}>Delete</button>
            </>
          )}

          <div className="page-sub" style={{ marginLeft: 4, display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>
              {items.length} stocks{priced.length > 0 && <> · {up} up / {dn} down today</>}
              {watchlists.length > 1 && <> · {totalWatched} across {watchlists.length} lists</>}
            </span>
            <VendorTag v="polygon" />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn primary" disabled={!uid || !activeId} onClick={() => setAddOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Add stock
          </button>
        </div>
      </div>

      <div style={{ padding: "0 18px 18px" }}>

        {!uid ? (
          <DataState label="Sign in to create and sync watchlists." />
        ) : (
        <>
        <StockPanelLayout
          selectedSym={sel ?? ""}
          chartPx={selData?.price ?? 0}
          chartEmptyText="Select a stock to see chart"
          detailEmptyText="Add a stock to see its detail here."
          listCard={
            <StockListCard
              title={active?.name ?? "Watchlist"}
              headerRight={<span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{items.length} stocks</span>}
              isEmpty={items.length === 0}
              loading={wlLoading || companiesLoading}
              emptyMessage='No stocks — click "Add stock".'
            >
              {list.map((w, i) => (
                <StockRow
                  key={w.ticker}
                  sym={w.ticker}
                  name={w.name}
                  seed={i + 3}
                  sparkUp={(w.pctChange ?? 0) >= 0}
                  isSelected={sel === w.ticker}
                  onClick={() => setSel(w.ticker)}
                  onDelete={() => setConfirmDelete(w.ticker)}
                  valueTop={w.price == null ? "—" : w.price >= 1000 ? `$${(w.price / 1000).toFixed(2)}K` : `$${w.price.toFixed(2)}`}
                  valueBottom={w.pctChange == null ? "—" : `${arr(w.pctChange)} ${sign(w.pctChange)}`}
                  valueBottomClass={w.pctChange == null ? "" : w.pctChange >= 0 ? "up" : "down"}
                />
              ))}
            </StockListCard>
          }
        />
        </>
        )}
      </div>

      {/* Add stock modal */}
      {addOpen && (
        <>
          <div className="scrim" onClick={() => setAddOpen(false)} />
          <div className="drawer" style={{ maxHeight: "min(440px,85vh)" }}>
            <div className="drawer-h">
              <div style={{ flex: 1, fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Add Stock to {active?.name}</div>
              <button className="closebtn" onClick={() => setAddOpen(false)}>✕</button>
            </div>
            <div className="drawer-b" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", display: "block", marginBottom: 5 }}>Ticker symbol</label>
                <TickerSearchField value={newSym} onChange={setNewSym} onEnter={addStock} />
              </div>
              <button className="btn primary" style={{ width: "100%" }} onClick={addStock}>Add to {active?.name}</button>
            </div>
          </div>
        </>
      )}

      {/* Create / rename watchlist modal */}
      {nameModal && (
        <>
          <div className="scrim" style={{ zIndex: 60 }} onClick={() => setNameModal(null)} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)",
            padding: 24, zIndex: 61, minWidth: 340, boxShadow: "0 16px 48px rgba(0,0,0,.5)",
          }}>
            <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)", marginBottom: 12 }}>
              {nameModal.mode === "create" ? "New watchlist" : "Rename watchlist"}
            </div>
            <input
              autoFocus
              value={nameModal.value}
              onChange={e => setNameModal(m => (m ? { ...m, value: e.target.value } : m))}
              onKeyDown={e => { if (e.key === "Enter") void submitName(); }}
              placeholder="Watchlist name"
              style={{ width: "100%", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", padding: "9px 12px", fontSize: ".9rem", color: "var(--text-hi)", outline: "none", marginBottom: 18 }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setNameModal(null)}>Cancel</button>
              <button className="btn primary" onClick={submitName}>{nameModal.mode === "create" ? "Create" : "Save"}</button>
            </div>
          </div>
        </>
      )}

      {/* Delete stock confirmation */}
      {confirmDelete && (
        <>
          <div className="scrim" style={{ zIndex: 60 }} onClick={() => setConfirmDelete(null)} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)",
            padding: 24, zIndex: 61, minWidth: 320, boxShadow: "0 16px 48px rgba(0,0,0,.5)",
          }}>
            <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)", marginBottom: 8 }}>Remove from {active?.name}</div>
            <div style={{ fontSize: ".88rem", color: "var(--text)", marginBottom: 20 }}>
              Remove <b style={{ color: "var(--text-hi)" }}>{confirmDelete}</b> from <b style={{ color: "var(--text-hi)" }}>{active?.name}</b>?
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn primary" onClick={() => deleteStock(confirmDelete)}>Remove</button>
            </div>
          </div>
        </>
      )}

      {/* Delete watchlist confirmation */}
      {confirmDeleteList && active && (
        <>
          <div className="scrim" style={{ zIndex: 60 }} onClick={() => setConfirmDeleteList(false)} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)",
            padding: 24, zIndex: 61, minWidth: 340, boxShadow: "0 16px 48px rgba(0,0,0,.5)",
          }}>
            <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)", marginBottom: 8 }}>Delete watchlist</div>
            <div style={{ fontSize: ".88rem", color: "var(--text)", marginBottom: 20 }}>
              Delete <b style={{ color: "var(--text-hi)" }}>{active.name}</b> and its {active.tickers.length} stock{active.tickers.length === 1 ? "" : "s"}? This can&apos;t be undone.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setConfirmDeleteList(false)}>Cancel</button>
              <button className="btn primary" onClick={async () => { const id = active.id; setConfirmDeleteList(false); await deleteList(id); }}>Delete</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
