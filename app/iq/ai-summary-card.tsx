"use client";

import { useState, type ReactNode } from "react";

/**
 * Collapsible AI-summary card — same interaction as the dashboard's
 * "What Matters Now": a full-width header button with a rotating chevron toggles
 * the body open/closed via a CSS grid 0fr->1fr transition, pushing the content
 * below it down. Collapsed by default, matching the dashboard.
 *
 * Keeps the existing `.ai-block` / `.card-h` / `.card-b` classes so the glow
 * border and header styling are unchanged; only the interaction is added.
 */
export function AiSummaryCard({
  title,
  pill,
  children,
  defaultOpen = false,
}: {
  title: ReactNode;
  pill?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`ai-block collapsible${open ? " open" : ""}`} style={{ marginBottom: 14 }}>
      <button
        type="button"
        className="card-h collapse-h"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <h3 className="ai-c">{title}</h3>
        <span className="collapse-h-right">
          {pill}
          <svg className="collapse-chev" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      <div className="collapse-region">
        <div className="collapse-region-inner">
          <div className="card-b">{children}</div>
        </div>
      </div>
    </div>
  );
}
