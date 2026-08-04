"use client";

import { useIQActions } from "../shell";
import { StockLogo } from "../utils";
import { useApiList } from "../hooks/useApiList";
import type { AnalystConsensusDoc } from "../types";

// Live source is FMP's grades-consensus snapshot: a current Buy/Hold/Sell vote
// count per ticker, not a per-firm upgrade/downgrade event feed (that needs
// Benzinga, blocked on a missing key). Per-firm actions (upgrades/downgrades,
// price-target changes, cluster alerts) aren't reconstructable from this feed,
// so that table has been retired rather than backed by fabricated data.

export function AnalystScreen() {
  const { openStock } = useIQActions();
  const { data: liveConsensus } = useApiList<AnalystConsensusDoc>("/market-data/analyst-actions");

  const liveRows = [...liveConsensus].sort((a, b) =>
    (b.strongBuy + b.buy) - (a.strongBuy + a.buy)
  ).slice(0, 8);

  return (
    <>
      {/* ── Live analyst consensus (FMP grades-consensus, real) ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-h">
          <h3>Live analyst consensus</h3>
          <span className="pill" style={{ background: "var(--surface-3)", color: "var(--up)" }}>live · FMP</span>
        </div>
        <div className="card-b" style={{ paddingTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
          {liveRows.length === 0 ? (
            <div className="ec-none">No live consensus data available.</div>
          ) : (
            liveRows.map(c => {
              const total = c.strongBuy + c.buy + c.hold + c.sell + c.strongSell || 1;
              return (
                <div key={c.ticker} className="minirow" style={{ cursor: "pointer" }} onClick={() => openStock(c.ticker)}>
                  <StockLogo sym={c.ticker} size={20} />
                  <span className="tkr">{c.ticker}</span>
                  <span className="mid" style={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
                    <span style={{ width: `${c.strongBuy / total * 100}%`, minWidth: c.strongBuy ? 3 : 0, height: 6, background: "var(--up)", borderRadius: 2 }} />
                    <span style={{ width: `${c.buy / total * 100}%`, minWidth: c.buy ? 3 : 0, height: 6, background: "var(--up)", opacity: .6, borderRadius: 2 }} />
                    <span style={{ width: `${c.hold / total * 100}%`, minWidth: c.hold ? 3 : 0, height: 6, background: "var(--text-dim-solid)", opacity: .5, borderRadius: 2 }} />
                    <span style={{ width: `${c.sell / total * 100}%`, minWidth: c.sell ? 3 : 0, height: 6, background: "var(--down)", opacity: .6, borderRadius: 2 }} />
                    <span style={{ width: `${c.strongSell / total * 100}%`, minWidth: c.strongSell ? 3 : 0, height: 6, background: "var(--down)", borderRadius: 2 }} />
                  </span>
                  <span className="r" style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
                    {c.strongBuy + c.buy}B / {c.hold}H / {c.sell + c.strongSell}S
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Per-firm actions table retired: not available from the live feed ── */}
      <div className="card">
        <div className="card-b">
          <div className="ec-none">
            Per-firm analyst actions aren't available from the live data feed yet — showing aggregate consensus above.
          </div>
        </div>
      </div>
    </>
  );
}
