import { menuItems } from "../dashboard/menu-items";

/**
 * Static feature catalog — labels + groups only.
 *
 * New-architecture rule: the browser does not write to Firestore. The original
 * `trackFeatureOpen()` (client → Firestore) was removed in the 2026-08-03 admin
 * port; feature-adoption WRITES must go through the backend when they are wired
 * (UI → backend → Firebase). This module now only supplies the label/group
 * lookups the admin console uses to name each tracked feature.
 *
 * SCREENS are derived from `menuItems` so the nav and this list cannot drift.
 */
export const TRACKED_FEATURES: Array<{ key: string; label: string; group: string }> = [
  // ── Screens (from the nav) ────────────────────────────────────────────────
  ...menuItems.map(m => ({ key: m.slug, label: m.label, group: m.group as string })),

  // ── Screens with no nav entry ─────────────────────────────────────────────
  { key: "earnings-calendar", label: "Earnings Calendar", group: "Intelligence" },
  { key: "settings", label: "Settings", group: "Account" },
  { key: "manage-plan", label: "Manage Plan", group: "Account" },
  { key: "profile", label: "Profile", group: "Account" },

  // ── Stock Detail: the drawers ─────────────────────────────────────────────
  { key: "stock.drawer.techrating", label: "Technical Rating drawer", group: "Stock Detail" },
  { key: "stock.drawer.peers", label: "Peers drawer", group: "Stock Detail" },
  { key: "stock.drawer.industry", label: "Industry Group drawer", group: "Stock Detail" },
  { key: "stock.drawer.insider", label: "Insider & Institutional drawer", group: "Stock Detail" },
  { key: "stock.drawer.keylevels", label: "Key Levels drawer", group: "Stock Detail" },
  { key: "stock.drawer.earnings", label: "Earnings History drawer", group: "Stock Detail" },
  { key: "stock.drawer.financials", label: "Financials drawer", group: "Stock Detail" },
  { key: "stock.drawer.dividend", label: "Dividend History drawer", group: "Stock Detail" },

  // ── Charting ──────────────────────────────────────────────────────────────
  { key: "chart.timeframe.intraday", label: "Chart · intraday (1D/1W/1M)", group: "Charting" },
  { key: "chart.timeframe.long", label: "Chart · long range (1Y/5Y)", group: "Charting" },
  { key: "chart.type", label: "Chart · type changed", group: "Charting" },
  { key: "chart.indicator.ma", label: "Chart · moving averages", group: "Charting" },
  { key: "chart.indicator.ema", label: "Chart · EMA", group: "Charting" },
  { key: "chart.indicator.rsi", label: "Chart · RSI pane", group: "Charting" },
  { key: "chart.indicator.volume", label: "Chart · volume", group: "Charting" },
  { key: "chart.indicator.earnings", label: "Chart · earnings markers", group: "Charting" },
  { key: "chart.expand", label: "Chart · expanded view", group: "Charting" },
  { key: "chart.note", label: "Chart · note added", group: "Charting" },

  // ── Portfolio & watchlist actions ─────────────────────────────────────────
  { key: "watchlist.add", label: "Watchlist · add symbol", group: "My Money" },
  { key: "watchlist.remove", label: "Watchlist · remove symbol", group: "My Money" },
  { key: "portfolio.add", label: "Portfolio · add holding", group: "My Money" },
  { key: "portfolio.import", label: "Portfolio · import from photo", group: "My Money" },

  // ── Discovery ─────────────────────────────────────────────────────────────
  { key: "search.ticker", label: "Ticker search", group: "Discovery" },
  { key: "screener.preset", label: "Screener · preset applied", group: "Discovery" },
  { key: "screener.save", label: "Screener · screen saved", group: "Discovery" },
  { key: "movers.tab", label: "Movers · tab switched", group: "Discovery" },
  { key: "heatmap.mode", label: "Heatmap · day/week toggle", group: "Discovery" },

  // ── Content ───────────────────────────────────────────────────────────────
  { key: "news.drawer", label: "News drawer", group: "Content" },
  { key: "news.tab", label: "Commentary · tab switched", group: "Content" },
  { key: "recap.export", label: "Recap · export", group: "Content" },
  { key: "earnings.call", label: "Earnings call drawer", group: "Content" },

  // ── Gated / not yet built ─────────────────────────────────────────────────
  { key: "ai-assistant", label: "AI Assistant", group: "AI" },
  { key: "alerts.create", label: "Alert created", group: "Alerts" },
  { key: "options.chain", label: "Options chain viewed", group: "Options" },
];

export const FEATURE_LABEL = new Map(TRACKED_FEATURES.map(f => [f.key, f.label]));
export const FEATURE_GROUP = new Map(TRACKED_FEATURES.map(f => [f.key, f.group]));
