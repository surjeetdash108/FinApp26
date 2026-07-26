"use client";

import React from "react";

/**
 * Catches render crashes in any screen and shows an honest error card instead
 * of a silent blank page (before this, one thrown exception while rendering —
 * e.g. an unexpected data shape — blanked the whole content area with nothing
 * in the UI and only a console trace to explain it).
 */
export class ScreenErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Screen crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          margin: 24, padding: "22px 24px", borderRadius: 14,
          border: "1px solid var(--down, #e5484d)", background: "var(--surface-1)",
        }}>
          <div style={{ fontWeight: 700, color: "var(--down, #e5484d)", marginBottom: 6 }}>
            This screen hit an error.
          </div>
          <div className="mono" style={{ fontSize: ".78rem", color: "var(--text-dim-solid)", marginBottom: 14, wordBreak: "break-word" }}>
            {String(this.state.error?.message ?? this.state.error)}
          </div>
          <button className="btn primary" onClick={() => { this.setState({ error: null }); }}>
            Try again
          </button>
          <button className="btn" style={{ marginLeft: 8 }} onClick={() => window.location.reload()}>
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
