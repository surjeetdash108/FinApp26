# Archived — Dashboard "View all" sliding drawers

**Removed:** 2026-08-03
**File:** `app/iq/screens/dashboard.tsx`
**Why:** Per product decision, every dashboard widget's **"View all →"** now
navigates to the full screen (`/menu/{slug}`) instead of opening an in-page
sliding drawer. The drawer branches for earnings / movers / analyst /
earn-movers / internals / watchlist / portfolio / insider became unreachable,
so they were deleted to keep `dashboard.tsx` clean. The **Fear & Greed
"History →"** drawer (`fg-history`) was **kept** — it is not a "View all" and
has no dedicated screen.

This file preserves the exact removed code so it can be restored verbatim.

---

## How to restore

1. Widen the `DrawerKey` type back to the full union (see below).
2. Re-add the `EARN_MOVERS` derived list near the other derived lists (it sat
   just after `laggards`, before the `useState` hooks).
3. Paste the full drawer body back into the `{drawer && ( … )}` block.
4. Repoint whichever "View all" buttons should reopen a drawer: change
   `<Link className="link" href="/menu/{slug}">View all →</Link>` back to
   `<button className="link" onClick={() => setDrawer("{key}")}>View all →</button>`.
   Mapping: earnings→`/menu/earnings`, movers→`/menu/movers`,
   analyst→`/menu/analyst`, portfolio→`/menu/portfolio`,
   watchlist→`/menu/watchlist`, insider→`/menu/insider`,
   screener→`/menu/screener` (screener was always a Link).

---

## 1. Original `DrawerKey` type (line ~28)

```ts
type DrawerKey = "earnings" | "movers" | "analyst" | "earn-movers" | "internals" | "watchlist" | "portfolio" | "insider" | "fg-history" | null;
```

Current (kept) value:

```ts
type DrawerKey = "fg-history" | null;
```

## 2. Removed derived list `EARN_MOVERS` (was lines ~332–334)

```tsx
const EARN_MOVERS = [...earnings]
  .filter(e => e.priceReaction !== null)
  .sort((a, b) => Math.abs(b.priceReaction!) - Math.abs(a.priceReaction!));
```

## 3. Removed drawer branches

These lived inside the `{drawer && ( … )}` block's `.drawer-b` container and
inside the `.drawer-title` switch. The `fg-history` branch and the drawer
shell itself were kept — only the branches below were removed.

### Title lines removed from `.drawer-title`

```tsx
{drawer === "earnings"    && "Earnings Calendar"}
{drawer === "movers"      && "Movers"}
{drawer === "analyst"     && "Analyst Actions"}
{drawer === "earn-movers" && "Biggest Earnings Movers"}
{drawer === "internals"   && "Market Internals"}
{drawer === "watchlist"   && "Watchlist"}
{drawer === "portfolio"   && "Portfolio Pulse"}
{drawer === "insider"     && "Insider & Institutional"}
```

### Body branches removed from `.drawer-b`

