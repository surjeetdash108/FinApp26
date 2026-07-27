"use client";

import { useApiResource } from "./useApiResource";

/**
 * Same return shape as useCollection() — `data` always an array, defaulting
 * to `[]` rather than `null` — for backend list endpoints that replace a
 * Firestore collection listener (Movers, Heatmap, and the rest of Phase 2).
 */
export function useApiList<T>(path: string | null, refetchMs?: number) {
  const { data, loading, error } = useApiResource<T[]>(path, refetchMs);
  return { data: data ?? [], loading, error };
}
