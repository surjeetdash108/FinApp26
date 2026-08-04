"use client";

import { useEffect, useState } from "react";
import { useIQActions } from "../shell";
import { StockLogo } from "../utils";
import { apiGet } from "../backend";
import { useApiList } from "../hooks/useApiList";
import type { InsiderTxDoc } from "../types";

// ---- types ----
type InsFilter   = "All" | "Buys" | "Sells" | "10% owners" | "Clusters";
type InstFilter  = "All" | "Net buying" | "Net selling";
type InsSort     = "value" | "date";
type InstSort    = "owners" | "move";
type DrawerState = { kind: "insider"; sym: string } | { kind: "inst"; sym: string; sn: string } | null;

// ---- insider feed ----
interface Tx { s: string; role: string; det: string; dir: "buy" | "sell"; val: string; date: string; live?: boolean; }

const BUYERS: Tx[] = [
  { s:"AMR",  role:"Director",                                det:"bought 10,000 sh @ $199.80–$201.64",  dir:"buy",  val:"2.0M",   date:"6/12"       },
  { s:"ARTV", role:"10% owner (RA Capital)",                  det:"bought 531,326 sh",                    dir:"buy",  val:"4.6M",   date:"6/12–6/15"  },
  { s:"CXT",  role:"CEO & CFO",                               det:"bought 27,550 sh combined",            dir:"buy",  val:"1.2M",   date:"6/12"       },
  { s:"FISV", role:"Chief Admin/Legal Officer + 3 Directors", det:"bought 21,761 sh combined",            dir:"buy",  val:"1.1M",   date:"6/16"       },
  { s:"FUN",  role:"Director",                                det:"bought 250,000 sh @ $23.41–$23.69",    dir:"buy",  val:"5.88M",  date:"6/12–6/15"  },
  { s:"GOTU", role:"CEO",                                     det:"bought 73,801 sh",                     dir:"buy",  val:"168K",   date:"6/16"       },
  { s:"LULU", role:"Director",                                det:"bought 4,275 sh @ ~$117.05",           dir:"buy",  val:"500K",   date:"6/15"       },
  { s:"MH",   role:"President & CEO",                         det:"bought 22,421 sh @ $11.12–$11.15",     dir:"buy",  val:"249K",   date:"6/15"       },
  { s:"REI",  role:"Chairman & CEO + CFO",                    det:"bought 281,000 sh",                    dir:"buy",  val:"338K",   date:"6/15"       },
  { s:"SOFI", role:"CEO",                                     det:"bought 13,888 sh @ $18.03–$18.07",     dir:"buy",  val:"251K",   date:"6/16"       },
  { s:"VRA",  role:"CEO + 1 Director",                        det:"bought 53,827 sh",                     dir:"buy",  val:"205K",   date:"6/12"       },
  { s:"WHF",  role:"CEO",                                     det:"bought 15,000 sh @ $6.41",             dir:"buy",  val:"96K",    date:"6/15"       },
];
const SELLERS: Tx[] = [
  { s:"AFL",  role:"10% owner (Japan Post)",                  det:"sold 28,800 sh @ $116.77–$118.11",     dir:"sell", val:"3.4M",   date:"6/15"       },
  { s:"BLTE", role:"COO",                                     det:"sold 10,000 ADS",                      dir:"sell", val:"1.4M",   date:"6/16"       },
  { s:"BSBR", role:"CEO",                                     det:"sold 553,702 units",                   dir:"sell", val:"3.0M",   date:"6/16"       },
  { s:"DBD",  role:"10% owner (Millstreet Capital)",          det:"sold 161,440 sh",                      dir:"sell", val:"13.26M", date:"6/12–6/15"  },
  { s:"JOE",  role:"10% owner (Bruce Berkowitz / Fairholme)", det:"sold 184,700 sh",                      dir:"sell", val:"12.1M",  date:"6/12–6/16"  },
  { s:"RILY", role:"Chairman & Co-CEO",                       det:"sold 195,492 sh",                      dir:"sell", val:"1.8M",   date:"6/16"       },
];
const MOCK_FEED: Tx[] = [...BUYERS, ...SELLERS];

// ---- institutional pool ----
const INST_POOL = [
  { s:"NVDA",  sn:"NVIDIA",        mc:2910 }, { s:"AVGO",  sn:"Broadcom",     mc:648  },
  { s:"AMD",   sn:"Adv Micro Dev", mc:266  }, { s:"MU",    sn:"Micron",       mc:152  },
  { s:"INTC",  sn:"Intel",         mc:128  }, { s:"SMCI",  sn:"Super Micro",  mc:48   },
  { s:"MSFT",  sn:"Microsoft",     mc:3100 }, { s:"CRM",   sn:"Salesforce",   mc:281  },
  { s:"ORCL",  sn:"Oracle",        mc:380  }, { s:"NOW",   sn:"ServiceNow",   mc:140  },
  { s:"ADBE",  sn:"Adobe",         mc:240  }, { s:"PLTR",  sn:"Palantir",     mc:52   },
  { s:"GOOGL", sn:"Alphabet",      mc:2100 }, { s:"META",  sn:"Meta",         mc:1060 },
  { s:"NFLX",  sn:"Netflix",       mc:260  }, { s:"AAPL",  sn:"Apple",        mc:3000 },
  { s:"DELL",  sn:"Dell Tech",     mc:90   }, { s:"AMZN",  sn:"Amazon",       mc:1900 },
  { s:"HD",    sn:"Home Depot",    mc:340  }, { s:"WBA",   sn:"Walgreens",    mc:14   },
  { s:"TSLA",  sn:"Tesla",         mc:540  }, { s:"COIN",  sn:"Coinbase",     mc:60   },
  { s:"UBER",  sn:"Uber",          mc:130  }, { s:"ZIM",   sn:"ZIM Shipping", mc:3    },
];

