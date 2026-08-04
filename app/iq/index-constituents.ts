/**
 * Index-constituent membership — static reference config (public facts), NOT
 * market data. Same category as `screenerPresets`: it labels/organises the UI,
 * it does not carry prices or fundamentals. Prices/changes/market caps are all
 * still fetched live from the backend; these lists only decide WHICH of the
 * live companies a given heatmap tab includes.
 *
 * Why static: the data plan does not authorise index products (Polygon
 * `I:NDX`/`I:SPX`/… are NOT_AUTHORIZED), so there is no dynamic membership feed.
 * Memberships drift on index reconstitutions — re-verify periodically. The
 * heatmap intersects these with the live 260-name universe, so a member we do
 * not sync simply does not appear, and a name we sync that is not a member is
 * filtered out.
 *
 * Russell 2000 is intentionally absent: it is 2000 small-caps and our synced
 * universe is large-caps, so the intersection is empty. The heatmap shows an
 * explicit "not available" note for that tab rather than an empty treemap.
 */

// Dow Jones Industrial Average — 30 components (as of 2024-11, after NVDA/SHW
// replaced INTC/DOW and AMZN replaced WBA).
const DOW_30 = [
  "AAPL", "AMGN", "AMZN", "AXP", "BA", "CAT", "CRM", "CSCO", "CVX", "DIS",
  "GS", "HD", "HON", "IBM", "JNJ", "JPM", "KO", "MCD", "MMM", "MRK",
  "MSFT", "NKE", "NVDA", "PG", "SHW", "TRV", "UNH", "V", "VZ", "WMT",
];

// Nasdaq-100 — the 100 largest non-financial Nasdaq-listed companies (2024).
const NASDAQ_100 = [
  "AAPL", "ABNB", "ADBE", "ADI", "ADP", "ADSK", "AEP", "AMAT", "AMD", "AMGN",
  "AMZN", "ANSS", "APP", "ARM", "ASML", "AVGO", "AZN", "BIIB", "BKNG", "BKR",
  "CCEP", "CDNS", "CDW", "CEG", "CHTR", "CMCSA", "COST", "CPRT", "CRWD", "CSCO",
  "CSGP", "CSX", "CTAS", "CTSH", "DASH", "DDOG", "DXCM", "EA", "EXC", "FANG",
  "FAST", "FTNT", "GEHC", "GFS", "GILD", "GOOG", "GOOGL", "HON", "IDXX", "INTC",
  "INTU", "ISRG", "KDP", "KHC", "KLAC", "LIN", "LRCX", "LULU", "MAR", "MCHP",
  "MDB", "MDLZ", "MELI", "META", "MNST", "MRVL", "MSFT", "MU", "NFLX", "NVDA",
  "NXPI", "ODFL", "ON", "ORLY", "PANW", "PAYX", "PCAR", "PDD", "PEP", "PLTR",
  "PYPL", "QCOM", "REGN", "ROP", "ROST", "SBUX", "SNPS", "TEAM", "TMUS", "TSLA",
  "TTD", "TTWO", "TXN", "VRSK", "VRTX", "WBD", "WDAY", "XEL", "ZS",
];

