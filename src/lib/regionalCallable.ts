import {
  getFunctions,
  httpsCallable as sdkHttpsCallable,
  type Functions,
  type HttpsCallable,
  type HttpsCallableOptions,
  type HttpsCallableResult,
} from "firebase/functions";
import { CALLABLE_FALLBACK_REGION, CALLABLE_PRIMARY_REGION, isDualRegionCallable } from "./callableRegions";

/**
 * Drop-in replacement for `httpsCallable` that talks to the São Paulo copy of a callable first.
 *
 * Why: Firestore is in `southamerica-east1`. A callable in `us-central1` pays ~150 ms for each of the ~8–10
 * sequential Firestore round trips of an operational command, plus a slower handshake/preflight from the phone.
 *
 * Safety rules:
 *  - Only names in DUAL_REGION_CALLABLES are routed; everything else behaves exactly like the SDK.
 *  - The emulator and any non-default region are never rerouted.
 *  - The fallback to `us-central1` happens ONLY when the São Paulo copy is evidently absent:
 *      • HTTP 404 without a JSON error body (Google front end: "function does not exist") — nothing ran; or
 *      • a network-level failure (status 0, e.g. the CORS preflight of a missing function) BEFORE this session ever got
 *        one answer from São Paulo for that function. Once São Paulo answered, later network failures are plain network
 *        failures and are surfaced as such (the durable outbox retries them with the same request id).
 *    A real server error (permission-denied, failed-precondition, internal 500, ...) is never retried in another region.
 *  - After a fallback, that function skips São Paulo for 10 minutes to avoid paying a failed attempt on every call.
 */
const UNAVAILABLE_MS = 10 * 60_000;

const spInstances = new WeakMap<Functions, Functions>();
const confirmedNearby = new Set<string>();
const unavailableUntil = new Map<string, number>();

export function resetRegionalCallableState(): void {
  confirmedNearby.clear();
  unavailableUntil.clear();
}

const nearbyInstance = (primary: Functions): Functions => {
  let found = spInstances.get(primary);
  if (!found) {
    found = getFunctions(primary.app, CALLABLE_PRIMARY_REGION);
    spInstances.set(primary, found);
  }
  return found;
};

const routesNearby = (functionsInstance: Functions, name: string): boolean =>
  isDualRegionCallable(name) &&
  functionsInstance.region === CALLABLE_FALLBACK_REGION &&
  !(functionsInstance as unknown as { emulatorOrigin?: string | null }).emulatorOrigin;

type SdkError = { code?: unknown; message?: unknown; details?: unknown };

/** HTTP 404 from the front end (no JSON error body): the function is not deployed in that region. */
export const isMissingFunctionError = (error: unknown): boolean => {
  const e = (error || {}) as SdkError;
  return e.code === "functions/not-found" && e.details === undefined && /^not-found \[404\]$/i.test(String(e.message || "").trim());
};
/** `fetch` rejected before any HTTP response (the SDK reports it as status 0). */
export const isNetworkLevelError = (error: unknown): boolean => {
  const e = (error || {}) as SdkError;
  return e.code === "functions/internal" && e.details === undefined && /^internal \[0\]$/i.test(String(e.message || "").trim());
};

const mayFallBack = (name: string, error: unknown): boolean => {
  if (isMissingFunctionError(error)) return true;
  if (!isNetworkLevelError(error) || confirmedNearby.has(name)) return false;
  // Offline is not evidence that the region is missing; the outbox/retry paths already handle it.
  return typeof navigator === "undefined" || navigator.onLine !== false;
};

export function httpsCallable<RequestData = unknown, ResponseData = unknown, StreamData = unknown>(
  functionsInstance: Functions,
  name: string,
  options?: HttpsCallableOptions,
): HttpsCallable<RequestData, ResponseData, StreamData> {
  const legacy = sdkHttpsCallable<RequestData, ResponseData, StreamData>(functionsInstance, name, options);
  if (!routesNearby(functionsInstance, name)) return legacy;
  const nearby = sdkHttpsCallable<RequestData, ResponseData, StreamData>(nearbyInstance(functionsInstance), name, options);
  const call = async (data?: RequestData | null): Promise<HttpsCallableResult<ResponseData>> => {
    if ((unavailableUntil.get(name) || 0) > Date.now()) return legacy(data);
    try {
      const result = await nearby(data);
      confirmedNearby.add(name);
      unavailableUntil.delete(name);
      return result;
    } catch (error) {
      if (!mayFallBack(name, error)) throw error;
      unavailableUntil.set(name, Date.now() + UNAVAILABLE_MS);
      return legacy(data);
    }
  };
  return Object.assign(call, { stream: legacy.stream }) as HttpsCallable<RequestData, ResponseData, StreamData>;
}

/** Test/diagnostic helper: where the next call of `name` would go. */
export function nextCallableRegion(functionsInstance: Functions, name: string): string {
  if (!routesNearby(functionsInstance, name)) return functionsInstance.region;
  return (unavailableUntil.get(name) || 0) > Date.now() ? CALLABLE_FALLBACK_REGION : CALLABLE_PRIMARY_REGION;
}
