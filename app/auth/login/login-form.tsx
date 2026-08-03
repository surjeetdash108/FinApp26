"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  getRedirectResult,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
} from "firebase/auth";
import { firebaseAuth, googleAuthProvider } from "../../firebase";
import { postLoginPath } from "../../admin/admin-email";
import {
  checkAndRedirectIfLoggedIn,
  completeGoogleLogin,
  getAuthErrorMessage,
  shouldUseGoogleRedirect,
  showError,
} from "../auth-utils";

/* ---- shared inline style helpers ---- */
const label: React.CSSProperties = {
  display: "block",
  fontSize: ".72rem",
  fontWeight: 600,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "var(--text-dim-solid)",
  marginBottom: 7,
};
const input: React.CSSProperties = {
  width: "100%",
  height: 42,
  background: "var(--surface-0)",
  border: "1px solid var(--border)",
  borderRadius: "var(--r)",
  padding: "0 14px",
  fontSize: ".88rem",
  color: "var(--text-hi)",
  fontFamily: "var(--f-body)",
  outline: "none",
  transition: "border-color .14s, box-shadow .14s",
};
const divider: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12,
  margin: "18px 0",
  fontSize: ".66rem", fontWeight: 700,
  letterSpacing: ".08em", textTransform: "uppercase",
  color: "var(--text-dim-solid)",
};
const divLine: React.CSSProperties = {
  flex: 1, height: 1, background: "var(--border-soft)",
};

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [focused, setFocused] = useState("");

  useEffect(() => {
    let isMounted = true;
    void (async () => {
      try {
        const cred = await getRedirectResult(firebaseAuth);
        if (!isMounted) return;
        if (cred) { setIsSubmitting(true); await completeGoogleLogin(cred); return; }
        await checkAndRedirectIfLoggedIn();
      } catch (err) {
        if (!isMounted) return;
        const msg = getAuthErrorMessage(err);
        setError(msg); showError(msg);
      } finally {
        if (isMounted) setIsSubmitting(false);
      }
    })();
    return () => { isMounted = false; };
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(""); setIsSubmitting(true);
    try {
      await signInWithEmailAndPassword(firebaseAuth, email, password);
      // The admin account lands on the admin console, everyone else on the app.
      window.location.href = postLoginPath(email);
    } catch (err) {
      const msg = getAuthErrorMessage(err);
      setError(msg); showError(msg);
    } finally { setIsSubmitting(false); }
  }

  async function handleGoogle() {
    setError(""); setIsSubmitting(true);

    // On mobile browsers and standalone PWAs, popups are unreliable — Safari
    // dismisses the cross-origin auth popup (yielding auth/popup-closed-by-user)
    // and, added to the home screen, popups don't open at all. Use the redirect
    // flow there; it's completed by getRedirectResult() in the mount effect above.
    if (shouldUseGoogleRedirect()) {
      try {
        await signInWithRedirect(firebaseAuth, googleAuthProvider);
        // Page navigates away — leave isSubmitting set so the button stays disabled.
      } catch (err) {
        const msg = getAuthErrorMessage(err);
        setError(msg); showError(msg);
        setIsSubmitting(false);
      }
      return;
    }

    try {
      // Desktop: signInWithPopup works when called directly from a user gesture.
      const result = await signInWithPopup(firebaseAuth, googleAuthProvider);
      await completeGoogleLogin(result);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        // Popup was blocked (rare on desktop) — fall back to redirect.
        try {
          await signInWithRedirect(firebaseAuth, googleAuthProvider);
        } catch (redirectErr) {
          const msg = getAuthErrorMessage(redirectErr);
          setError(msg); showError(msg);
          setIsSubmitting(false);
        }
      } else if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        // User dismissed the popup — reset quietly, no error alert.
        setIsSubmitting(false);
      } else {
        const msg = getAuthErrorMessage(err);
        setError(msg); showError(msg);
        setIsSubmitting(false);
      }
    }
  }

  const focusStyle = (id: string): React.CSSProperties => ({
    ...input,
    borderColor: focused === id ? "var(--brand)" : "var(--border)",
    boxShadow: focused === id ? "0 0 0 3px var(--brand-dim)" : "none",
  });

  return (
    <div>
      {/* Header */}
      <div style={{
        fontSize: ".64rem", fontWeight: 600, letterSpacing: ".14em",
        textTransform: "uppercase", color: "var(--brand-2)",
        fontFamily: "var(--f-display)", marginBottom: 8,
      }}>Welcome back</div>
      <h1 style={{
        fontFamily: "var(--f-display)", fontSize: "1.55rem",
        fontWeight: 700, color: "var(--text-hi)", letterSpacing: "-.02em", marginBottom: 6,
      }}>Sign in to MarketCatalyst</h1>
      <p style={{ fontSize: ".84rem", color: "var(--text-dim-solid)", marginBottom: 22 }}>
        Access your market intelligence terminal.
      </p>

      {/* Google */}
      <button
        type="button"
        disabled={isSubmitting}
        onClick={handleGoogle}
        style={{
          width: "100%", height: 42, display: "flex", alignItems: "center",
          justifyContent: "center", gap: 10, borderRadius: "var(--r)",
          background: "var(--surface-2)", border: "1px solid var(--border-strong)",
          color: "var(--text-hi)", fontSize: ".84rem", fontWeight: 600,
          cursor: isSubmitting ? "not-allowed" : "pointer", opacity: isSubmitting ? .6 : 1,
          transition: "border-color .13s, background .13s", fontFamily: "var(--f-body)",
        }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--brand)")}
        onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border-strong)")}
      >
        <span style={{
          width: 22, height: 22, borderRadius: "50%",
          background: "var(--surface-3)", display: "grid", placeItems: "center",
          fontSize: ".78rem", fontWeight: 700, color: "var(--brand-2)",
        }}>G</span>
        Continue with Google
      </button>

      <div style={divider}><span style={divLine} />or use email<span style={divLine} /></div>

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={label} htmlFor="email">Email</label>
          <input
            id="email" type="email" required
            placeholder="analyst@company.com"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onFocus={() => setFocused("email")}
            onBlur={() => setFocused("")}
            style={focusStyle("email")}
          />
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
            <span style={label}>Password</span>
            <Link href="/auth/forgot-password" style={{
              fontSize: ".74rem", fontWeight: 600, color: "var(--brand-2)", textDecoration: "none",
            }}>Forgot password?</Link>
          </div>
          <input
            id="password" type="password" required minLength={6}
            placeholder="Enter password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onFocus={() => setFocused("password")}
            onBlur={() => setFocused("")}
            style={focusStyle("password")}
          />
        </div>

        {error && (
          <div style={{
            background: "var(--down-dim)", border: "1px solid var(--down)",
            borderRadius: "var(--r-sm)", padding: "9px 12px",
            fontSize: ".8rem", color: "var(--down)", fontWeight: 600,
          }}>{error}</div>
        )}

        <button
          type="submit" disabled={isSubmitting}
          style={{
            height: 42, width: "100%", borderRadius: "var(--r)",
            background: isSubmitting ? "var(--surface-3)" : "linear-gradient(135deg, var(--brand), #6354d6)",
            border: "none", color: "#fff", fontSize: ".88rem", fontWeight: 600,
            cursor: isSubmitting ? "not-allowed" : "pointer",
            opacity: isSubmitting ? .7 : 1,
            transition: "filter .14s", fontFamily: "var(--f-body)",
          }}
          onMouseEnter={e => { if (!isSubmitting) e.currentTarget.style.filter = "brightness(1.1)"; }}
          onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p style={{ marginTop: 20, textAlign: "center", fontSize: ".8rem", color: "var(--text-dim-solid)" }}>
        New to MarketCatalyst?{" "}
        <Link href="/auth/signup" style={{ color: "var(--brand-2)", fontWeight: 600 }}>
          Create an account
        </Link>
      </p>
    </div>
  );
}