// S&P 500 — large-cap membership (2024). Comprehensive for large/mid caps; the
// cap-weighted treemap is dominated by these, and the intersection with our
// 260-name universe is what actually renders.
const SP_500 = [
  "MMM", "AOS", "ABT", "ABBV", "ACN", "ADBE", "AMD", "AES", "AFL", "A",
  "APD", "ABNB", "AKAM", "ALB", "ARE", "ALGN", "ALLE", "LNT", "ALL", "GOOGL",
  "GOOG", "MO", "AMZN", "AMCR", "AEE", "AEP", "AXP", "AIG", "AMT", "AWK",
  "AMP", "AME", "AMGN", "APH", "ADI", "ANSS", "AON", "APA", "AAPL", "AMAT",
  "APTV", "ACGL", "ADM", "ANET", "AJG", "AIZ", "T", "ATO", "ADSK", "ADP",
  "AZO", "AVB", "AVY", "AXON", "BKR", "BALL", "BAC", "BAX", "BDX", "BRK.B",
  "BBY", "BIO", "TECH", "BIIB", "BLK", "BX", "BK", "BA", "BKNG", "BWA",
  "BSX", "BMY", "AVGO", "BR", "BRO", "BF.B", "BLDR", "BG", "CDNS", "CZR",
  "CPT", "CPB", "COF", "CAH", "KMX", "CCL", "CARR", "CTLT", "CAT", "CBOE",
  "CBRE", "CDW", "CE", "COR", "CNC", "CNP", "CF", "CHRW", "CRL", "SCHW",
  "CHTR", "CVX", "CMG", "CB", "CHD", "CI", "CINF", "CTAS", "CSCO", "C",
  "CFG", "CLX", "CME", "CMS", "KO", "CTSH", "CL", "CMCSA", "CAG", "COP",
  "ED", "STZ", "CEG", "COO", "CPRT", "GLW", "CTVA", "CSGP", "COST", "CTRA",
  "CCI", "CSX", "CMI", "CVS", "DHR", "DRI", "DVA", "DAY", "DECK", "DE",
  "DAL", "DVN", "DXCM", "FANG", "DLR", "DFS", "DG", "DLTR", "D", "DPZ",
  "DOV", "DOW", "DHI", "DTE", "DUK", "DD", "EMN", "ETN", "EBAY", "ECL",
  "EIX", "EW", "EA", "ELV", "EMR", "ENPH", "ETR", "EOG", "EPAM", "EQT",
  "EFX", "EQIX", "EQR", "ESS", "EL", "EG", "EVRG", "ES", "EXC", "EXPE",
  "EXPD", "EXR", "XOM", "FFIV", "FDS", "FICO", "FAST", "FRT", "FDX", "FIS",
  "FITB", "FSLR", "FE", "FI", "FMC", "F", "FTNT", "FTV", "FOXA", "FOX",
  "BEN", "FCX", "GRMN", "IT", "GEHC", "GEN", "GNRC", "GD", "GE", "GIS",
  "GM", "GPC", "GILD", "GPN", "GL", "GDDY", "GS", "HAL", "HIG", "HAS",
  "HCA", "DOC", "HSIC", "HSY", "HES", "HPE", "HLT", "HOLX", "HD", "HON",
  "HRL", "HST", "HWM", "HPQ", "HUBB", "HUM", "HBAN", "HII", "IBM", "IEX",
  "IDXX", "ITW", "ILMN", "INCY", "IR", "PODD", "INTC", "ICE", "IFF", "IP",
  "IPG", "INTU", "ISRG", "IVZ", "INVH", "IQV", "IRM", "JBHT", "JBL", "JKHY",
  "J", "JNJ", "JCI", "JPM", "JNPR", "K", "KVUE", "KDP", "KEY", "KEYS",
  "KMB", "KIM", "KMI", "KLAC", "KHC", "KR", "LHX", "LH", "LRCX", "LW",
  "LVS", "LDOS", "LEN", "LLY", "LIN", "LYV", "LKQ", "LMT", "L", "LOW",
  "LULU", "LYB", "MTB", "MRO", "MPC", "MKTX", "MAR", "MMC", "MLM", "MAS",
  "MA", "MTCH", "MKC", "MCD", "MCK", "MDT", "MRK", "META", "MET", "MTD",
  "MGM", "MCHP", "MU", "MSFT", "MAA", "MRNA", "MHK", "MOH", "TAP", "MDLZ",
  "MPWR", "MNST", "MCO", "MS", "MOS", "MSI", "MSCI", "NDAQ", "NTAP", "NFLX",
  "NEM", "NWSA", "NWS", "NEE", "NKE", "NI", "NDSN", "NSC", "NTRS", "NOC",
  "NCLH", "NRG", "NUE", "NVDA", "NVR", "NXPI", "ORLY", "OXY", "ODFL", "OMC",
  "ON", "OKE", "ORCL", "OTIS", "PCAR", "PKG", "PANW", "PARA", "PH", "PAYX",
  "PAYC", "PYPL", "PNR", "PEP", "PFE", "PCG", "PM", "PSX", "PNW", "PNC",
  "POOL", "PPG", "PPL", "PFG", "PG", "PGR", "PLD", "PRU", "PEG", "PTC",
  "PSA", "PHM", "QRVO", "PWR", "QCOM", "DGX", "RL", "RJF", "RTX", "O",
  "REG", "REGN", "RF", "RSG", "RMD", "RVTY", "ROK", "ROL", "ROP", "ROST",
  "RCL", "SPGI", "CRM", "SBAC", "SLB", "STX", "SRE", "NOW", "SHW", "SPG",
  "SWKS", "SJM", "SNA", "SO", "LUV", "SWK", "SBUX", "STT", "STLD", "STE",
  "SYK", "SMCI", "SYF", "SNPS", "SYY", "TMUS", "TROW", "TTWO", "TPR", "TRGP",
  "TGT", "TEL", "TDY", "TFX", "TER", "TSLA", "TXN", "TXT", "TMO", "TJX",
  "TSCO", "TT", "TDG", "TRV", "TRMB", "TFC", "TYL", "TSN", "USB", "UBER",
  "UDR", "ULTA", "UNP", "UAL", "UPS", "URI", "UNH", "UHS", "VLO", "VTR",
  "VLTO", "VRSN", "VRSK", "VZ", "VRTX", "VTRS", "VICI", "V", "VST", "VMC",
  "WAB", "WBA", "WMT", "DIS", "WBD", "WM", "WAT", "WEC", "WFC", "WELL",
  "WST", "WDC", "WY", "WMB", "WTW", "GWW", "WYNN", "XEL", "XYL", "YUM",
  "ZBRA", "ZBH", "ZTS",
];

/** Ticker sets per heatmap index tab. Russell 2000 has no set (see docblock). */
export const INDEX_MEMBERS: Record<"SP500" | "NDX" | "DOW", Set<string>> = {
  SP500: new Set(SP_500),
  NDX: new Set(NASDAQ_100),
  DOW: new Set(DOW_30),
};

/**
 * Heatmap tab order → membership key. `null` = all synced stocks (no filter);
 * "RUT" = Russell 2000, which we cannot populate (empty intersection).
 */
export type IndexTabKey = keyof typeof INDEX_MEMBERS | "RUT" | null;
export const HEATMAP_TAB_KEYS: IndexTabKey[] = [null, "SP500", "NDX", "DOW", "RUT"];
