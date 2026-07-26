"use client";

import { useState } from "react";
import { useIQActions } from "../shell";
import { cls, sign, StockLogo } from "../utils";
import { useApiList } from "../hooks/useApiList";
import type { IpoEventDoc } from "../types";

function formatIpoPrice(low: number | null, high: number | null): string {
  if (low == null && high == null) return "—";
  if (low != null && high != null && low !== high) return `$${low.toFixed(2)}–$${high.toFixed(2)}`;
  return `$${(low ?? high)!.toFixed(2)}`;
}

interface IpoRow {
  s: string; n: string; date: string;
  offer: number | null;
  /** Current price and day-1 return require aftermarket pricing, which the
   *  ipos feed does not carry — null for every live row. */
  cur: number | null; day1: number | null;
  sec: string; live?: boolean;
}

const RECENT_IPOS: IpoRow[] = [
  { s: "RDDT", n: "Reddit",        date: "Mar 21 '24", offer: 34,   cur: 52.40,  day1: 48,  sec: "Internet"  },
  { s: "ALAB", n: "Astera Labs",   date: "Mar 20 '24", offer: 36,   cur: 71.20,  day1: 72,  sec: "Semis"     },
  { s: "ARM",  n: "Arm Holdings",  date: "Sep 14 '23", offer: 51,   cur: 118.30, day1: 25,  sec: "Semis"     },
  { s: "CART", n: "Instacart",     date: "Sep 19 '23", offer: 30,   cur: 38.60,  day1: 12,  sec: "Internet"  },
  { s: "RBRK", n: "Rubrik",        date: "Apr 25 '24", offer: 32,   cur: 38.90,  day1: 16,  sec: "Software"  },
  { s: "BIRK", n: "Birkenstock",   date: "Oct 11 '23", offer: 46,   cur: 52.80,  day1: -12, sec: "Consumer"  },
  { s: "KVYO", n: "Klaviyo",       date: "Sep 20 '23", offer: 30,   cur: 26.10,  day1: 9,   sec: "Software"  },
  { s: "CAVA", n: "CAVA Group",    date: "Jun 15 '23", offer: 22,   cur: 84.40,  day1: 99,  sec: "Consumer"  },
];

const PIPELINE = [
  { s: "CHYM", n: "Chime",         expected: "Q3 '25 (expected)",  sec: "Fintech"   },
  { s: "TTAN", n: "ServiceTitan",  expected: "Filed S-1",          sec: "Software"  },
  { s: "SKMS", n: "Skims",         expected: "Rumored 2025",       sec: "Consumer"  },
  { s: "DBRX", n: "Databricks",    expected: "2025 (expected)",    sec: "Data / AI" },
];

const SECTOR_OPTIONS = [
  "All", "Consumer", "Data / AI", "Fintech", "Healthcare",
  "Internet", "Media", "Retail", "Semis", "Software",
];