// ---- AI / cross-fund data ----
const AI_SECTIONS = [
  { h:"What changed",  p:"Berkshire <b>trimmed its Apple stake by ~13%</b> — the single biggest dollar move of the quarter — while sharply building cash. Net posture turned more defensive." },
  { h:"Biggest buys",  p:"Added to <b>Chubb (CB)</b>, the previously-secret position now disclosed at ~$6.7B, and topped up <b>Occidental</b>." },
  { h:"Biggest exits", p:"Fully exited <b>HP Inc</b> and <b>Paramount</b>, booking a loss on the latter." },
  { h:"Theme shift",   p:"Rotation <b>away from mega-cap tech concentration</b> toward insurance and energy — consistent with valuation caution." },
  { h:"Concentration", p:"Slightly <b>less concentrated</b>: top-5 weight fell from 79% to 75% after the Apple trim." },
  { h:"Your overlap",  p:"You both hold <b>AAPL</b>. Berkshire reducing while you hold a large high-conviction position — worth noting the divergence." },
];
const CROSS_OWN  = [{ s:"MSFT", n:4 }, { s:"AMZN", n:3 }, { s:"GOOGL", n:3 }];
const CROSS_SOLD = [{ s:"AAPL", n:3 }, { s:"DIS",  n:3 }];
const CROSS_LONE = [{ s:"BABA", fund:"Scion" }, { s:"CMG", fund:"Pershing" }];

// ---- deterministic helpers (mirror HTML) ----
function instSeed(sym: string): number {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = ((h * 31 + sym.charCodeAt(i)) >>> 0);
  return h;
}
function instMeta(sym: string, mc: number) {
  const seed   = instSeed(sym);
  const owners = Math.round(280 + mc / 2.2 + (seed % 520));
  const ownPct = Math.max(38, Math.min(94, Math.round(50 + (seed % 42))));
  const lastQ  = +((((seed >> 9) % 80) / 10) - 3.5).toFixed(1);
  const buyPct = Math.max(22, Math.min(80, Math.round(50 + lastQ * 4)));
  return { owners, ownPct, lastQ, buyPct, add: lastQ >= 0 };
}
const INST_DATA = INST_POOL.map(({ s, sn, mc }) => ({ s, sn, ...instMeta(s, mc) }));
const INST_SN: Record<string, string> = Object.fromEntries(INST_DATA.map(x => [x.s, x.sn]));

// ---- insider feed helpers ----
function isCluster(x: Tx) { return /\+|combined|Directors|and one/i.test(`${x.role} ${x.det}`); }
function insValM(v: string): number {
  const n = parseFloat(v);
  return /M/.test(v) ? n : /K/.test(v) ? n * 0.001 : n * 0.000001;
}
function insDate(d: string): number {
  const last = d.split("–").pop() ?? d;
  const p    = last.split("/");
  return (+p[0] || 0) * 100 + (+p[1] || 0);
}

// ---- drawer data helpers (mirror HTML) ----
function insiderHistory(sym: string) {
  const roles = ["CEO","CFO","Director","10% owner","President","COO"];
  const dates = ["Q1 2024","Q4 2023","Q3 2023","Q2 2023"];
  const h = Math.abs(sym.charCodeAt(0) * 5 + (sym.charCodeAt(1) || 2) * 3);
  return dates.map((d, i) => ({
    role: roles[(h + i) % roles.length],
    dir:  ((h + i) % 3 !== 0 ? "buy" : "sell") as "buy" | "sell",
    sh:   ((h + i * 7) % 90 + 10) * 1000,
    val:  `${((h + i * 3) % 9 + 1)}.${(h + i) % 9}M`,
    date: d,
  }));
}
// Live 13F positions are keyed by CUSIP + issuer name, not ticker — there is no
// live way to answer "which tracked funds hold ticker X" without a CUSIP→ticker
// map, which the backend doesn't provide. Accepted gap: the drawer's existing
// "No tracked 13F funds hold…" empty state covers this.
function instHolders(_sym: string): { fund: string; mgr: string; pct: number; act: string }[] {
  return [];
}
function mutualFunds(sym: string) {
  const h     = instSeed(sym);
  const names = ["Vanguard Total Stock Mkt","Fidelity Contrafund","BlackRock iShares Core S&P 500","T. Rowe Price Growth","Capital Group AMCAP"];
  const start = h % names.length;
  return Array.from({ length: 5 }, (_, i) => {
    const tr: number[] = [];
    let base = 100;
    for (let j = 0; j < 4; j++) { base *= (1 + (((h >> (i * 2 + j)) % 60) / 1000) - 0.024); tr.push(base); }
    return { name: names[(start + i) % names.length], pct: +((((h >> (i*2)) % 320) / 100) + 0.4).toFixed(1), q: +((((h >> (i*4)) % 70) / 10) - 3).toFixed(1), tr };
  });
}
function instQuarters(sym: string) {
  const h = instSeed(sym);
  return ["Q3 '24","Q4 '24","Q1 '25","Q2 '25"].map((q, i) => ({ q, chg: +((((h >> (i*3)) % 80) / 10) - 3.5).toFixed(1) }));
}

