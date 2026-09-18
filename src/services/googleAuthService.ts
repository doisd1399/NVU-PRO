import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import {
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  type User,
} from "firebase/auth";
import { auth, authPersistenceReady } from "../lib/firebase";
import {
  createGoogleAuthAttempt,
  type GoogleAuthAttempt,
  type GoogleAuthEnvironment,
} from "./googleAuthState";

const nativePluginName = "FirebaseAuthentication";
const GOOGLE_WEB_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID ||
  "451561168694-9nldqgb2edr91j2flrl0m7305dd6gbj5.apps.googleusercontent.com";
const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
const GOOGLE_IDENTITY_TIMEOUT_MS = 60_000;

function isAndroidWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  const userAgent = String(navigator.userAgent || "");
  if (!/Android/i.test(userAgent)) return false;

  // Capacitor WebViews normally expose `wv`/`Version/4.0` in the UA. A
  // regular Chrome tab does not, so Chrome remains on the browser flow.
  return (
    /(?:;\s*wv\)|\bwv\b)/i.test(userAgent) ||
    // The standard Android WebView UA commonly contains both Version/4.0
    // and Chrome/<version>; Chrome itself does not include Version/4.0.
    (/Version\/4\.0/i.test(userAgent) && /Mobile/i.test(userAgent))
  );
}

function isNativeAndroidRuntime(): boolean {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
    return true;
  }
  if (typeof window !== "undefined") {
    const runtimeWindow = window as Window & {
      androidBridge?: unknown;
      CapacitorCustomPlatform?: { name?: string } | null;
    };
    if (
      runtimeWindow.androidBridge ||
      runtimeWindow.CapacitorCustomPlatform?.name === "android"
    ) {
      return true;
    }
  }
  return isAndroidWebView();
}

function isNativeAppRuntime(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  if (typeof window !== "undefined") {
    const runtimeWindow = window as Window & {
      androidBridge?: unknown;
      CapacitorCustomPlatform?: { name?: string } | null;
    };
    if (
      runtimeWindow.androidBridge ||
      runtimeWindow.CapacitorCustomPlatform?.name === "android"
    ) {
      return true;
    }
  }
  return isAndroidWebView();
}

let activeAttempt: GoogleAuthAttempt | null = null;
let googleScriptPromise: Promise<void> | null = null;
let googlePromptGeneration = 0;
let googleIdentityInitialized = false;
let activeWebCredentialHandler:
  | ((response: GoogleCredentialResponse) => void | Promise<void>)
  | null = null;

export const NATIVE_GOOGLE_PLUGIN_UNAVAILABLE = "NATIVE_GOOGLE_PLUGIN_UNAVAILABLE";
export const GOOGLE_AUTH_ALREADY_IN_PROGRESS = "GOOGLE_AUTH_ALREADY_IN_PROGRESS";
export const GOOGLE_IDENTITY_NOT_DISPLAYED = "GOOGLE_IDENTITY_NOT_DISPLAYED";
export const GOOGLE_IDENTITY_CREDENTIAL_MISSING = "GOOGLE_IDENTITY_CREDENTIAL_MISSING";
export const GOOGLE_AUTH_SESSION_NOT_CONFIRMED = "GOOGLE_AUTH_SESSION_NOT_CONFIRMED";
export const GOOGLE_WEB_POPUP_FALLBACK = "GOOGLE_WEB_POPUP_FALLBACK";

export type GoogleIdentityNotification = {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  getNotDisplayedReason?: () => string;
  getSkippedReason?: () => string;
};

type GoogleCredentialResponse = {
  credential?: string;
  select_by?: string;
};

type GoogleIdentityApi = {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void | Promise<void>;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        context?: "signin" | "signup" | "use";
        use_fedcm_for_button?: boolean;
      }) => void;
      prompt: (listener?: (notification: GoogleIdentityNotification) => void) => void;
      cancel?: () => void;
      disableAutoSelect?: () => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentityApi;
  }
}

export function isNativeGoogleAuthenticationAvailable(): boolean {
  return isNativeAndroidRuntime() && Capacitor.isPluginAvailable(nativePluginName);
}

export function isMobileWebBrowser(): boolean {
  if (typeof window === "undefined" || isNativeAppRuntime()) return false;
  const userAgent = String(window.navigator.userAgent || "");
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ||
    (userAgent.includes("Macintosh") && window.navigator.maxTouchPoints > 1)
  );
}

