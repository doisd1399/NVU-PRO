import { httpsCallable } from "firebase/functions";
import { doc, onSnapshot } from "firebase/firestore";
import { db, functions } from "../lib/firebase";
import { isNativeAndroid } from "../lib/gtoObserver";

export const GTO_STATES = [
  "IDLE",
  "WAITING_FREIGHT",
  "CONFIRMING_FREIGHT",
  "TRIP_IN_PROGRESS",
  "RESULT_DETECTED",
  "AWAITING_BONUS_VALIDATION",
  "RESULT_CONFIRMED",
  "REJECTED_BONUS",
  "CANCELLED",
] as const;

export type GtoCanonicalState = (typeof GTO_STATES)[number];

export const syncGtoCanonicalState = async (payload: {
  sessionId: string;
  driverId: string;
  companyId?: string;
  jobId?: string;
  expectedState?: string;
  state: GtoCanonicalState;
  reason?: string;
  selectedRow?: number;
}) => {
  const call = httpsCallable(functions, "syncGtoTripState");
  return (await call(payload)).data as { success: boolean; sessionId: string; state: string };
};

export const subscribeToGtoCanonicalSession = (
  driverId: string,
  onState: (value: any | null) => void,
  onError?: (error: unknown) => void,
) => {
  // The native Android observer is the live authority for the GTO state. Avoid
  // opening a Firestore listener on every active APK session; the optional remote
  // sync window is controlled explicitly by the native plugin.
  if (!driverId || isNativeAndroid()) return () => {};
  return onSnapshot(
    doc(db, "gto_active_gto_sessions", driverId),
    snapshot => onState(snapshot.exists() ? snapshot.data() : null),
    onError,
  );
};
