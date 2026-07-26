"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { firebaseDb } from "../firebase";
import { useAppSelector } from "../store/hooks";
import type { SnapshotQuote } from "./hooks/useSnapshotQuote";

/**
 * App-wide live (delayed) price subscription.
 *
 * The moment a user is signed in, this subscribes every ticker in their
 * Portfolio and Watchlist — read straight from Firestore — so those prices are
 * warm across the whole app, not just on the screen that happens to be open.
 * Any screen can register additional tickers (the stock being viewed, the
 * search results) via useLivePrices()/useLivePrice(); registrations are
 * ref-counted so a ticker stops polling once nothing references it.
 *
 * All of it collapses to ONE poll of the union per interval (chunked at the
 * endpoint's 50-ticker cap). The backend already serves one Polygon call per
 * refresh regardless of how many browsers ask, and `cache: no-store` keeps the
 * browser from handing back a stale-while-revalidate body — see useSnapshotQuote.
 */

import { API_BASE } from "./backend";
const BACKEND = API_BASE;
const TICKERS_PER_CALL = 50; // /live/snapshot ?tickers cap
const MAX_TICKERS = 100; // hard ceiling on the union (2 calls)
const POLL_MS = 15_000;

interface LivePricesCtx {
  prices: Map<string, SnapshotQuote>;
  register: (tickers: string[]) => () => void;
}

const EMPTY: Map<string, SnapshotQuote> = new Map();
const Ctx = createContext<LivePricesCtx>({ prices: EMPTY, register: () => () => {} });

/**
 * Register `tickers` for live polling for as long as the caller is mounted, and
 * read the shared price map (keyed by upper-case ticker). Drop-in replacement
 * for useSnapshotQuotes — same Map<string, SnapshotQuote> return.
 */
export function useLivePrices(tickers: string[]): Map<string, SnapshotQuote> {
  const { prices, register } = useContext(Ctx);
  const key = [...new Set(tickers.map((t) => t?.toUpperCase()).filter(Boolean))]
    .sort()
    .join(",");
  useEffect(() => {
    if (!key) return;
    return register(key.split(","));
  }, [key, register]);
  return prices;
}

/** Single-ticker convenience over useLivePrices. */
export function useLivePrice(ticker: string | null | undefined): SnapshotQuote | undefined {
  const arr = useMemo(() => (ticker ? [ticker] : []), [ticker]);
  const map = useLivePrices(arr);
  return ticker ? map.get(ticker.toUpperCase()) : undefined;
}

export function LivePricesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAppSelector((s) => s.auth);
  const uid = user?.uid ?? null;

  const [prices, setPrices] = useState<Map<string, SnapshotQuote>>(new Map());
  // Tickers the signed-in user always has subscribed (portfolio ∪ watchlist).
  const [baseTickers, setBaseTickers] = useState<string[]>([]);
  // Ref-counted transient registrations from screens, mirrored into state so
  // the polling effect re-keys when the registered set changes.
  const counts = useRef<Map<string, number>>(new Map());
  const [registered, setRegistered] = useState<string[]>([]);

  const register = useCallback((tickers: string[]) => {
    for (const t of tickers) counts.current.set(t, (counts.current.get(t) ?? 0) + 1);
    setRegistered([...counts.current.keys()]);
    return () => {
      for (const t of tickers) {
        const n = (counts.current.get(t) ?? 1) - 1;
        if (n <= 0) counts.current.delete(t);
        else counts.current.set(t, n);
      }
      setRegistered([...counts.current.keys()]);
    };
  }, []);

  // Seed the base set from Firestore the moment we know the user. Watchlist is a
  // single doc with a `tickers[]`; holdings is a subcollection of ticker docs.
  useEffect(() => {
    if (!uid) {
      setBaseTickers([]);
      return;
    }
    let watch: string[] = [];
    let hold: string[] = [];
    const push = () => setBaseTickers([...new Set([...watch, ...hold])]);
    const unsubW = onSnapshot(
      doc(firebaseDb, "users", uid, "watchlists", "default"),
      (snap) => {
        watch = ((snap.data()?.tickers as string[] | undefined) ?? []).map((t) => t.toUpperCase());
        push();
      },
      () => {},
    );
    const unsubH = onSnapshot(
      collection(firebaseDb, "users", uid, "portfolios", "default", "holdings"),
      (snap) => {
        hold = snap.docs
          .map((d) => (d.data()?.ticker as string | undefined) ?? d.id)
          .filter(Boolean)
          .map((t) => t.toUpperCase());
        push();
      },
      () => {},
    );
    return () => {
      unsubW();
      unsubH();
    };
  }, [uid]);

  const unionKey = [...new Set([...baseTickers, ...registered])].sort().slice(0, MAX_TICKERS).join(",");

  useEffect(() => {
    if (!unionKey) return;
    const all = unionKey.split(",");
    const chunks: string[][] = [];
    for (let i = 0; i < all.length; i += TICKERS_PER_CALL) {
      chunks.push(all.slice(i, i + TICKERS_PER_CALL));
    }
    let cancelled = false;
    const controller = new AbortController();
    // ZERO-poll when closed (2026-07-26): outside 04:00–20:00 ET weekdays the
    // quotes are frozen, so after ONE fetch to populate this ticker set the
    // client stops polling entirely; the local clock check below runs every
    // tick (no network) so polling resumes by itself when the session opens.
    // A hidden tab never polls (it catches up on visibilitychange).
    let fetchedOnce = false;
    const marketLikelyClosed = () => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", hour12: false, weekday: "short", hour: "numeric",
      }).formatToParts(new Date());
      const wd = parts.find(p => p.type === "weekday")?.value ?? "Mon";
      const hour = Number(parts.find(p => p.type === "hour")?.value ?? "12") % 24;
      const weekday = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(wd);
      return !(weekday >= 1 && weekday <= 5 && hour >= 4 && hour < 20);
    };

    const poll = async (force = false) => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (!force && marketLikelyClosed() && fetchedOnce) return;
      fetchedOnce = true;
      try {
        const results = await Promise.all(
          chunks.map(async (chunk) => {
            const res = await fetch(
              `${BACKEND}/live/snapshot?tickers=${encodeURIComponent(chunk.join(","))}`,
              { signal: controller.signal, cache: "no-store" },
            );
            if (!res.ok) return null; // keep prior prices for this chunk
            const body = await res.json();
            return (body.quotes ?? []) as SnapshotQuote[];
          }),
        );
        if (cancelled) return;
        setPrices((prev) => {
          const next = new Map(prev);
          for (const quotes of results) {
            if (!quotes) continue;
            for (const q of quotes) if (q.ticker) next.set(q.ticker.toUpperCase(), q);
          }
          return next;
        });
      } catch {
        // Network blip — keep the last good prices.
      }
    };

    void poll(true);
    const id = setInterval(() => void poll(), POLL_MS);
    // Coming back to a hidden tab refreshes immediately.
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") void poll(true);
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
  }, [unionKey]);

  const value = useMemo<LivePricesCtx>(() => ({ prices, register }), [prices, register]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
