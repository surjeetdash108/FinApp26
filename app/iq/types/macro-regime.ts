/** Mirrors backend's `macro_regime/current` (macro-regime job) — GET /market-data/macro-regime. Rules-based FRED-derived regime read. */
export interface RegimeComponent {
  value: number | null;
  signal: -1 | 0 | 1 | null;
  label: string;
}

export interface MacroRegimeDoc {
  id: string; // "current"
  regime: "Risk-On" | "Neutral" | "Risk-Off";
  score: number;
  maxScore: number;
  components: {
    yieldCurve: RegimeComponent;
    volatility: RegimeComponent;
    credit: RegimeComponent;
    trend: RegimeComponent;
    employment: RegimeComponent;
  };
  asOfDate: string;
  source: string;
}
