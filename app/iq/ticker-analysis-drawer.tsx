"use client";

import { useApiResource } from "./hooks/useApiResource";
import { DataState } from "./utils";

/**
 * Read-only view of the rolling per-ticker AI analysis produced by the
 * 10-minute pipeline (ticker_ai_analysis).
 *
 * Deliberately a READ: /live/ticker-analysis never triggers generation, so
 * opening this from a feed row cannot incur a model call however many times a
 * user clicks. A ticker the pipeline has not reached yet returns `empty` and
 * is shown as "not analysed yet" rather than an error — with ~8 tickers
 * refreshed per cycle, a quiet name legitimately may not have one.
 */

interface AnalysisDoc {
  ticker: string;
  empty?: boolean;
  summary?: string;
  sentiment?: string;
  confidence?: number;
  keyDevelopments?: string[];
  positiveFactors?: string[];
  negativeFactors?: string[];
  risks?: string[];
  opportunities?: string[];
  fundamentalImpact?: string;
  shortTermImpact?: string;
  mediumTermImpact?: string;
  investorInterpretation?: string;
  overallAssessment?: string;
  lastUpdatedAt?: string;
  revision?: number;
  sourceNewsCount?: number;
}

const toneFor = (s?: string) =>
  s === "positive" ? "var(--up)"
  : s === "negative" ? "var(--down)"
  : s === "mixed" ? "var(--warn)"
  : "var(--text-dim-solid)";

function List({ label, items }: { label: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="ta-lbl">{label}</div>
      <ul className="ta-list">
        {items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </div>
  );
}

function Para({ label, text }: { label: string; text?: string }) {
  if (!text?.trim()) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="ta-lbl">{label}</div>
      <p className="ta-p">{text}</p>
    </div>
  );
}

export function TickerAnalysisDrawer({ sym, onClose }: { sym: string; onClose: () => void }) {
  const { data, loading } = useApiResource<AnalysisDoc>(
    `/live/ticker-analysis?ticker=${encodeURIComponent(sym)}`,
  );
  const empty = !loading && (!data || data.empty || !data.summary);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer open">
        <div className="drawer-h">
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)" }}>
              {sym} · AI Analysis
            </div>
            <div style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>
              Rolling read, updated as news arrives
            </div>
          </div>
          <button className="closebtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="drawer-b">
          {loading || empty ? (
            <DataState
              loading={loading}
              label={`No AI analysis for ${sym} yet — it is generated as news arrives for this ticker.`}
            />
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                <span className="pill" style={{ background: "var(--surface-3)", color: toneFor(data!.sentiment), textTransform: "capitalize", fontWeight: 700 }}>
                  {data!.sentiment ?? "neutral"}
                </span>
                {typeof data!.confidence === "number" && (
                  <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>
                    confidence {Math.round(data!.confidence * 100)}%
                  </span>
                )}
                {data!.sourceNewsCount != null && (
                  <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>
                    {data!.sourceNewsCount} article{data!.sourceNewsCount === 1 ? "" : "s"}
                  </span>
                )}
                {data!.revision != null && data!.revision > 1 && (
                  <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-dim-solid)" }}>
                    rev {data!.revision}
                  </span>
                )}
              </div>

              <Para label="Summary" text={data!.summary} />
              <List label="Key developments" items={data!.keyDevelopments} />
              <List label="Positive factors" items={data!.positiveFactors} />
              <List label="Negative factors" items={data!.negativeFactors} />
              <List label="Risks" items={data!.risks} />
              <List label="Opportunities" items={data!.opportunities} />
              <Para label="Fundamental impact" text={data!.fundamentalImpact} />
              <Para label="Short term" text={data!.shortTermImpact} />
              <Para label="Medium term" text={data!.mediumTermImpact} />
              <Para label="What it means for investors" text={data!.investorInterpretation} />
              <Para label="Overall assessment" text={data!.overallAssessment} />

              <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border-soft)", fontSize: ".66rem", color: "var(--text-dim-solid)" }}>
                AI-generated from news · informational only, not investment advice
                {data!.lastUpdatedAt ? ` · updated ${data!.lastUpdatedAt.slice(0, 16).replace("T", " ")}` : ""}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
