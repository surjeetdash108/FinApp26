"use client";

/**
 * Backend base URLs — Firebase Hosting CDN routing (2026-07-26).
 *
 * firebase.json rewrites `/live/**` on the Hosting origin to the
 * `market-catalyst-live` Cloud Run service. Requests made SAME-ORIGIN
 * therefore pass through Firebase Hosting's global CDN, which caches each
 * response per the backend's own Cache-Control/s-maxage headers — identical
 * polls from many users collapse to ~1 origin request per interval per edge,
 * for free. (Per-user responses like /live/whoami are `no-store`, so the CDN
 * never caches them.)
 *
 * API_BASE  — cacheable JSON GETs (bars, company, search, collections,
 *             snapshot, market-status, whoami): same-origin on a Hosting
 *             domain (→ CDN), the direct Cloud Run URL everywhere else
 *             (local dev, previews).
 * SSE_BASE  — EventSource streams (tape): ALWAYS the direct Cloud Run URL.
 *             Hosting rewrites buffer responses and time out long streams, so
 *             SSE must bypass the proxy.
 */

export const DIRECT_BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:4100";

const onHostingOrigin =
  typeof window !== "undefined" &&
  /(\.web\.app|\.firebaseapp\.com)$/.test(window.location.hostname);

export const API_BASE = onHostingOrigin ? "" : DIRECT_BACKEND;
export const SSE_BASE = DIRECT_BACKEND;