export function IPOsScreen() {
  const { openStock } = useIQActions();
  const [sector, setSector] = useState("All");
  const { data: liveIpos } = useApiList<IpoEventDoc>("/market-data/ipos");
  const liveIposSorted = [...liveIpos].sort((a, b) => b.date.localeCompare(a.date));

  // Live ipos docs carry the offering, not its aftermarket performance, so
  // cur/day1 stay null and the performance tiles below report "—" rather than
  // computing a return from a fabricated current price.
  const liveRows: IpoRow[] = liveIposSorted.map(e => ({
    s: e.symbol ?? "—",
    n: e.name,
    date: e.date,
    offer: e.priceLow != null && e.priceHigh != null ? (e.priceLow + e.priceHigh) / 2 : e.priceLow ?? e.priceHigh,
    cur: null,
    day1: null,
    sec: e.exchange ?? "—",
    live: true,
  }));
  const rows = liveRows.length > 0 ? liveRows : RECENT_IPOS;
  const usingLive = liveRows.length > 0;
  const filtered = rows.filter(r => sector === "All" || r.sec === sector);

  // Only rows with BOTH an offer price and a current price can produce a return.
  const perf = filtered.filter(
    (r): r is IpoRow & { cur: number; offer: number } => r.cur != null && r.offer != null && r.offer !== 0,
  );
  const winners = perf.filter(r => r.cur > r.offer).length;
  const returns = perf.map(r => (r.cur - r.offer) / r.offer * 100).sort((a, b) => a - b);
  const median  = returns.length ? returns[Math.floor(returns.length / 2)] : null;
  const best    = perf.length > 0 ? perf.reduce((a, b) => (b.cur - b.offer) / b.offer > (a.cur - a.offer) / a.offer ? b : a) : null;
  const bestRet = best ? ((best.cur - best.offer) / best.offer * 100).toFixed(0) : "—";

  return (
    <>
      {/* Stats strip */}
      <div className="dash" style={{ marginBottom: 14 }}>
        <div className="col-4">
          <div className="card">
            <div className="card-b" style={{ textAlign: "center", padding: "18px" }}>
              <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>Trading above offer</div>
              <div className="mono up" style={{ fontSize: "1.6rem", fontWeight: 700 }}>
                {perf.length ? `${winners}/${perf.length}` : "—"}
              </div>
            </div>
          </div>
        </div>
        <div className="col-4">
          <div className="card">
            <div className="card-b" style={{ textAlign: "center", padding: "18px" }}>
              <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>Best performer</div>
              <div className="mono up" style={{ fontSize: "1.6rem", fontWeight: 700 }}>
                {best ? `${best.s} +${bestRet}%` : "—"}
              </div>
            </div>
          </div>
        </div>
        <div className="col-4">
          <div className="card">
            <div className="card-b" style={{ textAlign: "center", padding: "18px" }}>
              <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>Median since IPO</div>
              <div className={`mono ${median != null ? cls(median) : ""}`} style={{ fontSize: "1.6rem", fontWeight: 700 }}>
                {median != null ? sign(median) : "—"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Sector filter ── */}
      <div className="fbar" style={{ marginBottom: 10, gap: 10 }}>
        <span style={{ fontSize: ".78rem", color: "var(--text-dim-solid)", fontWeight: 600, alignSelf: "center" }}>
          Sector
        </span>
        <select
          className="iq-select"
          value={sector}
          onChange={e => setSector(e.target.value)}
          style={{ width: "auto", minWidth: 160, padding: "5px 10px", fontSize: ".82rem" }}
        >
          {SECTOR_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="spacer" />
        <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", alignSelf: "center" }}>
          {filtered.length} of {rows.length} shown{usingLive ? "" : " · sample data"}
        </span>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-h">
          <h3>Recent IPO performance</h3>
          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>click any row to open stock detail</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Company</th>
                <th>Sector</th>
                <th>IPO date</th>
                <th className="num">Offer</th>
                <th className="num">Current</th>
                <th className="num">Day 1</th>
                <th className="num">Since IPO</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 16, color: "var(--text-dim-solid)" }}>No IPOs match your filter.</td>
                </tr>
              ) : filtered.map(r => {
                // null when the feed has no aftermarket price — rendered as "—" below.
                  const ret = r.cur != null && r.offer != null && r.offer !== 0 ? (r.cur - r.offer) / r.offer * 100 : null;
                return (
                  <tr key={r.s} onClick={() => openStock(r.s)} style={{ cursor: "pointer" }}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <StockLogo sym={r.s} size={26} />
                        <div className="co">
                          <span className="s">{r.s}</span>
                          <span className="n">{r.n}</span>
                        </div>
                      </div>
                    </td>
                    <td>{r.sec}</td>
                    <td>{r.date}</td>
                    <td className="num">{r.offer != null ? `$${r.offer.toFixed(2)}` : "—"}</td>
                    <td className="num">{r.cur != null ? `$${r.cur.toFixed(2)}` : "—"}</td>
                    <td className={`num ${r.day1 != null ? cls(r.day1) : ""}`}>{r.day1 != null ? sign(r.day1) : "—"}</td>
                    <td className={`num ${ret != null ? cls(ret) : ""}`}>
                      <b>{ret != null ? sign(ret) : "—"}</b>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Upcoming pipeline</h3>
          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>expected new issues</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Company</th>
                <th>Symbol</th>
                <th>Expected</th>
                <th>Sector</th>
              </tr>
            </thead>
            <tbody>
              {PIPELINE.map(p => (
                <tr key={p.s}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <StockLogo sym={p.s} size={26} />
                      <b style={{ color: "var(--text-hi)" }}>{p.n}</b>
                    </div>
                  </td>
                  <td style={{ fontFamily: "var(--f-mono)", fontWeight: 700, color: "var(--text-hi)" }}>{p.s}</td>
                  <td>{p.expected}</td>
                  <td>{p.sec}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Live IPO calendar (Finnhub) — additive, doesn't touch the tables above ── */}
      {liveIposSorted.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <h3>Live IPO Calendar</h3>
            <span className="pill ai" style={{ fontSize: ".68rem" }}>live · Finnhub</span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Symbol</th>
                  <th>Date</th>
                  <th>Exchange</th>
                  <th className="num">Price</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {liveIposSorted.slice(0, 25).map(e => (
                  <tr key={e.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {e.symbol && <StockLogo sym={e.symbol} size={22} />}
                        <b style={{ color: "var(--text-hi)" }}>{e.name}</b>
                      </div>
                    </td>
                    <td style={{ fontFamily: "var(--f-mono)", fontWeight: 700, color: "var(--text-hi)" }}>
                      {e.symbol || "—"}
                    </td>
                    <td>{e.date}</td>
                    <td>{e.exchange || "—"}</td>
                    <td className="num">{formatIpoPrice(e.priceLow, e.priceHigh)}</td>
                    <td>
                      <span className={`pill ${e.status === "priced" ? "up" : e.status === "withdrawn" ? "down" : "amc"}`}>
                        {e.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", marginTop: 10 }}>
        Returns measured from IPO offer price. Source (production): SEC EDGAR + Polygon.io. Informational only — not investment advice.
      </p>
    </>
  );
}
