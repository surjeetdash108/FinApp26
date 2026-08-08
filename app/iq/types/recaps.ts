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

export interface RecapDoc {
  id?: string;
  date: string;
  internals: RecapInternals | null;
  /** Weekly rollup from *_history collections (index % + sector leaders/laggards). */
  weekly: RecapWeekly | null;
  /** narrative is written null by the job — prose isn't produced yet. */
  narrative: string | null;
}
