"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../backend";

/**
 * Fetches a backend REST endpoint, replacing useCollection()'s direct
 * Firestore onSnapshot for screens migrated to the backend. No live push —
 * pass a refetchMs to poll, otherwise it fetches once per (path, deps) change.
 * Pass path === null to skip fetching (e.g. waiting on an auth-dependent id).
 */
export function useApiResource<T>(path: string | null, refetchMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (path === null) {
      // Deferred so this stays a callback, not a synchronous setState in the
      // effect body (see react-hooks/set-state-in-effect).
      queueMicrotask(() => setLoading(false));
      return;
    }
    let cancelled = false;

    // On a path change (e.g. switching ticker), re-raise the spinner and drop
    // the previous path's data so the screen shows "Loading…" instead of the
    // stale result while the new — now live/slow — request is in flight. Done
    // once per effect run (path change), NOT inside load(), so poll refetches
    // (refetchMs) refresh silently without flashing the spinner. queueMicrotask
    // keeps this out of the synchronous effect body (react-hooks lint).
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setData(null);
        setError(null);
      }
    });

    async function load() {
      try {
        const result = await apiGet<T>(path as string);
        if (!cancelled) {
          setData(result);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(`Backend fetch failed for "${path}":`, err);
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }

    load();
    const interval = refetchMs ? setInterval(load, refetchMs) : undefined;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [path, refetchMs]);

  return { data, loading, error };
}
