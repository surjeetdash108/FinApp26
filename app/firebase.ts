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

const firebaseConfig = {
  apiKey: "AIzaSyDVjZmJ11qzbPIvruwOHiTiMWvjTcUmhuk",
  authDomain: "market-catalyst-502415.firebaseapp.com",
  projectId: "market-catalyst-502415",
  storageBucket: "market-catalyst-502415.firebasestorage.app",
  messagingSenderId: "741318166823",
  appId: "1:741318166823:web:e7bdefb314ecd446494102",
  measurementId: "G-NFPTC0K6Z0",
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