function errorText(error: unknown): string {
  const value = error as {
    message?: string;
    code?: string;
    name?: string;
    cause?: { message?: string; code?: string; name?: string };
  } | null;
  return `${value?.message || ""} ${value?.code || ""} ${value?.name || ""} ${value?.cause?.message || ""} ${value?.cause?.code || ""} ${value?.cause?.name || ""}`.toLowerCase();
}

function isPluginRegistrationError(error: unknown): boolean {
  const text = errorText(error);
  return (
    text.includes("not implemented") ||
    text.includes("plugin is not implemented") ||
    text.includes("unimplemented") ||
    text.includes("plugin unavailable") ||
    text.includes("plugin is not available") ||
    text.includes("plugin not available")
  );
}

function isNativeGoogleCancellation(error: unknown): boolean {
  const text = errorText(error);
  return (
    text.includes("12501") ||
    text.includes("cancel") ||
    text.includes("canceled") ||
    text.includes("cancelled") ||
    text.includes("user aborted") ||
    text.includes("fechar")
  );
}

function createAttemptId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Use the monotonic fallback below when WebView crypto is unavailable.
  }
  return `google-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function finishAttempt(attempt: GoogleAuthAttempt): void {
  if (activeAttempt !== attempt) return;
  activeAttempt = null;
  activeWebCredentialHandler = null;
}

function beginAttempt(environment: GoogleAuthEnvironment): GoogleAuthAttempt {
  if (activeAttempt) {
    const phase = activeAttempt.state().phase;
    if (phase !== "recoverable-error" && phase !== "cancelled" && phase !== "signed-out") {
      throw new Error(GOOGLE_AUTH_ALREADY_IN_PROGRESS);
    }
  }
  const attempt = createGoogleAuthAttempt(createAttemptId(), environment);
  activeAttempt = attempt;
  attempt.transition("starting");
  console.info("[NVU Google Auth] attempt-created", {
    attemptId: attempt.attemptId,
    environment,
  });
  return attempt;
}

export function getGoogleAuthAttemptState() {
  return activeAttempt?.state() || null;
}

export function resetGoogleAuthAttempt(): void {
  activeAttempt = null;
  activeWebCredentialHandler = null;
  googlePromptGeneration += 1;
  try {
    if (typeof window === "undefined") return;
    window.google?.accounts.id.cancel?.();
  } catch {
    // Older GIS builds may not expose cancel; generation invalidation is enough.
  }
}

function ensureGoogleIdentityServices(): Promise<void> {
  if (typeof window === "undefined" || isNativeAppRuntime()) {
    return Promise.resolve();
  }
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_IDENTITY_SCRIPT}"]`,
    );
    const script = existing || document.createElement("script");
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) {
        googleScriptPromise = null;
        reject(error);
      } else if (window.google?.accounts?.id) {
        resolve();
      } else {
        googleScriptPromise = null;
        reject(new Error("GOOGLE_IDENTITY_SCRIPT_UNAVAILABLE"));
      }
    };

    script.addEventListener("load", () => finish(), { once: true });
    script.addEventListener(
      "error",
      () => finish(new Error("GOOGLE_IDENTITY_SCRIPT_LOAD_FAILED")),
      { once: true },
    );
    if (!existing) {
      script.src = GOOGLE_IDENTITY_SCRIPT;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else if (window.google?.accounts?.id) {
      finish();
    }

    window.setTimeout(() => {
      if (!settled) finish(new Error("GOOGLE_IDENTITY_SCRIPT_TIMEOUT"));
    }, 15_000);
  });

  return googleScriptPromise;
}

function initializeGoogleIdentityOnce(): void {
  if (googleIdentityInitialized) return;
  const identityApi = window.google?.accounts?.id;
  if (!identityApi) throw new Error("GOOGLE_IDENTITY_API_UNAVAILABLE");

  identityApi.initialize({
    client_id: GOOGLE_WEB_CLIENT_ID,
    context: "signin",
    auto_select: false,
    cancel_on_tap_outside: false,
    // This service uses `prompt()`, not the GIS rendered button. Do not opt
    // into the button-specific FedCM mode or reinitialize the singleton per
    // login click.
    use_fedcm_for_button: false,
    callback: (response) => {
      const handler = activeWebCredentialHandler;
      if (!handler) return;
      void Promise.resolve(handler(response)).catch((error) => {
        const attempt = activeAttempt;
        if (!attempt) return;
        attempt.fail();
        finishAttempt(attempt);
        console.warn("[NVU Google Auth] credential callback failed", error);
      });
    },
  });
  googleIdentityInitialized = true;
}

