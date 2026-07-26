"use client";

/**
 * Login / session / presence tracking.
 *
 * On every entry into the authenticated app we record a rich "who / where /
 * how" snapshot and mark the user online; on explicit logout we mark them
 * offline. A per-tab session document keeps the full login history.
 *
 * Firestore shape written here:
 *   users/{uid}                         (fields merged onto the existing doc)
 *     isOnline           boolean        true on login, false on explicit logout
 *     lastLoginAt        timestamp
 *     lastLogoutAt       timestamp
 *     lastSeenAt         timestamp      heartbeat (~90 s while the tab is visible)
 *     loginCount         number         +1 per new browser session
 *     lastIp             string|null    from the first-party /live/whoami endpoint
 *     lastAuthProvider   string         'google' | 'password'
 *     lastUserAgent      string
 *     lastDevice         { browser, os, type }
 *     lastTimezone       string
 *     lastLocale         string
 *
 *   users/{uid}/sessions/{sessionId}    (one doc per browser session — history)
 *     startedAt, endedAt, lastSeenAt, online, ip, provider, email,
 *     userAgent, browser, os, deviceType, timezone, locale, screen, referrer
 *
 * PRESENCE NOTE: Firestore has no server-side disconnect trigger, so a tab that
 * is closed WITHOUT logging out stays `isOnline:true` — treat a user as truly
 * online only when `isOnline && (now - lastSeenAt) < ~3 min`. `lastSeenAt` is
 * refreshed on a heartbeat and on tab-hide for exactly this reason.
 */

import { useEffect, useRef } from "react";
import { doc, updateDoc, setDoc, serverTimestamp, increment } from "firebase/firestore";
import type { User } from "firebase/auth";
import { firebaseAuth, firebaseDb } from "../firebase";

import { API_BASE as BACKEND } from "./backend";
const SESSION_KEY = "mc-session-id";
/**
 * 30 min, not seconds: every heartbeat is 2 Firestore writes, and at 10k users
 * a 90-second pulse alone would cost ~$20/month. At 30 min an active user
 * costs ~2-4 writes/day (~$0.15/month across 10k users). Presence staleness
 * threshold is therefore ~35 min: online = isOnline && lastSeenAt < 35 min ago.
 */
const HEARTBEAT_MS = 30 * 60_000;

// ---- client-side signals ------------------------------------------------

function parseUA(ua: string): { browser: string; os: string; type: string } {
  const s = ua.toLowerCase();
  let browser = "Unknown";
  if (s.includes("edg/")) browser = "Edge";
  else if (s.includes("opr/") || s.includes(" opera")) browser = "Opera";
  else if (s.includes("chrome")) browser = "Chrome";
  else if (s.includes("firefox")) browser = "Firefox";
  else if (s.includes("safari")) browser = "Safari";

  let os = "Unknown";
  if (s.includes("windows")) os = "Windows";
  else if (/iphone|ipad|ipod/.test(s)) os = "iOS";
  else if (s.includes("mac os")) os = "macOS";
  else if (s.includes("android")) os = "Android";
  else if (s.includes("linux")) os = "Linux";

  const type = /iphone|ipod|android.*mobile|windows phone/.test(s) ? "mobile"
    : /ipad|tablet|android/.test(s) ? "tablet"
    : "desktop";
  return { browser, os, type };
}

function providerOf(user: User): string {
  const p = user.providerData[0]?.providerId ?? "";
  if (p.includes("google")) return "google";
  if (p === "password") return "password";
  return p || "unknown";
}

function clientMeta() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const { browser, os, type } = parseUA(ua);
  let timezone = "";
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* ignore */ }
  return {
    userAgent: ua,
    browser, os, deviceType: type,
    timezone,
    locale: typeof navigator !== "undefined" ? navigator.language : "",
    screen: typeof window !== "undefined" ? `${window.screen.width}x${window.screen.height}` : "",
    referrer: typeof document !== "undefined" ? document.referrer : "",
  };
}

