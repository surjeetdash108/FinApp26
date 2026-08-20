"use client";

import { useEffect, useState } from "react";
import { useApiResource } from "./hooks/useApiResource";
import type { AiAggregateDoc } from "./types";
import { DataState } from "./utils";

/**
 * The cumulative AI read, appended INSIDE the existing AI summary card on the
 * portfolio and watchlist screens. The card's computed bullets stay exactly as
 * they were — they are exact, instant and never fail; this block sits beneath
 * them and adds the cross-holding picture the per-stock reads can't give.
 *
 * Model output is rendered as PLAIN TEXT (never dangerouslySetInnerHTML) since
 * it is generated/untrusted, matching the stock-detail AI block.
 */
export function AiAggregateBlock({
  path,
  label,
}: {
  /** Endpoint to read, or null to not fetch yet (card still collapsed). */
  path: string | null;
  label: string;
}) {
  // One automatic retry. The live service scales to zero, so a first request
  // that lands on a cold container can exceed Firebase Hosting's 60s rewrite
  // limit and come back 503 — even though the backend finished and cached the
  // doc moments later. Retrying once picks that cached doc up immediately, so
  // the user sees the insight instead of a spurious "unavailable".
  const [retry, setRetry] = useState(0);
  const fullPath = path
    ? `${path}${path.includes("?") ? "&" : "?"}r=${retry}`
    : null;
  const { data: doc, loading, error } = useApiResource<AiAggregateDoc>(fullPath);

  useEffect(() => {
    if (!error || retry > 0 || !path) return;
    const t = setTimeout(() => setRetry(1), 2000);
    return () => clearTimeout(t);
  }, [error, retry, path]);

  // Keep showing the loading state through the retry rather than flashing an
  // error the retry is about to clear.
  const settling = !!error && retry === 0 && !!path;
  const a = doc?.ok ? doc.analysis : null;
  const rows: Array<[string, string | null | undefined]> = a
    ? [
        ["Posture", a.posture?.note],
        ["Concentration", a.concentration?.note],
        ["Leaders", a.leaders],
        ["Laggards", a.laggards],
        ["Watch", a.watchItems],
      ]
    : [];

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-soft)" }}>
      <div
        style={{
          fontSize: ".66rem", fontWeight: 700, color: "var(--ai)",
          textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8,
          display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
        }}
      >
        <span>◆ AI {label} insight</span>
        {doc?.ok && (
          <span
            className="pill"
            style={{
              fontSize: ".54rem", background: "var(--surface-3)",
              color: "var(--text-dim-solid)", textTransform: "none", letterSpacing: 0,
            }}
          >
            {doc.model}
            {doc.memberCount ? ` · ${doc.memberCount} names` : ""}
          </span>
        )}
      </div>

      {(loading || settling) && <DataState loading label="Generating AI insight…" />}

      {!loading && !settling && (!!error || doc?.ok === false) && (
        <div style={{ fontSize: ".78rem", color: "var(--text-dim-solid)" }}>
          {doc?.error === "empty-basket"
            ? `Add holdings to get an AI ${label} insight.`
            : "AI insight unavailable right now."}
        </div>
      )}

      {!loading && !settling && a && (
        <>
          {a.headline && (
            <div style={{ fontSize: ".86rem", fontWeight: 600, color: "var(--text-hi)", marginBottom: 8 }}>
              {a.headline}
            </div>
          )}
          {rows.map(([k, v]) =>
            v ? (
              <div className="ai-line" key={k}>
                <span className="k">{k}</span>
                <span className="v">{v}</span>
              </div>
            ) : null,
          )}
          <div style={{ marginTop: 10, fontSize: ".66rem", color: "var(--text-dim-solid)" }}>
            AI-generated · informational only, not investment advice.
          </div>
        </>
      )}
    </div>
  );
}
