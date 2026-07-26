"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { firebaseDb } from "../../firebase";

/**
 * Live Firestore collection read, with ONE listener per collection process-wide.
 *
 * WHY THE SHARED REGISTRY
 * Every call to this hook used to open its own `onSnapshot`. Components cannot
 * know what their siblings read, so the same collection was routinely subscribed
 * more than once on a single screen: the Earnings page mounts the calendar and
 * the detail section, and BOTH read `earnings_events` and `companies` — 299
 * documents fetched and billed twice per page load. Firestore charges per
 * document delivered per listener, so the duplication costs money and bytes,
 * not just an extra socket.
 *
 * The registry keys live subscriptions by collection name and ref-counts
 * subscribers. The first mount opens the listener; later mounts attach to it and
 * immediately adopt the last snapshot, so they render with data on their first
 * paint instead of flashing empty. The last unmount closes it.
 *
 * WHY SOME COLLECTIONS ARE SERVED FROM THE BACKEND CACHE (CACHED set below)
 * The shared, slow-changing collections (indices, movers, sectors, breadth,
 * sentiment, earnings, ipos, macro, recaps, …) are written once a day by the
 * sync jobs, yet a direct `onSnapshot` bills each user for every document. So
 * Firestore reads scaled as (users × documents) — the line item that grows the
 * bill fastest. For those collections this hook instead polls the `live`
 * service's cached `/live/collections` endpoint (one server-side read per few
 * minutes, shared by everyone), which makes reads INDEPENDENT of user count. If
 * that endpoint is unreachable it transparently falls back to a direct
 * Firestore listener, so nothing breaks. User-owned/private collections
 * (watchlists, holdings, settings) are never cached — they stay direct.
 *
 * WHY THE CLOSE IS DEFERRED
 * React StrictMode double-invokes effects, and a route change can unmount one
 * reader of a collection just before mounting another. Closing synchronously
 * would tear down the listener and immediately reopen it, re-downloading the
 * whole collection for nothing. A short grace period lets the incoming
 * subscriber adopt the still-open listener.
 */

const IDLE_CLOSE_MS = 5_000;
const CACHE_POLL_MS = 5 * 60 * 1000; // matches the backend's 5-minute TTL
import { API_BASE } from "../backend";
const BACKEND = API_BASE;

/** Shared, slow-changing collections served from the backend cache (must match
 *  the backend allow-list in cached-collections.service.ts). */
const CACHED = new Set<string>([
  "companies",
  "market_indices",
  "market_indices_history",
  "market_movers",
  "market_movers_history",
  "sectors",
  "sectors_history",
  "market_breadth",
  "market_sentiment",
  "market_sentiment_history",
  "earnings_events",
  "analyst_actions",
  "ipos",
  "macro_events",
  "recaps",
  "insider_transactions",
]);

interface Entry {
  /** Latest snapshot, replayed to every new subscriber on attach. */
  data: unknown[];
  error: string | null;
  loading: boolean;
  refs: number;
  unsub: Unsubscribe | null;
  /** Stops the cache poll (cached collections only). */
  stopPoll: (() => void) | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
  listeners: Set<(e: Entry) => void>;
}

const registry = new Map<string, Entry>();

function emit(entry: Entry) {
  for (const l of entry.listeners) l(entry);
}

/** Direct Firestore listener — the default path, and the fallback for cached
 *  collections when the backend cache is unreachable. */
function openFirestore(name: string, e: Entry) {
  if (e.unsub) return;
  e.unsub = onSnapshot(
    collection(firebaseDb, name),
    (snap) => {
      e.data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      e.loading = false;
      e.error = null;
      emit(e);
    },
    (err) => {
      console.error(`Firestore read failed for "${name}":`, err);
      e.error = err.message;
      e.loading = false;
      emit(e);
    },
  );
}

/** Poll the backend cache for a shared collection; fall back to Firestore if the
 *  endpoint is unreachable (and we have no data yet). */
function startCachedPoll(name: string, e: Entry) {
  let stopped = false;
  let etag: string | null = null;
  const poll = async () => {
    try {
      const res = await fetch(`${BACKEND}/live/collections?names=${encodeURIComponent(name)}`, {
        // `no-store` + manual If-None-Match: every poll is a real request, but an
        // UNCHANGED collection returns a 304 with NO body. These collections
        // change once a day, so after the first fetch nearly every poll is a
        // few-byte 304 — the payload (companies is ~0.5 MB) crosses the wire
        // only when the data actually changes.
        cache: "no-store",
        headers: etag ? { "If-None-Match": etag } : {},
      });
      if (stopped || res.status === 304) return; // unchanged → keep current data
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tag = res.headers.get("ETag");
      if (tag) etag = tag;
      const body = (await res.json()) as Record<string, unknown[]>;
      const docs = Array.isArray(body?.[name]) ? body[name] : [];
      if (stopped) return;
      e.data = docs;
      e.loading = false;
      e.error = null;
      emit(e);
    } catch {
      if (stopped) return;
      // Only fall back if we never got cached data — otherwise keep the last
      // good snapshot and retry on the next poll.
      if (e.loading && !e.unsub) openFirestore(name, e);
    }
  };
  void poll();
  const id = setInterval(poll, CACHE_POLL_MS);
  e.stopPoll = () => {
    stopped = true;
    clearInterval(id);
  };
}

function acquire(name: string, onChange: (e: Entry) => void): Entry {
  let entry = registry.get(name);

  if (entry) {
    // A pending close from a previous unmount is cancelled — reuse the open
    // listener/poll rather than paying for another full read.
    if (entry.closeTimer) {
      clearTimeout(entry.closeTimer);
      entry.closeTimer = null;
    }
  } else {
    const e: Entry = {
      data: [],
      error: null,
      loading: true,
      refs: 0,
      unsub: null,
      stopPoll: null,
      closeTimer: null,
      listeners: new Set(),
    };
    registry.set(name, e);
    if (CACHED.has(name)) startCachedPoll(name, e);
    else openFirestore(name, e);
    entry = e;
  }

  entry.refs++;
  entry.listeners.add(onChange);
  return entry;
}

function release(name: string, onChange: (e: Entry) => void) {
  const entry = registry.get(name);
  if (!entry) return;
  entry.listeners.delete(onChange);
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0 || entry.closeTimer) return;

  entry.closeTimer = setTimeout(() => {
    entry.closeTimer = null;
    // Re-check: a subscriber may have arrived while the timer was pending.
    if (entry.refs > 0) return;
    entry.unsub?.();
    entry.stopPoll?.();
    registry.delete(name);
  }, IDLE_CLOSE_MS);
}

export function useCollection<T>(collectionName: string) {
  const [state, setState] = useState<{ data: T[]; loading: boolean; error: string | null }>(() => {
    // Seed from the registry so a second subscriber paints with data straight
    // away instead of rendering an empty array it must immediately re-render past.
    const existing = registry.get(collectionName);
    return existing
      ? { data: existing.data as T[], loading: existing.loading, error: existing.error }
      : { data: [], loading: true, error: null };
  });

  useEffect(() => {
    const onChange = (e: Entry) =>
      setState({ data: e.data as T[], loading: e.loading, error: e.error });

    const entry = acquire(collectionName, onChange);
    // Adopt what the shared entry already holds: onSnapshot only calls back on
    // the NEXT change, so a late subscriber would otherwise sit empty until the
    // collection happened to change.
    onChange(entry);

    return () => release(collectionName, onChange);
  }, [collectionName]);

  return state;
}
