import { auth, db, storage, functions } from "../lib/firebase";
import { Capacitor } from "@capacitor/core";

export const REMOTE_APP_URL = import.meta.env.VITE_NVU_NETLIFY_URL || "https://stirring-pavlova-ca6808.netlify.app";

export interface DiagnosticResult {
  platform: string;
  isNativePlatform: boolean;
  remoteAppUrl: string;
  buildManifest?: any;
  manifestError?: string;
  firebase: {
    initialized: boolean;
    auth: string;
    firestore: string;
    storage: string;
    functions: string;
  };
}

export async function runDiagnostics(): Promise<DiagnosticResult> {
  const result: DiagnosticResult = {
    platform: Capacitor.getPlatform(),
    isNativePlatform: Capacitor.isNativePlatform(),
    remoteAppUrl: REMOTE_APP_URL,
    firebase: {
      initialized: false,
      auth: 'uninitialized',
      firestore: 'uninitialized',
      storage: 'uninitialized',
      functions: 'uninitialized',
    }
  };

  try {
    // 1. Fetch Build Manifest
    // In a browser, this fetches from the current domain.
    // In Capacitor, if we want to ensure we are running the remote version,
    // we could fetch from REMOTE_APP_URL. 
    // We fetch from window.location.origin to see the current active build manifest.
    const manifestUrl = `${window.location.origin}/nvu-build.json?t=${Date.now()}`;
    const manifestRes = await fetch(manifestUrl);
    
    if (manifestRes.ok) {
      result.buildManifest = await manifestRes.json();
    } else {
      result.manifestError = `HTTP ${manifestRes.status}: ${manifestRes.statusText}`;
    }
  } catch (error: any) {
    result.manifestError = error.message;
  }

  // 2. Firebase Check
  try {
    if (auth && db && storage && functions) {
      result.firebase.initialized = true;
      result.firebase.auth = auth.app ? 'ready' : 'error';
      result.firebase.firestore = db.app ? 'ready' : 'error';
      result.firebase.storage = storage.app ? 'ready' : 'error';
      result.firebase.functions = functions.app ? 'ready' : 'error';
    }
  } catch (err: any) {
    result.firebase.initialized = false;
  }

  return result;
}
