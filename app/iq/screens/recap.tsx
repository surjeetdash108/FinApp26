"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useIQActions } from "../shell";
import { cls, sign, StockLogo, DataState, NotAvailable } from "../utils";
import { useApiList } from "../hooks/useApiList";
import { useTapeStream } from "../hooks/useTapeStream";
import { tapeItemsToIndexDocs } from "../live-market-indices";
import type { SectorApiDoc, LiveEarningsDoc, NewsArticleDoc, MacroEventDoc } from "../types";

const SEC_PAGE = 10;
const TABS = ["Today (EOD)", "This Week"];
const MAJOR_INDEX_LABELS = ["S&P 500", "Nasdaq", "Dow", "Russell 2K"];

function heatColor(v: number): string {
  const a = Math.min(Math.abs(v) / 2.2, 1);
  if (v >= 0) return `rgba(47,230,166,${(0.15 + a * 0.6).toFixed(2)})`;
  return `rgba(255,84,112,${(0.15 + a * 0.6).toFixed(2)})`;
}

const STAR_SVG = (
  <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16 }}>
    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9z" fill="currentColor" />
  </svg>
);

const DL_ICON = (
  <svg viewBox="0 0 24 24" fill="none" style={{ width: 13, height: 13 }}>
    <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Real download: a plain-text digest built from the live data already on
// screen (date, headlines, earnings surprises) — no fabricated narrative.
function downloadRecap(dateLabel: string, headlines: NewsArticleDoc[], surprises: EarnSurprise[], which: string) {
  const lines = [
    `MarketCatalyst ${which} Recap — ${dateLabel}`,
    "",
    "Headlines:",
    ...(headlines.length ? headlines.map(n => `- ${n.ticker}: ${n.headline} (${n.source})`) : ["  (none synced)"]),
    "",
    "Earnings surprises:",
    ...(surprises.length ? surprises.slice(0, 10).map(e => `- ${e.ticker}: EPS $${e.epsEstimate.toFixed(2)} → $${e.epsActual.toFixed(2)} (${e.surp >= 0 ? "+" : ""}${e.surp.toFixed(1)}%)`) : ["  (none synced)"]),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `MarketCatalyst-Recap-${which}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

interface EarnSurprise { ticker: string; date: string; epsEstimate: number; epsActual: number; surp: number; }

function earnSurprises(events: LiveEarningsDoc[]): EarnSurprise[] {
  return events
    .filter((e): e is LiveEarningsDoc & { epsEstimate: number; epsActual: number } => e.epsEstimate != null && e.epsActual != null)
    .map(e => ({
      ticker: e.ticker, date: e.date, epsEstimate: e.epsEstimate, epsActual: e.epsActual,
      surp: e.epsEstimate !== 0 ? ((e.epsActual - e.epsEstimate) / Math.abs(e.epsEstimate)) * 100 : 0,
    }))
    .sort((a, b) => Math.abs(b.surp) - Math.abs(a.surp));
}

// ---- Main screen ----
export function RecapScreen() {
  const router = useRouter();
  const { openStock, openSector } = useIQActions();
  const [activeTab, setActiveTab] = useState(0);
  const [recapPage, setRecapPage] = useState(0);
  const [drawer, setDrawer] = useState<"earn-movers" | null>(null);
  const [audioMsg, setAudioMsg] = useState(false);

  const { data: sectorsLive } = useApiList<SectorApiDoc>("/market-data/sectors");
  const { data: liveEarnings } = useApiList<LiveEarningsDoc>("/market-data/earnings");
  const { data: liveNews } = useApiList<NewsArticleDoc>("/market-data/news");
  const { data: macroEvents } = useApiList<MacroEventDoc>("/market-data/macro-events");
  const { frame: tapeFrame } = useTapeStream();
  const liveIndices = tapeFrame
    ? tapeItemsToIndexDocs(tapeFrame.items).filter(i => MAJOR_INDEX_LABELS.includes(i.label))
    : [];

  const sortedSectors = [...sectorsLive].sort((a, b) => a.sector.localeCompare(b.sector));
  const SEC_PAGES = Math.max(1, Math.ceil(sortedSectors.length / SEC_PAGE));
  const pageStart = recapPage * SEC_PAGE;
  const pageSectors = sortedSectors.slice(pageStart, pageStart + SEC_PAGE);

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const weekAgoStr = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const surprises = earnSurprises(liveEarnings);
  const todaySurprises = surprises.filter(e => e.date === todayStr);
  const weekSurprises = surprises.filter(e => e.date >= weekAgoStr);

  const upcomingMacro = [...macroEvents]
    .filter(e => e.eventDate >= todayStr)
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
    .slice(0, 6);

  const todayHeadlines = [...liveNews]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 6);
  const weekHeadlines = [...liveNews]
    .filter(n => n.publishedAt >= weekAgoStr)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 8);

  // ---- Reusable cards ----

  const IndicesRow = liveIndices.length === 0 ? (
    <DataState label="No live index snapshot available right now." />
  ) : (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
      {liveIndices.map(idx => {
        const fg = idx.pctChange >= 0 ? "var(--up)" : "var(--down)";
        return (
          <div key={idx.id} style={{ background: "var(--surface-2)", borderRadius: 10, padding: "8px 14px", minWidth: 90 }}>
            <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginBottom: 3 }}>{idx.label}</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, fontFamily: "var(--f-mono)", color: fg }}>
              {sign(idx.pctChange)}
            </div>
          </div>
        );
      })}
    </div>
  );

  const SectorHeatCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <h3>Sector heatmap</h3>
        <span className="link" onClick={() => router.push("/menu/heatmap")}>View all →</span>
      </div>
      <div className="card-b">
        {pageSectors.length === 0 ? (
          <DataState label="No live sector performance data yet." />
        ) : (
          <>
            <div className="heat">
              {pageSectors.map(s => (
                <div key={s.sector} className="s"
                  style={{ background: heatColor(s.pctChange), cursor: "pointer" }}
                  onClick={() => openSector(s.sector)}>
                  <div className="nm">{s.sector}</div>
                  <div className="v">{sign(s.pctChange)}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 9, fontSize: ".74rem" }}>
              <span style={{ color: "var(--text-dim-solid)" }}>
                Sectors {pageStart + 1}–{Math.min(pageStart + SEC_PAGE, sortedSectors.length)} of {sortedSectors.length} · click one to open it in the heatmap
              </span>
              <span style={{ display: "flex", gap: 14 }}>
                {recapPage > 0 && (
                  <span className="link" onClick={() => setRecapPage(p => p - 1)}>← Previous 10</span>
                )}
                <span className="link" onClick={() => setRecapPage(p => (p + 1) % SEC_PAGES)}>
                  {recapPage < SEC_PAGES - 1 ? "Show next 10 →" : "Back to first 10 ↺"}
                </span>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );

  const EarningsMoversCard = (list: EarnSurprise[], title: string) => (
    <div className="card">
      <div className="card-h">
        <h3>{title}</h3>
        <button className="link" onClick={() => router.push("/menu/earnings")}>View all →</button>
      </div>
      <div className="card-b" style={{ paddingTop: 6 }}>
        {list.length === 0 ? (
          <DataState label="No live earnings-surprise data for this window yet." />
        ) : list.slice(0, 8).map(m => (
          <div key={m.ticker + m.date} className="minirow" style={{ cursor: "pointer" }} onClick={() => openStock(m.ticker)}>
            <StockLogo sym={m.ticker} size={20} />
            <span className="tkr">{m.ticker}</span>
            <span className="mid">EPS ${m.epsEstimate.toFixed(2)} → ${m.epsActual.toFixed(2)}</span>
            <span className={`r ${cls(m.surp)}`}>{sign(m.surp)}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const NewsCard = (list: NewsArticleDoc[], title: string) => (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <h3>{title}</h3>
        <span className="link" onClick={() => router.push("/menu/commentary")}>View all →</span>
      </div>
      <div className="card-b" style={{ paddingTop: 6 }}>
        {list.length === 0 ? (
          <DataState label="No live news synced for this window yet." />
        ) : list.map(n => (
          <a key={n.id} href={n.url} target="_blank" rel="noreferrer" className="minirow"
            style={{ alignItems: "flex-start", gap: 10, textDecoration: "none", cursor: "pointer" }}>
            <StockLogo sym={n.ticker} size={20} />
            <span className="mid" style={{ whiteSpace: "normal", lineHeight: 1.4 }}>
              <b style={{ color: "var(--text-hi)" }}>{n.ticker}</b> {n.headline}
              <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)" }}>{n.source}</div>
            </span>
          </a>
        ))}
      </div>
    </div>
  );

  return (
    <>
      {/* ── Page head ── */}
      <div className="page-head">
        <div>
          <h1 className="page-title">{activeTab === 1 ? "Weekly Recap" : "End-of-Day Recap"}</h1>
        </div>
        <div className="tabs">
          {TABS.map((t, i) => (
            <button key={t} className={`tab${i === activeTab ? " active" : ""}`}
              onClick={() => setActiveTab(i)}>{t}</button>
          ))}
        </div>
      </div>

      {/* ── Today (EOD) ── */}
      {activeTab === 0 && (
        <div style={{ padding: "14px 18px 18px" }}>
          <div className="recap-hero">
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14 }}>
              <div className="wmn-orb">{STAR_SVG}</div>
              <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>
                {dateLabel}
              </div>
              <div style={{ marginLeft: "auto" }}>
                <button className="btn ai" title="Audio recap isn't connected to a live TTS service yet"
                  onClick={() => setAudioMsg(true)}>
                  <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
                    <path d="M8 5v14l11-7z" fill="currentColor" />
                  </svg>
                  60-sec audio recap
                </button>
                {audioMsg && (
                  <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginTop: 6, textAlign: "right" }}>
                    Not connected to a live TTS service yet.
                  </div>
                )}
              </div>
            </div>
            {IndicesRow}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "12px 0 4px" }}>
              <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", fontWeight: 600, letterSpacing: ".03em" }}>
                DOWNLOAD:
              </span>
              <button className="btn" onClick={() => downloadRecap(dateLabel, todayHeadlines, todaySurprises, "today")}>{DL_ICON} Today (EOD)</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 14 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div className="eyebrow">Top headlines</div>
                  <span className="link" onClick={() => router.push("/menu/commentary")}>View all →</span>
                </div>
                {todayHeadlines.length === 0 ? (
                  <DataState label="No live news synced yet today." />
                ) : todayHeadlines.map(n => (
                  <div key={n.id} style={{ display: "flex", gap: 8, padding: "6px 0", fontSize: ".84rem" }}>
                    <span className="bullet" style={{ marginTop: 6, flexShrink: 0 }} />
                    <span><b>{n.ticker}</b> {n.headline}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div className="eyebrow">Up next</div>
                  <span className="link" onClick={() => router.push("/menu/macro")}>View all →</span>
                </div>
                {upcomingMacro.length === 0 ? (
                  <DataState label="No upcoming macro events on record." />
                ) : upcomingMacro.map(e => (
                  <div key={e.id} className="minirow">
                    <span className="mono" style={{ width: 66, color: "var(--warn)" }}>{e.eventDate.slice(5)}</span>
                    <span className="mid">{e.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {NewsCard(todayHeadlines, "Today's headlines")}
          {SectorHeatCard}
          <div className="dash" style={{ marginTop: 14, padding: "0 0 14px" }}>
            <div className="col-6">{EarningsMoversCard(todaySurprises, "Biggest earnings surprises today")}</div>
            <div className="col-6">
              <div className="card">
                <div className="card-h"><h3>Market internals</h3></div>
                <div className="card-b">
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".8rem", marginBottom: 6 }}>
                      <span className="up mono" style={{ fontWeight: 700 }}>▲ <NotAvailable /> advancing</span>
                      <span className="down mono" style={{ fontWeight: 700 }}>▼ <NotAvailable /> declining</span>
                    </div>
                    <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 4 }}>
                      No live advance/decline breadth feed yet.
                    </div>
                  </div>
                  {[
                    "NYSE TICK", "TRIN (Arms)", "McClellan Osc", "Put/Call Ratio", "New 52W Highs", "New 52W Lows",
                  ].map(label => (
                    <div key={label} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 12px", marginBottom: 6,
                      background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 8,
                    }}>
                      <span style={{ fontSize: ".8rem", color: "var(--text)" }}>{label}</span>
                      <NotAvailable />
                    </div>
                  ))}
                  <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                    Market breadth needs a live NYSE/NASDAQ composite feed — not on the current plan.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── This Week ── */}
      {activeTab === 1 && (
        <div style={{ padding: "14px 18px 18px" }}>
          <div className="recap-hero">
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14 }}>
              <div className="wmn-orb">{STAR_SVG}</div>
              <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>
                Week ending {dateLabel}
              </div>
            </div>
            <DataState label="Weekly index performance isn't tracked by a live feed — only the current session is available (see Today tab)." />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "12px 0 4px" }}>
              <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", fontWeight: 600, letterSpacing: ".03em" }}>
                DOWNLOAD:
              </span>
              <button className="btn" onClick={() => downloadRecap(dateLabel, weekHeadlines, weekSurprises, "this-week")}>{DL_ICON} This Week</button>
            </div>
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div className="eyebrow">Up next · next week</div>
                <span className="link" onClick={() => router.push("/menu/macro")}>View all →</span>
              </div>
              {upcomingMacro.length === 0 ? (
                <DataState label="No upcoming macro events on record." />
              ) : upcomingMacro.map(e => (
                <div key={e.id} className="minirow">
                  <span className="mono" style={{ width: 66, color: "var(--warn)" }}>{e.eventDate.slice(5)}</span>
                  <span className="mid">{e.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="dash" style={{ marginTop: 14, padding: 0 }}>
            <div className="col-6">
              <div className="card">
                <div className="card-h"><h3>Sector leaders</h3><span className="pill up">Week</span></div>
                <div className="card-b" style={{ paddingTop: 6 }}>
                  <DataState label="Weekly sector performance isn't tracked by a live feed — see the daily sector heatmap on the Today tab." />
                </div>
              </div>
            </div>
            <div className="col-6">
              <div className="card">
                <div className="card-h"><h3>Sector laggards</h3><span className="pill dn">Week</span></div>
                <div className="card-b" style={{ paddingTop: 6 }}>
                  <DataState label="Weekly sector performance isn't tracked by a live feed — see the daily sector heatmap on the Today tab." />
                </div>
              </div>
            </div>
          </div>

          {EarningsMoversCard(weekSurprises, "Biggest earnings surprises this week")}
          {NewsCard(weekHeadlines, "This week's headlines")}
        </div>
      )}

      {/* ── Sliding drawer ── */}
      {drawer === "earn-movers" && (
        <>
          <div className="scrim" onClick={() => setDrawer(null)} />
          <div className="side-drawer">
            <div className="drawer-h">
              <div style={{ flex: 1 }}>
                <div className="drawer-title">Biggest Earnings Surprises</div>
                <div className="drawer-sub">Ranked by EPS surprise magnitude</div>
              </div>
              <button className="closebtn" onClick={() => setDrawer(null)}>✕</button>
            </div>
            <div className="drawer-b">
              {surprises.length === 0 ? (
                <DataState label="No live earnings-surprise data yet." />
              ) : surprises.map(e => (
                <div key={e.ticker + e.date} className="minirow" style={{ cursor: "pointer", padding: "8px 0" }}
                  onClick={() => { openStock(e.ticker); setDrawer(null); }}>
                  <StockLogo sym={e.ticker} size={22} />
                  <span className="tkr">{e.ticker}</span>
                  <span className="mid">
                    <span className={`pill ${e.surp >= 0 ? "beat" : "miss"}`}>{e.surp >= 0 ? "Beat" : "Miss"}</span>
                    <span style={{ marginLeft: 6, fontSize: ".7rem", color: "var(--text-dim-solid)" }}>
                      EPS ${e.epsEstimate.toFixed(2)} → ${e.epsActual.toFixed(2)}
                    </span>
                  </span>
                  <span className={`r mono ${e.surp >= 0 ? "up" : "down"}`} style={{ fontWeight: 700 }}>
                    {e.surp >= 0 ? "+" : ""}{e.surp.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