// ---- UI helpers ----
function MiniBar({ tr }: { tr: number[] }) {
  const mn = Math.min(...tr), mx = Math.max(...tr), rng = (mx - mn) || 1;
  return (
    <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 2, height: 18 }}>
      {tr.map((v, i) => {
        const hh = Math.round(4 + (v - mn) / rng * 14);
        const up = i === 0 || v >= tr[i - 1];
        return <i key={i} style={{ width: 4, height: hh, borderRadius: 1, display: "inline-block", flexShrink: 0, background: up ? "var(--up)" : "var(--down)" }} />;
      })}
    </span>
  );
}
function QBar({ chg }: { chg: number }) {
  const pct = Math.min(100, Math.abs(chg) * 18);
  return (
    <div style={{ height: 7, background: "var(--surface-3)", borderRadius: 4, overflow: "hidden", minWidth: 96 }}>
      <div style={{ height: "100%", width: `${pct}%`, background: chg >= 0 ? "var(--up)" : "var(--down)", borderRadius: 4 }} />
    </div>
  );
}

// ---- backend doc shape (see backend/src/sync/sec-13f.job.ts, market-data/insider-positions.controller.ts) ----
interface FundHoldingDoc {
  id: string; fundName: string; latestFilingDate: string; latestAccessionNumber: string;
  totalPositions: number; totalValue: number;
}
interface PositionDoc { id: string; cusip: string; nameOfIssuer: string; value: number; shares: number; }

