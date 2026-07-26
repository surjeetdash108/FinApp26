/** Mirrors backend MarketStatusPayload (src/live/market-status.service.ts) — GET /live/market-status. */
export interface MarketStatusPayload {
  market: string;
  earlyHours: boolean;
  afterHours: boolean;
  exchanges: Record<string, string>;
  serverTime: string;
  phase: "open" | "pre" | "after" | "closed";
  label: string;
  upcoming: Array<{
    date: string;
    exchange: string;
    name: string;
    status: string;
    open?: string;
    close?: string;
  }>;
  fetchedAt: string;
}