```tsx
{/* Earnings */}
{drawer === "earnings" && earnings.map(e => (
  <div key={e.ticker} className="minirow" style={{ cursor: "pointer", padding: "8px 0" }}
    onClick={() => { openEarnings(e.ticker); setDrawer(null); }}>
    <StockLogo sym={e.ticker} size={22} />
    <span className="tkr">{e.ticker}<small>{e.name}</small></span>
    <span className="mid">
      <span className={`pill ${e.session.includes("pre") ? "bmo" : "amc"}`}>{e.session}</span>
    </span>
    <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
      EPS est <span className="mono">{e.epsEstimate != null ? `$${e.epsEstimate}` : "—"}</span>
      {e.epsActual != null && e.epsEstimate != null && <> &rarr; <span className={`mono ${e.epsActual >= e.epsEstimate ? "up" : "down"}`}>${e.epsActual}</span></>}
    </span>
    <span className={`r ${e.priceReaction != null ? cls(e.priceReaction) : ""}`}>
      {e.priceReaction != null ? sign(e.priceReaction) : <span style={{ color: "var(--text-dim-solid)" }}>pending</span>}
    </span>
  </div>
))}

{/* Movers — same Gainers/Losers/Most Active tabs as the dashboard card */}
{drawer === "movers" && (
  <>
    <div style={{ display: "flex", gap: 4, margin: "0 0 10px" }}>
      {(["Gainers", "Losers", "Most Active"] as const).map((label, i) => (
        <button key={label}
          className={`chip${moversTab === i ? " on" : ""}`}
          style={{ fontSize: ".65rem", padding: "3px 9px" }}
          onClick={() => setMoversTab(i as 0 | 1 | 2)}
        >{label}</button>
      ))}
    </div>
    {(moversTab === 0
      ? [...movers].filter(m => m.pctChange > 0).sort((a, b) => b.pctChange - a.pctChange)
      : moversTab === 1
      ? [...movers].filter(m => m.pctChange < 0).sort((a, b) => a.pctChange - b.pctChange)
      : [...movers].sort((a, b) => b.rvolRatio - a.rvolRatio)
    ).map(m => (
      <div key={m.ticker} className="minirow" style={{ cursor: "pointer", padding: "7px 0" }}
        onClick={() => { openMoverModal(m.ticker); setDrawer(null); }}>
        <StockLogo sym={m.ticker} size={22} />
        <span className="tkr">{m.ticker}<small>{m.name}</small></span>
        <span className="mid">{m.catalystLabel}</span>
        <span className={`r mono ${cls(m.pctChange)}`}>{sign(m.pctChange)}</span>
      </div>
    ))}
  </>
)}

{/* Analyst */}
{drawer === "analyst" && (consensusLive.length === 0 ? (
  <DataState loading={consensusLoading} label="No analyst consensus synced yet." />
) : consensusLive.map(a => (
  <div key={a.ticker} className="minirow" style={{ cursor: "pointer", padding: "7px 0" }}
    onClick={() => { openStock(a.ticker); setDrawer(null); }}>
    <StockLogo sym={a.ticker} size={22} />
    <span className="tkr">{a.ticker}</span>
    <span className="mid" style={{ fontSize: ".74rem" }}>
      {a.strongBuy + a.buy} Buy · {a.hold} Hold · {a.sell + a.strongSell} Sell
    </span>
    <span className="r"><b style={{ color: "var(--text-hi)" }}>{a.consensus}</b></span>
  </div>
)))}

{/* Earn movers */}
{drawer === "earn-movers" && EARN_MOVERS.length === 0 && (
  <DataState label="Price reaction has no live source yet (needs a Benzinga-class feed)." />
)}
{drawer === "earn-movers" && EARN_MOVERS.map(e => (
  <div key={e.ticker} className="minirow" style={{ cursor: "pointer", padding: "8px 0" }}
    onClick={() => { openEarnings(e.ticker); setDrawer(null); }}>
    <StockLogo sym={e.ticker} size={22} />
    <span className="tkr">{e.ticker}<small>{e.name}</small></span>
    <span className="mid">
      <span className={`pill ${e.priceReaction! >= 0 ? "beat" : "miss"}`}>{e.priceReaction! >= 0 ? "Beat" : "Miss"}</span>
      {e.guidanceStatus && e.guidanceStatus !== "In-line" && (
        <span className={`pill ${e.guidanceStatus === "Raised" ? "beat" : "miss"}`} style={{ marginLeft: 4 }}>{e.guidanceStatus}</span>
      )}
      <span style={{ marginLeft: 6, fontSize: ".7rem", color: "var(--text-dim-solid)" }}>EPS: ${e.epsEstimate} &rarr; ${e.epsActual}</span>
    </span>
    <span className={`r mono ${e.priceReaction! >= 0 ? "up" : "down"}`} style={{ fontWeight: 700 }}>
      {e.priceReaction! >= 0 ? "+" : ""}{e.priceReaction}%
    </span>
  </div>
))}

{/* Market internals */}
{drawer === "internals" && (
  <DataState label="Market internals (advance/decline, TICK, TRIN, McClellan, put/call) have no live endpoint yet." />
)}

{/* Watchlist */}
{drawer === "watchlist" && (watchMini.length === 0 ? (
  <DataState loading={watchlistLoading} label="No saved watchlist yet." />
) : watchMini.map(w => (
  <div key={w.ticker} className="minirow" style={{ cursor: "pointer", padding: "7px 0" }}
    onClick={() => { openStock(w.ticker); setDrawer(null); }}>
    <StockLogo sym={w.ticker} size={22} />
    <span className="tkr">{w.ticker}<small>{w.name}</small></span>
    <span className="mid">{companyByTicker.get(w.ticker) ? "live" : "not synced"}</span>
    <span className={`r ${cls(w.pctChange)}`}>{sign(w.pctChange)}</span>
  </div>
)))}

{/* Portfolio */}
{drawer === "portfolio" && folioMini.map(f => {
  const dayC = movers.find(m => m.ticker === f.ticker)?.pctChange ?? f.pctChange;
  return (
    <div key={f.ticker} className="minirow" style={{ cursor: "pointer", padding: "7px 0" }}
      onClick={() => { openStock(f.ticker); setDrawer(null); }}>
      <StockLogo sym={f.ticker} size={22} />
      <span className="tkr">{f.ticker}</span>
      <span className="mid">{f.positionSize} &middot; {f.conviction} conv.</span>
      <span className={`r ${cls(dayC)}`}>{sign(dayC)}</span>
      <span className={`mono ${cls(f.gainLossPct)}`} style={{ fontSize: ".74rem", marginLeft: 6 }}>
        {f.gainLossPct > 0 ? "+" : ""}{f.gainLossPct.toFixed(1)}% total
      </span>
    </div>
  );
})}

{/* Insider */}
{drawer === "insider" && INSIDER_MINI.map(x => (
  <div key={x.key} className="minirow" style={{ cursor: "pointer", padding: "7px 0" }}
    onClick={() => { openStock(x.s); setDrawer(null); }}>
    <StockLogo sym={x.s} size={22} />
    <span className="tkr">{x.s}</span>
    <span className="mid">{x.dir === "buy" ? "Buy" : "Sell"} &middot; {x.role}</span>
    <span className={`r ${x.dir === "buy" ? "up" : "down"}`}>
      {x.dir === "buy" ? "+" : "−"}${x.val}
    </span>
  </div>
))}
```

**Kept (not removed) — Fear & Greed history branch:**

```tsx
{/* Fear & Greed History */}
{drawer === "fg-history" && (
  <DataState label="Fear & Greed history has no live endpoint yet (the backfill job writes to Firestore directly; nothing exposes it over REST)." />
)}
```
