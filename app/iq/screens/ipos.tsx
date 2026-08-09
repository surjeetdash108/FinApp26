"use client";

import { useState } from "react";
import { useIQActions } from "../shell";
import { cls, sign, StockLogo, DataState } from "../utils";
import { useApiList } from "../hooks/useApiList";
import type { IpoEventDoc, IpoPipelineDoc } from "../types";

function formatIpoPrice(low: number | null, high: number | null): string {
  if (low == null && high == null) return "—";
  if (low != null && high != null && low !== high) return `$${low.toFixed(2)}–$${high.toFixed(2)}`;
  return `$${(low ?? high)!.toFixed(2)}`;
}

interface IpoRow {
  s: string; n: string; date: string;
  offer: number | null;
  /** Aftermarket pricing computed by the ipos job from Polygon bars: current
   *  price, day-1 pop %, and return-since-offer %. Null when the name hasn't
   *  listed yet or Polygon has no series for it. */
  cur: number | null; day1: number | null; since: number | null;
  sec: string; live?: boolean;
}

const SECTOR_OPTIONS = [
  "All", "Consumer", "Data / AI", "Fintech", "Healthcare",
  "Internet", "Media", "Retail", "Semis", "Software",
];

export function IPOsScreen() {
  const { openStock } = useIQActions();
  const [sector, setSector] = useState("All");
  const [tab, setTab] = useState<"recent" | "pipeline" | "calendar">("recent");
  const { data: liveIpos } = useApiList<IpoEventDoc>("/market-data/ipos");
  const { data: pipeline } = useApiList<IpoPipelineDoc>("/market-data/ipo-pipeline");
  const pipelineSorted = [...pipeline].sort((a, b) => b.dateFiled.localeCompare(a.dateFiled));
  const liveIposSorted = [...liveIpos].sort((a, b) => b.date.localeCompare(a.date));

  // Aftermarket performance (current price, day-1 pop %, return since offer) is
  // computed by the backend ipos job from Polygon daily bars for already-listed
  // names; it's null only when the name hasn't listed yet or has no series.
  const liveRows: IpoRow[] = liveIposSorted.map(e => ({
    s: e.symbol ?? "—",
    n: e.name,
    date: e.date,
    offer: e.offerPrice ?? (e.priceLow != null && e.priceHigh != null ? (e.priceLow + e.priceHigh) / 2 : e.priceLow ?? e.priceHigh),
    cur: e.currentPrice,
    day1: e.day1PopPct,
    since: e.returnSinceIpoPct,
    sec: e.exchange ?? "—",
    live: true,
  }));
  const filtered = liveRows.filter(r => sector === "All" || r.sec === sector);

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
      <div className="page-head">
        <div className="tabs">
          <button className={`tab${tab === "recent" ? " on" : ""}`} onClick={() => setTab("recent")}>Recent IPO performance</button>
          <button className={`tab${tab === "pipeline" ? " on" : ""}`} onClick={() => setTab("pipeline")}>Upcoming pipeline</button>
          <button className={`tab${tab === "calendar" ? " on" : ""}`} onClick={() => setTab("calendar")}>Live IPO Calendar</button>
        </div>
      </div>

      {tab === "recent" && (<>
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
          {filtered.length} of {liveRows.length} shown
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
                // Prefer the backend's return-since-offer; fall back to computing
                // it from cur/offer. Null → "—" when there's no aftermarket price.
                  const ret = r.since ?? (r.cur != null && r.offer != null && r.offer !== 0 ? (r.cur - r.offer) / r.offer * 100 : null);
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
      </>)}

      {tab === "pipeline" && (
      <div className="card">
        <div className="card-h">
          <h3>Upcoming pipeline</h3>
          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>SEC-EDGAR registration filings (S-1 / 424B)</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Company</th>
                <th>Form</th>
                <th>Filed</th>
                <th>Filing</th>
              </tr>
            </thead>
            <tbody>
              {pipelineSorted.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 16 }}>
                    <DataState label="No recent S-1/424B registrations synced yet (run the edgar-ipo-pipeline job). Rumored/pre-filing names would still need a filings-intelligence feed." />
                  </td>
                </tr>
              ) : pipelineSorted.slice(0, 30).map(p => (
                <tr key={p.id}>
                  <td><b style={{ color: "var(--text-hi)" }}>{p.companyName}</b></td>
                  <td><span className="pill amc">{p.form}</span></td>
                  <td>{p.dateFiled}</td>
                  <td>
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="link" style={{ fontSize: ".72rem" }}>
                      SEC filing →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", padding: "8px 12px 0" }}>
          Raw registration pipeline from EDGAR — includes shells, SPACs and amendments, not a curated IPO list.
        </p>
      </div>
      )}

      {/* ── Live IPO calendar (Polygon) ── */}
      {tab === "calendar" && liveIposSorted.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <h3>Live IPO Calendar</h3>
            <span className="pill ai" style={{ fontSize: ".68rem" }}>live · Polygon</span>
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
