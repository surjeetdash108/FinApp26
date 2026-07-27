"use client";

import { useState, useMemo } from "react";
import { movers } from "../data";
import { fmt, sign, cls, arr, StockLogo } from "../utils";
import { useApiResource } from "../hooks/useApiResource";
import { OptionsChainDoc, OPTIONS_UNIVERSE } from "../types";

const EXTRA_STOCKS = [
  { s: "AAPL",  n: "Apple",          p:  189.98, c:  1.02 },
  { s: "TSLA",  n: "Tesla",          p:  171.40, c:  3.45 },
  { s: "META",  n: "Meta",           p:  415.32, c:  0.86 },
  { s: "MSFT",  n: "Microsoft",      p:  415.50, c:  0.41 },
  { s: "AMZN",  n: "Amazon",         p:  182.20, c:  2.11 },
  { s: "GOOGL", n: "Alphabet",       p:  173.20, c:  1.34 },
  { s: "AMD",   n: "Adv Micro Dev",  p:  165.20, c: -2.10 },
  { s: "MU",    n: "Micron",         p:  131.50, c:  1.75 },
  { s: "SMCI",  n: "Super Micro",    p:  812.40, c:  5.60 },
  { s: "NFLX",  n: "Netflix",        p:  645.80, c:  1.22 },
  { s: "DIS",   n: "Disney",         p:  115.40, c: -0.88 },
  { s: "BA",    n: "Boeing",         p:  185.30, c: -1.40 },
  { s: "GS",    n: "Goldman Sachs",  p:  451.20, c:  0.72 },
  { s: "JPM",   n: "JPMorgan",       p:  196.40, c:  0.55 },
  { s: "XOM",   n: "ExxonMobil",     p:  117.80, c: -0.31 },
  { s: "SOFI",  n: "SoFi Tech",      p:    8.42, c:  3.20 },
  { s: "COIN",  n: "Coinbase",       p:  232.40, c:  4.85 },
  { s: "MSTR",  n: "MicroStrategy",  p: 1580.00, c:  6.44 },
  { s: "SPY",   n: "S&P 500 ETF",    p:  525.50, c:  0.73 },
  { s: "QQQ",   n: "Nasdaq 100 ETF", p:  445.60, c:  1.02 },
  { s: "RIOT",  n: "Riot Platforms", p:   12.65, c:  2.90 },
  { s: "HOOD",  n: "Robinhood",      p:   21.85, c:  1.55 },
];

// ---- Expiry dates ----
const EXPS = [
  { label: "Jun 27", days: 2 },
  { label: "Jul 18", days: 23 },
  { label: "Aug 15", days: 51 },
  { label: "Sep 19", days: 86 },
  { label: "Dec 19", days: 177 },
];

// ---- Strike increment by price ----
function optNice(p: number): number {
  return p < 25 ? 1 : p < 60 ? 2.5 : p < 150 ? 5 : p < 400 ? 10 : p < 1000 ? 25 : 50;
}

// ---- Deterministic pseudo-random (seeded) ----
function optRand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

interface OptionSide {
  last: number; bid: number; ask: number;
  iv: number; vol: number; oi: number; itm: boolean;
}
interface OptionRow {
  k: number; atm: boolean;
  call: OptionSide; put: OptionSide;
}

function buildChain(sym: string, p: number, ei: number): OptionRow[] {
  const exp = EXPS[ei] ?? EXPS[0];
  const T   = Math.max(exp.days, 1) / 365;
  const ivb = 0.30;
  const step = optNice(p);
  const atmK = Math.round(p / step) * step;
  const sb   = sym.charCodeAt(0) * 7 + exp.days;
  const sig  = p * ivb * Math.sqrt(T) + 1e-6;
  const rows: OptionRow[] = [];

  for (let i = -15; i <= 14; i++) {
    const k = +(atmK + i * step).toFixed(2);
    if (k <= 0) continue;
    const dist = Math.abs(k - p) / p;
    const iv   = ivb * (1 + dist * 1.3) * (0.92 + 0.16 * optRand(sb + k));
    const d    = (k - p) / sig;
    const tv   = sig * Math.exp(-(d * d) / 2) * 0.55;
    const cL   = Math.max(0, p - k) + tv;
    const pL   = Math.max(0, k - p) + tv;
    const volC = Math.round(40 + optRand(sb + k + 1) * 5000 * Math.exp(-dist * 7));
    const volP = Math.round(40 + optRand(sb + k + 2) * 5000 * Math.exp(-dist * 7));
    const oiC  = Math.round(150 + optRand(sb + k + 3) * 22000 * Math.exp(-dist * 4));
    const oiP  = Math.round(150 + optRand(sb + k + 4) * 22000 * Math.exp(-dist * 4));
    rows.push({
      k, atm: Math.abs(k - atmK) < 1e-6,
      call: { last: cL, bid: cL * 0.985, ask: cL * 1.015, iv, vol: volC, oi: oiC, itm: k < p },
      put:  { last: pL, bid: pL * 0.985, ask: pL * 1.015, iv, vol: volP, oi: oiP, itm: k > p },
    });
  }
  return rows;
}

