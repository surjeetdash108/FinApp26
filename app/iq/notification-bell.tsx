"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { firebaseAuth } from "../firebase";
import { apiGet, apiPost } from "./backend";

/**
 * Written server-side by news.job.ts when scoreImportance() flags an article.
 * Read/mark-as-read via GET/POST /api/notifications (src/user-data/notifications.controller.ts).
 */
export interface NotificationDoc {
  id: string;
  type: "news";
  header: string;
  detail: string | null;
  imageUrl: string | null;
  tickers: string[];
  /** The subset of tickers this user actually tracks — why they received it. */
  matchedTickers?: string[];
  source: string | null;
  url: string | null;
  publishedAt: string;
  /** How the news reads for the stock — colours the row +ve/-ve. */
  direction?: "positive" | "negative" | "neutral";
  reasons: string[];
  read: boolean;
}

/** "20h ago" / "3d ago" — matches the relative style used elsewhere in the app. */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function NotificationBell() {
  // Per-user subcollection: the backend only writes a notification to a user
  // whose watchlist or portfolio contains one of the story's tickers, so there
  // is nothing to filter client-side.
  const uid = firebaseAuth.currentUser?.uid ?? null;
  const [notifications, setNotifications] = useState<NotificationDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!uid) return;
    try {
      const rows = await apiGet<NotificationDoc[]>("/api/notifications");
      setNotifications(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [uid]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const sorted = [...notifications].sort((a, b) =>
    (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
  );
  const unread = sorted.filter(n => !n.read).length;

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      // Mark everything currently visible as read, same trigger point as before.
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      void apiPost("/api/notifications/mark-all-read").catch(() => { /* best-effort */ });
    }
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        className="iconbtn notif-btn"
        title={unread > 0 ? `${unread} new notification${unread === 1 ? "" : "s"}` : "Notifications"}
        aria-label="Notifications"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="notif-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <span>Notifications</span>
            <span className="notif-count">{sorted.length}</span>
          </div>

          <div className="notif-list">
            {error && <div className="notif-empty">Could not load notifications: {error}</div>}
            {!error && sorted.length === 0 && (
              <div className="notif-empty">
                <div style={{ fontWeight: 600, marginBottom: 4 }}>No alerts yet</div>
                <div>
                  Add tickers to your <strong>watchlist</strong> or <strong>portfolio</strong> —
                  you&apos;ll be notified when important news breaks on them.
                </div>
              </div>
            )}

            {sorted.map(n => {
              const isOpen = expanded === n.id;
              return (
                <div key={n.id} className={`notif-item${isOpen ? " on" : ""}`}>
                  <button className="notif-row" onClick={() => setExpanded(isOpen ? null : n.id)}>
                    <span className="notif-img">
                      {n.imageUrl
                        ? <img src={n.imageUrl} alt="" loading="lazy"
                               onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                        : <span className="notif-img-fallback">{(n.tickers[0] ?? "N")[0]}</span>}
                    </span>
                    <span className="notif-body">
                      <span className="notif-header">
                        {n.direction && n.direction !== "neutral" && (
                          <span
                            title={n.direction === "positive" ? "Positive for the stock" : "Negative for the stock"}
                            style={{ color: n.direction === "positive" ? "var(--up)" : "var(--down)", fontWeight: 700, marginRight: 6 }}
                          >
                            {n.direction === "positive" ? "▲" : "▼"}
                          </span>
                        )}
                        {n.header}
                      </span>
                      {n.tickers.length > 0 && (
                        <span className="notif-tickers">
                          {(n.matchedTickers?.length ? n.matchedTickers : n.tickers)
                          .slice(0, 4)
                          .map(t => <span key={t} className="notif-tkr">{t}</span>)}
                          {n.source && <span className="notif-src">{n.source}</span>}
                        </span>
                      )}
                      <span className="notif-time">{timeAgo(n.publishedAt)}</span>
                    </span>
                    <span className={`notif-chev${isOpen ? " on" : ""}`} aria-hidden>›</span>
                  </button>

                  {isOpen && (
                    <div className="notif-detail">
                      <p>{n.detail || "No further detail provided."}</p>
                      {n.url && (
                        <a href={n.url} target="_blank" rel="noopener noreferrer" className="notif-link">
                          Read full article →
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
