import { getDocFromServer, doc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, auth, functions } from "../lib/firebase";
import { normalizeWorkModeAvailability, isWorkModeAllowed, type WorkModeAvailability, type WorkMode } from "../lib/workModeAvailability";
import { isConnectivityError, isDefinitelyOffline } from "../lib/connectivity";
export * from "../lib/workModeAvailability";
// Open the chooser while this server request is in flight. A very short reuse
// window removes the redundant round trip on a prompt selection; older data
// must always be checked again before entering a mode.
let pendingAvailability: Promise<WorkModeAvailability> | null = null;
let recentAvailability: { value: WorkModeAvailability; at: number } | null = null;
const OFFLINE_AVAILABILITY_KEY = "nvu.work-mode-availability.v1";

const readCachedAvailability = (): WorkModeAvailability | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(OFFLINE_AVAILABILITY_KEY);
    return raw ? normalizeWorkModeAvailability(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

const persistAvailability = (value: WorkModeAvailability) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OFFLINE_AVAILABILITY_KEY, JSON.stringify(value));
  } catch {
    // Best effort: availability remains in the short-lived in-memory cache.
  }
};

const offlineAvailability = () => {
  const cached = readCachedAvailability();
  if (cached) return cached;
  // A first-ever offline launch has no server maintenance snapshot. Keep the
  // operational flow usable and replace this permissive default on next sync.
  return normalizeWorkModeAvailability(undefined);
};

/** UI/offline preflight only. The server still checks maintenance on replay. */
export function assertCachedNewOperationAllowed(simulator: unknown) {
  const value = recentAvailability?.value || offlineAvailability();
  if (!( ["print", "pro", "max"] as WorkMode[]).some(mode => isWorkModeAllowed(value, mode, simulator)))
    throw new Error("Sistema em manutenção: novas operações estão pausadas para este simulador.");
}

/** Capture already has a server-side maintenance check on replay. No network on Save. */
export function assertCachedWorkModeEntryAllowed(mode: WorkMode, simulator: unknown) {
  const value = recentAvailability?.value || offlineAvailability();
  if (!isWorkModeAllowed(value, mode, simulator))
    throw new Error(`Sistema em manutenção: novas entradas no modo ${mode.toUpperCase()} estão pausadas para este simulador.`);
  prefetchWorkModeAvailability();
}

let lastServerAttempt = 0;
function refreshAvailability(): Promise<WorkModeAvailability> {
  if (pendingAvailability) return pendingAvailability;
  lastServerAttempt = Date.now();
  const request = getDocFromServer(doc(db, "settings", "system"))
    .then(snapshot => {
      const value = normalizeWorkModeAvailability(snapshot.data()?.workModeAvailability);
      recentAvailability = { value, at: Date.now() };
      persistAvailability(value);
      return value;
    })
    .finally(() => { pendingAvailability = null; });
  pendingAvailability = request;
  return request;
}

export async function getWorkModeAvailability(): Promise<WorkModeAvailability> {
  const cached = recentAvailability?.value || readCachedAvailability();
  if (isDefinitelyOffline()) return cached || offlineAvailability();
  if (cached) {
    if (Date.now() - lastServerAttempt >= 15_000) void refreshAvailability().catch(() => undefined);
    return cached;
  }
  // First use has no snapshot. Bound the visual preflight; canonical writes
  // remain server-validated even when a captive portal reports itself online.
  const request = refreshAvailability().catch(error => {
    if (!isConnectivityError(error)) throw error;
    return offlineAvailability();
  });
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([request, new Promise<WorkModeAvailability>(resolve => {
    timer = setTimeout(() => {
      const value = offlineAvailability();
      recentAvailability = { value, at: Date.now() };
      resolve(value);
    }, 1500);
  })]); } finally { clearTimeout(timer!); }
}

export function prefetchWorkModeAvailability(): void {
  void getWorkModeAvailability().catch(() => undefined);
}

export async function updateWorkModeAvailability(availability: WorkModeAvailability, expectedVersion: number) {
  const user = auth.currentUser;
  if (!user || (await user.getIdTokenResult()).claims.senior !== true) {
    throw new Error("Autentique o acesso sênior para alterar o controle de envio.");
  }

  const callable = httpsCallable<
    { expectedVersion: number; availability: WorkModeAvailability },
    { success: true; version: number; actionId: string }
  >(functions, "updateWorkModeAvailability");
  const response = await callable({
    expectedVersion,
    availability: normalizeWorkModeAvailability(availability),
  });
  if (response.data?.success !== true) {
    throw new Error("O servidor não confirmou a atualização do controle de envio.");
  }

  const cached = normalizeWorkModeAvailability(availability);
  cached.version = response.data.version;
  persistAvailability(cached);
  recentAvailability = { value: cached, at: Date.now() };
  return response.data;
}

// Offline entry uses the last server-confirmed maintenance snapshot. If the app has
// never synchronized this setting, the default is permissive until connectivity returns.
export async function assertNewOperationAllowed(simulator: unknown) {
  const value = await getWorkModeAvailability();
  if (!( ["print", "pro", "max"] as WorkMode[]).some(mode => isWorkModeAllowed(value, mode, simulator))) {
    throw new Error("Sistema em manutenção: novas operações estão pausadas para este simulador. Operações já iniciadas podem continuar.");
  }
}

/** Legacy replay has no server callable preflight. Keep its fresh maintenance
 * read off the UI path, and never substitute an offline/default value here. */
export async function assertServerNewOperationAllowed(simulator: unknown) {
  const value = await refreshAvailability();
  if (!( ["print", "pro", "max"] as WorkMode[]).some(mode => isWorkModeAllowed(value, mode, simulator)))
    throw new Error("Sistema em manutenção: novas operações estão pausadas para este simulador.");
}

export async function assertWorkModeEntryAllowed(mode: WorkMode, simulator: unknown) {
  const value = await getWorkModeAvailability();
  if (!isWorkModeAllowed(value, mode, simulator)) {
    throw new Error(`Sistema em manutenção: novas entradas no modo ${mode.toUpperCase()} estão pausadas para este simulador.`);
  }
}