async function authenticateWithGoogleIdToken(
  idToken: string,
  attempt: GoogleAuthAttempt,
): Promise<User> {
  const normalizedToken = idToken.trim();
  if (!normalizedToken) throw new Error(GOOGLE_IDENTITY_CREDENTIAL_MISSING);
  attempt.transition("credential-received");
  await authPersistenceReady;
  attempt.transition("firebase-authenticating");
  const userCredential = await signInWithCredential(
    auth,
    GoogleAuthProvider.credential(normalizedToken),
  );
  await userCredential.user.getIdToken(true);
  await auth.authStateReady();
  if (auth.currentUser?.uid !== userCredential.user.uid) {
    throw new Error(GOOGLE_AUTH_SESSION_NOT_CONFIRMED);
  }
  attempt.transition("auth-confirmed");
  attempt.transition("ready-for-profile-selector");
  finishAttempt(attempt);
  return userCredential.user;
}

async function signInWithWebIdentity(attempt: GoogleAuthAttempt): Promise<User> {
  await ensureGoogleIdentityServices();
  if (!window.google?.accounts?.id) {
    throw new Error("GOOGLE_IDENTITY_API_UNAVAILABLE");
  }
  initializeGoogleIdentityOnce();

  attempt.transition("awaiting-provider");
  const generation = ++googlePromptGeneration;

  return new Promise<User>((resolve, reject) => {
    let settled = false;
    const settleError = (error: unknown) => {
      if (settled || generation !== googlePromptGeneration) return;
      settled = true;
      attempt.fail();
      finishAttempt(attempt);
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const settleSuccess = (user: User) => {
      if (settled || generation !== googlePromptGeneration) return;
      settled = true;
      resolve(user);
    };

    activeWebCredentialHandler = async (response) => {
      if (
        settled ||
        generation !== googlePromptGeneration ||
        activeAttempt !== attempt
      ) {
        return;
      }
      try {
        const user = await authenticateWithGoogleIdToken(
          response.credential || "",
          attempt,
        );
        settleSuccess(user);
      } catch (error) {
        settleError(error);
      }
    };

    window.google!.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
        settleError(
          new Error(
            `${GOOGLE_IDENTITY_NOT_DISPLAYED}:${
              notification.getNotDisplayedReason?.() ||
              notification.getSkippedReason?.() ||
              "unknown"
            }`,
          ),
        );
      }
    });

    window.setTimeout(() => {
      settleError(new Error("GOOGLE_IDENTITY_TIMEOUT"));
    }, GOOGLE_IDENTITY_TIMEOUT_MS);
  });
}

async function signInWithWebPopup(attempt: GoogleAuthAttempt): Promise<User> {
  attempt.transition("awaiting-provider");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  let userCredential: Awaited<ReturnType<typeof signInWithPopup>>;
  try {
    // Firebase opens the provider selector from the user's click gesture. This
    // is the deterministic fallback when GIS One Tap is skipped or unavailable.
    userCredential = await signInWithPopup(auth, provider);
  } catch (error) {
    attempt.fail();
    throw error;
  }
  attempt.transition("credential-received");
  attempt.transition("firebase-authenticating");
  await auth.authStateReady();
  if (auth.currentUser?.uid !== userCredential.user.uid) {
    throw new Error(GOOGLE_AUTH_SESSION_NOT_CONFIRMED);
  }
  attempt.transition("auth-confirmed");
  attempt.transition("ready-for-profile-selector");
  finishAttempt(attempt);
  return userCredential.user;
}

function isGoogleIdentityNotDisplayedError(error: unknown): boolean {
  return errorText(error).includes(GOOGLE_IDENTITY_NOT_DISPLAYED.toLowerCase());
}