function fmtValue(v: number) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}
async function fetchPositions(cik: string, accessionNumber: string): Promise<PositionDoc[]> {
  return apiGet<PositionDoc[]>(
    `/market-data/fund-holdings/positions?cik=${encodeURIComponent(cik)}&accession=${encodeURIComponent(accessionNumber)}`,
  );
}
// ---- insider stock drawer ----
function InsiderDrawer({ sym, liveTxns, onClose, onOpenFull }: {
  sym: string; liveTxns: InsiderTxDoc[]; onClose: () => void; onOpenFull: (s: string) => void;
}) {
  const txns  = MOCK_FEED.filter(x => x.s === sym);
  const liveForSym = liveTxns.filter(x => x.ticker === sym);
  const hist  = insiderHistory(sym);
  const nBuy  = txns.filter(x => x.dir === "buy").length + liveForSym.filter(x => x.acquiredOrDisposed === "A").length;
  const nSell = txns.filter(x => x.dir === "sell").length + liveForSym.filter(x => x.acquiredOrDisposed === "D").length;
  const read  = nBuy > nSell
    ? `Net <b class="up">insider buying</b> in ${sym} — insiders adding is generally a constructive signal.`
    : nSell > nBuy
    ? `Net <b class="down">insider selling</b> in ${sym} — often diversification, but worth monitoring if it clusters.`
    : `Mixed insider activity in ${sym}.`;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="side-drawer">
        <div className="drawer-h">
          <div className="sd-logo" style={{ background: "linear-gradient(135deg,#1f6b4d,#0e3a2a)", color: "#5ff0b3" }}>{sym[0]}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--f-display)" }}>{sym}</div>
            <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>Insider activity · Form 4 filings</div>
          </div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-b">
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            <span className="pill up">{nBuy} buy filing{nBuy !== 1 ? "s" : ""}</span>
            <span className="pill dn">{nSell} sell filing{nSell !== 1 ? "s" : ""}</span>
          </div>

          {liveForSym.length > 0 && (
            <>
              <div className="ai-sec"><div className="h">Live SEC EDGAR Form 4 filings</div></div>
              {liveForSym.map((x) => (
                <div key={x.id} className="minirow" style={{ alignItems: "flex-start" }}>
                  <span className="tr-badge" style={{ background: x.acquiredOrDisposed === "A" ? "var(--up)22" : "var(--down)22", color: x.acquiredOrDisposed === "A" ? "var(--up)" : "var(--down)", flexShrink: 0 }}>
                    {x.acquiredOrDisposed === "A" ? "BUY" : "SELL"}
                  </span>
                  <span className="mid" style={{ marginLeft: 8 }}>
                    <b style={{ color: "var(--text-hi)" }}>{x.ownerName ?? "Unknown filer"}</b>
                    {x.officerTitle && <span style={{ color: "var(--text-dim-solid)" }}> · {x.officerTitle}</span>}
                    <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
                      {x.shares.toLocaleString()} sh{x.pricePerShare ? ` @ $${x.pricePerShare.toFixed(2)}` : ""} · {x.transactionDate}
                    </div>
                  </span>
                  {x.pricePerShare && (
                    <span className={`r ${x.acquiredOrDisposed === "A" ? "up" : "down"}`}>
                      {x.acquiredOrDisposed === "A" ? "+" : "−"}{fmtValue(x.shares * x.pricePerShare)}
                    </span>
                  )}
                </div>
              ))}
            </>
          )}

          <div className="ai-sec"><div className="h">Recent insider transactions · last 5 sessions</div></div>
          {txns.length ? txns.map((x, i) => (
            <div key={i} className="minirow" style={{ alignItems: "flex-start" }}>
              <span className="tr-badge" style={{ background: x.dir==="buy" ? "var(--up)22" : "var(--down)22", color: x.dir==="buy" ? "var(--up)" : "var(--down)", flexShrink: 0 }}>
                {x.dir === "buy" ? "BUY" : "SELL"}
              </span>
              <span className="mid" style={{ marginLeft: 8 }}>
                <b style={{ color: "var(--text-hi)" }}>{x.role}</b>
                <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{x.det} · {x.date}</div>
              </span>
              <span className={`r ${x.dir === "buy" ? "up" : "down"}`}>{x.dir === "buy" ? "+" : "−"}${x.val}</span>
            </div>
          )) : (
            <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>No Form 4 filings in the last 5 sessions.</div>
          )}

          <div className="ai-sec" style={{ marginTop: 14 }}><div className="h">Earlier filings · prior quarters</div></div>
          {hist.map((x, i) => (
            <div key={i} className="minirow">
              <span className="tr-badge" style={{ background: x.dir==="buy" ? "var(--up)22" : "var(--down)22", color: x.dir==="buy" ? "var(--up)" : "var(--down)", flexShrink: 0 }}>
                {x.dir === "buy" ? "BUY" : "SELL"}
              </span>
              <span className="mid" style={{ marginLeft: 8 }}>
                {x.role} {x.dir} {x.sh.toLocaleString("en-US")} sh
                <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>{x.date}</div>
              </span>
              <span className={`r ${x.dir === "buy" ? "up" : "down"}`}>${x.val}</span>
            </div>
          ))}

          <div className="ai-block" style={{ marginTop: 16 }}>
            <div className="card-h"><h3 className="ai-c">◆ AI read</h3></div>
            <div className="card-b">
              <p style={{ fontSize: ".84rem", lineHeight: 1.55, color: "var(--text)" }}
                dangerouslySetInnerHTML={{ __html: read + " Clusters of multiple insiders carry more signal than a single filing." }} />
            </div>
          </div>
          <button className="btn primary" style={{ width: "100%", marginTop: 14 }} onClick={() => { onClose(); onOpenFull(sym); }}>
            Open full stock page →
          </button>
        </div>
      </div>
    </>
  );
}

