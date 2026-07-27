/** Mirrors backend's `options_chains/{ticker}` doc (src/live/ondemand.service.ts's getOptionsChain) — GET /live/options-chain?ticker=X. Curated 8-ticker universe only. */
export interface LiveOptionContract {
  contractTicker: string;
  contractType: "call" | "put";
  strike: number;
  expirationDate: string;
  lastClose: number | null;
  lastVolume: number | null;
  lastBarDate: string | null;
}

export interface OptionsChainDoc {
  underlyingTicker: string;
  contracts: LiveOptionContract[];
  note: string;
  source: string;
}

/** Same curated universe as backend's src/common/options-universe.ts. */
export const OPTIONS_UNIVERSE: string[] = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "SPY", "QQQ"];
