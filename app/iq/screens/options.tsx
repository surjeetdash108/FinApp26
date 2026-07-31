"use client";

import { useState, useMemo } from "react";
import { sign, cls, arr, fmt, StockLogo, DataState, NotAvailable } from "../utils";
import { useApiResource } from "../hooks/useApiResource";
import { useApiList } from "../hooks/useApiList";
import { OptionsChainDoc, OPTIONS_UNIVERSE } from "../types";
import type { CompanyDoc } from "../types";

// Polygon's reference contracts give strike/expiration/lastClose/lastVolume —
// no bid/ask, IV or open interest (those need a live quotes/greeks feed this
// plan doesn't have). The classic calls|strike|puts grid below keeps every
// column so a richer feed can be wired straight in later; columns with no
// live source render NotAvailable instead of being dropped.
interface ChainRow {
  strike: number;
  call?: { last: number | null; vol: number | null };
  put?: { last: number | null; vol: number | null };
}

function buildChainRows(chain: OptionsChainDoc, expiry: string): ChainRow[] {
  const byStrike = new Map<number, ChainRow>();
  for (const c of chain.contracts) {
    if (c.expirationDate !== expiry) continue;
    const row = byStrike.get(c.strike) ?? { strike: c.strike };
    const side = { last: c.lastClose, vol: c.lastVolume };
    if (c.contractType === "call") row.call = side; else row.put = side;
    byStrike.set(c.strike, row);
  }
  return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
}

export function OptionsScreen() {
  const { data: companies, loading: companiesLoading } = useApiList<CompanyDoc>("/market-data/companies");
  const stockList = useMemo(
    () => [...companies]
      .filter(c => c.price != null)
      .map(c => ({ s: c.ticker, n: c.name ?? c.ticker, p: c.price as number, c: c.pctChange ?? 0 }))
      .sort((a, b) => a.s < b.s ? -1 : 1),
    [companies],
  );

  const [selSym, setSelSym] = useState<string | null>(null);
  const [query,  setQuery]  = useState("");
  const [expiry, setExpiry] = useState<string | null>(null);
  const sym = selSym ?? stockList[0]?.s ?? null;
  const inUniverse = !!sym && OPTIONS_UNIVERSE.includes(sym);
  const { data: liveChain, loading: liveChainLoading } = useApiResource<OptionsChainDoc>(
    inUniverse ? `/live/options-chain?ticker=${sym}` : null,
  );

  const cur = stockList.find(s => s.s === sym) ?? null;
  const filtered = query
    ? stockList.filter(s => (s.s + " " + s.n).toLowerCase().includes(query.toLowerCase()))
    : stockList;

  const expiries = liveChain
    ? [...new Set(liveChain.contracts.map(c => c.expirationDate))].sort()
    : [];
  const activeExpiry = expiry && expiries.includes(expiry) ? expiry : expiries[0] ?? null;
  const rows = liveChain && activeExpiry ? buildChainRows(liveChain, activeExpiry) : [];

  function selectSym(s: string) {
    setSelSym(s);
    setExpiry(null);
  }

  return (
    <>

      <div className="opt-wrap">
        {/* ─── Left sidebar ─── */}
        <aside className="opt-side">
          <div className="opt-search">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
            </svg>
            <input
              placeholder="Search stocks"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="opt-list">
            {filtered.map(o => (
              <div
                key={o.s}
                className={`opt-li${o.s === sym ? " sel" : ""}`}
                onClick={() => selectSym(o.s)}
              >
                <StockLogo sym={o.s} size={26} />
                <div className="opt-li-tx">
                  <div className="opt-li-s">{o.s}</div>
                  <div className="opt-li-n">{o.n}</div>
                </div>
                <div className={`opt-li-r ${cls(o.c)}`}>{sign(o.c)}</div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: "14px 10px", fontSize: ".8rem", color: "var(--text-dim-solid)" }}>
                No stocks match &ldquo;{query}&rdquo;
              </div>
            )}
          </div>
        </aside>

        {/* ─── Main chain ─── */}
        <div className="opt-main">
          {!cur ? (
            <DataState loading={companiesLoading} label="No live stock data yet — pick a ticker once the companies feed has synced." />
          ) : (
            <>
              {/* Stock header */}
              <div className="opt-h">
                <StockLogo sym={cur.s} size={36} />
                <div className="opt-h-tx">
                  <div className="opt-h-s">
                    {cur.s} <span className="opt-h-n">{cur.n}</span>
                  </div>
                  <div className="opt-h-p">
                    ${fmt(cur.p)}{" "}
                    <span className={cls(cur.c)}>{arr(cur.c)} {sign(cur.c)}</span>
                  </div>
                </div>
                {!inUniverse && (
                  <div className="opt-h-meta">
                    Curated universe only · {OPTIONS_UNIVERSE.join(", ")}
                  </div>
                )}
              </div>

              {/* Expiry tabs */}
              <div className="opt-exps">
                {expiries.length === 0 ? (
                  <span className="opt-exp" style={{ cursor: "default" }}>No live expirations</span>
                ) : expiries.map(e => (
                  <button
                    key={e}
                    className={`opt-exp${e === activeExpiry ? " on" : ""}`}
                    onClick={() => setExpiry(e)}
                  >
                    {e}
                  </button>
                ))}
              </div>

              {/* Chain table */}
              <div className="opt-chain-wrap">
                <span className="opt-cap opt-cap-c">▲ CALLS</span>
                <span className="opt-cap opt-cap-p">PUTS ▼</span>
                <div className="opt-chain-scroll">
                  <table className="opt-chain">
                    <thead>
                      <tr>
                        <th>OI</th><th>Vol</th><th>IV</th>
                        <th>Last</th><th>Bid</th><th>Ask</th>
                        <th className="opt-strike-h">Strike</th>
                        <th>Bid</th><th>Ask</th><th>Last</th>
                        <th>IV</th><th>Vol</th><th>OI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!inUniverse ? (
                        <tr><td colSpan={13} style={{ padding: 0 }}>
                          <DataState label={`Live options data is only available for a curated ${OPTIONS_UNIVERSE.length}-ticker universe. ${cur.s} isn't in it yet.`} />
                        </td></tr>
                      ) : rows.length === 0 ? (
                        <tr><td colSpan={13} style={{ padding: 0 }}>
                          <DataState loading={liveChainLoading} label={`No live options contracts synced for ${cur.s} yet.`} />
                        </td></tr>
                      ) : rows.map(r => (
                        <tr key={r.strike}>
                          <td><NotAvailable /></td>
                          <td>{r.call?.vol ?? <NotAvailable />}</td>
                          <td><NotAvailable /></td>
                          <td className="opt-last">{r.call?.last != null ? r.call.last.toFixed(2) : <NotAvailable />}</td>
                          <td><NotAvailable /></td>
                          <td><NotAvailable /></td>
                          <td className="opt-strike">{r.strike % 1 === 0 ? r.strike.toFixed(0) : r.strike.toFixed(1)}</td>
                          <td><NotAvailable /></td>
                          <td><NotAvailable /></td>
                          <td className="opt-last">{r.put?.last != null ? r.put.last.toFixed(2) : <NotAvailable />}</td>
                          <td><NotAvailable /></td>
                          <td>{r.put?.vol ?? <NotAvailable />}</td>
                          <td><NotAvailable /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 10 }}>
                {liveChain?.note ?? "Bid/ask, IV and open interest need a live quotes/greeks feed — not on the current plan. Last price and volume are real (Polygon, delayed) where synced."}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
