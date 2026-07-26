"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { firebaseDb } from "../../firebase";

/**
 * One company document, read by id.
 *
 * Deliberately not useCollection("companies"): that subscribes to the WHOLE
 * collection and filters in the browser, which is fine for a screen that
 * genuinely ranks every ticker but wasteful for a panel that needs a single
 * symbol's indicators. This is one document read per selected ticker.
 */

export interface CompanyDoc {
  ticker?: string;
  name?: string | null;
  price?: number | null;
  pctChange?: number | null;
  marketCap?: number | null;
  peRatio?: number | null;
  eps?: number | null;
  beta?: number | null;
  sector?: string | null;
  industry?: string | null;
  exchange?: string | null;
  description?: string | null;

  /** Peers from Polygon /v1/related-companies (was a sector-filtered mock list). */
  peers?: string[] | null;
  dividendYield?: number | null;
  dividendPerShare?: number | null;

  // ── technical-indicators.job.ts ──
  rsi14?: number | null;
  /** Rolling RSI(14) line; the pane drew a seeded sine walk without it. */
  rsi14Series?: number[] | null;
  macd?: number | null;
  macdSignal?: number | null;
  macdHistogram?: number | null;
  rvol?: number | null;
  sma50?: number | null;
  sma200?: number | null;
  aboveSma50?: boolean | null;
  aboveSma200?: boolean | null;
  week5ChangePct?: number | null;
  /** SMA/EMA keyed by period ("10","20","30","50","100","200"). */
  smaLadder?: Record<string, number | null> | null;
  emaLadder?: Record<string, number | null> | null;
  vwap?: number | null;
  high52?: number | null;
  low52?: number | null;
  pctFromHigh52?: number | null;
  pctFromLow52?: number | null;
  avgVolume20?: number | null;
  avgVolume50?: number | null;
  barsAnalyzed?: number | null;

  rsRating?: number | null;
  techRating?: number | null;
  sectorRank?: number | null;
  sectorRankTotal?: number | null;
}

import { API_BASE } from "../backend";
const BACKEND = API_BASE;

/** One on-demand trigger per ticker per session — prevents request loops. */
const requested = new Set<string>();

/**
 * ON-DEMAND (2026-07-24): when the company doc doesn't exist yet (the DB starts
 * empty and grows with usage), poke `GET /live/company` once — the backend
 * fetches the profile+price from Polygon and WRITES `companies/{ticker}`, and
 * the snapshot listener below then fires with the real data. Existing docs are
 * served straight from Firestore with no backend call.
 */
function requestOnDemand(sym: string): void {
  if (requested.has(sym)) return;
  requested.add(sym);
  void fetch(`${BACKEND}/live/company?ticker=${encodeURIComponent(sym)}`).catch(() => {
    requested.delete(sym); // allow a retry on a later mount if the poke failed
  });
}

/** Give the on-demand fetch this long to land before screens stop spinning. */
const ONDEMAND_GRACE_MS = 12_000;

/**
 * Company doc + loading flag. `loading` is true while the first snapshot is
 * pending AND while the on-demand backend fetch (triggered on a missing doc)
 * has not yet written the doc — bounded by a grace period so an unknown ticker
 * can't spin forever. Screens show a spinner while loading, their honest
 * "—" / empty states after.
 */
export function useCompanyState(sym: string): { company: CompanyDoc | undefined; loading: boolean } {
  const [data, setData] = useState<CompanyDoc | undefined>(undefined);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!sym) {
      setData(undefined);
      setSettled(true);
      return;
    }
    setData(undefined);
    setSettled(false);
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    const unsub = onSnapshot(
      doc(firebaseDb, "companies", sym),
      snap => {
        if (snap.exists()) {
          if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
          setData(snap.data() as CompanyDoc);
          setSettled(true);
        } else {
          setData(undefined);
          // Missing → poke the backend once; keep "loading" until the doc
          // appears via this same listener, or the grace period lapses.
          requestOnDemand(sym.toUpperCase());
          if (!graceTimer) graceTimer = setTimeout(() => setSettled(true), ONDEMAND_GRACE_MS);
        }
      },
      err => {
        console.error(`Firestore companies/${sym} read failed:`, err);
        setData(undefined);
        setSettled(true);
      },
    );
    return () => {
      unsub();
      if (graceTimer) clearTimeout(graceTimer);
    };
  }, [sym]);

  return { company: data, loading: !data && !settled };
}

export function useCompany(sym: string): CompanyDoc | undefined {
  return useCompanyState(sym).company;
}
