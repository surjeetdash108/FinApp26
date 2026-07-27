import { getApp, getApps, initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
} from "firebase/auth";

// Env-driven so each branch/environment authenticates against its OWN Firebase
// project (its own Auth users, its own Firestore). Previously this object was
// hardcoded to the prod project unconditionally, so a staging build still
// signed users into market-catalyst-502415 — the stage site had no Firebase
// project of its own from the browser's point of view, no matter which
// backend or domain it was deployed under.
//
// Falls back to the prod project's values so any branch/build that hasn't set
// these NEXT_PUBLIC_FIREBASE_* vars behaves exactly as before (zero regression
// risk) — but every environment should set its own via .env.production, the
// same per-branch pattern already used for NEXT_PUBLIC_BACKEND_URL.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyDVjZmJ11qzbPIvruwOHiTiMWvjTcUmhuk",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "market-catalyst-502415.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "market-catalyst-502415",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "market-catalyst-502415.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "741318166823",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:741318166823:web:e7bdefb314ecd446494102",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "G-NFPTC0K6Z0",
};

export const firebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

// Use initializeAuth with IndexedDB persistence so Safari ITP (which blocks
// cross-origin cookies) cannot clear the auth state between navigations.
// Falls back to getAuth if the instance was already created (e.g. hot reload).
function createAuth() {
  try {
    return initializeAuth(firebaseApp, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    return getAuth(firebaseApp);
  }
}

export const firebaseAuth = createAuth();
export const googleAuthProvider = new GoogleAuthProvider();

export async function getFirebaseAnalytics() {
  if (typeof window === "undefined") {
    return null;
  }

  const supported = await isSupported();

  if (!supported) {
    return null;
  }

  return getAnalytics(firebaseApp);
}