// ---- institutional stock sliding drawer ----
function InstDrawer({ sym, sn, onClose, onOpenFull }: { sym: string; sn: string; onClose: () => void; onOpenFull: (s: string) => void }) {
  const holders  = instHolders(sym);
  const mfs      = mutualFunds(sym);
  const quarters = instQuarters(sym);
  const tot      = holders.length || 1;
  const nBuy     = holders.filter(h => h.act === "added" || h.act === "new").length;
  const nSell    = holders.filter(h => h.act === "reduced" || h.act === "exited").length;
  const buyPct   = Math.round(nBuy / tot * 100);
  const sellPct  = Math.round(nSell / tot * 100);
  const actMap: Record<string, string> = { added:"Added", new:"New", reduced:"Reduced", exited:"Exited", unchanged:"Held" };
  const read = nBuy > nSell
    ? `Institutions are net <b class="up">accumulating</b> ${sym} — ${nBuy} of ${holders.length} tracked funds added or initiated.`
    : nSell > nBuy
    ? `Institutions are net <b class="down">trimming</b> ${sym} this quarter.`
    : `Institutional positioning in ${sym} is mixed / steady.`;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="side-drawer">
        <div className="drawer-h">
          <div className="sd-logo" style={{ background: "linear-gradient(135deg,#3a2f6b,#241c44)", color: "var(--brand-2)" }}>{sym[0]}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--f-display)" }}>{sym}</div>
            <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>{sn} · institutional 13F ownership</div>
          </div>
          <button className="closebtn" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-b">
          <div className="metric-grid" style={{ marginBottom: 14 }}>
            <div className="m"><div className="k">Funds holding</div><div className="v">{holders.length}</div></div>
            <div className="m"><div className="k">Buying</div><div className="v up">{buyPct}%</div></div>
            <div className="m"><div className="k">Selling</div><div className="v down">{sellPct}%</div></div>
          </div>
          <div style={{ height: 8, borderRadius: 5, overflow: "hidden", display: "flex", marginBottom: 16, background: "var(--surface-3)" }}>
            <div style={{ width: `${buyPct}%`, background: "var(--up)" }} />
            <div style={{ width: `${sellPct}%`, background: "var(--down)" }} />
          </div>

          <div className="ai-sec"><div className="h">Funds holding {sym} · % of their book &amp; action</div></div>
          {holders.length ? holders.map((h, i) => (
            <div key={i} className="minirow">
              <span className="mid">
                <b style={{ color: "var(--text-hi)" }}>{h.fund}</b>
                <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>{h.mgr} · {h.pct}% of book</div>
              </span>
              <span className="r">
                <span className={`pill ${h.act==="added"||h.act==="new" ? "up" : h.act==="reduced"||h.act==="exited" ? "dn" : "hold"}`}>
                  {actMap[h.act] || h.act}
                </span>
              </span>
            </div>
          )) : (
            <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>No tracked 13F funds hold {sym} this quarter.</div>
          )}

          <div className="ai-sec" style={{ marginTop: 14 }}><div className="h">Mutual fund holders · % of shares &amp; QoQ</div></div>
          {mfs.map((m, i) => (
            <div key={i} className="minirow">
              <span className="mid">
                <b style={{ color: "var(--text-hi)" }}>{m.name}</b>
                <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>
                  {m.pct}% of shares ·{" "}
                  <span className={m.q >= 0 ? "up" : "down"}>{m.q >= 0 ? "▲ +" : "▼ "}{m.q}%</span>
                  {" "}QoQ
                </div>
              </span>
              <span className="r"><MiniBar tr={m.tr} /></span>
            </div>
          ))}

          <div className="ai-sec" style={{ marginTop: 14 }}><div className="h">Institutional position · last 4 quarters</div></div>
          {quarters.map((q, i) => (
            <div key={i} className="minirow">
              <span className="tkr" style={{ width: 58 }}>{q.q}</span>
              <span className="mid"><QBar chg={q.chg} /></span>
              <span className={`r ${q.chg >= 0 ? "up" : "down"}`}>{q.chg >= 0 ? "▲ +" : "▼ "}{q.chg}%</span>
            </div>
          ))}

          <div className="ai-block" style={{ marginTop: 16 }}>
            <div className="card-h"><h3 className="ai-c">◆ AI read</h3></div>
            <div className="card-b">
              <p style={{ fontSize: ".84rem", lineHeight: 1.55, color: "var(--text)" }}
                dangerouslySetInnerHTML={{ __html: read + " 13F data is filed with a lag — treat it as positioning context, not a real-time signal." }} />
            </div>
          </div>
          <button className="btn primary" style={{ width: "100%", marginTop: 14 }} onClick={() => { onClose(); onOpenFull(sym); }}>
            Open full stock page →
          </button>
        </div>
      </div>
    </>
  );
}

