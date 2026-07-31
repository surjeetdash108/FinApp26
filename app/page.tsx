"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signInWithPopup, signInWithRedirect } from "firebase/auth";
import { firebaseAuth, googleAuthProvider } from "./firebase";
import { completeGoogleLogin, getAuthErrorMessage } from "./auth/auth-utils";
import { LoginForm } from "./auth/login/login-form";
import { pulse, wmn, movers, earnings, analyst, folio, sectorList, recap, watch } from "./iq/data";
import { fmt, sign, cls, heatCol, StockLogo } from "./iq/utils";

// ---- Workspace thumbnail components ----
// Content is authored at 1200px virtual width then CSS-scaled to fill whatever container it lives in
// (carousel card ~340px, glance modal ~572px, mobile stacked ~320px, etc.)

function ScaledScreen({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2834); // initial guess for 340px card

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setScale(e.contentRect.width / 1200);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outerRef} style={{ position: "absolute", inset: 0, overflow: "hidden", background: "var(--surface-0)" }}>
      <div style={{ width: 1200, minHeight: 1567, transformOrigin: "top left", transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

// Tiny sparkline SVG for thumbnails
function Spark({ idx, up }: { idx: number; up: boolean }) {
  const pts = [40,44,41,47,43,50,46,53,49,55,51,58,54,60,57,62,55,65,60,67,63,70,61,68,66,72];
  const phase = idx * 3;
  const data = pts.map((v, i) => pts[(i + phase) % pts.length]);
  const W = 72, H = 22;
  const mn = Math.min(...data), mx = Math.max(...data), range = mx - mn || 1;
  const path = data.map((v, i) => `${i === 0 ? "M" : "L"}${(i / (data.length - 1)) * W},${H - ((v - mn) / range) * H}`).join(" ");
  const col = up ? "#22c55e" : "#f43f5e";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }}>
      <path d={path} fill="none" stroke={col} strokeWidth="1.6" />
    </svg>
  );
}

// Fear & Greed gauge SVG (matches HTML's gaugeSVG)
function GaugeSVG({ val }: { val: number }) {
  const a = Math.PI * (1 - val / 100), cx = 70, cy = 66, r = 54;
  const x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
  return (
    <svg viewBox="0 0 140 78" width="150">
      <defs>
        <linearGradient id="gfg" x1="0" x2="1">
          <stop offset="0" stopColor="#FF5470" />
          <stop offset=".5" stopColor="#FFB547" />
          <stop offset="1" stopColor="#2FE6A6" />
        </linearGradient>
      </defs>
      <path d="M16 66 A54 54 0 0 1 124 66" fill="none" stroke="var(--surface-3)" strokeWidth="11" strokeLinecap="round" />
      <path d="M16 66 A54 54 0 0 1 124 66" fill="none" stroke="url(#gfg)" strokeWidth="11" strokeLinecap="round" strokeDasharray="170" strokeDashoffset={170 - 170 * val / 100} />
      <circle cx={x} cy={y} r="6" fill="var(--text-hi)" stroke="var(--bg)" strokeWidth="3" />
    </svg>
  );
}

