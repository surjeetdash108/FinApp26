// Unified sector/theme filter — ONE option set shared across every screen's
// sector dropdown so it's identical app-wide. The dropdown carries the live GICS
// sectors PLUS the curated theme baskets below; the visible theme "tabs" on the
// Themes screen are just quick-access shortcuts to the same values.
//
// Selecting a GICS sector filters by CompanyDoc.sector; selecting a theme filters
// by that theme's ticker membership. Use matchesSector() everywhere so behaviour
// is uniform.

/** Curated theme basket — editorial ticker list (there is no live "theme" feed). */
export interface Theme {
  id: string;
  name: string;
  desc: string;
  tickers: string[];
}

export const THEMES: Theme[] = [
  { id: "mag7", name: "Magnificent Seven", desc: "The 7 mega-caps driving market returns",
    tickers: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"] },
  { id: "ai", name: "AI & Semiconductors", desc: "Chips, models and infrastructure powering AI",
    tickers: ["NVDA", "AMD", "AVGO", "INTC", "MU", "ARM", "QCOM", "MRVL"] },
  { id: "software", name: "Software & Cloud", desc: "Enterprise SaaS and cloud platforms",
    tickers: ["PLTR", "CRM", "NOW", "MSFT", "ADSK", "SNOW", "DDOG"] },
  { id: "internet", name: "Internet & Media", desc: "Digital advertising, streaming and social",
    tickers: ["META", "GOOGL", "AMZN", "NFLX", "PINS", "SNAP"] },
  { id: "consumer", name: "Consumer & Retail", desc: "Brands, retail and consumer discretionary",
    tickers: ["AMZN", "TSLA", "SBUX", "NKE", "MCD", "HD", "TGT", "WBA"] },
  { id: "fintech", name: "Fintech", desc: "Payments, crypto and financial innovation",
    tickers: ["PYPL", "SQ", "V", "MA", "SOFI", "COIN", "AFRM"] },
  { id: "hardware", name: "Devices & Hardware", desc: "Physical compute, servers and peripherals",
    tickers: ["AAPL", "DELL", "SMCI", "HPQ", "NTAP", "WDC"] },
  { id: "value", name: "Deep Value", desc: "Low-multiple, out-of-favor names with recovery potential",
    tickers: ["INTC", "WBA", "DELL", "F", "BAC", "C", "T"] },
];

export const THEME_NAMES: string[] = THEMES.map(t => t.name);
const themeByName = new Map(THEMES.map(t => [t.name, t]));

/** The theme for a selected value, or null if it's a plain sector / "All". */
export function themeFor(selected: string): Theme | null {
  return themeByName.get(selected) ?? null;
}

export function isTheme(selected: string): boolean {
  return themeByName.has(selected);
}

/**
 * The uniform option list for EVERY sector dropdown: "All" + the GICS sectors
 * actually present in `companies` + the curated theme names. Same everywhere.
 */
export function sectorFilterOptions(
  companies: Array<{ sector?: string | null }>,
): string[] {
  const sectors = Array.from(
    new Set(
      companies
        .map(c => c.sector)
        .filter((s): s is string => !!s && s !== "—"),
    ),
  ).sort();
  return ["All", ...sectors, ...THEME_NAMES];
}

/**
 * True if a ticker (with its GICS sector) passes the selected filter. "All" →
 * everything; a theme → the ticker is in that theme's basket; a sector → the
 * ticker's sector matches.
 */
export function matchesSector(
  selected: string,
  ticker: string | null | undefined,
  sector: string | null | undefined,
): boolean {
  if (!selected || selected === "All") return true;
  const theme = themeByName.get(selected);
  if (theme) return ticker != null && theme.tickers.includes(ticker);
  return sector === selected;
}