// ============================================================
export function InsiderScreen() {
  const { openStockFull } = useIQActions();
  const [view,       setView]       = useState<"insider" | "13f">("insider");
  const [insFilter,  setInsFilter]  = useState<InsFilter>("All");
  const [insSort,    setInsSort]    = useState<InsSort>("value");
  const [instFilter, setInstFilter] = useState<InstFilter>("All");
  const [instSort,   setInstSort]   = useState<InstSort>("owners");
  const [drawer,     setDrawer]     = useState<DrawerState>(null);

  const { data: liveInsiderTx } = useApiList<InsiderTxDoc>("/market-data/insider-transactions");
  const { data: liveFunds } = useApiList<FundHoldingDoc>("/market-data/fund-holdings");

  // Real cross-fund overlap (CUSIP-matched across live 13F positions) — additive, alongside the mock "Cross-fund signals" card.
  const [liveOverlap, setLiveOverlap] = useState<Array<{ cusip: string; name: string; funds: string[] }> | null>(null);
  useEffect(() => {
    if (view !== "13f" || liveOverlap !== null || liveFunds.length === 0) return;
    (async () => {
      const byCusip = new Map<string, { name: string; funds: string[] }>();
      for (const f of liveFunds) {
        if (!f.latestAccessionNumber) continue;
        const positions = await fetchPositions(f.id, f.latestAccessionNumber);
        for (const p of positions) {
          const existing = byCusip.get(p.cusip);
          if (existing) existing.funds.push(f.fundName);
          else byCusip.set(p.cusip, { name: p.nameOfIssuer, funds: [f.fundName] });
        }
      }
      setLiveOverlap([...byCusip.entries()].map(([cusip, v]) => ({ cusip, ...v })).filter(x => x.funds.length >= 2).sort((a, b) => b.funds.length - a.funds.length));
    })();
  }, [view, liveFunds, liveOverlap]);

  const openIns  = (sym: string) => setDrawer({ kind: "insider", sym });
  const openInst = (sym: string) => setDrawer({ kind: "inst", sym, sn: INST_SN[sym] || sym });

  // Merge real Form 4 filings into the feed as additional rows (never removes mock rows).
  const liveFeed: Tx[] = liveInsiderTx.map(x => ({
    s: x.ticker,
    role: x.officerTitle ?? x.ownerName ?? "Filer",
    det: `${x.acquiredOrDisposed === "A" ? "acquired" : "disposed"} ${x.shares.toLocaleString()} sh${x.pricePerShare ? ` @ $${x.pricePerShare.toFixed(2)}` : ""} (live SEC EDGAR)`,
    dir: x.acquiredOrDisposed === "A" ? "buy" : "sell",
    val: x.pricePerShare ? (x.shares * x.pricePerShare / 1e6).toFixed(2) + "M" : "0",
    date: x.transactionDate,
    live: true,
  }));
  const FEED = [...MOCK_FEED, ...liveFeed];

  // ---- insider filter + sort ----
  const filtered = FEED.filter(x => {
    if (insFilter === "Buys")       return x.dir === "buy";
    if (insFilter === "Sells")      return x.dir === "sell";
    if (insFilter === "10% owners") return /10% owner/.test(x.role);
    if (insFilter === "Clusters")   return isCluster(x);
    return true;
  });
  const list = [...filtered].sort((a, b) =>
    insSort === "date" ? insDate(b.date) - insDate(a.date) : insValM(b.val) - insValM(a.val)
  );

  // most active by $ volume
  const agg: Record<string, { n: number; buy: number; sell: number }> = {};
  FEED.forEach(x => {
    const v = insValM(x.val);
    if (!agg[x.s]) agg[x.s] = { n: 0, buy: 0, sell: 0 };
    agg[x.s].n++;
    if (x.dir === "buy") agg[x.s].buy += v; else agg[x.s].sell += v;
  });
  const active = Object.entries(agg)
    .map(([s, o]) => ({ s, n: o.n, gross: o.buy + o.sell, net: o.buy - o.sell }))
    .sort((a, b) => b.gross - a.gross)
    .slice(0, 6);

  // ---- institutional filter + sort ----
  const filtInst = INST_DATA.filter(x => {
    if (instFilter === "Net buying")  return x.add;
    if (instFilter === "Net selling") return !x.add;
    return true;
  });
  const sortedInst = [...filtInst].sort((a, b) =>
    instSort === "move" ? Math.abs(b.lastQ) - Math.abs(a.lastQ) : b.owners - a.owners
  );
  const activeInst = [...INST_DATA].sort((a, b) => b.owners - a.owners).slice(0, 6);

  // Fund summary cards are built directly from the live 13F feed — no mock
  // base list. Fields the mock used to carry with no live source (manager
  // name, top holding ticker, new/exit counts) are dropped rather than
  // fabricated; the "Deep analysis" link needs a ticker so it goes away too.
  const fundCards = liveFunds.map(f => ({
    fundName: f.fundName,
    avatar: f.fundName.slice(0, 2).toUpperCase(),
    aum: fmtValue(f.totalValue),
    totalPositions: f.totalPositions,
    quarter: `Filed ${f.latestFilingDate}`,
  }));

  return (
    <>

      {/* ---- tabs (left-aligned, below header) ---- */}
      <div className="tabs" style={{ marginBottom: 14, alignSelf: "flex-start" }}>
        <button className={`tab${view === "insider" ? " active" : ""}`} onClick={() => setView("insider")}>Insider activity</button>
        <button className={`tab${view === "13f" ? " active" : ""}`} onClick={() => setView("13f")}>13F institutional</button>
      </div>

      {/* ======================================================== INSIDER ACTIVITY */}
      {view === "insider" && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-h">
              <h3>Most active by insider $ volume</h3>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>tap a name for all its filings</span>
            </div>
            <div className="card-b" style={{ paddingTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {active.map(o => (
                <button key={o.s} className="tr-pill" onClick={() => openIns(o.s)}>
                  <StockLogo sym={o.s} size={18} />
                  <span className="tr-tk">{o.s}</span>
                  <span className="tr-mt">{o.n} filing{o.n > 1 ? "s" : ""} · {o.net >= 0 ? "net +" : "net −"}${Math.abs(o.net).toFixed(1)}M</span>
                </button>
              ))}
            </div>
          </div>

          <div className="fbar" style={{ marginBottom: 12 }}>
            {(["All", "Buys", "Sells", "10% owners", "Clusters"] as InsFilter[]).map(c => (
              <button key={c} className={`chip${insFilter === c ? " on" : ""}`} onClick={() => setInsFilter(c)}>{c}</button>
            ))}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", alignSelf: "center", marginRight: 6 }}>Sort</span>
            <button className={`chip${insSort === "value" ? " on" : ""}`} onClick={() => setInsSort("value")}>Value</button>
            <button className={`chip${insSort === "date"  ? " on" : ""}`} onClick={() => setInsSort("date")}>Date</button>
          </div>

          <div className="card">
            <div className="card-h">
              <h3>{insFilter === "All" ? "All activity" : insFilter} · {list.length} filings</h3>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>Form 4 · {liveFeed.length} live + {MOCK_FEED.length} sample</span>
            </div>
            <div className="card-b" style={{ paddingTop: 2, overflowX: "auto" }}>
              <table className="tbl" id="insTbl">
                <thead>
                  <tr>
                    <th>Ticker</th><th>Side</th><th>Insider / owner</th><th>Transaction</th>
                    <th className="num">Value</th><th className="num">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {list.length === 0 ? (
                    <tr><td colSpan={6} style={{ color: "var(--text-dim-solid)", padding: 16 }}>No filings match this filter.</td></tr>
                  ) : list.map((x, i) => (
                    <tr key={i} data-sym={x.s} onClick={() => openIns(x.s)} style={{ cursor: "pointer" }}>
                      <td>
                        <div className="co">
                          <span className="s"><StockLogo sym={x.s} size={20} />{x.s}</span>
                        </div>
                      </td>
                      <td>
                        <span className="tr-badge" style={{ background: x.dir==="buy" ? "var(--up)22" : "var(--down)22", color: x.dir==="buy" ? "var(--up)" : "var(--down)" }}>
                          {x.dir === "buy" ? "BUY" : "SELL"}
                        </span>
                      </td>
                      <td style={{ whiteSpace: "normal", lineHeight: 1.4 }}>
                        {x.role}
                        {x.live && <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)", marginLeft: 6 }}>live</span>}
                        {!x.live && isCluster(x) && <span className="pill" style={{ background: "var(--surface-3)", color: "var(--ai)", marginLeft: 6 }}>cluster</span>}
                      </td>
                      <td style={{ whiteSpace: "normal", lineHeight: 1.4, color: "var(--text-dim-solid)" }}>{x.det}</td>
                      <td className="num"><b className={x.dir === "buy" ? "up" : "down"}>{x.dir === "buy" ? "+" : "−"}${x.val}</b></td>
                      <td className="num" style={{ color: "var(--text-dim-solid)" }}>{x.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", marginTop: 10 }}>
            Click any row for that company&#8217;s full insider history. Rows marked &ldquo;live&rdquo; are real SEC Form 4 filings via EDGAR; the rest are illustrative sample data. Informational only — not investment advice.
          </p>
        </>
      )}

      {/* ======================================================== 13F INSTITUTIONAL */}
      {view === "13f" && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-h">
              <h3>Most active institutional stocks</h3>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>tap a name for fund detail</span>
            </div>
            <div className="card-b" style={{ paddingTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {activeInst.map(o => (
                <button key={o.s} className="tr-pill" onClick={() => openInst(o.s)}>
                  <StockLogo sym={o.s} size={18} />
                  <span className="tr-tk">{o.s}</span>
                  <span className="tr-mt">{o.owners.toLocaleString()} owners · {o.add ? "▲ +" : "▼ "}{o.lastQ}% QoQ</span>
                </button>
              ))}
            </div>
          </div>

          <div className="fbar" style={{ marginBottom: 12 }}>
            {(["All", "Net buying", "Net selling"] as InstFilter[]).map(c => (
              <button key={c} className={`chip${instFilter === c ? " on" : ""}`} onClick={() => setInstFilter(c)}>{c}</button>
            ))}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", alignSelf: "center", marginRight: 6 }}>Sort</span>
            <button className={`chip${instSort === "owners" ? " on" : ""}`} onClick={() => setInstSort("owners")}>Owners</button>
            <button className={`chip${instSort === "move"   ? " on" : ""}`} onClick={() => setInstSort("move")}>Move</button>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-h">
              <h3>{instFilter === "All" ? "All institutional activity" : instFilter} · {sortedInst.length} stocks</h3>
              <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>13F · most recent quarter</span>
            </div>
            <div className="card-b" style={{ paddingTop: 2, overflowX: "auto" }}>
              <table className="tbl" id="instTbl">
                <thead>
                  <tr>
                    <th>Ticker</th><th className="num">Inst. owners</th><th className="num">Inst. %</th>
                    <th className="num">Buying</th><th className="num">Net QoQ</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedInst.map(x => (
                    <tr key={x.s} data-sym={x.s} onClick={() => openInst(x.s)} style={{ cursor: "pointer" }}>
                      <td>
                        <div className="co">
                          <span className="s"><StockLogo sym={x.s} size={20} />{x.s}</span>
                          <span className="n">{x.sn}</span>
                        </div>
                      </td>
                      <td className="num">{x.owners.toLocaleString()}</td>
                      <td className="num">{x.ownPct}%</td>
                      <td className="num"><b className={x.buyPct >= 50 ? "up" : "down"}>{x.buyPct}%</b></td>
                      <td className="num"><b className={x.add ? "up" : "down"}>{x.add ? "▲ +" : "▼ "}{x.lastQ}%</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ margin: "20px 0 10px", fontSize: ".74rem", textTransform: "uppercase" as const, letterSpacing: ".06em", color: "var(--text-dim-solid)", fontWeight: 700 }}>
            Top tracked funds · latest 13F filings
          </div>

          <div className="dash" style={{ marginBottom: 14 }}>
            {fundCards.map((f) => (
              <div key={f.fundName} className="col-4">
                <div className="fundcard">
                  <div style={{ display: "flex", gap: 11, alignItems: "center", marginBottom: 12 }}>
                    <div className="av">{f.avatar}</div>
                    <div>
                      <div className="nm">{f.fundName}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 14, fontFamily: "var(--f-mono)", fontSize: ".78rem" }}>
                    <div>
                      <div style={{ color: "var(--text-dim-solid)", fontSize: ".62rem", fontFamily: "var(--f-body)" }}>13F AUM</div>
                      <b style={{ color: "var(--text-hi)" }}>{f.aum}</b>
                    </div>
                    <div>
                      <div style={{ color: "var(--text-dim-solid)", fontSize: ".62rem", fontFamily: "var(--f-body)" }}>Positions</div>
                      <b style={{ color: "var(--text-hi)" }}>{f.totalPositions}</b>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 11, alignItems: "center" }}>
                    <span className="pill amc">{f.quarter}</span>
                  </div>
                </div>
              </div>
            ))}
            {fundCards.length === 0 && (
              <div style={{ fontSize: ".85rem", color: "var(--text-dim-solid)" }}>No 13F filings synced yet.</div>
            )}
          </div>

          <div className="dash" style={{ marginTop: 14 }}>
            <div className="col-8">
              <div className="ai-block">
                <div className="card-h">
                  <h3 className="ai-c">◆ AI 13F Summary · Berkshire Hathaway · Q1 2024</h3>
                  <span className="pill ai">Auto-generated</span>
                </div>
                <div className="card-b">
                  {AI_SECTIONS.map(s => (
                    <div key={s.h} className="ai-sec">
                      <div className="h">{s.h}</div>
                      <p dangerouslySetInnerHTML={{ __html: s.p }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="col-4">
              <div className="card">
                <div className="card-h"><h3>Cross-fund signals</h3></div>
                <div className="card-b">
                  <div style={{ fontSize: ".7rem", textTransform: "uppercase" as const, letterSpacing: ".06em", color: "var(--up)", fontWeight: 700, margin: "4px 0 6px" }}>
                    Most owned (3+ funds)
                  </div>
                  {CROSS_OWN.map(r => (
                    <div key={r.s} className="minirow" style={{ cursor: "pointer" }} onClick={() => openInst(r.s)}>
                      <span className="tkr">{r.s}</span>
                      <span className="mid">held by {r.n} funds</span>
                      <span className="r up">▲</span>
                    </div>
                  ))}
                  <div style={{ fontSize: ".7rem", textTransform: "uppercase" as const, letterSpacing: ".06em", color: "var(--down)", fontWeight: 700, margin: "12px 0 6px" }}>
                    Most sold (3+ funds)
                  </div>
                  {CROSS_SOLD.map(r => (
                    <div key={r.s} className="minirow" style={{ cursor: "pointer" }} onClick={() => openInst(r.s)}>
                      <span className="tkr">{r.s}</span>
                      <span className="mid">trimmed by {r.n} funds</span>
                      <span className="r down">▼</span>
                    </div>
                  ))}
                  <div style={{ fontSize: ".7rem", textTransform: "uppercase" as const, letterSpacing: ".06em", color: "var(--ai)", fontWeight: 700, margin: "12px 0 6px" }}>
                    Lone high-conviction
                  </div>
                  {CROSS_LONE.map(r => (
                    <div key={r.s} className="minirow" style={{ cursor: "pointer" }} onClick={() => openInst(r.s)}>
                      <span className="tkr">{r.s}</span>
                      <span className="mid">only {r.fund}</span>
                      <span className="r ai-c">◆</span>
                    </div>
                  ))}

                  <div style={{ fontSize: ".7rem", textTransform: "uppercase" as const, letterSpacing: ".06em", color: "var(--brand-2)", fontWeight: 700, margin: "12px 0 6px" }}>
                    Live overlap (CUSIP-matched, real)
                  </div>
                  {liveOverlap === null ? (
                    <div style={{ fontSize: ".76rem", color: "var(--text-dim-solid)" }}>Computing…</div>
                  ) : liveOverlap.length === 0 ? (
                    <div style={{ fontSize: ".76rem", color: "var(--text-dim-solid)" }}>No overlap found yet in synced 13F data.</div>
                  ) : liveOverlap.slice(0, 5).map(o => (
                    <div key={o.cusip} className="minirow">
                      <span className="mid">
                        <b style={{ color: "var(--text-hi)" }}>{o.name}</b>
                        <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)" }}>{o.funds.join(", ")}</div>
                      </span>
                      <span className="r">{o.funds.length} funds</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ---- drawers ---- */}
      {drawer?.kind === "insider" && (
        <InsiderDrawer sym={drawer.sym} liveTxns={liveInsiderTx} onClose={() => setDrawer(null)} onOpenFull={openStockFull} />
      )}
      {drawer?.kind === "inst" && (
        <InstDrawer sym={drawer.sym} sn={drawer.sn} onClose={() => setDrawer(null)} onOpenFull={openStockFull} />
      )}
    </>
  );
}
