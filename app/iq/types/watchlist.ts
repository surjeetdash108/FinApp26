/** Mirrors backend's `users/{uid}/watchlists/default` doc (src/user-data/watchlist.controller.ts) — GET/POST/DELETE /api/watchlist. */
export interface WatchlistDoc {
  tickers: string[];
}
