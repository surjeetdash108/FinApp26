"use client";

import { onAuthStateChanged } from "firebase/auth";
import { useEffect } from "react";
import { firebaseAuth } from "../firebase";
import { apiGet } from "../iq/backend";
import { setAuthReady, setUser } from "./auth-slice";
import { useAppDispatch } from "./hooks";
import { setProfile, setProfileLoading, StoredProfile } from "./profile-slice";

export function FirebaseListener() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    // Wait for Firebase to restore the persisted session from IndexedDB before
    // subscribing, so the first onAuthStateChanged call reflects the real state.
    void firebaseAuth.authStateReady().then(() => {
      if (cancelled) return;

      unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (cancelled) return;

        if (user) {
          dispatch(
            setUser({
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL,
            }),
          );

          // Auth is ready the moment we know who the user is — mark it BEFORE
          // fetching the profile. Previously setAuthReady() ran only after
          // `await apiGet("/api/profile")`, so on a slow/flaky mobile network a
          // hung profile fetch (or the token refresh inside it) left status
          // stuck on "loading" and the dashboard stuck on its spinner — i.e.
          // login succeeded but the app never "went inside". The profile now
          // loads in the background and does not gate entry.
          if (!cancelled) dispatch(setAuthReady());

          dispatch(setProfileLoading());
          try {
            const raw = await apiGet<Record<string, unknown> | null>("/api/profile");
            if (!cancelled) dispatch(setProfile(raw ? (raw as StoredProfile) : null));
          } catch {
            if (!cancelled) dispatch(setProfile(null));
          }
        } else {
          dispatch(setUser(null));
          dispatch(setProfile(null));
          if (!cancelled) dispatch(setAuthReady());
        }
      });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [dispatch]);

  return null;
}
