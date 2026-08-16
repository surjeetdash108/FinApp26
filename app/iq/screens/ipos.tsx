"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { cls, sign, StockLogo, DataState, VendorTag } from "../utils";

// Same embedded stock detail the Movers drawer uses.
const StockScreenEmbed = dynamic<{ initialSym?: string }>(
  () => import("./stock").then(m => ({ default: m.StockScreen })),
  { ssr: false, loading: () => <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim-solid)" }}>Loading…</div> },
);
import { useApiList } from "../hooks/useApiList";
import type { IpoEventDoc, IpoPipelineDoc, CompanyDoc } from "../types";

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
  /** Shares offered and total deal size (shares × offer), from the ipos job. */
  shares: number | null; deal: number | null;
  sec: string; live?: boolean;
}

/** Compact magnitude label (12.5M, 1.2B) for share counts and deal sizes. */
function compactNum(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${n}`;
}

const SECTOR_OPTIONS = [
  "All", "Consumer", "Data / AI", "Fintech", "Healthcare",
  "Internet", "Media", "Retail", "Semis", "Software",
];

export function IPOsScreen() {
  const [selectedSym, setSelectedSym] = useState<string | null>(null);
  const [sector, setSector] = useState("All");
  const [tab, setTab] = useState<"recent" | "pipeline" | "calendar">("recent");
  const [dateSort, setDateSort] = useState<"desc" | "asc">("desc"); // Recent-IPO date order
  const { data: liveIpos } = useApiList<IpoEventDoc>("/market-data/ipos");
  const { data: pipeline } = useApiList<IpoPipelineDoc>("/market-data/ipo-pipeline");
  // IPO events carry no sector, so join the live companies collection for each
  // listed ticker's sector — that's what the sector filter matches on.
  const { data: companies } = useApiList<CompanyDoc>("/market-data/companies");
  const sectorByTicker = new Map(companies.map(c => [c.ticker, c.sector]));
  const sectorOf = (symbol: string | null | undefined): string =>
    (symbol ? sectorByTicker.get(symbol) : null) ?? "—";
  // Raw EDGAR registrations repeat the same filer many times (e.g. JPMorgan
  // Chase files hundreds of structured-note 424Bs). Keep each company once — its
  // most recent filing — so the pipeline reads as distinct names, not spam.
  const pipelineSorted = (() => {
    const sorted = [...pipeline].sort((a, b) => b.dateFiled.localeCompare(a.dateFiled));
    const seen = new Set<string>();
    return sorted.filter(p => {
      const k = (p.companyName || "").trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  })();
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
    shares: e.numberOfShares,
    deal: e.totalSharesValue,
    sec: sectorOf(e.symbol),
    live: true,
  }));
  const filtered = liveRows
    .filter(r => sector === "All" || r.sec === sector)
    .sort((a, b) => dateSort === "desc" ? (b.date ?? "").localeCompare(a.date ?? "") : (a.date ?? "").localeCompare(b.date ?? ""));
  // Calendar tab shares the same sector filter (also ticker-based).
  const filteredCalendar = liveIposSorted.filter(e => sector === "All" || sectorOf(e.symbol) === sector);

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

      {/* ── Sector filter — shared across all tabs (matches the listed ticker's
          sector; the pre-IPO pipeline has no ticker, so it isn't sector-filtered). ── */}
      <div className="fbar" style={{ marginBottom: 10, gap: 10 }}>
        <span style={{ fontSize: ".78rem", color: "var(--text-dim-solid)", fontWeight: 600, alignSelf: "center" }}>Sector</span>
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
          {tab === "recent" ? `${filtered.length} of ${liveRows.length} shown`
            : tab === "calendar" ? `${filteredCalendar.length} of ${liveIposSorted.length} shown`
            : "sector n/a for pre-IPO filings"}
        </span>
      </div>

      {tab === "recent" && (<>
      {/* Stats strip */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: ".68rem", color: "var(--text-dim-solid)" }}>Aftermarket performance</span><VendorTag v="polygon" />
      </div>
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


      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-h">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Recent IPO performance</h3><VendorTag v="polygon" /></div>
          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>click any row to open stock detail</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Company</th>
                <th>Sector</th>
                <th style={{ cursor: "pointer", userSelect: "none" }}
                  onClick={() => setDateSort(s => s === "desc" ? "asc" : "desc")}
                  title="Sort by IPO date">
                  IPO date <span style={{ color: "var(--brand-2)", fontSize: ".7rem" }}>{dateSort === "desc" ? "▼" : "▲"}</span>
                </th>
                <th className="num">Shares</th>
                <th className="num">Deal size</th>
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
                  <tr key={r.s} onClick={() => setSelectedSym(r.s && r.s !== "—" ? r.s : "")} style={{ cursor: "pointer" }}>
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
                    <td className="num">{r.shares != null ? compactNum(r.shares) : "—"}</td>
                    <td className="num">{r.deal != null ? `$${compactNum(r.deal)}` : "—"}</td>
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
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Upcoming pipeline</h3><VendorTag v="sec" /></div>
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
      {tab === "calendar" && filteredCalendar.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Live IPO Calendar</h3><VendorTag v="polygon" /></div>
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
                {filteredCalendar.slice(0, 25).map(e => (
                  <tr key={e.id} onClick={() => setSelectedSym(e.symbol || "")} style={{ cursor: "pointer" }}>
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

      {/* Slide-in stock detail (same as Movers). Empty string = clicked a row
          with no listed ticker → show a not-available message. */}
      {selectedSym !== null && (
        <>
          <div className="scrim" onClick={() => setSelectedSym(null)} />
          <div className="stock-side-drawer">
            <div className="drawer-h" style={{ paddingTop: 14, paddingBottom: 14 }}>
              {selectedSym && <StockLogo sym={selectedSym} size={32} />}
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)" }}>
                  {selectedSym ? `${selectedSym} · Stock Details` : "IPO details"}
                </div>
                <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
                  Full analysis · chart · technicals · peers
                </div>
              </div>
              <button className="closebtn" onClick={() => setSelectedSym(null)}>✕</button>
            </div>
            <div className="drawer-b">
              {selectedSym
                ? <StockScreenEmbed initialSym={selectedSym} />
                : <DataState label="Stock data isn't available for this IPO yet — it hasn't started trading or isn't in the synced universe." />}
            </div>
          </div>
        </>
      )}
    </>
  );
}
