// Extracted from app/iq/entitlements.tsx @ commit 4090ae2 (AppUI) during the
// 2026-08-03 surgical admin-panel port to prod. Self-contained so the admin
// console does not drag in the full entitlements/feature-flags system.
// Mirrors ENTITLEMENTS in the backend's plans.registry.ts — keep in sync.

export interface EntitlementDef {
  key: string;
  label: string;
  /** One plain sentence: what the user gets when this is ON. */
  description: string;
  group: string;
  staffOnly?: boolean;
  unbuilt?: boolean;
}

/**
 * Mirrors ENTITLEMENTS in the backend's plans.registry.ts — keep them in sync.
 * The backend is the source of truth; this copy exists so the client can gate
 * without a round-trip it currently cannot make.
 */
export const ENTITLEMENTS: EntitlementDef[] = [
  { key: "marketCatalyst", label: "Market Dashboard", group: "Core",
    description: "See the main dashboard with market pulse, movers and heatmap." },
  { key: "news", label: "News & Commentary", group: "Core",
    description: "Read the live news feed and commentary screen." },
  { key: "scanner", label: "Market Movers", group: "Core",
    description: "See daily gainers, losers and unusual-volume lists." },
  { key: "heatmap", label: "Sector Heatmap", group: "Core",
    description: "View the sector and stock heatmap with day/week performance." },
  { key: "macro", label: "Macro & Calendars", group: "Core",
    description: "Access the economic calendar, VIX and dividend calendars." },
  { key: "ipos", label: "IPO Corner", group: "Core",
    description: "Browse upcoming and recent IPOs with offer prices." },
  { key: "chartsDaily", label: "Daily Charts", group: "Charting",
    description: "View 3-month, 6-month and 1-year price charts." },
  { key: "chartsIntraday", label: "Intraday Charts", group: "Charting",
    description: "View 1-day, 1-week and 1-month charts built from minute bars." },
  { key: "chartsHistory", label: "Long History (5Y)", group: "Charting",
    description: "View the full five-year price history on any chart." },
  { key: "chartIndicators", label: "Chart Indicators", group: "Charting",
    description: "Overlay moving averages, EMAs, volume and the RSI pane." },
  { key: "chartNotes", label: "Chart Notes", group: "Charting",
    description: "Save personal notes pinned to a chart." },
  { key: "technicalRatings", label: "Technical Ratings", group: "Research",
    description: "See the technical rating gauge, RSI, MACD and moving-average table." },
  { key: "fundamentalRatings", label: "Financial Statements", group: "Research",
    description: "See quarterly revenue, EPS, balance sheet and cash flow." },
  { key: "dividendHistory", label: "Dividend History", group: "Research",
    description: "See full dividend history, yield, growth rate and payment dates." },
  { key: "peers", label: "Peer Comparison", group: "Research",
    description: "See comparable companies and how the stock ranks against them." },
  { key: "ownership", label: "Insider & 13F", group: "Research",
    description: "See insider trades and institutional fund holdings." },
  { key: "earningsDetail", label: "Earnings Detail", group: "Research",
    description: "See EPS history, estimate-vs-actual and the earnings calendar." },
  { key: "watchlist", label: "Watchlist", group: "My Money",
    description: "Build and track a personal watchlist of stocks." },
  { key: "portfolio", label: "Portfolio Tracking", group: "My Money",
    description: "Track holdings with live prices and profit/loss." },
  { key: "screener", label: "Stock Screener", group: "My Money",
    description: "Filter the universe by growth, technical and liquidity criteria." },
  { key: "themes", label: "Sector Themes", group: "My Money",
    description: "Browse curated theme baskets such as Mag7 and AI & Semis." },
  { key: "alerts", label: "Price Alerts", group: "My Money",
    description: "Create alerts that fire when a price or signal condition is met.", unbuilt: true },
  { key: "optionsChain", label: "Options Chain", group: "Advanced",
    description: "View the options chain with strikes, expirations and traded prices." },
  { key: "exportData", label: "Data Export", group: "Advanced",
    description: "Download screens and recaps as PDF or CSV.", unbuilt: true },
  { key: "apiAccess", label: "API Access", group: "Advanced",
    description: "Call the market-data API from your own scripts with a key.", unbuilt: true },
  { key: "aiAssistant", label: "AI Assistant", group: "Advanced",
    description: "Ask the AI copilot questions and get generated summaries.", unbuilt: true },
  { key: "backtesting", label: "Backtesting", group: "Advanced",
    description: "Test a strategy against historical price data.", unbuilt: true },
  { key: "paperTrading", label: "Paper Trading", group: "Advanced",
    description: "Place simulated trades without real money.", unbuilt: true },
  { key: "adminDashboard", label: "Admin Console", group: "Staff",
    description: "Open the admin console with revenue and user analytics.", staffOnly: true },
  { key: "userManagement", label: "User Management", group: "Staff",
    description: "View and manage other users’ accounts and subscriptions.", staffOnly: true },
];

