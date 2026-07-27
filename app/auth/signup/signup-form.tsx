"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  updateProfile,
} from "firebase/auth";
import { firebaseAuth, googleAuthProvider } from "../../firebase";
import { apiPatch } from "../../iq/backend";
import {
  InvestorProfile,
  ProfileFields,
  emptyInvestorProfile,
} from "../../profile/profile-fields";
import {
  completeGoogleLogin,
  getAuthErrorMessage,
  navigateAfterAuth,
  shouldUseGoogleRedirect,
  showError,
} from "../auth-utils";

const divider: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12,
  margin: "18px 0",
  fontSize: ".66rem", fontWeight: 700,
  letterSpacing: ".08em", textTransform: "uppercase",
  color: "var(--text-dim-solid)",
};
const divLine: React.CSSProperties = { flex: 1, height: 1, background: "var(--border-soft)" };
const label: React.CSSProperties = {
  display: "block", fontSize: ".72rem", fontWeight: 600,
  letterSpacing: ".06em", textTransform: "uppercase",
  color: "var(--text-dim-solid)", marginBottom: 7,
};

export function SignupForm() {
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState<InvestorProfile>(emptyInvestorProfile);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [focused, setFocused] = useState("");

  // Pick up any pending redirect result (fallback for when popup was blocked
  // and signInWithRedirect was used instead).
  useEffect(() => {
    let isMounted = true;
    void (async () => {
      try {
        const cred = await getRedirectResult(firebaseAuth);
        if (!isMounted || !cred) return;
        setIsSubmitting(true);
        await completeGoogleLogin(cred);
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

  function handleProfileChange(field: keyof InvestorProfile, value: string | string[]) {
    setProfile(cur => ({ ...cur, [field]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(""); setIsSubmitting(true);
    try {
      if (profile.preferredAssetClasses.length === 0) {
        const msg = "Select at least one preferred asset class.";
        setError(msg); showError(msg); return;
      }
      const cred = await createUserWithEmailAndPassword(firebaseAuth, profile.email, password);
      await updateProfile(cred.user, { displayName: profile.name });
      await apiPatch("/api/profile", {
        ...profile,
        email: cred.user.email ?? profile.email,
        tier: "free",
      });
      // Same persisted-session wait as the login path — a bare
      // window.location.href races the IndexedDB write on mobile. Signup already
      // awaits the setDoc above, but routing through the same helper keeps the
      // two post-auth paths consistent and the button disabled until navigation.
      await navigateAfterAuth("/dashboard");
    } catch (err) {
      const msg = getAuthErrorMessage(err);
      setError(msg); showError(msg);
      setIsSubmitting(false);
    }
  }

  async function handleGoogle() {
    setError(""); setIsSubmitting(true);

    // Mobile browsers / standalone PWAs: popups are dismissed by Safari ITP
    // (auth/popup-closed-by-user) or blocked entirely — use the redirect flow,
    // completed by getRedirectResult() in the mount effect above.
    if (shouldUseGoogleRedirect()) {
      try {
        await signInWithRedirect(firebaseAuth, googleAuthProvider);
      } catch (err) {
        const msg = getAuthErrorMessage(err);
        setError(msg); showError(msg);
        setIsSubmitting(false);
      }
      return;
    }

    try {
      const result = await signInWithPopup(firebaseAuth, googleAuthProvider);
      await completeGoogleLogin(result);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        try {
          await signInWithRedirect(firebaseAuth, googleAuthProvider);
        } catch (redirectErr) {
          const msg = getAuthErrorMessage(redirectErr);
          setError(msg); showError(msg);
          setIsSubmitting(false);
        }
      } else if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        setIsSubmitting(false);
      } else {
        const msg = getAuthErrorMessage(err);
        setError(msg); showError(msg);
        setIsSubmitting(false);
      }
    }
  }

  const pwStyle: React.CSSProperties = {
    width: "100%", height: 42,
    background: "var(--surface-0)",
    border: `1px solid ${focused === "pw" ? "var(--brand)" : "var(--border)"}`,
    boxShadow: focused === "pw" ? "0 0 0 3px var(--brand-dim)" : "none",
    borderRadius: "var(--r)", padding: "0 14px",
    fontSize: ".88rem", color: "var(--text-hi)",
    fontFamily: "var(--f-body)", outline: "none", transition: "border-color .14s",
  };

  return (
    <div>
      {/* Header */}
      <div style={{
        fontSize: ".64rem", fontWeight: 600, letterSpacing: ".14em",
        textTransform: "uppercase", color: "var(--brand-2)",
        fontFamily: "var(--f-display)", marginBottom: 8,
      }}>Create account</div>
      <h1 style={{
        fontFamily: "var(--f-display)", fontSize: "1.55rem",
        fontWeight: 700, color: "var(--text-hi)", letterSpacing: "-.02em", marginBottom: 6,
      }}>Join MarketCatalyst</h1>
      <p style={{ fontSize: ".84rem", color: "var(--text-dim-solid)", marginBottom: 22 }}>
        Set up your market intelligence workspace in seconds.
      </p>

      {/* Google */}
      <button
        type="button" disabled={isSubmitting} onClick={handleGoogle}
        style={{
          width: "100%", height: 42, display: "flex", alignItems: "center",
          justifyContent: "center", gap: 10, borderRadius: "var(--r)",
          background: "var(--surface-2)", border: "1px solid var(--border-strong)",
          color: "var(--text-hi)", fontSize: ".84rem", fontWeight: 600,
          cursor: isSubmitting ? "not-allowed" : "pointer", opacity: isSubmitting ? .6 : 1,
          fontFamily: "var(--f-body)", transition: "border-color .13s",
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

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <ProfileFields profile={profile} onChange={handleProfileChange} />

        <div>
          <label style={label} htmlFor="password">Password</label>
          <input
            id="password" type="password" required minLength={6}
            placeholder="Create a password"
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onFocus={() => setFocused("pw")}
            onBlur={() => setFocused("")}
            style={pwStyle}
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
            opacity: isSubmitting ? .7 : 1, fontFamily: "var(--f-body)",
          }}
          onMouseEnter={e => { if (!isSubmitting) e.currentTarget.style.filter = "brightness(1.1)"; }}
          onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
        >
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p style={{ marginTop: 20, textAlign: "center", fontSize: ".8rem", color: "var(--text-dim-solid)" }}>
        Already have access?{" "}
        <Link href="/" style={{ color: "var(--brand-2)", fontWeight: 600 }}>
          Sign in
        </Link>
      </p>
    </div>
  );
}
