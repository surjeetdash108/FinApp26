/** Mirrors backend's `recaps` collection (src/market-data/recaps.controller.ts) —
 *  GET /market-data/recaps. One doc per trading day, written by recaps.job.ts. */

export interface RecapInternals {
  date: string;
  advancers: number | null;
  decliners: number | null;
  netAdvancers: number | null;
  breadthPct: number | null;
  trin: number | null;
  mcclellan: number | null;
  upVolume: number | null;
  downVolume: number | null;
}

export interface RecapWeeklyIndex {
  label: string;
  pctChange: number | null;
}

export interface RecapWeeklySector {
  sector: string;
  pctChange: number;
}

export interface RecapWeekly {
  indices: RecapWeeklyIndex[];
  sectorLeaders: RecapWeeklySector[];
  sectorLaggards: RecapWeeklySector[];
}

/** Daily index snapshot carried on the recap doc. */
export interface RecapIndex {
  id?: string;
  label: string;
  value?: number | null;
  pctChange: number | null;
  change?: number | null;
}

/** Daily top mover carried on the recap doc. */
export interface RecapMover {
  ticker: string;
  name?: string | null;
  price?: number | null;
  pctChange: number | null;
  sector?: string | null;
  cap?: string | null;
}

export interface RecapDoc {
  id?: string;
  date: string;
  internals: RecapInternals | null;
  /** Daily index snapshots + top movers + sector leaders/laggards. */
  indices?: RecapIndex[] | null;
  topGainers?: RecapMover[] | null;
  topLosers?: RecapMover[] | null;
  sectorLeaders?: RecapWeeklySector[] | null;
  sectorLaggards?: RecapWeeklySector[] | null;
  /** Weekly rollup from *_history collections (index % + sector leaders/laggards). */
  weekly: RecapWeekly | null;
  /** narrative is written null by the job — prose isn't produced yet. */
  narrative: string | null;
}
