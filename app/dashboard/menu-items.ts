export const menuItems = [
  // ---- Home ----
  { label: 'Dashboard', slug: 'dashboard', group: 'Home', icon: '⬛', badge: null },
  // ---- Markets ----
  { label: 'Earnings Hub', slug: 'earnings', group: 'Markets', icon: '📋', badge: null },
  { label: 'Movers', slug: 'movers', group: 'Markets', icon: '📈', badge: null },
  { label: 'Heatmap', slug: 'heatmap', group: 'Markets', icon: '🟩', badge: null },
  { label: 'Analyst Actions', slug: 'analyst', group: 'Markets', icon: '🔔', badge: null },
  { label: 'Macro & VIX', slug: 'macro', group: 'Markets', icon: '📅', badge: null },
  // ---- Research ----
  { label: 'Screener', slug: 'screener', group: 'Research', icon: '🔍', badge: null },
  { label: 'Themes', slug: 'themes', group: 'Research', icon: '◈', badge: null },
  { label: 'IPOs', slug: 'ipos', group: 'Research', icon: '🚀', badge: null },
  { label: 'Insider & Institutional', slug: 'insider', group: 'Research', icon: '📄', badge: null },
  // ---- Market Recaps ----
  { label: 'Daily/Weekly Recaps', slug: 'recap', group: 'Market Recaps', icon: '🔖', badge: null },
  { label: 'Market Commentary', slug: 'commentary', group: 'Market Recaps', icon: '💬', badge: null },
  // ---- My Workspace ----
  { label: 'Portfolio', slug: 'portfolio', group: 'My Workspace', icon: '💼', badge: null },
  { label: 'Watchlist', slug: 'watchlist', group: 'My Workspace', icon: '⭐', badge: null },
  // ---- Hidden: route kept (static export + ⌘K search), not shown in the nav.
  //      Options is hidden "for now"; Search (stock detail) is reached via ⌘K
  //      and by clicking a ticker, not a nav item. The 'Hidden' group is not in
  //      the shell's rendered group order, so these never appear in the menu. ----
  { label: 'Options', slug: 'options', group: 'Hidden', icon: '◈', badge: null },
  { label: 'Search', slug: 'stock', group: 'Hidden', icon: '📊', badge: null },
] as const;

export type MenuItem = (typeof menuItems)[number];

export function getMenuItemBySlug(slug: string) {
  return menuItems.find((item) => item.slug === slug);
}
