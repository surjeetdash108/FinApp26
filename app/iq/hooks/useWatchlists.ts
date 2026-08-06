"use client";

import { useCallback, useEffect, useState } from "react";
import { firebaseAuth } from "../../firebase";
import { apiGet, apiPost, apiPatch, apiDelete } from "../backend";

export interface Watchlist {
  id: string;
  name: string;
  tickers: string[];
}

/**
 * Multiple named watchlists for the signed-in user. Backed by
 * GET/POST/PATCH/DELETE /api/watchlists (users/{uid}/watchlists/{id}). All
 * mutations update local state optimistically and reconcile from the server
 * response; a failed write refetches so the UI never drifts from the backend.
 */
export function useWatchlists() {
  const uid = firebaseAuth.currentUser?.uid ?? null;
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!uid) { setWatchlists([]); setLoading(false); return; }
    try {
      const res = await apiGet<{ watchlists: Watchlist[] }>("/api/watchlists");
      setWatchlists(res.watchlists ?? []);
    } catch { /* keep previous */ } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createList = useCallback(async (name: string): Promise<Watchlist | null> => {
    try {
      const created = await apiPost<Watchlist>("/api/watchlists", { name });
      setWatchlists(prev => [...prev, created]);
      return created;
    } catch { return null; }
  }, []);

  const renameList = useCallback(async (id: string, name: string) => {
    setWatchlists(prev => prev.map(w => (w.id === id ? { ...w, name } : w)));
    try { await apiPatch<Watchlist>(`/api/watchlists/${id}`, { name }); } catch { void refresh(); }
  }, [refresh]);

  const deleteList = useCallback(async (id: string) => {
    setWatchlists(prev => prev.filter(w => w.id !== id));
    try {
      const res = await apiDelete<{ watchlists: Watchlist[] }>(`/api/watchlists/${id}`);
      setWatchlists(res.watchlists ?? []);
    } catch { void refresh(); }
  }, [refresh]);

  const addTicker = useCallback(async (id: string, sym: string) => {
    const s = sym.toUpperCase();
    setWatchlists(prev => prev.map(w => (w.id === id && !w.tickers.includes(s) ? { ...w, tickers: [...w.tickers, s] } : w)));
    try { await apiPost<Watchlist>(`/api/watchlists/${id}/tickers`, { ticker: s }); } catch { void refresh(); }
  }, [refresh]);

  const removeTicker = useCallback(async (id: string, sym: string) => {
    const s = sym.toUpperCase();
    setWatchlists(prev => prev.map(w => (w.id === id ? { ...w, tickers: w.tickers.filter(t => t !== s) } : w)));
    try { await apiDelete<Watchlist>(`/api/watchlists/${id}/tickers/${encodeURIComponent(s)}`); } catch { void refresh(); }
  }, [refresh]);

  return { uid, watchlists, loading, refresh, createList, renameList, deleteList, addTicker, removeTicker };
}