async function signInWithNative(attempt: GoogleAuthAttempt): Promise<User> {
  attempt.transition("awaiting-provider");
  if (!Capacitor.isPluginAvailable(nativePluginName)) {
    throw new Error(NATIVE_GOOGLE_PLUGIN_UNAVAILABLE);
  }

  let nativeResult: Awaited<ReturnType<typeof FirebaseAuthentication.signInWithGoogle>>;
  try {
    nativeResult = await FirebaseAuthentication.signInWithGoogle({
      useCredentialManager: true,
    });
  } catch (error) {
    if (isNativeGoogleCancellation(error)) throw error;
    if (isPluginRegistrationError(error)) {
      throw new Error(NATIVE_GOOGLE_PLUGIN_UNAVAILABLE);
    }
    try {
      nativeResult = await FirebaseAuthentication.signInWithGoogle({
        useCredentialManager: false,
      });
    } catch (legacyError) {
      if (isPluginRegistrationError(legacyError)) {
        throw new Error(NATIVE_GOOGLE_PLUGIN_UNAVAILABLE);
      }
      throw legacyError;
    }
  }

  const idToken = nativeResult.credential?.idToken?.trim();
  if (!idToken) throw new Error("NATIVE_GOOGLE_ID_TOKEN_MISSING");
  const normalizedToken = idToken;
  attempt.transition("credential-received");
  await authPersistenceReady;
  attempt.transition("firebase-authenticating");
  const userCredential = await signInWithCredential(
    auth,
    GoogleAuthProvider.credential(normalizedToken),
  );
  // signInWithCredential already establishes the Firebase session. A forced
  // refresh here adds a second network round-trip to the first login; protected
  // requests can refresh the token when they actually need it.
  await auth.authStateReady();
  if (auth.currentUser?.uid !== userCredential.user.uid) {
    throw new Error(GOOGLE_AUTH_SESSION_NOT_CONFIRMED);
  }
  attempt.transition("auth-confirmed");
  attempt.transition("ready-for-profile-selector");
  finishAttempt(attempt);
  return userCredential.user;
}

/**
 * Rehydrates the native Firebase session when the Android app is reopened.
 * It never starts a provider flow: it only projects the already authenticated
 * native session into the Firebase Web SDK used by the remote UI.
 */
export async function restoreNativeGoogleSession(): Promise<User | null> {
  // Firebase Web persistence is the first authority. It must finish opening
  // IndexedDB before authStateReady() is allowed to produce a null snapshot;
  // otherwise Android can mistake a transient hydration state for logout.
  const persistenceReady = await authPersistenceReady;
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;

  if (!isNativeAndroidRuntime() || !Capacitor.isPluginAvailable(nativePluginName)) {
    return null;
  }

  if (!persistenceReady) {
    console.warn("[NVU Auth] Web persistence unavailable; using native session fallback.");
  }

  const nativeSession = await FirebaseAuthentication.getCurrentUser();
  if (!nativeSession.user) return null;

  const { token } = await FirebaseAuthentication.getIdToken({ forceRefresh: false });
  const normalizedToken = token?.trim();
  if (!normalizedToken) throw new Error("NATIVE_GOOGLE_ID_TOKEN_MISSING");

  await authPersistenceReady;
  const userCredential = await signInWithCredential(
    auth,
    GoogleAuthProvider.credential(normalizedToken),
  );
  await auth.authStateReady();
  if (auth.currentUser?.uid !== userCredential.user.uid) {
    throw new Error(GOOGLE_AUTH_SESSION_NOT_CONFIRMED);
  }
  return userCredential.user;
}

/**
 * Single Google-auth boundary. Web uses Google Identity Services callback
 * without a full-page redirect. Capacitor uses the native provider only.
 */
export async function signInWithGoogleAccount(): Promise<User> {
  const environment: GoogleAuthEnvironment = isNativeAndroidRuntime()
    ? "android"
    : isMobileWebBrowser()
      ? "web-mobile"
      : "web-desktop";
  let attempt = beginAttempt(environment);

  try {
    if (environment === "android") {
      return await signInWithNative(attempt);
    }

    try {
      return await signInWithWebIdentity(attempt);
    } catch (error) {
      if (!isGoogleIdentityNotDisplayedError(error)) throw error;
      console.info("[NVU Google Auth] GIS prompt skipped; using Firebase popup fallback", {
        environment,
      });
      // signInWithWebIdentity has already closed its failed attempt. Start a
      // fresh attempt so the state machine remains single-owner and explicit.
      attempt = beginAttempt(environment);
      return await signInWithWebPopup(attempt);
    }
  } catch (error) {
    if (isNativeGoogleCancellation(error)) {
      attempt.cancel();
    } else if (attempt.state().phase !== "recoverable-error") {
      attempt.fail();
    }
    finishAttempt(attempt);
    throw error;
  }
}

/**
 * Preloads the official GIS library while the Login screen is mounted. This
 * keeps the user gesture available for the in-page account prompt and avoids a
 * redirect or a second browser tab.
 */
export function preloadGoogleIdentityServices(): void {
  if (!isNativeAppRuntime()) {
    void ensureGoogleIdentityServices().catch((error) => {
      console.warn("[NVU Google Auth] GIS preload failed", error);
    });
  }
}

export function signOutNativeGoogleIfAvailable(): Promise<void> {
  if (!isNativeGoogleAuthenticationAvailable()) return Promise.resolve();
  return FirebaseAuthentication.signOut();
}
