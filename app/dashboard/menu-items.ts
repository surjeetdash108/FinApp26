export const menuItems = [
  // ---- Intelligence group ----
  { label: 'Dashboard', slug: 'dashboard', group: 'Intelligence', icon: '⬛', badge: null },
  { label: 'Earnings Hub', slug: 'earnings', group: 'Intelligence', icon: '📋', badge: null },
  { label: 'Movers', slug: 'movers', group: 'Intelligence', icon: '📈', badge: null },
  { label: 'Market Heatmap', slug: 'heatmap', group: 'Intelligence', icon: '🟩', badge: null },
  { label: 'Analyst Actions', slug: 'analyst', group: 'Intelligence', icon: '🔔', badge: null },
  { label: 'Screener', slug: 'screener', group: 'Intelligence', icon: '🔍', badge: null },
  { label: 'Themes', slug: 'themes', group: 'Intelligence', icon: '◈', badge: null },
  { label: 'IPO Corner', slug: 'ipos', group: 'Intelligence', icon: '🚀', badge: null },
  { label: 'Search', slug: 'stock', group: 'Intelligence', icon: '📊', badge: null },
  { label: 'Options', slug: 'options', group: 'Intelligence', icon: '◈', badge: null },
  { label: 'Insider & Institutional', slug: 'insider', group: 'Intelligence', icon: '📄', badge: null },
  // ---- Context group ----
  { label: 'Live Feed', slug: 'commentary', group: 'Context', icon: '💬', badge: null },
  { label: 'Recaps', slug: 'recap', group: 'Context', icon: '🔖', badge: null },
  { label: 'Macro & VIX', slug: 'macro', group: 'Context', icon: '📅', badge: null },
  // ---- My Money group ----
  { label: 'Portfolio Pulse', slug: 'portfolio', group: 'My Money', icon: '💼', badge: null },
  { label: 'Watchlist', slug: 'watchlist', group: 'My Money', icon: '⭐', badge: null },
] as const;

export type MenuItem = (typeof menuItems)[number];

export function getMenuItemBySlug(slug: string) {
  return menuItems.find((item) => item.slug === slug);
}