function f2(x: number) { return (Math.round(x * 100) / 100).toFixed(2); }
function fK(k: number) { return k % 1 === 0 ? k.toFixed(0) : k.toFixed(1); }
function fOI(x: number) { return fmt(x, 0); }

export function OptionsScreen() {
  const stockList = useMemo(() => {
    const moverSyms = new Set(movers.map(m => m.ticker));
    const base = movers.map(m => ({ s: m.ticker, n: m.name, p: m.price, c: m.pctChange }));
    const extra = EXTRA_STOCKS.filter(e => !moverSyms.has(e.s));
    return [...base, ...extra].sort((a, b) => a.s < b.s ? -1 : 1);
  }, []);

  const [selSym, setSelSym] = useState(stockList[0]?.s ?? "NVDA");
  const [expIdx, setExpIdx] = useState(0);
  const [query,  setQuery]  = useState("");
  const { data: liveChain } = useApiResource<OptionsChainDoc>(
    OPTIONS_UNIVERSE.includes(selSym) ? `/live/options-chain?ticker=${selSym}` : null,
  );

  const cur     = stockList.find(s => s.s === selSym) ?? stockList[0];
  const rows    = useMemo(() => buildChain(cur.s, cur.p, expIdx), [cur.s, cur.p, expIdx]);
  const exp     = EXPS[expIdx];
  const atmK    = Math.round(cur.p / optNice(cur.p)) * optNice(cur.p);
  const filtered = query
    ? stockList.filter(s => (s.s + " " + s.n).toLowerCase().includes(query.toLowerCase()))
    : stockList;

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
                className={`opt-li${o.s === selSym ? " sel" : ""}`}
                onClick={() => { setSelSym(o.s); setExpIdx(0); }}
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
            <div className="opt-h-meta">
              Expiry <b style={{ color: "var(--text-hi)" }}>{exp.label}</b> · {exp.days}d · ATM {atmK}
            </div>
          </div>

          {/* Expiry tabs */}
          <div className="opt-exps">
            {EXPS.map((x, i) => (
              <button
                key={x.label}
                className={`opt-exp${i === expIdx ? " on" : ""}`}
                onClick={() => setExpIdx(i)}
              >
                {x.label}<span>{x.days}d</span>
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
                  {rows.map(r => (
                    <tr key={r.k} className={r.atm ? "opt-atm" : ""}>
                      <td className={r.call.itm ? "opt-itm" : ""}>{fOI(r.call.oi)}</td>
                      <td>{fOI(r.call.vol)}</td>
                      <td>{(r.call.iv * 100).toFixed(0)}%</td>
                      <td className="opt-last">{f2(r.call.last)}</td>
                      <td>{f2(r.call.bid)}</td>
                      <td>{f2(r.call.ask)}</td>
                      <td className="opt-strike">{fK(r.k)}</td>
                      <td>{f2(r.put.bid)}</td>
                      <td>{f2(r.put.ask)}</td>
                      <td className="opt-last">{f2(r.put.last)}</td>
                      <td>{(r.put.iv * 100).toFixed(0)}%</td>
                      <td>{fOI(r.put.vol)}</td>
                      <td className={r.put.itm ? "opt-itm" : ""}>{fOI(r.put.oi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 10 }}>
            Simulated data for informational purposes only — not investment advice. OI &amp; volume are illustrative.
          </div>

          {/* ── Live options reference (Polygon) — additive, doesn't touch the simulated chain above ── */}
          {liveChain && liveChain.contracts.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="card-h">
                <h3>Live Options Reference · {cur.s}</h3>
                <span className="pill ai" style={{ fontSize: ".68rem" }}>live · Polygon (delayed)</span>
              </div>
              <div style={{ padding: "0 14px 6px", fontSize: ".7rem", color: "var(--text-dim-solid)" }}>
                {liveChain.note}
              </div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Type</th><th className="num">Strike</th><th>Expiration</th>
                      <th className="num">Last close</th><th className="num">Volume</th><th>As of</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...liveChain.contracts]
                      .sort((a, b) => a.expirationDate.localeCompare(b.expirationDate) || a.strike - b.strike)
                      .map(c => (
                        <tr key={c.contractTicker}>
                          <td className={c.contractType === "call" ? "up" : "down"}>{c.contractType}</td>
                          <td className="num">{c.strike}</td>
                          <td>{c.expirationDate}</td>
                          <td className="num">{c.lastClose != null ? `$${c.lastClose.toFixed(2)}` : "—"}</td>
                          <td className="num">{c.lastVolume ?? "—"}</td>
                          <td style={{ fontSize: ".76rem", color: "var(--text-dim-solid)" }}>{c.lastBarDate ?? "—"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
