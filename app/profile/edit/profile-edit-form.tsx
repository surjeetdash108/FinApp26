"use client";

import { FirebaseError } from "firebase/app";
import { updateProfile } from "firebase/auth";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { firebaseAuth } from "../../firebase";
import { apiPatch } from "../../iq/backend";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { updateProfileData } from "../../store/profile-slice";
import { InvestorProfile, ProfileFields, emptyInvestorProfile } from "../profile-fields";

function getSaveErrorMessage(error: unknown) {
  if (error instanceof FirebaseError) return error.message;
  return "Unable to save profile. Please try again.";
}

export function ProfileEditForm() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { user } = useAppSelector(state => state.auth);
  const { data: savedProfile, status: profileStatus } = useAppSelector(state => state.profile);

  const [profile, setProfile] = useState<InvestorProfile>(emptyInvestorProfile);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (savedProfile) {
      setProfile({
        ...emptyInvestorProfile,
        ...savedProfile,
        email: user?.email ?? savedProfile.email ?? "",
      });
    }
  }, [savedProfile, user]);

  function handleProfileChange(field: keyof InvestorProfile, value: string | string[]) {
    setProfile(current => ({ ...current, [field]: value }));
  }

  async function handleSave() {
    if (!user?.uid) {
      const msg = "Your session is not ready. Please sign in again.";
      setError(msg);
      window.alert(msg);
      return;
    }
    if (profile.preferredAssetClasses.length === 0) {
      const msg = "Select at least one preferred asset class.";
      setError(msg);
      window.alert(msg);
      return;
    }
    setError("");
    setSuccess("");
    setIsSaving(true);
    try {
      if (firebaseAuth.currentUser) {
        await updateProfile(firebaseAuth.currentUser, { displayName: profile.name });
      }
      await apiPatch("/api/profile", profile);
      dispatch(updateProfileData({ ...profile, uid: user.uid, tier: savedProfile?.tier ?? "free" }));
      setSuccess("Profile updated successfully.");
    } catch (saveError) {
      const msg = getSaveErrorMessage(saveError);
      setError(msg);
      window.alert(msg);
    } finally {
      setIsSaving(false);
    }
  }

  if (profileStatus === "loading" || (profileStatus === "idle" && !savedProfile)) {
    return (
      <div className="card">
        <div className="card-b" style={{ color: "var(--text-dim-solid)", fontSize: "0.8125rem" }}>
          Loading profile details…
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Profile header */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-b" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img
            alt={profile.name || "Profile"}
            src={profile.profile_image || "/profile-avatar.svg"}
            style={{
              width: 56, height: 56, borderRadius: "50%",
              objectFit: "cover", border: "2px solid var(--border-strong)", flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-hi)", fontFamily: "var(--f-display)" }}>
              {profile.name || "Investor profile"}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-dim-solid)", marginTop: 2 }}>
              {profile.investmentExperience || "Investment profile"}
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="card">
        <div className="card-h"><h3>Profile details</h3></div>
        <div className="card-b">
          <form onSubmit={e => e.preventDefault()}>
            <ProfileFields emailReadOnly onChange={handleProfileChange} profile={profile} />

            {error && (
              <div style={{
                marginTop: 14, padding: "9px 13px", borderRadius: "var(--r-sm)",
                background: "var(--down-dim)", border: "1px solid var(--down)",
                fontSize: "0.8125rem", color: "var(--down)",
              }}>
                {error}
              </div>
            )}
            {success && (
              <div style={{
                marginTop: 14, padding: "9px 13px", borderRadius: "var(--r-sm)",
                background: "var(--up-dim)", border: "1px solid var(--up)",
                fontSize: "0.8125rem", color: "var(--up)",
              }}>
                {success}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button type="button" className="iq-btn-ghost" onClick={() => router.push("/dashboard")}>
                Cancel
              </button>
              <button type="button" className="iq-btn-primary" disabled={isSaving} onClick={handleSave}>
                {isSaving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