function DashThumb() {
  const hmMini = sectorList.slice(0, 8).map(sd => {
    const tot = sd.items.reduce((s, i) => s + i[1], 0);
    const { bg, fg } = heatCol(sd.pctChange!);
    return (
      <div key={sd.name} style={{ background: bg, borderRadius: 7, padding: "8px 9px", flex: `${Math.max(1, tot / 1400)} 1 70px` }}>
        <div style={{ fontSize: ".6rem", fontWeight: 700, color: fg, lineHeight: 1.1 }}>{sd.name.replace("Mega-Cap ", "").replace("Cloud ", "")}</div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: ".64rem", color: fg, opacity: 0.88, marginTop: 2 }}>{sign(sd.pctChange!)}</div>
      </div>
    );
  });
  const insiderBuys = [
    { s: "NVDA", dir: "buy", role: "CEO", val: "$42M" },
    { s: "AAPL", dir: "buy", role: "CFO", val: "$8.2M" },
    { s: "META", dir: "sell", role: "Director", val: "$15M" },
  ];
  const feedItems = [
    { cat: "Earnings", col: "var(--up)", t: "NVDA beats EPS 18%, raises FY25", time: "9:31a" },
    { cat: "Analyst", col: "var(--brand-2)", t: "MS upgrades CRM to Overweight", time: "9:18a" },
    { cat: "Macro", col: "var(--warn)", t: "May core CPI +0.2% m/m, below est.", time: "8:30a" },
  ];
  return (
    <ScaledScreen>
      <div className="page-head" style={{ padding: "28px 40px 16px" }}>
        <div><div className="eyebrow">Tuesday &middot; May 21 &middot; 10:24 ET</div><h1 className="page-title">Good morning, Arvind</h1></div>
      </div>
      <div className="dgrid" style={{ padding: "0 32px 20px" }}>
        <div className="col-12">
          <div className="pulse">
            {pulse.slice(0, 6).map((p, i) => {
              const dec = p.value > 1000 ? 0 : 2;
              return (
                <div key={p.label} className="p" style={{ cursor: "pointer" }}>
                  <div className="lbl">{p.label}</div>
                  <div className="val">{fmt(p.value, dec)}</div>
                  <div className={`chg ${cls(p.change)}`}>{sign(p.change)}</div>
                  <div className="pmeta" style={{ fontSize: ".6rem", color: "var(--text-dim-solid)" }}>O {fmt(p.open ?? p.value * 0.99, dec)} &middot; PC {fmt(p.prevClose ?? p.value * 1.01, dec)}</div>
                  <Spark idx={i} up={p.change >= 0} />
                </div>
              );
            })}
          </div>
        </div>
        <div className="col-12">
          <div className="wmn">
            <div className="wmn-h">
              <div className="t">
                <div className="wmn-orb"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9z" fill="currentColor" /></svg></div>
                <div><h2>What Matters Now</h2><div className="meta"><span className="live"><span className="dot" />&nbsp;Live</span>&nbsp;&middot; AI-curated</div></div>
              </div>
              <button className="btn ai" style={{ fontSize: ".72rem" }}>&#9654; 30-sec audio</button>
            </div>
            <ul className="wmn-body">
              {wmn.slice(0, 4).map((b, i) => (
                <li key={i}><span className="bullet" /><span><b>{b.headline}.</b> <span dangerouslySetInnerHTML={{ __html: b.body }} /></span></li>
              ))}
            </ul>
            <div className="wmn-foot" style={{ display: "flex", gap: 6, padding: "8px 18px", borderTop: "1px solid var(--border)", fontSize: ".66rem", flexWrap: "wrap" }}>
              Sources used:<span className="src-chip">CPI release</span><span className="src-chip">NVDA 10-Q</span><span className="src-chip">Analyst feed</span><span style={{ marginLeft: "auto", color: "var(--ai)" }}>AI-generated</span>
            </div>
          </div>
        </div>
        <div className="col-4">
          <div className="card">
            <div className="card-h"><h3>Earnings Today</h3><span className="link">View all →</span></div>
            <div className="card-b" style={{ paddingTop: 4 }}>
              {earnings.slice(0, 5).map(e => (
                <div key={e.ticker} className="minirow">
                  <span className="tkr">{e.ticker}<small>{e.name}</small></span>
                  <span className="mid"><span className={`pill ${e.session.includes("pre") ? "bmo" : "amc"}`}>{e.session}</span></span>
                  <span className={`r ${e.epsActual !== null && e.epsEstimate !== null ? cls(e.epsActual - e.epsEstimate) : ""}`}>{e.epsActual !== null && e.epsEstimate !== null ? sign(e.epsActual - e.epsEstimate) : <span style={{ color: "var(--text-dim-solid)" }}>pending</span>}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-4">
          <div className="card">
            <div className="card-h"><h3>Market Movers</h3><span className="link">View all →</span></div>
            <div className="card-b" style={{ paddingTop: 4 }}>
              {movers.slice(0, 5).map(m => (
                <div key={m.ticker} className="minirow">
                  <span className="tkr">{m.ticker}</span>
                  <span className="mid">{m.catalystLabel}</span>
                  <span className={`r ${cls(m.pctChange)}`}>{sign(m.pctChange)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-4">
          <div className="card">
            <div className="card-h"><h3>Market Heatmap</h3><span className="link">View all →</span></div>
            <div className="card-b" style={{ paddingTop: 10 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{hmMini}</div>
              <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 9 }}>Tap to open the full heatmap.</div>
            </div>
          </div>
        </div>
        <div className="col-4">
          <div className="card">
            <div className="card-h"><h3>Analyst Actions</h3><span className="link">View all →</span></div>
            <div className="card-b" style={{ paddingTop: 4 }}>
              {analyst.slice(0, 5).map((a, i) => (
                <div key={i} className="minirow">
                  <span className="tkr">{a.ticker}</span>
                  <span className="mid">{a.firm} &rarr; <b style={{ color: "var(--text-hi)" }}>{a.newRating}</b></span>
                  <span className="r">{a.actionType === "up" ? <span className="up">&#9650; Upg</span> : a.actionType === "down" ? <span className="down">&#9660; Dng</span> : a.actionType === "init" ? <span className="ai-c">&#9670; Init</span> : <span style={{ color: "var(--text-dim-solid)" }}>Reit</span>}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-4">
          <div className="card">
            <div className="card-h"><h3>Screener &middot; Leaders &amp; Laggards</h3><span className="link">View all →</span></div>
            <div className="card-b" style={{ paddingTop: 4 }}>
              <div style={{ fontSize: ".6rem", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", margin: "0 0 4px", color: "var(--up)" }}>&#9650; Leaders</div>
              {sectorList.slice(0, 3).map(g => (
                <div key={g.name} className="minirow"><span className="tkr">{g.name.split(" ")[0]}</span><span className="mid">RS {g.rank} &middot; {g.name.split(" ").slice(1).join(" ")}</span><span className={`r ${cls(g.pctChange!)}`}>{sign(g.pctChange!)}</span></div>
              ))}
              <div style={{ fontSize: ".6rem", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", margin: "8px 0 4px", color: "var(--down)" }}>&#9660; Laggards</div>
              {sectorList.slice(-3).map(g => (
                <div key={g.name} className="minirow"><span className="tkr">{g.name.split(" ")[0]}</span><span className="mid">RS {g.rank} &middot; {g.name.split(" ").slice(1).join(" ")}</span><span className={`r ${cls(g.pctChange!)}`}>{sign(g.pctChange!)}</span></div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-4">
          <div className="card">
            <div className="card-h"><h3>Portfolio Pulse</h3><span className="link">View all →</span></div>
            <div className="card-b" style={{ paddingTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span className="mono" style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-hi)" }}>$128,430</span>
                <span className="mono up" style={{ fontWeight: 600 }}>&#9650; +1.42%</span>
              </div>
              {folio.slice(0, 4).map(f => (
                <div key={f.ticker} className="minirow"><span className="tkr">{f.ticker}</span><span className="mid">{f.positionSize} &middot; {f.conviction} conv.</span><span className={`r ${cls(f.pctChange)}`}>{sign(f.pctChange)}</span></div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-4">
          <div className="card">
            <div className="card-h"><h3>Watchlist</h3><span className="link">View all →</span></div>
            <div className="card-b" style={{ paddingTop: 8 }}>
              {watch.slice(0, 5).map(w => (
                <div key={w.ticker} className="minirow"><span className="tkr">{w.ticker}</span><span className="mid">{w.hasOptions && <span className="pill opt">&#9889;</span>} ER {w.nextEarningsDate}</span><span className={`r ${cls(w.pctChange)}`}>{sign(w.pctChange)}</span></div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-4">
          <div className="card">
            <div className="card-h"><h3>Insider &amp; Institutional</h3><span className="link">View all →</span></div>
            <div className="card-b" style={{ paddingTop: 4 }}>
              {insiderBuys.map((x, i) => (
                <div key={i} className="minirow"><span className="tkr">{x.s}</span><span className="mid">{x.dir === "buy" ? "Buy" : "Sell"} &middot; {x.role}</span><span className={`r ${x.dir === "buy" ? "up" : "down"}`}>{x.dir === "buy" ? "+" : "−"}{x.val}</span></div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-4">
          <div className="card">
            <div className="card-h"><h3>Live Market Feed</h3><span className="link">Commentary →</span></div>
            <div className="card-b" style={{ paddingTop: 2 }}>
              {feedItems.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--border-soft,#1a2535)" }}>
                  <div style={{ flexShrink: 0, width: 62 }}><span className="pill" style={{ background: "var(--surface-3)", color: f.col, fontSize: ".6rem" }}>{f.cat}</span><div style={{ fontFamily: "var(--f-mono)", fontSize: ".6rem", color: "var(--text-dim-solid)", marginTop: 5 }}>{f.time}</div></div>
                  <div style={{ fontSize: ".78rem", color: "var(--text)" }}>{f.t}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-4">
          <div className="card">
            <div className="card-h"><h3>Recaps</h3><span className="link">All →</span></div>
            <div className="card-b" style={{ paddingTop: 8 }}>
              <div style={{ fontSize: ".74rem", color: "var(--text-dim-solid)", marginBottom: 10 }}>Structured executive-summary report (PDF).</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {["Today (EOD)", "Yesterday", "Last week"].map(l => (
                  <button key={l} className="btn" style={{ justifyContent: "flex-start" }}>&#11015; &nbsp;{l}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="col-4">
          <div className="card vix">
            <div className="card-h"><h3>VIX &middot; Volatility</h3><span className="pill up">Calm</span></div>
            <div className="card-b">
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}><span className="big">14.18</span><span className="mono down" style={{ fontWeight: 600 }}>&#9660; -2.51%</span></div>
              <div className="pctl"><i style={{ width: "22%" }} /></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".66rem", color: "var(--text-dim-solid)", marginBottom: 10 }}><span>12-mo pct: 22nd</span><span>Trend: falling</span></div>
              <div className="note">VIX at 14 is low — a calm, risk-on tape.</div>
            </div>
          </div>
        </div>
        <div className="col-4">
          <div className="card">
            <div className="card-h"><h3>Fear &amp; Greed</h3><span className="link">History →</span></div>
            <div className="card-b gauge-wrap">
              <GaugeSVG val={62} />
              <div className="gauge-num up">62</div>
              <div className="gauge-lbl up">Greed</div>
              <div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>Previous close: 58</div>
            </div>
          </div>
        </div>
      </div>
    </ScaledScreen>
  );
}

function MoversThumb() {
  const tabs = [["win","Top Gainers"],["lose","Top Losers"],["vol","Unusual Volume"],["week","Weekly Movers"]];
  const list = [...movers].filter(m => m.pctChange > 0).sort((a, b) => b.pctChange - a.pctChange).slice(0, 15);
  const tally: Record<string, number> = {};
  list.forEach(m => { tally[m.sector] = (tally[m.sector] || 0) + 1; });
  const tallyEntries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const trending = [
    { s: "NVDA", n: 3 }, { s: "AAPL", n: 2 }, { s: "META", n: 2 },
  ];
  return (
    <ScaledScreen>
      <div className="page-head" style={{ padding: "28px 40px 20px" }}>
        <div><div className="eyebrow">Market Movers</div><h1 className="page-title">Winners &amp; Losers</h1><div className="page-sub">Top 15 gainers today &middot; click any stock to see why it moved</div></div>
        <div className="tabs">{tabs.map(([k, l], i) => <button key={k} className={`tab${i === 0 ? " active" : ""}`}>{l}</button>)}</div>
      </div>
      <div style={{ padding: "0 32px" }}>
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-h"><h3>&#128293; Trending across reports</h3><span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>{trending.length} names</span></div>
          <div className="card-b" style={{ paddingTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {trending.map(o => (
              <button key={o.s} className="tr-pill"><span className="tr-tk">{o.s}</span><span className="tr-mt">{o.n} reports</span></button>
            ))}
          </div>
        </div>
        <div className="fbar">
          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", alignSelf: "center" }}>Sector</span>
          <select className="mv-sel"><option>All</option><option>Technology</option><option>Finance</option></select>
          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", alignSelf: "center", marginLeft: 10 }}>Market cap</span>
          <select className="mv-sel"><option>All</option><option>Mega</option><option>Large</option></select>
          <div className="spacer" />
          <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{list.length} stocks</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {tallyEntries.map(([k, v]) => (
            <span key={k} className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>
              {k} <b style={{ color: "var(--text-hi)" }}>{v}</b>
            </span>
          ))}
        </div>
        <div className="card" style={{ overflow: "visible" }}>
          <table className="tbl">
            <thead>
              <tr><th>Company</th><th className="num">Price</th><th className="num">Change</th><th className="num">RVOL</th><th>Cap &middot; Sector</th><th>Catalyst</th><th className="num">Intraday</th></tr>
            </thead>
            <tbody>
              {movers.map(m => (
                <tr key={m.ticker} style={{ cursor: "pointer" }}>
                  <td><div className="co"><span className="s">{m.ticker}</span><span className="n">{m.name}</span></div></td>
                  <td className="num">${fmt(m.price, 2)}</td>
                  <td className={`num ${cls(m.pctChange)}`}>{sign(m.pctChange)}</td>
                  <td className="num"><b style={{ color: m.rvolRatio > 3 ? "var(--warn)" : "var(--text)" }}>{m.rvolRatio.toFixed(1)}&times;</b></td>
                  <td><span style={{ fontSize: ".74rem" }}><b style={{ color: "var(--text-hi)" }}>{m.cap}</b> &middot; <span style={{ color: "var(--text-dim-solid)" }}>{m.sector}</span></span></td>
                  <td><span className="pill" style={{ background: "var(--surface-3)", color: "var(--brand-2)" }}>{m.catalystLabel}</span></td>
                  <td className="num"><Spark idx={m.ticker.charCodeAt(0) % 8} up={m.pctChange >= 0} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ScaledScreen>
  );
}

// Seeded PRNG — matches HTML's _seed/_hash
function sdHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h * 31 + s.charCodeAt(i)) | 0) & 0x7fffffff;
  return h;
}
function sdRand(seed: number) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// Deterministic OHLC — matches HTML's genOHLC(sym, tf)
function genOHLC(sym: string, tf: string, price: number, chgPct: number, rs: number) {
  const C: Record<string, [number, number]> = {
    '1D': [78, 0.5], '1W': [65, 0.9], '1M': [44, 1.5],
    '3M': [64, 1.1], '6M': [120, 1.3], '1Y': [252, 1.8], '5Y': [260, 2.6],
  };
  const [n, volat] = C[tf] ?? [64, 1.1];
  const bias = (chgPct >= 0 ? 1 : -1) * (0.12 + Math.abs(rs - 50) / 140);
  const rnd = sdRand(sdHash(sym + tf) + 7);
  let p = price * (tf === '5Y' ? 0.32 : tf === '1Y' ? 0.6 : 0.86);
  const out: { o: number; h: number; l: number; c: number; v: number }[] = [];
  for (let i = 0; i < n; i++) {
    const o = p;
    const ch = (rnd() - 0.5) * volat * 2 + bias * volat * 0.9;
    const c = Math.max(0.5, o * (1 + ch / 100));
    const hi = Math.max(o, c) * (1 + rnd() * volat / 160);
    const lo = Math.min(o, c) * (1 - rnd() * volat / 160);
    const v = 0.5 + rnd() * 0.7 + (Math.abs(ch) > volat ? 0.9 : 0);
    out.push({ o, h: hi, l: lo, c, v });
    p = c;
  }
  const k = price / out[out.length - 1].c;
  out.forEach(d => { d.o *= k; d.h *= k; d.l *= k; d.c *= k; });
  return out;
}

// Candlestick chart SVG — matches HTML's candleChart()
function CandleChart({ data }: { data: ReturnType<typeof genOHLC> }) {
  const d = data, n = d.length;
  const W = 720, PH = 224, PADT = 12, PADB = 18, axisW = 46, H = PADT + PH + PADB;
  const mn = Math.min(...d.map(x => x.l)), mx = Math.max(...d.map(x => x.h)), rng = (mx - mn) || 1;
  const plotW = W - axisW - 8, cw = plotW / n;
  const X = (i: number) => 6 + i * cw + cw / 2;
  const Y = (p: number) => PADT + PH * (1 - (p - mn) / rng);
  const ei = Math.round(n * 0.82);
  const ex = X(ei), ey = Y(d[ei].h) - 10;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }}>
      {[0, 1, 2, 3, 4].map(g => {
        const yy = PADT + PH * g / 4, val = mx - rng * g / 4;
        return (
          <g key={g}>
            <line x1={6} x2={W - axisW} y1={yy} y2={yy} stroke="var(--border-soft)" strokeWidth={1} />
            <text x={W - axisW + 4} y={yy + 3} fill="#697486" fontSize={9} fontFamily="var(--f-mono)">
              ${val > 500 ? Math.round(val).toLocaleString() : val.toFixed(2)}
            </text>
          </g>
        );
      })}
      {d.map((bar, i) => {
        const x = X(i), isUp = bar.c >= bar.o, col = isUp ? "var(--up)" : "var(--down)";
        const bt = Y(Math.max(bar.o, bar.c)), bb = Y(Math.min(bar.o, bar.c)), ww = Math.max(1.2, cw * 0.62);
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={Y(bar.h)} y2={Y(bar.l)} stroke={col} strokeWidth={1} />
            <rect x={x - ww / 2} y={bt} width={ww} height={Math.max(1, bb - bt)} fill={col} stroke={col} strokeWidth={1} />
          </g>
        );
      })}
      <circle cx={ex} cy={ey} r={4} fill="var(--ai)" />
      <text x={ex} y={ey - 6} textAnchor="middle" fill="var(--ai)" fontSize={9} fontFamily="var(--f-mono)">◆ ER</text>
    </svg>
  );
}

// Grouped bar chart for financials — matches HTML's earnIncChart()
function EarnIncChart() {
  const inc = [
    { c: "Q2'25", rev: 44.1, gp: 32.2, ni: 24.3 },
    { c: "Q1'25", rev: 35.1, gp: 25.6, ni: 19.3 },
    { c: "Q4'24", rev: 26.1, gp: 19.1, ni: 14.4 },
    { c: "Q3'24", rev: 18.1, gp: 13.2, ni:  9.9 },
  ];
  const W = 380, H = 200, PADL = 8, PADR = 8, PADT = 14, PADB = 26;
  const iw = W - PADL - PADR, ih = H - PADT - PADB;
  const max = Math.max(...inc.map(x => x.rev)) * 1.12;
  const n = inc.length, gw = iw / n, bw = gw * 0.2;
  const series: [keyof typeof inc[0], string][] = [["rev", "var(--brand)"], ["gp", "var(--ai)"], ["ni", "var(--up)"]];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }}>
      {inc.map((x, i) => {
        const gx = PADL + gw * i;
        return (
          <g key={i}>
            {series.map(([key, col], si) => {
              const v = x[key] as number, h = (v / max) * ih, bx = gx + gw * 0.16 + si * (bw + 5);
              return <rect key={si} x={bx} y={PADT + ih - h} width={bw} height={h} rx={2} fill={col} />;
            })}
            <text x={gx + gw / 2} y={H - 8} textAnchor="middle" fill="var(--text-dim-solid)" fontSize={9}>{x.c}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Shared stock detail content — used by StockThumb and PortfolioThumb's pf-detail
function StockDetailContent() {
  const price = 1181.75, chg = 8.23, rs = 98;
  const dollar = chg / 100 * price;
  const ohlc = genOHLC("NVDA", "1D", price, chg, rs);

  return (
    <>
      <div className="sd-head">
        <div className="sd-logo" style={{ width: 46, height: 46, borderRadius: 12, background: "linear-gradient(135deg,#1f6b4d,#0e3a2a)", color: "#5ff0b3", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--f-display)", fontWeight: 800, fontSize: "1.125rem" }}>N</div>
        <div className="sd-name">
          <h1 style={{ fontFamily: "var(--f-mono)", fontSize: "1.5rem", fontWeight: 700, color: "var(--text-hi)", letterSpacing: "-.01em", margin: 0 }}>NVDA</h1>
          <div className="sub" style={{ fontSize: ".8rem", color: "var(--text-dim-solid)" }}>NVIDIA Corp &middot; NASDAQ &middot; Semiconductors</div>
        </div>
        <div className="sd-px" style={{ marginLeft: 8 }}>
          <div className="p" style={{ fontFamily: "var(--f-mono)", fontSize: "1.7rem", fontWeight: 700, color: "var(--text-hi)" }}>${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="c up" style={{ fontFamily: "var(--f-mono)", fontSize: ".86rem", fontWeight: 600 }}>&#9650; +${dollar.toFixed(2)} (+{chg.toFixed(2)}%)</div>
        </div>
        <div className="sd-actions">
          <button className="btn">Watch</button>
          <button className="btn ai">Ask Copilot</button>
        </div>
      </div>
      <div className="sd-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Chart card */}
          <div className="card">
            <div className="chart-toolbar">
              {["1D","1W","1M","3M","6M","1Y","5Y"].map((t, i) => (
                <button key={t} className={`rng${i === 0 ? " on" : ""}`}>{t}</button>
              ))}
              <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 4px" }} />
              {["Candles","Hollow","Bars","Line","Area"].map((t, i) => (
                <button key={t} className={`rng${i === 0 ? " on" : ""}`}>{t}</button>
              ))}
              <button className="rng">MA</button>
              <button className="rng">EMA</button>
              <button className="rng">Volume</button>
              <button className="rng">RSI</button>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>drag-free · hover for OHLC</span>
            </div>
            <CandleChart data={ohlc} />
            <div style={{ padding: "6px 14px 12px", fontSize: ".7rem", color: "var(--text-dim-solid)" }}>Pattern: <b style={{ color: "var(--up)" }}>cup-with-handle breakout</b> on above-average volume.</div>
          </div>
          {/* Key stats */}
          <div className="card">
            <div className="keystats">
              {[["Mkt Cap","$2.91T"],["P/E","71.4"],["Revenue (TTM)","$78.0B"],["EPS (TTM)","$16.55"],["Short Int.","1.1%"],["Next ER","Aug 28"],["52W Range","$685 – $1,205"],["Avg Vol","30M"]].map(([k, v]) => (
                <div key={k} className="kstat"><div className="k">{k}</div><div className="v">{v}</div></div>
              ))}
            </div>
          </div>
          {/* AI Technical Analysis */}
          <div className="ai-block">
            <div className="card-h"><h3 className="ai-c">&#9670; AI Technical Analysis</h3>
              <div className="toneseg" style={{ width: 280 }}>
                {["Summary","Swing","Position","Long-term"].map((t, i) => <button key={t} className={i === 1 ? "on" : ""}>{t}</button>)}
              </div>
            </div>
            <div className="card-b">
              {[
                ["Trend","<b>Strong uptrend.</b> Higher highs and higher lows; momentum confirmed by recent strength."],
                ["Support / Resist.","Support near <b>$1,140</b> and <b>$1,099</b>; resistance at <b>$1,217</b> then the 52-week high <b>$1,205</b>."],
                ["MA posture","Above the 20, 50 and 200-day — bullish alignment."],
                ["Rel. strength","Relative-strength rank <b class=\"up\">98/99</b> vs the market — group leader."],
                ["Volume","Relative volume <b>4.2×</b> — well above average (event-driven)."],
                ["Event risk","Next earnings Aug 28 (~99 days). Macro: a hawkish Fed surprise pressures high-multiple names first."],
              ].map(([k, v]) => (
                <div key={k} className="ai-line"><span className="k">{k}</span><span className="v" dangerouslySetInnerHTML={{ __html: v as string }} /></div>
              ))}
              <div style={{ marginTop: 10, fontSize: ".7rem", color: "var(--text-dim-solid)" }}>Source: 250-day OHLCV, 20/50/200 SMA, RS vs SPX · AI-generated · not investment advice.</div>
            </div>
          </div>
          {/* Financials */}
          <div className="card">
            <div className="card-h"><h3>Financials</h3><div style={{ display: "flex", alignItems: "center", gap: 10 }}><div className="tf-pills"><button className="rng">Quarterly</button><button className="rng on">Annual</button></div><span className="link">View all →</span></div></div>
            <div className="card-b" style={{ paddingTop: 8 }}>
              <div className="ec-legend"><span><i style={{ background: "var(--brand)" }} />Revenue</span><span><i style={{ background: "var(--ai)" }} />Gross profit</span><span><i style={{ background: "var(--up)" }} />Net income</span></div>
              <EarnIncChart />
              <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 6 }}>Last 4 quarters · revenue, gross profit &amp; net income · tap "View all" for the full statement.</div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <div className="card-h"><h3>Technical Rating</h3><div style={{ display: "flex", alignItems: "center", gap: 10 }}><div className="tf-pills">{["1D","1W","1M"].map((t, i) => <button key={t} className={`rng${i === 2 ? " on" : ""}`}>{t}</button>)}</div><span className="link">View all →</span></div></div>
            <div className="card-b">
              <div className="trgroup" style={{ borderColor: "var(--ai-dim,rgba(52,226,240,.2))", marginBottom: 10 }}>
                <div className="gl ai-c">Summary</div>
                <div className="rate" style={{ color: "#22c55e" }}>Strong Buy</div>
                <div className="counts"><span style={{ color: "var(--down)" }}>Sell<b>2</b></span><span style={{ color: "var(--text-dim-solid)" }}>Neut<b>3</b></span><span style={{ color: "var(--up)" }}>Buy<b>12</b></span></div>
              </div>
              <div className="trseg2">
                <div className="trgroup"><div className="gl">Oscillators</div><div className="rate" style={{ color: "#22c55e" }}>Buy</div><div className="counts"><span style={{ color: "var(--down)" }}>Sell<b>1</b></span><span style={{ color: "var(--text-dim-solid)" }}>Neut<b>2</b></span><span style={{ color: "var(--up)" }}>Buy<b>6</b></span></div></div>
                <div className="trgroup"><div className="gl">Moving Avgs</div><div className="rate" style={{ color: "#22c55e" }}>Strong Buy</div><div className="counts"><span style={{ color: "var(--down)" }}>Sell<b>1</b></span><span style={{ color: "var(--text-dim-solid)" }}>Neut<b>1</b></span><span style={{ color: "var(--up)" }}>Buy<b>7</b></span></div></div>
              </div>
              <table className="ind-tbl" style={{ marginTop: 12 }}><tbody>
                {[["RSI (14)","73.28","Sell"],["MACD (12,26)","21.4","Buy"],["Stoch %K","82.9","Sell"],["ADX (14)","36.5","Buy"],["EMA 50","$1,111","Buy"],["SMA 200","$875","Buy"]].map(([ind, val, act]) => (
                  <tr key={String(ind)}><td>{ind}</td><td className="v">{val}</td><td className="a" style={{ color: act === "Buy" ? "var(--up)" : act === "Sell" ? "var(--down)" : "var(--text-dim-solid)" }}>{act}</td></tr>
                ))}
              </tbody></table>
              <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 8 }}>Computed from 11 oscillators + 15 moving averages.</div>
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Peers &middot; who&apos;s leading</h3><span className="link">View all →</span></div>
            <div className="card-b" style={{ paddingTop: 6 }}>
              {([["NVDA",8.23,"Leader"],["AMD",2.10,""],["AVGO",2.97,""],["INTC",-1.80,"Laggard"],["QCOM",1.30,""]] as [string,number,string][]).map(([t, c, tag]) => (
                <div key={t} className={`minirow${t === "NVDA" ? " owned" : ""}`}>
                  <span className="tkr">{t}</span>
                  <span className="mid">{tag ? <span className={`pill ${tag === "Leader" ? "up" : "dn"}`}>{tag}</span> : ""}</span>
                  <span className={`r ${c >= 0 ? "up" : "down"}`}>{c >= 0 ? "+" : ""}{c.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Industry Group rank</h3><div style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="pill up">Improving</span><span className="link">View all →</span></div></div>
            <div className="card-b">
              {sectorList.slice(0, 5).map(g => (
                <div key={g.name} className="grouprow">
                  <span className="rk">{g.rank}</span><span className="gn">{g.name}</span>
                  <span className="bar"><i style={{ width: `${Math.max(8, 100 - g.rank * 1.6)}%` }} /></span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{sign(g.pctChange!)}</span>
                </div>
              ))}
              <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", marginTop: 8 }}>Semiconductors ranks <b style={{ color: "var(--up)" }}>#1 of {sectorList.length}</b> groups.</div>
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Earnings history</h3><div style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="pill up">7-qtr beat streak</span><span className="link">View all →</span></div></div>
            <div className="card-b" style={{ paddingTop: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <div className="cd"><span className="num">99</span><span className="u">days to<br/>next ER</span></div>
                <div>
                  <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginBottom: 4 }}>Beat / miss streak</div>
                  <div className="streak">{[1,1,1,1,1,1,1,0].map((b, i) => <b key={i} style={{ background: b ? "var(--up)" : "var(--down)" }}>{b ? "B" : "M"}</b>)}</div>
                </div>
              </div>
              {[["Q1 25","$4.39 EPS","beat 12%"],["Q4 24","$4.10 EPS","beat 8%"],["Q3 24","$3.93 EPS","beat 6%"],["Q2 24","$3.73 EPS","beat 5%"]].map(([q, eps, res]) => (
                <div key={q} className="minirow"><span className="tkr" style={{ width: 60 }}>{q}</span><span className="mid mono">{eps}</span><span className="r up">{res}</span></div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Insider &amp; Institutional</h3><span className="link">View all →</span></div>
            <div className="card-b" style={{ paddingTop: 6 }}>
              <div style={{ fontSize: ".72rem", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-dim-solid)", margin: "2px 0 5px" }}>Recent insider transactions</div>
              {[{ dir: "buy", role: "CEO", val: "$42M", date: "May 18" }, { dir: "sell", role: "CFO", val: "$8.2M", date: "May 15" }].map((x, i) => (
                <div key={i} className="minirow"><span className="tkr" style={{ width: 60 }}>{x.date}</span><span className="mid">{x.dir === "buy" ? "Buy" : "Sell"} · {x.role}</span><span className={`r ${x.dir === "buy" ? "up" : "down"}`}>{x.dir === "buy" ? "+" : "−"}{x.val}</span></div>
              ))}
              <div style={{ height: 1, background: "var(--border-soft)", margin: "12px 0 8px" }} />
              <div style={{ fontSize: ".72rem", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-dim-solid)", marginBottom: 4 }}>Institutional</div>
              {[["Inst. ownership","66%","up"],["Short interest","1.1%","dim"],["13F funds holding","4 tracked","dim"]].map(([k, v, c]) => (
                <div key={k} className="minirow"><span className="mid">{k}</span><span className="r" style={{ color: c === "dim" ? "var(--text-hi)" : c === "up" ? "var(--up)" : "var(--down)" }}>{v}</span></div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Key levels (pivots)</h3><span className="link">View all →</span></div>
            <div className="card-b" style={{ paddingTop: 6 }}>
              {([["R2",1252.7,"down"],["R1",1217.2,"down"],["Pivot",1181.75,"dim"],["S1",1140.4,"up"],["S2",1099.0,"up"]] as [string,number,string][]).map(([lv, pr, c]) => (
                <div key={lv} className="minirow"><span className="tkr" style={{ width: 50 }}>{lv}</span><span className="mid" /><span className="r mono" style={{ color: c === "dim" ? "var(--text-hi)" : `var(--${c})` }}>${Math.round(pr as number).toLocaleString()}</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function StockThumb() {
  return (
    <ScaledScreen>
      <div style={{ padding: "20px 28px 0" }}>
        <StockDetailContent />
      </div>
    </ScaledScreen>
  );
}

function HeatmapThumb() {
  const k = 2.0;
  const page = sectorList.slice(0, 10);
  return (
    <ScaledScreen>
      <div className="page-head" style={{ padding: "28px 40px 20px" }}>
        <div><div className="eyebrow">Market Heatmap</div><h1 className="page-title">Where the day is leaning</h1><div className="page-sub">{sectorList.length} industry groups &middot; size = market cap, color = % change &middot; tap a tile to open it</div></div>
        <div className="tabs">{["Stocks","S&P 500","ETFs"].map((t, i) => <button key={t} className={`tab${i === 0 ? " active" : ""}`}>{t}</button>)}</div>
      </div>
      <div style={{ padding: "0 32px" }}>
        <div className="fbar">
          <button className="chip on">Color: % change</button><button className="chip">Size: Market cap</button>
          <div className="spacer" />
          <div className="legend" style={{ display: "flex", alignItems: "center", gap: 3, fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
            -3%&nbsp;
            {([-3, -1.5, -0.5, 0, 0.5, 1.5, 3] as number[]).map(v => {
              const { bg } = heatCol(v);
              return <i key={v} style={{ display: "inline-block", width: 22, height: 12, background: bg, borderRadius: 2 }} />;
            })}
            &nbsp;+3%
          </div>
        </div>
        <div className="card">
          <div className="card-b">
            <div className="treemap">
              {page.map(g => {
                const tot = g.items.reduce((s, it) => s + it[1], 0);
                return (
                  <div key={g.name} className="tm-sector" style={{ flex: `${Math.max(1, tot / 800)} 1 240px` }}>
                    <div className="sl" style={{ cursor: "pointer" }}>
                      <span>{g.name} <span className={cls(g.pctChange!)} style={{ fontFamily: "var(--f-mono)", fontWeight: 600 }}>{sign(g.pctChange!)}</span></span>
                      <span style={{ color: "var(--brand-2)", fontWeight: 600 }}>View all →</span>
                    </div>
                    <div className="tm-cells">
                      {g.items.map(it => {
                        const w = Math.max(56, Math.sqrt(it[1]) * k), h = Math.max(42, Math.sqrt(it[1]) * k * 0.62);
                        const fs = Math.max(.62, Math.min(1, Math.sqrt(it[1]) / 40));
                        const { bg, fg } = heatCol(it[2]);
                        return (
                          <div key={it[0]} className="tm-cell" style={{ width: w, height: h, background: bg }}>
                            <span className="tt" style={{ fontSize: `${fs}rem`, color: fg }}>{it[0]}</span>
                            <span className="tc" style={{ fontSize: `${fs * 0.8}rem`, color: fg, opacity: .85 }}>{sign(it[2])}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, fontSize: ".82rem" }}>
          <span style={{ color: "var(--text-dim-solid)" }}>Sectors <b style={{ color: "var(--text-hi)" }}>1–{page.length}</b> of {sectorList.length}</span>
          <span className="link">Show next 10 →</span>
        </div>
      </div>
    </ScaledScreen>
  );
}

function erH(s: string, i: number): number {
  return (Math.abs(s.charCodeAt(0) * 31 + (s.charCodeAt(1) || 7) * 17 + i * 13) % 97) / 97;
}
type EarnQ = { q: string; e: number; a: number; surp: number; mv: number };
function earnHistory(sym: string, price: number, pe: number): EarnQ[] {
  const base = Math.max(0.05, (price / (pe || 25)) / 4);
  const qs = ['Q2 25','Q1 25','Q4 24','Q3 24','Q2 24','Q1 24','Q4 23','Q3 23','Q2 23','Q1 23'];
  return qs.map((q, i) => {
    const r = erH(sym, i);
    const e = parseFloat((base * (1 - i * 0.03)).toFixed(2));
    const surp = parseFloat(((r - 0.4) * 18).toFixed(1));
    const a = parseFloat((e * (1 + surp / 100)).toFixed(2));
    const mv = parseFloat(((r - 0.45) * 22).toFixed(1));
    return { q, e, a, surp, mv };
  });
}
function EarnEpsChart({ hist }: { hist: EarnQ[] }) {
  const d = [...hist].reverse();
  const W = 580, H = 210, PADL = 30, PADR = 18, PADT = 14, PADB = 30;
  const iw = W - PADL - PADR, ih = H - PADT - PADB;
  const maxE = (Math.max(...d.map(x => Math.max(x.e, x.a))) || 1) * 1.15;
  const maxM = Math.max(1, ...d.map(x => Math.abs(x.mv)));
  const n = d.length, gw = iw / n, bw = gw * 0.28;
  const mid = PADT + ih / 2;
  const linePts = d.map((x, i) => {
    const cx = PADL + gw * i + gw / 2;
    const my = mid - (x.mv / maxM) * (ih / 2 - 8);
    return `${i === 0 ? 'M' : 'L'}${cx.toFixed(1)} ${my.toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }}>
      <line x1={PADL} y1={mid} x2={W - PADR} y2={mid} stroke="var(--border)" strokeDasharray="3 3" />
      {d.map((x, i) => {
        const cx = PADL + gw * i + gw / 2;
        const eh = x.e / maxE * ih, ah = x.a / maxE * ih;
        const ex = cx - bw - 2, ax = cx + 2;
        const my = mid - (x.mv / maxM) * (ih / 2 - 8);
        return (
          <g key={i}>
            <rect x={ex.toFixed(1)} y={(PADT + ih - eh).toFixed(1)} width={bw.toFixed(1)} height={eh.toFixed(1)} rx={2} fill="var(--surface-3)" />
            <rect x={ax.toFixed(1)} y={(PADT + ih - ah).toFixed(1)} width={bw.toFixed(1)} height={ah.toFixed(1)} rx={2} fill={x.surp >= 0 ? "var(--up)" : "var(--down)"} />
            <circle cx={cx.toFixed(1)} cy={my.toFixed(1)} r={2.6} fill="var(--brand-2)" />
            {(i % 2 === 0 || i === n - 1) && <text x={cx.toFixed(1)} y={H - 10} textAnchor="middle" fill="var(--text-dim-solid)" fontSize={9}>{x.q.replace(' ', '’')}</text>}
          </g>
        );
      })}
      <path d={linePts} fill="none" stroke="var(--brand-2)" strokeWidth={1.6} />
    </svg>
  );
}

function EcChip({ e, selected }: { e: { ticker: string; name: string }; selected: boolean }) {
  return (
    <button className={`ec-chip${selected ? " on" : ""}`}>
      <span className="ec-logo" style={{ background: "#27314a", color: "#cdd6e6", position: "relative" }}>
        {e.ticker[0]}
      </span>
      {e.ticker}
    </button>
  );
}

function EarningsThumb() {
  const ranges = [["yest","Yesterday"],["today","Today"],["tom","Tomorrow"],["week","This Week"],["next","Next Week"],["prev","Last Week"],["month","Month"]];
  const days = ["Mon","Tue","Wed","Thu","Fri"];
  const bmo = earnings.filter(e => e.session.includes("pre"));
  const amc = earnings.filter(e => e.session.includes("post"));
  const sel = earnings[0];
  const hist = earnHistory("NVDA", 1181.75, 71.4);
  const beats = hist.filter(h => h.surp > 0).length;
  const avgMv = (hist.reduce((a, h) => a + Math.abs(h.mv), 0) / hist.length).toFixed(1);
  return (
    <ScaledScreen>
      <div className="page-head" style={{ padding: "28px 40px 20px" }}>
        <div><div className="eyebrow">Earnings Workspace</div><h1 className="page-title">Earnings Calendar</h1><div className="page-sub">Company logos by day &middot; before-open vs after-close &middot; or switch to <b style={{ color: "var(--text-hi)" }}>Month</b> for the full calendar</div></div>
        <div className="tabs">{ranges.map(([k, l], i) => <button key={k} className={`tab${i === 3 ? " active" : ""}`}>{l}</button>)}</div>
      </div>
      <div style={{ padding: "0 32px" }}>
        <div className="ec-grid">
          {days.map((day, di) => {
            const bmoDay = earnings.slice(di * 2, di * 2 + 2).filter(e => e.session.includes("pre"));
            const amcDay = earnings.slice(di * 2, di * 2 + 2).filter(e => e.session.includes("post"));
            return (
              <div key={day} className={`ec-day${di === 1 ? " is-today" : ""}`}>
                <div className="ec-dh">{day}{di === 1 && " · Today"}</div>
                <div className="ec-sess">
                  <div className="ec-lbl">Before open</div>
                  {bmo.slice(di, di + 2).length ? bmo.slice(di, di + 2).map(e => <EcChip key={e.ticker} e={e} selected={e.ticker === sel.ticker} />) : <span className="ec-none">—</span>}
                </div>
                <div className="ec-sess">
                  <div className="ec-lbl">After close</div>
                  {amc.slice(di, di + 2).length ? amc.slice(di, di + 2).map(e => <EcChip key={e.ticker} e={e} selected={false} />) : <span className="ec-none">—</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="dash" style={{ marginTop: 16 }}>
          <div className="col-7">
            <div className="card">
              <div className="card-h"><h3>{sel.ticker} &middot; 10-quarter earnings history</h3><span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>{beats}/10 beats</span></div>
              <div className="card-b" style={{ paddingTop: 8 }}>
                <div className="ec-legend"><span><i style={{ background: "var(--surface-3)" }} />EPS estimate</span><span><i style={{ background: "var(--up)" }} />Beat</span><span><i style={{ background: "var(--down)" }} />Miss</span><span><i className="ln" style={{ background: "var(--brand-2)" }} />Stock move %</span></div>
                <EarnEpsChart hist={hist} />
              </div>
            </div>
          </div>
          <div className="col-5">
            <div className="card">
              <div className="card-h"><h3>Income statement</h3><span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>Quarterly</span></div>
              <div className="card-b" style={{ paddingTop: 8 }}>
                <div className="ec-legend"><span><i style={{ background: "var(--brand)" }} />Revenue</span><span><i style={{ background: "var(--ai)" }} />Gross profit</span><span><i style={{ background: "var(--up)" }} />Net income</span></div>
                <EarnIncChart />
              </div>
            </div>
          </div>
        </div>
        <div className="ai-block" style={{ marginTop: 2 }}>
          <div className="card-h"><h3 className="ai-c">&#9670; AI earnings read &middot; {sel.ticker}</h3></div>
          <div className="card-b"><p style={{ fontSize: ".85rem", lineHeight: 1.6, color: "var(--text)" }}>NVDA beat EPS estimates. Guidance was raised — bullish. History shows <b style={{ color: "var(--text-hi)" }}>{beats}/10 beats</b> and an average post-print move of <b style={{ color: "var(--text-hi)" }}>{avgMv}%</b>. Watch revenue growth and forward guidance most.</p></div>
        </div>
      </div>
    </ScaledScreen>
  );
}

function AnalystThumb() {
  const clusters = [{ s: "NVDA", name: "NVIDIA", up: 6, down: 0, n30: 6 }, { s: "CRM", name: "Salesforce", up: 2, down: 0, n30: 3 }];
  const multiUpgrades = [{ s: "CRM", up: 2 }, { s: "AMD", up: 2 }];
  return (
    <ScaledScreen>
      <div className="page-head" style={{ padding: "28px 40px 20px" }}>
        <div><div className="eyebrow">Analyst Actions</div><h1 className="page-title">Upgrades &amp; Downgrades</h1><div className="page-sub">Back-end flags stocks with 5+ actions in 30 days, and names drawing 2–3 upgrades</div></div>
        <div className="tabs">{["All","Upgrades","Downgrades","Initiations","PT changes"].map((t, i) => <button key={t} className={`tab${i === 0 ? " active" : ""}`}>{t}</button>)}</div>
      </div>
      <div style={{ padding: "0 32px" }}>
        <div className="dash" style={{ marginBottom: 14 }}>
          <div className="col-6">
            <div className="card" style={{ borderColor: "var(--warn)" }}>
              <div className="card-h"><h3>&#128293; Cluster alert &middot; 5+ actions / 30d</h3><span className="pill" style={{ background: "var(--surface-3)", color: "var(--warn)" }}>high conviction</span></div>
              <div className="card-b" style={{ paddingTop: 4 }}>
                {clusters.map(c => (
                  <div key={c.s} className="minirow"><span className="tkr">{c.s}</span><span className="mid">{c.name} &middot; {c.up} up / {c.down} down</span><span className="r" style={{ color: "var(--warn)", fontWeight: 700 }}>{c.n30} /30d</span></div>
                ))}
              </div>
            </div>
          </div>
          <div className="col-6">
            <div className="card">
              <div className="card-h"><h3>&#9650; Multiple upgrades (2–3)</h3><span className="pill up">trend turning</span></div>
              <div className="card-b" style={{ paddingTop: 4 }}>
                {multiUpgrades.map(c => (
                  <div key={c.s} className="minirow"><span className="tkr">{c.s}</span><span className="mid">{c.up} upgrades recently</span><span className="r up" style={{ fontWeight: 700 }}>&#9650; {c.up}</span></div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="fbar">
          <button className="chip on">My names</button><button className="chip">PT &gt;15% move</button><button className="chip">Clusters only</button><div className="spacer" />
        </div>
        <div className="dash">
          <div className="col-8">
            <div className="card">
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Company</th><th>Firm</th><th>Action</th><th>Rating</th><th className="num">Price Target</th><th className="num">Reaction</th><th className="num">Activity</th></tr></thead>
                  <tbody>
                    {analyst.map((a, i) => (
                      <tr key={i} style={{ cursor: "pointer" }}>
                        <td><div className="co"><span className="s">{a.ticker}</span><span className="n">{a.name}</span></div></td>
                        <td>{a.firm}</td>
                        <td>{a.actionType === "up" ? <span className="pill up">&#9650; Upgrade</span> : a.actionType === "down" ? <span className="pill dn">&#9660; Downgrade</span> : a.actionType === "init" ? <span className="pill ai">&#9670; Initiate</span> : <span className="pill hold">Reiterate</span>}</td>
                        <td><span style={{ color: "var(--text-dim-solid)" }}>{a.previousRating}</span> &rarr; <b style={{ color: "var(--text-hi)" }}>{a.newRating}</b></td>
                        <td className="num">{a.prevPriceTarget ? `$${a.prevPriceTarget}` : "—"} &rarr; <b style={{ color: "var(--text-hi)" }}>${a.newPriceTarget}</b></td>
                        <td className={`num ${cls(a.priceChangeSince)}`}>{sign(a.priceChangeSince)}</td>
                        <td className="num">{a.actionsLast30Days}&times; /30d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="col-4">
            <div className="ai-block">
              <div className="card-h"><h3 className="ai-c">&#9670; AI take &middot; CRM cluster</h3></div>
              <div className="card-b">
                <p style={{ fontSize: ".85rem", lineHeight: 1.6, color: "var(--text)" }}>CRM has drawn <b style={{ color: "var(--text-hi)" }}>two upgrades</b> this week with PTs to $330–340. NVDA shows a <b style={{ color: "var(--text-hi)" }}>6-action cluster</b> in 30 days — dense coverage that often precedes continued momentum.</p>
                <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span className="src-chip">CRM: 2 upgrades</span><span className="src-chip">NVDA: 6 / 30d</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScaledScreen>
  );
}

function PortfolioThumb() {
  const dayPL = folio.reduce((s, f) => s + f.pctChange * f.price * 0.005, 0);
  const tot = 128430;
  return (
    <ScaledScreen>
      <div className="page-head" style={{ padding: "28px 40px 20px" }}>
        <div><div className="eyebrow">Portfolio Pulse</div><h1 className="page-title">Portfolio Pulse</h1><div className="page-sub">{folio.length} holdings &middot; ${tot.toLocaleString()} &middot; <span className="up">+${Math.round(dayPL).toLocaleString()} today</span></div></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M4 16l5-5 4 4 3-3 4 4" /><circle cx="8.5" cy="8.5" r="1.5" /></svg> Import from photo</button>
          <button className="btn primary"><svg viewBox="0 0 24 24" fill="none" style={{ width: 15, height: 15 }}><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> Add holding</button>
        </div>
      </div>
      <div style={{ padding: "0 32px" }}>
        <div className="ai-block" style={{ marginBottom: 14 }}>
          <div className="card-h"><h3 className="ai-c">&#9670; AI portfolio summary</h3><span className="pill ai">drivers &middot; leaders &middot; laggards</span></div>
          <div className="card-b">
            <ul className="wmn-body" style={{ columns: 2 }}>
              <li><span className="bullet" /><span><b>Biggest driver:</b> <b style={{ color: "var(--text-hi)" }}>NVDA</b> — +8.23% at 28% weight.</span></li>
              <li><span className="bullet" /><span><b>Leader:</b> <b className="up">NVDA +8.23%</b>; <b>laggard:</b> <b className="down">HD -1.10%</b>.</span></li>
              <li><span className="bullet" /><span><b>Net:</b> {folio.filter(h => h.pctChange > 0).length} of {folio.length} green today.</span></li>
              <li><span className="bullet" /><span>Click any holding on the left to open its full detail →</span></li>
            </ul>
          </div>
        </div>
        <div className="pf-master">
          <div className="pf-side">
            <div className="card">
              <div className="card-h"><h3>Holdings</h3><span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>{folio.length} names</span></div>
              <div className="pf-list">
                {folio.map((f, i) => (
                  <div key={f.ticker} className={`pf-li${i === 0 ? " active" : ""}`}>
                    <div><span className="s">{f.ticker}</span><span className="n">{f.name}</span></div>
                    <div className="pf-spark"><Spark idx={i + 3} up={f.pctChange >= 0} /></div>
                    <div><span className="px">${fmt(f.price, 2)}</span><span className={`ch ${cls(f.pctChange)}`}>{sign(f.pctChange)}</span></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="pf-detail">
            <div className="pf-ctx">
              {[["Shares","48"],["Market value","$56,724"],["Weight","28.4%"],["Day","+8.23%"],["Unrealized G/L","+$23,188"],["Conviction","High"]].map(([k, v]) => (
                <div key={k} className="m"><span className="k">{k}</span><span className="v">{k === "Conviction" ? <span className="pill up">{v}</span> : v}</span></div>
              ))}
              <div className="sp" />
              <button className="btn">Trim &frac12;</button>
              <button className="btn">Sell all</button>
            </div>
            <StockDetailContent />
          </div>
        </div>
      </div>
    </ScaledScreen>
  );
}

function RecapsThumb() {
  return (
    <ScaledScreen>
      <div className="page-head" style={{ padding: "28px 40px 20px" }}>
        <div><div className="eyebrow">Recaps</div><h1 className="page-title">End-of-Day Recap</h1><div className="page-sub">Tuesday, May 21 &middot; auto-generated 4:31 ET</div></div>
        <div className="tabs">
          <button className="tab active">Today (EOD)</button>
          <button className="tab">This Week</button>
        </div>
      </div>
      <div style={{ padding: "0 32px" }}>
        <div className="rcp-idx">
          {pulse.slice(0, 6).map((p, i) => (
            <div key={p.label} className="rcp-box">
              <div className="rcp-bl">{p.label}</div>
              <div className="rcp-bv">{fmt(p.value, p.value > 1000 ? 0 : 2)}</div>
              <div className={`rcp-bc ${cls(p.change)}`}>{sign(p.change)}</div>
              <div className="rcp-bs"><Spark idx={i + 1} up={p.change >= 0} /></div>
            </div>
          ))}
        </div>
        <div className="recap-hero">
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14 }}>
            <div className="wmn-orb"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9z" fill="currentColor" /></svg></div>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)", cursor: "pointer" }}>{recap.headline} <span style={{ fontSize: ".7rem", color: "var(--brand-2)", fontWeight: 600 }}>↓ open PDF</span></div>
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
            {recap.indices.map(x => (
              <div key={x.label}><div style={{ fontSize: ".7rem", color: "var(--text-dim-solid)" }}>{x.label}</div><div className={`mono ${cls(x.value)}`} style={{ fontSize: "1.25rem", fontWeight: 700 }}>{sign(x.value)}</div></div>
            ))}
            <div style={{ marginLeft: "auto" }}><button className="btn ai">&#9654; 60-sec audio recap</button></div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", fontWeight: 600, letterSpacing: ".03em" }}>DOWNLOAD PDF:</span>
            {["Today (EOD)", "Yesterday", "Last week"].map(l => (
              <button key={l} className="btn"><svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> {l}</button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 14 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}><div className="eyebrow">Key stories</div><span className="link">View all →</span></div>
              {recap.stories.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 8, padding: "6px 0", fontSize: ".84rem" }}><span className="bullet" style={{ marginTop: 6 }} /><span>{s}</span></div>
              ))}
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}><div className="eyebrow">Up next · tomorrow</div><span className="link">View all →</span></div>
              {recap.tomorrow.map((t, i) => (
                <div key={i} className="minirow"><span className="mono" style={{ width: 54, color: "var(--warn)" }}>{t.time}</span><span className="mid">{t.event}</span></div>
              ))}
            </div>
          </div>
        </div>
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h"><h3>Sector heatmap</h3><span className="link">View all →</span></div>
          <div className="card-b">
            <div className="heat">
              {sectorList.slice(0, 10).map(s => {
                const hc = heatCol(s.pctChange!);
                return <div key={s.name} className="s" style={{ cursor: "pointer", background: hc.bg }}><div className="nm" style={{ color: hc.fg }}>{s.name}</div><div className="v" style={{ color: hc.fg }}>{sign(s.pctChange!)}</div></div>;
              })}
            </div>
          </div>
        </div>
        <div className="dash" style={{ marginTop: 14 }}>
          <div className="col-6">
            <div className="card">
              <div className="card-h"><h3>Biggest earnings movers</h3><span className="link">View all →</span></div>
              <div className="card-b" style={{ paddingTop: 6 }}>
                {recap.movers.map(m => (
                  <div key={m.ticker} className="minirow"><span className="tkr">{m.ticker}</span><span className="mid">{m.reason}</span><span className={`r ${cls(m.pctChange)}`}>{sign(m.pctChange)}</span></div>
                ))}
              </div>
            </div>
          </div>
          <div className="col-6">
            <div className="card">
              <div className="card-h"><h3>Market internals</h3><span className="link">View all →</span></div>
              <div className="card-b" style={{ paddingTop: 6 }}>
                {recap.internals.map(r => (
                  <div key={r.label} className="minirow"><span className="mid">{r.label}</span><span className={`r ${r.direction > 0 ? "up" : "down"}`}>{r.value}</span></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScaledScreen>
  );
}

// ---- Workspace list ----
type WS = { n: string; d: string; long: string; chips: string[]; feats: string[]; Thumb: React.FC };

const WS_LIST: WS[] = [
  {
    n: "Dashboard", d: "Your morning brief at a glance.",
    long: "The first thing you see each morning: live indices, a What-Matters-Now AI brief, and a launchpad into every other workspace — the whole market in one screen.",
    chips: ["Indices", "What Matters Now", "AI brief"],
    feats: ["Live index pulse with count-up tickers and sparklines","An AI 'what matters now' brief parsed from the tape","Quick cards into movers, earnings and analyst flow","Animated, glanceable, refreshed through the day"],
    Thumb: DashThumb,
  },
  {
    n: "Market Movers", d: "Top winners & losers, with the why.",
    long: "The day's biggest movers ranked, each with the catalyst behind the move — filter by sector or market cap and hover any name to see why it is running.",
    chips: ["Gainers", "Losers", "Catalysts"],
    feats: ["Top 15 winners and losers, ranked by move","Plain-English catalyst on every row","Sector and market-cap filters","Hover a ticker for the reason in context"],
    Thumb: MoversThumb,
  },
  {
    n: "Stock Detail", d: "One page, the whole story.",
    long: "Everything on one name in a single view: an interactive chart with overlays, fundamentals, ratings, key levels and an AI read that explains what actually moved it.",
    chips: ["Charting", "Fundamentals", "AI read"],
    feats: ["Interactive chart — candles, MA/EMA, 5 chart types","Fundamentals, ratings and analyst targets","Key levels, peers and earnings-history trays","An AI read explaining the move in plain English"],
    Thumb: StockThumb,
  },
  {
    n: "Market Heatmap", d: "The whole market in one glance.",
    long: "A treemap of the entire market by sector and size, colored by performance — spot leadership, rotation and breadth in a single look.",
    chips: ["By sector", "By size", "Performance"],
    feats: ["Every sector sized by market cap","Colored by performance, green to red","Instantly see leadership and rotation","Tap a tile to drill into the name"],
    Thumb: HeatmapThumb,
  },
  {
    n: "Earnings", d: "Who reports, and how they have done.",
    long: "An earnings hub with a logo calendar, ten quarters of beat/miss history and graphical income statements — see the setup before the print.",
    chips: ["Calendar", "10-qtr history", "Income"],
    feats: ["Calendar of upcoming reports with logos","10-quarter EPS beat/miss history","Graphical income statements","Surprise and reaction at a glance"],
    Thumb: EarningsThumb,
  },
  {
    n: "Analyst Actions", d: "Upgrades, downgrades, targets.",
    long: "Every rating change and price-target move in one feed, with detection of clusters where five or more analysts move on the same name in a window.",
    chips: ["Ratings", "Price targets", "Clusters"],
    feats: ["Upgrades, downgrades and initiations","From/to ratings and price-target deltas","5+ action cluster detection","Implied upside vs the current price"],
    Thumb: AnalystThumb,
  },
  {
    n: "Portfolio Pulse", d: "Your book, explained.",
    long: "An AI read of your holdings — what drove the day, who led and lagged, and your P/L — with one click into the detail on any position.",
    chips: ["Drivers", "Day P/L", "AI summary"],
    feats: ["AI summary of what moved your book","Day P/L with leaders and laggards","Drill into any holding's full detail","Concentration and driver breakdown"],
    Thumb: PortfolioThumb,
  },
  {
    n: "Recaps", d: "The day, in seven cards.",
    long: "Executive end-of-day recaps you swipe through — what happened, why, technicals, fundamentals, macro and the AI verdict — read, download or schedule by email.",
    chips: ["Swipeable", "7 sections", "Schedulable"],
    feats: ["Seven-card swipeable briefing per name","What happened → why → technical → verdict","Download or schedule by email","Day and week modes"],
    Thumb: RecapsThumb,
  },
];

// ---- Logo SVG ----
function LogoMark({ size = 17 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none">
      <path d="M3 17l5-6 4 4 6-9" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="20" cy="5.5" r="2.4" fill="#fff"/>
    </svg>
  );
}

// ---- Google SVG ----
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path fill="#fff" d="M21.35 11.1h-9.18v2.96h5.3c-.23 1.4-1.65 4.1-5.3 4.1-3.19 0-5.8-2.64-5.8-5.9s2.61-5.9 5.8-5.9c1.82 0 3.04.78 3.74 1.45l2.55-2.46C16.9 3.6 14.76 2.7 12.17 2.7 7.03 2.7 2.9 6.84 2.9 12s4.13 9.3 9.27 9.3c5.35 0 8.9-3.76 8.9-9.06 0-.61-.07-1.07-.16-1.54z"/>
    </svg>
  );
}

// ---- Main component ----
export default function LandingPage() {
  const trackRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const capRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const glbgRef = useRef<HTMLCanvasElement>(null);

  const [glanceIdx, setGlanceIdx] = useState<number | null>(null);
  const [authMode, setAuthMode] = useState<"signup" | "login">("signup");
  const [authOpen, setAuthOpen] = useState(false);

  // Scroll-driven marquee animation
  useEffect(() => {
    function tick() {
      const track = trackRef.current;
      const row = rowRef.current;
      if (track && row) {
        const r = track.getBoundingClientRect();
        const range = track.offsetHeight - window.innerHeight;
        const p = range > 0 ? Math.min(1, Math.max(0, -r.top / range)) : 0;

        const cards = Array.from(row.children) as HTMLElement[];
        const N = cards.length;
        if (N > 0) {
          const f = p * (N - 1);
          const cardW = cards[0].offsetWidth || 370;
          const step = cardW + 40;
          const stageW = window.innerWidth;
          row.style.transform = `translateX(${(stageW / 2 - (f * step + cardW / 2)).toFixed(1)}px)`;

          const fi = Math.round(f);
          cards.forEach((c, i) => {
            const dist = Math.abs(i - f);
            const visible = dist <= 1.4;
            if (!visible) {
              c.style.opacity = "0";
              c.style.transform = "scale(0.6)";
              (c.style as CSSStyleDeclaration & { zIndex: string }).zIndex = "0";
              c.style.pointerEvents = "none";
              c.classList.remove("front");
              return;
            }
            const scale = (dist < 0.5 ? 1.05 : Math.max(0.58, 1.05 - dist * 0.62)).toFixed(3);
            c.style.transform = `scale(${scale})`;
            c.style.opacity = Math.max(0.45, 1 - dist * 0.52).toFixed(2);
            c.style.pointerEvents = "auto";
            (c.style as CSSStyleDeclaration & { zIndex: string }).zIndex = i === fi ? "5" : "1";
            if (i === fi) c.classList.add("front");
            else c.classList.remove("front");
          });

          if (capRef.current) {
            capRef.current.textContent = fi < WS_LIST.length ? WS_LIST[fi].n : "And many more";
          }
          if (barRef.current) {
            barRef.current.style.width = `${(p * 100).toFixed(1)}%`;
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Reveal on scroll
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach(e => e.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      entries => entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }),
      { threshold: 0.12 }
    );
    els.forEach(e => io.observe(e));
    return () => io.disconnect();
  }, []);

  // Body scroll lock when modal open
  useEffect(() => {
    document.body.style.overflow = glanceIdx !== null || authOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [glanceIdx, authOpen]);

  // WebGL wave background (three animated sine-noise lines)
  useEffect(() => {
    const cv = glbgRef.current;
    if (!cv) return;
    const gl = (cv.getContext("webgl") || cv.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return;

    const vs = `attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}`;
    const fs = `precision highp float;
    uniform vec2 res; uniform float t; uniform vec3 cA; uniform vec3 cB;
    float hash(float n){return fract(sin(n)*43758.5453);}
    float n1(float x){float i=floor(x);float f=fract(x);float u=f*f*(3.0-2.0*f);return mix(hash(i),hash(i+1.0),u);}
    float fbm(float x){return 0.5*n1(x)+0.25*n1(x*2.0+3.1)+0.125*n1(x*4.0+7.7);}
    void main(){
      vec2 uv=gl_FragCoord.xy/res.xy;
      float vig=smoothstep(1.3,0.1,length(uv-0.5));
      vec3 col=mix(vec3(0.010,0.016,0.034),vec3(0.020,0.038,0.082),vig);
      vec2 cell=fract(uv*vec2(30.0,18.0));
      float gd=min(min(cell.x,1.0-cell.x),min(cell.y,1.0-cell.y));
      float grid=smoothstep(0.026,0.0,gd);
      col+=mix(cA,cB,0.5)*grid*0.05;
      float xA=uv.x*3.2+t*0.06;
      float yA=0.40+0.14*fbm(xA*2.0)+0.04*sin(uv.x*7.0+t*0.25)+uv.x*0.10;
      float lA=smoothstep(0.014,0.0,abs(uv.y-yA));
      float areaA=clamp(yA-uv.y,0.0,1.0)*step(uv.y,yA);
      col+=cB*lA;
      col+=cB*areaA*0.05;
      float xB=uv.x*3.2-t*0.045+13.0;
      float yB=0.58+0.12*fbm(xB*2.0+5.0)-uv.x*0.05;
      float lB=smoothstep(0.012,0.0,abs(uv.y-yB));
      col+=cA*lB*0.8;
      float xC=uv.x*2.4+t*0.03+27.0;
      float yC=0.26+0.08*fbm(xC*2.0+9.0);
      col+=mix(cA,cB,0.5)*smoothstep(0.008,0.0,abs(uv.y-yC))*0.4;
      for(int i=0;i<5;i++){float fi=float(i);vec2 c=vec2(fract(hash(fi*3.1)+t*0.01*(hash(fi*2.0)-0.5)),fract(hash(fi*5.3)+t*0.008));float d=length(uv-c);float g=smoothstep(0.34,0.0,d);col+=mix(cA,cB,hash(fi*7.0))*g*0.045;}
      col=col/(col+0.82);
      gl_FragColor=vec4(col,1.0);
    }`;

    function compileShader(type: number, src: string) {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      return s;
    }
    const pr = gl.createProgram()!;
    gl.attachShader(pr, compileShader(gl.VERTEX_SHADER, vs));
    gl.attachShader(pr, compileShader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(pr);
    gl.useProgram(pr);

    const bf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const lp = gl.getAttribLocation(pr, "p");
    gl.enableVertexAttribArray(lp);
    gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(pr, "res");
    const uT   = gl.getUniformLocation(pr, "t");
    const uA   = gl.getUniformLocation(pr, "cA");
    const uB   = gl.getUniformLocation(pr, "cB");
    gl.uniform3f(uA, 0.486, 0.424, 0.961);
    gl.uniform3f(uB, 0.204, 0.886, 0.941);

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      cv!.width  = Math.floor(window.innerWidth * dpr);
      cv!.height = Math.floor(window.innerHeight * dpr);
      gl!.viewport(0, 0, cv!.width, cv!.height);
    }
    resize();
    window.addEventListener("resize", resize);

    const t0 = performance.now();
    let animId = 0;
    function frame(now: number) {
      gl!.uniform2f(uRes, cv!.width, cv!.height);
      gl!.uniform1f(uT, (now - t0) / 1000);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      animId = requestAnimationFrame(frame);
    }
    animId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  function openAuth(mode: "signup" | "login") {
    setGlanceIdx(null);
    setAuthMode(mode);
    setAuthOpen(true);
  }

  function scrollToCard(idx: number) {
    const track = trackRef.current;
    const row = rowRef.current;
    if (!track || !row) return;
    const N = row.children.length;
    const range = track.offsetHeight - window.innerHeight;
    window.scrollTo({ top: track.offsetTop + (idx / (N - 1)) * range, behavior: "smooth" });
  }

  async function handleLandingGoogle() {
    try {
      const result = await signInWithPopup(firebaseAuth, googleAuthProvider);
      await completeGoogleLogin(result);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        await signInWithRedirect(firebaseAuth, googleAuthProvider);
      } else {
        window.alert(getAuthErrorMessage(err));
      }
    }
  }

  const glanceWs = glanceIdx !== null ? WS_LIST[glanceIdx] : null;

  return (
    <>
    <canvas ref={glbgRef} className="sp-glbg" />
    <div className="lp-root mq-root">
      <div className="sp-aurora">
        <i className="a1" /><i className="a2" /><i className="a3" />
      </div>

      <div className="hw">

        {/* ---- NAV ---- */}
        <nav className="hw-nav">
          <Link href="/" className="hw-brand">
            <span className="hw-logo"><LogoMark /></span>
            MarketCatalyst
          </Link>
          <div className="hw-nav-cta">
            <button className="hw-ghost" onClick={() => openAuth("login")}>Log in</button>
            <button className="hw-solid" onClick={() => openAuth("signup")}>Sign up</button>
          </div>
        </nav>

        {/* ---- HERO ---- */}
        <section className="mq-hero">
          <div className="mq-kicker">MarketCatalyst · Market Intelligence</div>
          <h1 className="mq-title">Every market view.<br />One scroll.</h1>
          <p className="mq-sub">
            The entire market, narrated. Scroll through every research view — movers, earnings, analysts, your book — each with an AI read that tells you <em>what</em> moved, and <em>why</em>. Ticker to thesis, without leaving the page.
          </p>
          <div className="mq-scrollcue">
            <span>Scroll</span>
            <i />
          </div>
        </section>

        {/* ---- MARQUEE TRACK ---- */}
        <section className="mq-track" ref={trackRef}>
          <div className="mq-stage">
            <div className="mq-progress"><i ref={barRef as React.RefObject<HTMLElement>} /></div>
            <div className="mq-row" ref={rowRef}>
              {WS_LIST.map((ws, i) => {
                const Thumb = ws.Thumb;
                return (
                  <div key={ws.n} className="mq-card" onClick={(e) => {
                    if (e.currentTarget.classList.contains("front")) openAuth("signup");
                    else scrollToCard(i);
                  }}>
                    <div className="mq-head">
                      <div className="mq-num">Workspace {String(i + 1).padStart(2, "0")} / {String(WS_LIST.length).padStart(2, "0")}</div>
                      <h3>{ws.n}</h3>
                      <p>{ws.d}</p>
                    </div>
                    <div className="mq-shot"><Thumb /></div>
                  </div>
                );
              })}
              {/* "And many more" card */}
              <div className="mq-card mq-more" onClick={(e) => {
                const row = rowRef.current;
                if (!row) return;
                const lastIdx = row.children.length - 1;
                if (e.currentTarget.classList.contains("front")) openAuth("signup");
                else scrollToCard(lastIdx);
              }}>
                <div className="mq-more-inner">
                  <h3>And many more</h3>
                  <p>Screener, IPOs, Watchlist, Insider & 13F, Commentary, Macro & VIX — fourteen connected workspaces in all.</p>
                  <div className="mq-go">See everything →</div>
                </div>
                <div className="mq-more-hint">Keep scrolling ↓</div>
              </div>
            </div>
            <div className="mq-cap" ref={capRef}>Dashboard</div>
            <div className="mq-hint">scroll — or tap a card to open it</div>
          </div>
        </section>

        {/* ---- GLANCE MODAL ---- */}
        {glanceIdx !== null && glanceWs && (
          <div className="mq-glance open">
            <div className="mqg-scrim" onClick={() => setGlanceIdx(null)} />
            <div className="mqg-panel">
              <button className="mqg-x" onClick={() => setGlanceIdx(null)}>✕</button>
              <div className="mqg-body">
                <div className="mqg-shot">
                  <glanceWs.Thumb />
                </div>
                <div className="mqg-info">
                  <div className="mqg-kicker">
                    Workspace {String(glanceIdx + 1).padStart(2, "0")} / {String(WS_LIST.length).padStart(2, "0")}
                  </div>
                  <h2>{glanceWs.n}</h2>
                  <p>{glanceWs.long}</p>
                  <ul className="mqg-feat">
                    {glanceWs.feats.map(f => <li key={f}>{f}</li>)}
                  </ul>
                  <div className="mqg-cta">
                    <button className="mqp-btn solid" onClick={() => openAuth("signup")}>
                      Open {glanceWs.n} →
                    </button>
                    <button className="mqp-btn" onClick={() => setGlanceIdx(null)}>Back to tour</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ---- AUTH MODAL ---- */}
        {authOpen && (
          <div className="auth-modal open">
            <div className="auth-scrim" onClick={() => setAuthOpen(false)} />
            <div className="auth-panel">
              <button className="mqg-x" onClick={() => setAuthOpen(false)}>✕</button>
              <div className="au-head">
                <span className="hw-logo"><LogoMark size={15} /></span>
                MarketCatalyst
              </div>
              <div className="au-tabs">
                <button className={`au-tab${authMode === "signup" ? " on" : ""}`} onClick={() => setAuthMode("signup")}>Sign up</button>
                <button className={`au-tab${authMode === "login" ? " on" : ""}`} onClick={() => setAuthMode("login")}>Log in</button>
              </div>
              {authMode === "signup" ? (
                <>
                  <h3 className="au-title">Create your free account</h3>
                  <Link href="/auth/signup" className="au-cta">Create account →</Link>
                  <div className="au-or">or</div>
                  <button className="au-google" onClick={handleLandingGoogle}><GoogleIcon />Continue with Google</button>
                  <p className="au-fine">Free to start. No credit card required.</p>
                </>
              ) : (
                <LoginForm />
              )}
            </div>
          </div>
        )}

        {/* ---- PRICING ---- */}
        <section className="mq-pricing">
          <div className="mq-kicker" style={{ textAlign: "center" }}>Pricing</div>
          <h2 className="mqp-title">One terminal. Simple plans.</h2>
          <div className="mqp-grid">
            <div className="mqp-card">
              <div className="mqp-tier">Starter</div>
              <div className="mqp-price">$0<span>/mo</span></div>
              <p className="mqp-d">Explore the whole terminal with delayed data.</p>
              <ul className="mqp-feat">
                <li>All 14 workspaces</li>
                <li>Delayed market data</li>
                <li>Daily EOD recap</li>
              </ul>
              <button className="mqp-btn" onClick={() => openAuth("signup")}>Start free</button>
            </div>
            <div className="mqp-card hot">
              <div className="mqp-flag">Most popular</div>
              <div className="mqp-tier">Pro</div>
              <div className="mqp-price">$29<span>/mo</span></div>
              <p className="mqp-d">Real-time research for active investors.</p>
              <ul className="mqp-feat">
                <li>Real-time data &amp; alerts</li>
                <li>AI read in every view</li>
                <li>Portfolio &amp; watchlist AI</li>
                <li>Scheduled recaps</li>
              </ul>
              <button className="mqp-btn solid" onClick={() => openAuth("signup")}>Go Pro</button>
            </div>
            <div className="mqp-card">
              <div className="mqp-tier">Elite</div>
              <div className="mqp-price">$79<span>/mo</span></div>
              <p className="mqp-d">Maximum firepower for serious investors.</p>
              <ul className="mqp-feat">
                <li>Everything in Pro</li>
                <li>Multi-portfolio &amp; 13F tracking</li>
                <li>Custom alert rules</li>
                <li>API &amp; data export</li>
                <li>Priority support</li>
              </ul>
              <button className="mqp-btn" onClick={() => openAuth("signup")}>Go Elite</button>
            </div>
          </div>
        </section>

        {/* ---- FINAL CTA ---- */}
        <div className="hw-final" style={{ borderTop: "1px solid #1c1c1c" }}>
          <h2 className="mqp-title" style={{ fontSize: "2rem" }}>Start your research in one place</h2>
          <div className="hw-cta" style={{ justifyContent: "center", marginTop: "18px" }}>
            <button className="mqp-btn solid" style={{ minWidth: "230px" }} onClick={() => openAuth("signup")}>
              Open the terminal →
            </button>
          </div>
          <p style={{ fontSize: ".74rem", color: "#666", marginTop: "16px" }}>
            MarketCatalyst is a research terminal for informational purposes — not investment advice.
          </p>
        </div>

      </div>
    </div>
    </>
  );
}
