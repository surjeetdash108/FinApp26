"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useIQActions } from "../shell";
import { cls, sign, StockLogo, DataState, NotAvailable, VendorTag } from "../utils";
import { useApiList } from "../hooks/useApiList";
import { useTapeStream } from "../hooks/useTapeStream";
import { tapeItemsToIndexDocs } from "../live-market-indices";
import type { SectorApiDoc, LiveEarningsDoc, NewsArticleDoc, MacroEventDoc, RecapDoc, CompanyDoc, EarningsAnnouncementDoc, AnalystConsensusDoc } from "../types";

const SEC_PAGE = 10;
const MAJOR_INDEX_LABELS = ["S&P 500", "Nasdaq", "Dow", "Russell 2000"];

// Compact volume/number formatter for the internals block (e.g. 1.2B, 340M).
function fmtVol(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${n}`;
}

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
function downloadRecap(dateLabel: string, headlines: NewsArticleDoc[], surprises: EarnSurprise[], grades: RatingChange[], which: string) {
  const lines = [
    `MarketCatalyst ${which} Recap — ${dateLabel}`,
    "",
    "Headlines:",
    ...(headlines.length ? headlines.map(n => `- ${n.ticker}: ${n.headline} (${n.source})`) : ["  (none synced)"]),
    "",
    "Earnings surprises:",
    ...(surprises.length ? surprises.slice(0, 10).map(e => `- ${e.ticker}: EPS $${e.epsEstimate.toFixed(2)} → $${e.epsActual.toFixed(2)} (${e.surp >= 0 ? "+" : ""}${e.surp.toFixed(1)}%)`) : ["  (none synced)"]),
    "",
    "Analyst rating changes:",
    ...(grades.length ? grades.slice(0, 10).map(g => `- ${g.ticker}: ${g.firm ?? "Analyst"} ${g.previousGrade ? `${g.previousGrade} → ` : ""}${g.newGrade ?? ""} (${g.action ?? "—"})`) : ["  (none synced)"]),
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
interface RatingChange { ticker: string; date: string; firm: string | null; previousGrade: string | null; newGrade: string | null; action: string | null; }

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
export function RecapScreen({ mode = "daily" }: { mode?: "daily" | "weekly" }) {
  const router = useRouter();
  const { openStock, openSector } = useIQActions();
  // Daily vs weekly is now chosen by the menu route (two separate options),
  // not an in-screen tab.
  const activeTab = mode === "weekly" ? 1 : 0;
  const [recapPage, setRecapPage] = useState(0);
  const [drawer, setDrawer] = useState<"earn-movers" | null>(null);
  const [audioMsg, setAudioMsg] = useState(false);

  const { data: sectorsLive, loading: sectorsLoading } = useApiList<SectorApiDoc>("/market-data/sectors");
  const { data: liveEarnings, loading: earningsLoading } = useApiList<LiveEarningsDoc>("/market-data/earnings");
  const { data: liveNews, loading: liveNewsLoading } = useApiList<NewsArticleDoc>("/market-data/news");
  const { data: macroEvents, loading: macroLoading } = useApiList<MacroEventDoc>("/market-data/macro-events");
  // Analyst rating changes (upgrades/downgrades) — FMP-backed analyst_actions.
  const { data: analystActions, loading: analystLoading } = useApiList<AnalystConsensusDoc>("/market-data/analyst-actions");
  // Recap docs carry the day's market internals (advance/decline, TRIN, up/down
  // volume, breadth %) computed by the backend from OHLCV bars. Pick the latest.
  const { data: recaps } = useApiList<RecapDoc>("/market-data/recaps");
  const latestRecap = [...recaps].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const internals = latestRecap?.internals ?? null;
  const weekly = latestRecap?.weekly ?? null;
  // New 52-week highs/lows: count company docs whose latest price sits at/through
  // their rolling 52-wk high/low (both from technical-indicators.job). Null when
  // no company doc carries a 52-wk range yet, so we show N/A rather than a false 0.
  const { data: companiesLive } = useApiList<CompanyDoc>("/market-data/companies");
  const with52 = companiesLive.filter(c => c.high52 != null || c.low52 != null);
  const newHighs = with52.length ? with52.filter(c => c.price != null && c.high52 != null && c.price >= c.high52).length : null;
  const newLows = with52.length ? with52.filter(c => c.price != null && c.low52 != null && c.price <= c.low52).length : null;
  // Earnings movers by post-announcement price reaction (EDGAR 8-K item 2.02).
  const { data: earningsAnn } = useApiList<EarningsAnnouncementDoc>("/market-data/earnings-announcements");
  const earnMovers = [...earningsAnn]
    .filter(a => a.reactionPct != null)
    .sort((a, b) => Math.abs(b.reactionPct as number) - Math.abs(a.reactionPct as number))
    .slice(0, 8);
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

  // Analyst rating changes (FMP) — flatten each ticker's recentGrades into one
  // dated feed, keep only real up/downgrades, then window it like the other
  // recap blocks (today for daily, trailing week for weekly).
  const gradeChanges = analystActions
    .flatMap(a => (a.recentGrades ?? []).map(g => ({ ticker: a.ticker, ...g })))
    .filter(g => g.date && (g.action === "upgrade" || g.action === "downgrade" || (g.newGrade && g.newGrade !== g.previousGrade)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const todayGrades = gradeChanges.filter(g => g.date.slice(0, 10) === todayStr).slice(0, 8);
  const weekGrades = gradeChanges.filter(g => g.date.slice(0, 10) >= weekAgoStr).slice(0, 10);

  // ---- Reusable cards ----

  const SectorHeatCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Sector heatmap</h3><VendorTag v="polygon" /></div>
        <span className="link" onClick={() => router.push("/menu/heatmap")}>View all →</span>
      </div>
      <div className="card-b">
        {pageSectors.length === 0 ? (
          <DataState loading={sectorsLoading} label="No live sector performance data yet." />
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
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>{title}</h3><VendorTag v="polygon" /></div>
        <button className="link" onClick={() => router.push("/menu/earnings")}>View all →</button>
      </div>
      <div className="card-b" style={{ paddingTop: 6 }}>
        {list.length === 0 ? (
          <DataState loading={earningsLoading} label="No live earnings-surprise data for this window yet." />
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
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>{title}</h3><VendorTag v="polygon" /></div>
        <span className="link" onClick={() => router.push("/menu/commentary")}>View all →</span>
      </div>
      <div className="card-b" style={{ paddingTop: 6 }}>
        {list.length === 0 ? (
          <DataState loading={liveNewsLoading} label="No live news synced for this window yet." />
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

  const gradeCls = (action: string | null) =>
    action === "upgrade" ? "up" : action === "downgrade" ? "down" : "";

  const AnalystChangesCard = (list: typeof gradeChanges, title: string) => (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>{title}</h3><VendorTag v="fmp" /></div>
        <span className="link" onClick={() => router.push("/menu/analyst")}>View all →</span>
      </div>
      <div className="card-b" style={{ paddingTop: 6 }}>
        {list.length === 0 ? (
          <DataState loading={analystLoading} label="No analyst rating changes for this window yet." />
        ) : list.map((g, i) => (
          <div key={`${g.ticker}-${g.date}-${i}`} className="minirow" style={{ cursor: "pointer" }} onClick={() => openStock(g.ticker)}>
            <StockLogo sym={g.ticker} size={20} />
            <span className="tkr">{g.ticker}</span>
            <span className="mid" style={{ whiteSpace: "normal", lineHeight: 1.4 }}>
              {g.firm ?? "Analyst"}
              {g.previousGrade && g.newGrade
                ? <span style={{ color: "var(--text-dim-solid)" }}> · {g.previousGrade} → {g.newGrade}</span>
                : g.newGrade
                ? <span style={{ color: "var(--text-dim-solid)" }}> · {g.newGrade}</span>
                : null}
            </span>
            <span className={`r ${gradeCls(g.action)}`} style={{ textTransform: "capitalize" }}>{g.action ?? "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );

  // Live daily sector leaders/laggards derived from the live sector feed.
  const dailyLeaders = sortedSectors.filter(s => s.pctChange != null).sort((a, b) => b.pctChange - a.pctChange).slice(0, 6);
  const dailyLaggards = sortedSectors.filter(s => s.pctChange != null).sort((a, b) => a.pctChange - b.pctChange).slice(0, 6);

  // Generic indices row — works for the live daily snapshot and the weekly
  // rollup alike; shows the standard empty-state when the period has no data.
  const renderIndicesRow = (
    list: { label: string; pctChange: number | null }[],
    emptyLabel: string,
    loading: boolean,
  ) => {
    const items = list.filter((i): i is { label: string; pctChange: number } => i.pctChange != null);
    if (items.length === 0) return <DataState loading={loading} label={emptyLabel} />;
    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        {items.map(idx => {
          const fg = idx.pctChange >= 0 ? "var(--up)" : "var(--down)";
          return (
            <div key={idx.label} style={{ background: "var(--surface-2)", borderRadius: 10, padding: "8px 14px", minWidth: 90 }}>
              <div style={{ fontSize: ".68rem", color: "var(--text-dim-solid)", marginBottom: 3 }}>{idx.label}</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, fontFamily: "var(--f-mono)", color: fg }}>
                {sign(idx.pctChange)}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Generic sector leaders/laggards card (one col-6 tile).
  const renderSectorPerfCard = (
    list: { sector: string; pctChange: number }[],
    title: string,
    pillCls: string,
    pillText: string,
    emptyLabel: string,
  ) => (
    <div className="col-6">
      <div className="card">
        <div className="card-h"><div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>{title}</h3><VendorTag v="polygon" /></div><span className={`pill ${pillCls}`}>{pillText}</span></div>
        <div className="card-b" style={{ paddingTop: 6 }}>
          {list.length === 0 ? (
            <DataState label={emptyLabel} />
          ) : list.map(s => (
            <div key={s.sector} className="minirow" style={{ justifyContent: "space-between" }}>
              <span className="mid">{s.sector}</span>
              <span className={`mono ${cls(s.pctChange)}`} style={{ fontWeight: 700 }}>{sign(s.pctChange)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // Weekly sector-heatmap shell (same head as the live daily card, empty body).
  const WeeklyHeatCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Sector heatmap</h3><VendorTag v="polygon" /></div>
        <span className="link" onClick={() => router.push("/menu/heatmap")}>View all →</span>
      </div>
      <div className="card-b">
        <DataState label="Weekly sector heatmap isn't available yet." />
      </div>
    </div>
  );

  // Market-internals card — real daily breadth block, or a weekly empty-state
  // in the same card shell (weekly internals aren't aggregated yet).
  const renderInternalsCard = (period: "daily" | "weekly") => {
    if (period === "weekly") {
      return (
        <div className="dash" style={{ marginTop: 14, padding: "0 0 14px" }}>
          <div className="col-12">
            <div className="card">
              <div className="card-h"><div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Market internals</h3><VendorTag v="polygon" /></div></div>
              <div className="card-b">
                <DataState label="Weekly market internals aren't aggregated yet — check back after the next daily run." />
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="dash" style={{ marginTop: 14, padding: "0 0 14px" }}>
        <div className="col-12">
          <div className="card">
            <div className="card-h"><div style={{ display: "flex", alignItems: "center", gap: 6 }}><h3>Market internals</h3><VendorTag v="polygon" /></div></div>
            <div className="card-b">
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".8rem", marginBottom: 6 }}>
                  <span className="up mono" style={{ fontWeight: 700 }}>
                    ▲ {internals?.advancers != null ? internals.advancers.toLocaleString() : <NotAvailable />} advancing
                  </span>
                  <span className="down mono" style={{ fontWeight: 700 }}>
                    ▼ {internals?.decliners != null ? internals.decliners.toLocaleString() : <NotAvailable />} declining
                  </span>
                </div>
                {internals?.breadthPct != null ? (
                  <>
                    <div style={{ height: 8, borderRadius: 4, overflow: "hidden", background: "var(--down-dim, rgba(255,84,112,.25))", display: "flex" }}>
                      <div style={{ width: `${(internals.breadthPct * 100).toFixed(0)}%`, background: "var(--up)" }} />
                    </div>
                    <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 4 }}>
                      {(internals.breadthPct * 100).toFixed(0)}% of the tracked universe advancing
                      {internals.date ? ` · ${internals.date}` : ""}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 4 }}>
                    No advance/decline breadth synced yet.
                  </div>
                )}
              </div>
              {([
                // Real values computed by the backend market-breadth job.
                { label: "TRIN (Arms)", value: internals?.trin != null ? internals.trin.toFixed(2) : null },
                { label: "Up volume", value: internals?.upVolume != null ? fmtVol(internals.upVolume) : null },
                { label: "Down volume", value: internals?.downVolume != null ? fmtVol(internals.downVolume) : null },
                // Counted from company docs' 52-wk range (technical-indicators.job).
                { label: "New 52W Highs", value: newHighs != null ? newHighs.toLocaleString() : null },
                { label: "New 52W Lows", value: newLows != null ? newLows.toLocaleString() : null },
                // McClellan from the breadth series (EMA19−EMA39 of net advances).
                { label: "McClellan Osc", value: internals?.mcclellan != null ? internals.mcclellan.toFixed(2) : null },
                // No source on the current plan — kept visible, marked N/A.
                { label: "NYSE TICK", value: null },
                { label: "Put/Call Ratio", value: null },
              ] as { label: string; value: string | null }[]).map(({ label, value }) => (
                <div key={label} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 12px", marginBottom: 6,
                  background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 8,
                }}>
                  <span style={{ fontSize: ".8rem", color: "var(--text)" }}>{label}</span>
                  {value != null
                    ? <span className="mono" style={{ fontSize: ".8rem", fontWeight: 700, color: "var(--text-hi)" }}>{value}</span>
                    : <NotAvailable />}
                </div>
              ))}
              <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", marginTop: 8 }}>
                Advance/decline, TRIN, up/down volume, McClellan and new 52-week highs/lows are computed from the tracked universe. NYSE TICK and Put/Call need a composite exchange feed not on the current plan.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Single shared render body — both the daily and weekly routes render the
  // identical widget set (windowed to their period) so they can't drift apart.
  const RecapBody = (period: "daily" | "weekly") => {
    const isWeek = period === "weekly";
    const heroTitle = isWeek ? `Week ending ${dateLabel}` : dateLabel;
    const indicesList = isWeek ? (weekly?.indices ?? []) : liveIndices;
    const indicesEmpty = isWeek
      ? "Weekly index performance needs at least two synced sessions this week — check back after the next daily run."
      : "No live index snapshot available right now.";
    const heroHeadlines = isWeek ? weekHeadlines : todayHeadlines;
    const dlSurprises = isWeek ? weekSurprises : todaySurprises;
    const dlGrades = isWeek ? weekGrades : todayGrades;
    const leaders = isWeek ? (weekly?.sectorLeaders ?? []) : dailyLeaders;
    const laggards = isWeek ? (weekly?.sectorLaggards ?? []) : dailyLaggards;

    return (
      <div style={{ padding: "14px 18px 18px" }}>
        <div className="recap-hero">
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14 }}>
            <div className="wmn-orb">{STAR_SVG}</div>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>
              {heroTitle}
            </div>
            <VendorTag v="polygon" />
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
          {renderIndicesRow(indicesList, indicesEmpty, !tapeFrame)}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "12px 0 4px" }}>
            <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", fontWeight: 600, letterSpacing: ".03em" }}>
              DOWNLOAD:
            </span>
            {isWeek ? (
              <button className="btn" onClick={() => downloadRecap(dateLabel, weekHeadlines, weekSurprises, weekGrades, "this-week")}>{DL_ICON} This Week</button>
            ) : (
              <button className="btn" onClick={() => downloadRecap(dateLabel, todayHeadlines, todaySurprises, todayGrades, "today")}>{DL_ICON} Today (EOD)</button>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 14 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div className="eyebrow">Top headlines</div>
                <span className="link" onClick={() => router.push("/menu/commentary")}>View all →</span>
              </div>
              {heroHeadlines.length === 0 ? (
                <DataState loading={liveNewsLoading} label={isWeek ? "No live news synced this week yet." : "No live news synced yet today."} />
              ) : heroHeadlines.map(n => (
                <div key={n.id} style={{ display: "flex", gap: 8, padding: "6px 0", fontSize: ".84rem" }}>
                  <span className="bullet" style={{ marginTop: 6, flexShrink: 0 }} />
                  <span><b>{n.ticker}</b> {n.headline}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div className="eyebrow">{isWeek ? "Up next · next week" : "Up next"}</div>
                <span className="link" onClick={() => router.push("/menu/macro")}>View all →</span>
              </div>
              {upcomingMacro.length === 0 ? (
                <DataState loading={macroLoading} label="No upcoming macro events on record." />
              ) : upcomingMacro.map(e => (
                <div key={e.id} className="minirow">
                  <span className="mono" style={{ width: 66, color: "var(--warn)" }}>{e.eventDate.slice(5)}</span>
                  <span className="mid">{e.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {NewsCard(heroHeadlines, isWeek ? "This week's headlines" : "Today's headlines")}
        {isWeek ? WeeklyHeatCard : SectorHeatCard}
        <div className="dash" style={{ marginTop: 14, padding: 0 }}>
          {renderSectorPerfCard(leaders, "Sector leaders", "up", isWeek ? "Week" : "Today", "Sector performance not synced for this period yet.")}
          {renderSectorPerfCard(laggards, "Sector laggards", "dn", isWeek ? "Week" : "Today", "Sector performance not synced for this period yet.")}
        </div>
        {EarningsMoversCard(dlSurprises, isWeek ? "Biggest earnings surprises this week" : "Biggest earnings surprises today")}
        {earnMovers.length > 0 && (
          <div className="dash" style={{ marginTop: 14, padding: "0 0 14px" }}>
            <div className="col-12">
              <div className="card">
                <div className="card-h"><h3>Earnings movers</h3><span className="pill ai" style={{ fontSize: ".68rem" }}>8-K reaction</span></div>
                <div className="card-b">
                  {earnMovers.map(a => (
                    <div key={a.id} className="minirow" style={{ justifyContent: "space-between", cursor: "pointer" }} onClick={() => openStock(a.ticker)}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <StockLogo sym={a.ticker} size={22} />
                        <span className="tkr">{a.ticker}</span>
                        {a.session && <span className="pill" style={{ fontSize: ".6rem" }}>{a.session}</span>}
                        <span style={{ fontSize: ".66rem", color: "var(--text-dim-solid)" }}>{a.announceDate.slice(5)}</span>
                      </span>
                      <span className={`mono ${cls(a.reactionPct as number)}`} style={{ fontWeight: 700 }}>{sign(a.reactionPct as number)}</span>
                    </div>
                  ))}
                  <div style={{ fontSize: ".64rem", color: "var(--text-dim-solid)", marginTop: 6 }}>
                    Price reaction around the SEC-EDGAR 8-K (item 2.02) earnings announcement.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {AnalystChangesCard(dlGrades, isWeek ? "Analyst rating changes this week" : "Analyst rating changes today")}
        {renderInternalsCard(period)}
      </div>
    );
  };

  return (
    <>
      {/* ── Page head ── */}
      <div className="page-head">
        <div>
          <h1 className="page-title">{activeTab === 1 ? "Weekly Recap" : "End-of-Day Recap"}</h1>
        </div>
      </div>

      {/* ── Shared recap body (identical widget set for daily + weekly) ── */}
      {RecapBody(mode)}

      {/* ── Sliding drawer ── */}
      {drawer === "earn-movers" && (
        <>
          <div className="scrim" onClick={() => setDrawer(null)} />
          <div className="side-drawer">
            <div className="drawer-h">
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div className="drawer-title">Biggest Earnings Surprises</div><VendorTag v="polygon" /></div>
                <div className="drawer-sub">Ranked by EPS surprise magnitude</div>
              </div>
              <button className="closebtn" onClick={() => setDrawer(null)}>✕</button>
            </div>
            <div className="drawer-b">
              {surprises.length === 0 ? (
                <DataState loading={earningsLoading} label="No live earnings-surprise data yet." />
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
