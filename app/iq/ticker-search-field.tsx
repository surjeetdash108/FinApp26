"use client";

import { useState } from "react";
import { useTickerSearch } from "./hooks/useTickerSearch";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  background: "var(--surface-3)",
  border: "1px solid var(--border-soft)",
  borderRadius: 8,
  padding: "8px 12px",
  color: "var(--text)",
  fontSize: ".9rem",
};

/**
 * Ticker search input with an inline result dropdown, backed by useTickerSearch
 * (GET /live/search over the in-memory ~10k-ticker universe). The list renders
 * in NORMAL FLOW (not absolute) so it can never cover the modal's Add button —
 * the drawer body scrolls if it runs long. Picking a result fills the value;
 * the parent owns the actual add action (via onEnter / its own button).
 */
export function TickerSearchField({
  value,
  onChange,
  onEnter,
  placeholder = "Search ticker or company…",
}: {
  value: string;
  onChange: (ticker: string) => void;
  onEnter?: () => void;
  placeholder?: string;
}) {
  const [picked, setPicked] = useState(false);
  const results = useTickerSearch(value);
  const open = !picked && value.trim().length > 0 && results.length > 0;

  return (
    <div>
      <input
        autoFocus
        style={INPUT_STYLE}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase());
          setPicked(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setPicked(true);
            onEnter?.();
          } else if (e.key === "Escape") {
            setPicked(true);
          }
        }}
      />
      {open && (
        <div
          role="listbox"
          style={{
            marginTop: 6,
            maxHeight: 200,
            overflowY: "auto",
            background: "var(--surface-2)",
            border: "1px solid var(--border-soft)",
            borderRadius: 8,
          }}
        >
          {results.slice(0, 10).map((r) => (
            <button
              key={r.ticker}
              type="button"
              onClick={() => {
                onChange(r.ticker);
                setPicked(true);
              }}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid var(--border-soft)",
                color: "var(--text)",
                cursor: "pointer",
                fontSize: ".84rem",
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  fontFamily: "var(--f-mono)",
                  minWidth: 56,
                  color: "var(--text-hi)",
                }}
              >
                {r.ticker}
              </span>
              <span
                style={{
                  color: "var(--text-dim-solid)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.name ?? ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
