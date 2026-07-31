import { firebaseAuth } from "../firebase";

/**
 * Base URL for the MarketCatalystBackEnd REST/SSE surface, resolved at RUNTIME
 * so a single static build works in every environment without a rebuild:
 *
 *   - Local dev (localhost / 127.0.0.1) -> http://localhost:4400 (local backend)
 *   - Firebase Hosting (deployed)        -> same-origin, i.e. the Firebase base
 *     URL. firebase.json rewrites /api, /market-data and /live to the backend
 *     Cloud Run service, so there is no CORS and responses are CDN-cacheable.
 *
 * NEXT_PUBLIC_BACKEND_URL is honoured only as an explicit REMOTE override (e.g.
 * pointing a local UI at a deployed backend). A localhost value is ignored once
 * the page itself is served from a real host, so a dev env baked into a
 * production build can never misroute deployed traffic back to localhost.
 */
function resolveBackendBaseUrl(): string {
  const override = process.env.NEXT_PUBLIC_BACKEND_URL?.trim().replace(/\/$/, "");
  const isRemoteOverride = !!override && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(override);

  // SSR / static-generation has no window; no client API calls happen there.
  if (typeof window === "undefined") return override || "http://localhost:4400";

  if (isRemoteOverride) return override as string;

  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "http://localhost:4400";

  // Deployed on Firebase Hosting -> talk to our own origin (proxied to backend).
  return window.location.origin;
}

const BASE_URL = resolveBackendBaseUrl();

export class BackendApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BackendApiError";
  }
}

/** Attaches the current Firebase ID token, if any. Anonymous/public GETs get no header at all. */
async function authHeaders(): Promise<Record<string, string>> {
  const user = firebaseAuth.currentUser;
  if (!user) return {};
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

/** Requests abort after this long so a stalled mobile connection can't hang forever. */
const REQUEST_TIMEOUT_MS = 20_000;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = { ...(await authHeaders()), ...(init.headers ?? {}) };
  // Without this a stalled connection (common on flaky mobile networks) leaves
  // the fetch pending indefinitely. Callers that await it — e.g. the auth
  // listener's profile fetch — would then never settle.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new BackendApiError(res.status, body || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

/** Absolute backend URL for a path — for EventSource/WebSocket construction, which can't go through fetch. */
export function backendUrl(path: string): string {
  return `${BASE_URL}${path}`;
}
