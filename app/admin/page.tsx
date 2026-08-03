"use client";

import { useEffect, useRef, useState } from "react";
import { signOut, updatePassword } from "firebase/auth";
import { firebaseAuth } from "../firebase";
import { apiPatch } from "../iq/backend";
import { buildAdminDataset, ADMIN_DATA_KEY, ADMIN_EMAIL } from "./admin-data";

/**
 * Admin console gate. The console itself is the exact static HTML at
 * /admin/console.html (design + static data preserved verbatim), embedded in an
 * iframe. This page owns the Firebase session: it lets ONLY the admin account
 * through, feeds the admin identity into the iframe, and services the iframe's
 * logout / change-password requests (postMessage bridge).
 *
 * The admin is a single fixed account (email never changes; password can).
 */

export default function AdminPage() {
  const [state, setState] = useState<"checking" | "denied" | "ok">("checking");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const emailRef = useRef<string>("");
  const [dataError, setDataError] = useState<string | null>(null);

  // Gate: resolve the session, allow only the admin email.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // MUST await authStateReady(): onAuthStateChanged fires an initial `null`
      // while Firebase restores the session from IndexedDB. Judging that first
      // emission bounced the admin straight back out before the session loaded.
      await firebaseAuth.authStateReady();
      if (cancelled) return;
      const user = firebaseAuth.currentUser;
      const email = user?.email?.toLowerCase() ?? "";
      emailRef.current = email;
      if (email === ADMIN_EMAIL) {
        // Stage real Firestore data BEFORE mounting the iframe. The console
        // renders once at module scope, so anything delivered after its load
        // would be ignored — see the hand-off comment in console.html.
        //
        // Reads happen here, as the signed-in admin, so Firestore rules apply:
        // isAdmin() is what permits the cross-user `users` read.
        try {
          const dataset = await buildAdminDataset();
          sessionStorage.setItem(ADMIN_DATA_KEY, JSON.stringify(dataset));
        } catch (err) {
          // Leave the key unset so the console falls back to its demo data and
          // shows its own "sample data" banner, rather than rendering an empty
          // console that looks like a real business with no customers.
          sessionStorage.removeItem(ADMIN_DATA_KEY);
          setDataError((err as Error).message);
        }
        if (cancelled) return;
        setState("ok");
      } else {
        setState("denied");
        // Non-admins (or signed-out) never see the console.
        window.location.replace(user ? "/dashboard" : "/auth/login");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Bridge: handle logout / password-change coming from the iframe.
  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      const d = e.data || {};
      if (d.type === "admin:logout") {
        await signOut(firebaseAuth);
        window.location.replace("/auth/login");
      }
      if (d.type === "admin:setPlanFlag") {
        // The console iframe has no Firebase SDK, so it delegates the write
        // here, where the admin session lives and Firestore rules authorise it.
        const reply = (m: Record<string, unknown>) =>
          iframeRef.current?.contentWindow?.postMessage(
            { type: "admin:setPlanFlagResult", planId: d.planId, key: d.key, value: d.value, ...m },
            "*",
          );
        try {
          const planId = String(d.planId);
          const key = String(d.key);
          const value = d.value === true;
          if (!planId || !key) throw new Error("missing planId or key");
          // New architecture: the browser does not write Firestore. The backend
          // owns the write — PATCH /admin/plans/:id (AdminGuard) sets only this
          // one entitlement (dotted path server-side), so a whole-map set can't
          // clobber a concurrent edit to a different flag.
          await apiPatch(`/admin/plans/${encodeURIComponent(planId)}`, {
            featureFlags: { [key]: value },
          });
          reply({ ok: true });
        } catch (err) {
          reply({ ok: false, error: (err as Error).message });
        }
      }
      if (d.type === "admin:changePassword") {
        const post = (m: Record<string, unknown>) =>
          iframeRef.current?.contentWindow?.postMessage({ type: "admin:passwordResult", ...m }, "*");
        try {
          if (!firebaseAuth.currentUser) throw new Error("Session expired — sign in again.");
          await updatePassword(firebaseAuth.currentUser, String(d.password));
          post({ ok: true });
        } catch (err) {
          // Firebase requires a RECENT login for password changes.
          const msg = (err as { code?: string; message?: string }).code === "auth/requires-recent-login"
            ? "Please log out and back in, then change the password."
            : (err as Error).message || "Update failed.";
          post({ ok: false, error: msg });
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  if (state !== "ok") {
    return (
      <div style={{ height: "100vh", display: "grid", placeItems: "center", background: "#090d16", color: "#8b97af", fontFamily: "system-ui" }}>
        {state === "checking" ? "Checking admin access…" : "Redirecting…"}
      </div>
    );
  }

  return (
    <>
    {dataError && (
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 10000,
        padding: "7px 14px", background: "rgba(255,93,122,.16)", color: "#ff5d7a",
        borderBottom: "1px solid rgba(255,93,122,.4)",
        font: "600 12px/1.4 system-ui, sans-serif", textAlign: "center",
      }}>
        ⚠ Could not load live admin data — showing sample data. {dataError}
      </div>
    )}
    <iframe
      ref={iframeRef}
      src="/admin/console.html"
      title="MarketCatalyst Admin"
      onLoad={() =>
        iframeRef.current?.contentWindow?.postMessage(
          { type: "admin:identity", email: emailRef.current },
          "*",
        )
      }
      style={{ border: "none", width: "100vw", height: "100vh", display: "block" }}
    />
    </>
  );
}