/** First-party IP echo (no third party). Null when the backend is unreachable. */
async function fetchIp(): Promise<string | null> {
  if (!BACKEND) return null;
  try {
    const res = await fetch(`${BACKEND}/live/whoami`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { ip?: unknown };
    return typeof body?.ip === "string" ? body.ip : null;
  } catch {
    return null;
  }
}

/** A stable id for THIS browser session (per tab). New tab ⇒ new session. */
function sessionInfo(): { sessionId: string; isNew: boolean } {
  if (typeof window === "undefined") return { sessionId: "ssr", isNew: false };
  const existing = sessionStorage.getItem(SESSION_KEY);
  if (existing) return { sessionId: existing, isNew: false };
  const id = (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`);
  sessionStorage.setItem(SESSION_KEY, id);
  return { sessionId: id, isNew: true };
}

export function currentSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(SESSION_KEY);
}

// ---- writes -------------------------------------------------------------

/** Mark the user online and record the login snapshot. Returns the session id. */
export async function recordLogin(user: User): Promise<string> {
  const { sessionId, isNew } = sessionInfo();
  const meta = clientMeta();
  const provider = providerOf(user);
  const ip = await fetchIp();

  // Presence + last-login summary on the user doc. updateDoc (not setDoc) so we
  // never accidentally CREATE a malformed user doc — the doc already exists by
  // the time the app shell mounts (created at signup / first Google login).
  updateDoc(doc(firebaseDb, "users", user.uid), {
    isOnline: true,
    lastLoginAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
    ...(isNew ? { loginCount: increment(1) } : {}),
    lastIp: ip,
    lastAuthProvider: provider,
    lastUserAgent: meta.userAgent,
    lastDevice: { browser: meta.browser, os: meta.os, type: meta.deviceType },
    lastTimezone: meta.timezone,
    lastLocale: meta.locale,
  }).catch((e) => console.warn("presence: user update failed", e?.code ?? e));

  // Per-session history doc.
  const sessRef = doc(firebaseDb, "users", user.uid, "sessions", sessionId);
  if (isNew) {
    setDoc(sessRef, {
      startedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      endedAt: null,
      online: true,
      ip,
      provider,
      email: user.email ?? null,
      ...meta,
    }).catch((e) => console.warn("presence: session create failed", e?.code ?? e));
  } else {
    setDoc(sessRef, { lastSeenAt: serverTimestamp(), online: true }, { merge: true }).catch(() => {});
  }
  return sessionId;
}

/** Refresh lastSeenAt so real presence can be inferred from freshness. */
export async function heartbeat(uid: string, sessionId: string): Promise<void> {
  const t = serverTimestamp();
  await Promise.allSettled([
    updateDoc(doc(firebaseDb, "users", uid), { lastSeenAt: t, isOnline: true }),
    setDoc(doc(firebaseDb, "users", uid, "sessions", sessionId), { lastSeenAt: t }, { merge: true }),
  ]);
}

/** Explicit logout: mark offline and close the session. Call BEFORE signOut(). */
export async function recordLogout(uid: string): Promise<void> {
  const sessionId = currentSessionId();
  const t = serverTimestamp();
  const jobs: Promise<unknown>[] = [
    updateDoc(doc(firebaseDb, "users", uid), { isOnline: false, lastLogoutAt: t, lastSeenAt: t }),
  ];
  if (sessionId) {
    jobs.push(setDoc(doc(firebaseDb, "users", uid, "sessions", sessionId), { online: false, endedAt: t, lastSeenAt: t }, { merge: true }));
  }
  await Promise.allSettled(jobs);
  if (typeof window !== "undefined") sessionStorage.removeItem(SESSION_KEY);
}

// ---- hook (mount once inside the authenticated shell) -------------------

/**
 * Records login + presence for the current user and heartbeats while the tab is
 * visible. Mount ONCE in the authenticated shell. Logout is recorded separately
 * (call `recordLogout(uid)` right before `signOut()`), because after sign-out
 * the client can no longer write to its own user doc.
 */
export function usePresence(): void {
  const sessionIdRef = useRef<string | null>(null);
  const lastBeatRef = useRef(0);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    const beat = () => {
      const u = firebaseAuth.currentUser;
      if (!u || !sessionIdRef.current) return;
      lastBeatRef.current = Date.now();
      void heartbeat(u.uid, sessionIdRef.current);
    };

    const unsub = firebaseAuth.onAuthStateChanged(async (user) => {
      stop();
      if (!user) { sessionIdRef.current = null; return; }
      sessionIdRef.current = await recordLogin(user);
      lastBeatRef.current = Date.now();
      timer = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
        beat();
      }, HEARTBEAT_MS);
    });

    // Refresh lastSeenAt on tab-hide (best-effort; does NOT flip offline — that
    // would flap when merely switching tabs). Write-gated to 5 min so rapid tab
    // switching costs nothing.
    const onHide = () => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") return;
      if (Date.now() - lastBeatRef.current < 5 * 60_000) return;
      beat();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onHide);

    return () => {
      stop();
      unsub();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onHide);
    };
  }, []);
}
