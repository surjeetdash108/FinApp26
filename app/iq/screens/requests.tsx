"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../backend";
import { DataState } from "../utils";
import type { FeatureRequestDoc } from "../types";

const MAX_LEN = 2000;

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function RequestsScreen() {
  const [requests, setRequests] = useState<FeatureRequestDoc[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<FeatureRequestDoc[]>("/api/feature-requests")
      .then(rows => { if (!cancelled) setRequests(rows); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const [addOpen, setAddOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function submitRequest() {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await apiPost<FeatureRequestDoc>("/api/feature-requests", { text: trimmed });
      setRequests(prev => [created, ...(prev ?? [])]);
      setText("");
      setAddOpen(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div style={{ fontWeight: 700, fontSize: ".92rem", color: "var(--text-hi)" }}>Feature Requests</div>
          <div className="page-sub">
            {requests ? `${requests.length} request${requests.length === 1 ? "" : "s"} submitted` : "Your submitted requests"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn primary" onClick={() => { setSubmitError(null); setAddOpen(true); }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Add request
          </button>
        </div>
      </div>

      <div style={{ padding: "0 18px 18px" }}>
        <div className="card">
          <div className="card-h">
            <h3>Your requests</h3>
            <span style={{ fontSize: ".72rem", color: "var(--text-dim-solid)" }}>only visible to you</span>
          </div>
          <div className="card-b" style={{ paddingTop: 4 }}>
            {error ? (
              <DataState label={`Couldn't load your requests: ${error}`} />
            ) : !requests || requests.length === 0 ? (
              <DataState loading={loading} label="You haven't submitted any feature requests yet." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {requests.map(r => (
                  <div key={r.id} className="minirow" style={{ alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--border-soft)" }}>
                    <span className="mid" style={{ whiteSpace: "normal", lineHeight: 1.5, flex: 1 }}>{r.text}</span>
                    <span style={{ flex: "none", fontSize: ".7rem", color: "var(--text-dim-solid)", whiteSpace: "nowrap" }}>{timeAgo(r.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Add Request modal ── */}
      {addOpen && (
        <>
          <div className="scrim" onClick={() => setAddOpen(false)} />
          <div className="drawer" style={{ maxHeight: "min(340px,85vh)" }}>
            <div className="drawer-h">
              <div style={{ flex: 1, fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)" }}>Add Request</div>
              <button className="closebtn" onClick={() => setAddOpen(false)}>✕</button>
            </div>
            <div className="drawer-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: ".72rem", color: "var(--text-dim-solid)", display: "block", marginBottom: 5 }}>
                  What would you like to see?
                </label>
                <textarea
                  style={{
                    width: "100%", minHeight: 110, resize: "vertical",
                    background: "var(--surface-3)", border: "1px solid var(--border-soft)", borderRadius: 8,
                    padding: "8px 12px", color: "var(--text)", fontSize: ".88rem", lineHeight: 1.5, fontFamily: "inherit",
                  }}
                  placeholder="Describe the feature you'd like to see…"
                  value={text}
                  maxLength={MAX_LEN}
                  onChange={e => setText(e.target.value)}
                  autoFocus
                />
                <div style={{ fontSize: ".66rem", color: "var(--text-dim-solid)", textAlign: "right", marginTop: 4 }}>
                  {text.length}/{MAX_LEN}
                </div>
              </div>
              {submitError && (
                <div style={{ fontSize: ".78rem", color: "var(--down)" }}>{submitError}</div>
              )}
              <button className="btn primary" style={{ width: "100%" }} disabled={!text.trim() || submitting} onClick={submitRequest}>
                {submitting ? "Submitting…" : "Submit request"}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
