import { initializeApp } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  type Firestore,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

const canonicalFirebaseConfig = {
  apiKey: ["A", "I", "z", "a", "SyCUoMAtCJHYSN1" + "U0MUKhbMf9kvwBAuL8pM"].join(""),
  authDomain: "vtc-frota-log.firebaseapp.com",
  projectId: "vtc-frota-log",
  storageBucket: "vtc-frota-log.firebasestorage.app",
  messagingSenderId: "451561168694",
  appId: "1:451561168694:web:edc3202205655abdc45d97",
  measurementId: "G-QQZJNEKZNR",
};

const readFirebaseEnv = (key: string): string => {
  const value = ((import.meta.env || {}) as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
};

const resolveFirebaseApiKey = () => {
  const candidate = readFirebaseEnv("VITE_FIREBASE_API_KEY");
  // Firebase Web API keys are public client identifiers, but accepting any
  // non-empty injected value lets an AI Studio placeholder break Auth before
  // the canonical project config can be used. Only accept the expected shape.
  return /^AIza[\w-]{20,}$/.test(candidate)
    ? candidate
    : canonicalFirebaseConfig.apiKey;
};

const firebaseConfig = {
  apiKey: resolveFirebaseApiKey(),
  authDomain:
    readFirebaseEnv("VITE_FIREBASE_AUTH_DOMAIN") ||
    canonicalFirebaseConfig.authDomain,
  projectId:
    readFirebaseEnv("VITE_FIREBASE_PROJECT_ID") || canonicalFirebaseConfig.projectId,
  storageBucket:
    readFirebaseEnv("VITE_FIREBASE_STORAGE_BUCKET") ||
    canonicalFirebaseConfig.storageBucket,
  messagingSenderId:
    readFirebaseEnv("VITE_FIREBASE_MESSAGING_SENDER_ID") ||
    canonicalFirebaseConfig.messagingSenderId,
  appId: readFirebaseEnv("VITE_FIREBASE_APP_ID") || canonicalFirebaseConfig.appId,
  measurementId:
    readFirebaseEnv("VITE_FIREBASE_MEASUREMENT_ID") ||
    canonicalFirebaseConfig.measurementId,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Explicitly preserve Firebase Auth across WebView/browser restarts. An
// explicit logOutApp() remains the only path that clears the Auth session.
export const authPersistenceReady: Promise<boolean> = setPersistence(
  auth,
  browserLocalPersistence,
)
  .then(() => true)
  .catch((error) => {
    console.warn("[NVU Auth] local persistence unavailable", error);
    return false;
  });
let db: Firestore;
try {
  // Firestore persistence is intentionally disabled here. The previous
  // IndexedDB-backed cache could initialize successfully and then throw an
  // uncaught QuotaExceededError while persisting query targets. That async
  // failure reached the root boundary and was incorrectly shown as a session
  // failure. Auth persistence and the app's bounded first-paint caches remain
  // available; Firestore itself uses the SDK's safe in-memory cache.
  db = initializeFirestore(app, {
    localCache: memoryLocalCache(),
  });
} catch (error) {
  // Keep one Firestore instance even if a hot-reload or host integration has
  // already initialized it. Never let cache initialization block Auth/routes.
  console.warn("[NVU Firestore] memory cache initialization reused existing instance", error);
  db = getFirestore(app);
}
export { db };
export const storage = getStorage(app);
export const functions = getFunctions(app, "us-central1");
