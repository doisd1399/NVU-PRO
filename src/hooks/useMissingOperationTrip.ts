import { createContext, useContext, useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { doc, getDocFromServer } from "firebase/firestore";
import { db, functions } from "../lib/firebase";
import { ingestOperationTripSnapshot } from "../lib/operationTripRecovery";
import { CanonicalTripQueryService } from "../application/trip/CanonicalTripQueryService";
import { publishDriverTripOptimistically, removeDriverTripOptimistically } from "./useDriverTrips";

export type OperationRecovery = {
  jobId: string;
  status: "idle" | "checking" | "offline" | "unavailable" | "conflict" | "repaired" | "stale";
  confirmedCount?: number;
  serverProgress?: number;
  reason?: string;
  retry: () => void;
};
export const OperationRecoveryContext = createContext<OperationRecovery | null>(null);
export const useOperationRecovery = () => useContext(OperationRecoveryContext);

type ServerResult = {
  status: "consistent" | "repaired" | "conflict";
  tripIds: string[];
  confirmedCount: number;
  serverProgress: number;
  reason: string;
  legacyRecoveredCount?: number;
};

/** The complete server operation is checked when its counter differs from the
 * canonical visible history. An exact last-ID listener cannot find older gaps,
 * deleted receipts or orphaned counters, and used to leave the UI waiting forever.
 */
export function useMissingOperationTrip(
  job: { id: string; companyId?: string; contractId?: string } | null,
  driverId: string | undefined,
  visibleTripIds: readonly string[],
  historyReady: boolean,
): OperationRecovery {
  const jobId = String(job?.id || "");
  const companyId = String(job?.companyId || "");
  const contractId = String(job?.contractId || "");
  const [retryRevision, setRetryRevision] = useState(0);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [result, setResult] = useState<{
    jobId: string;
    status: OperationRecovery["status"];
    confirmedCount?: number;
    serverProgress?: number;
    reason?: string;
  }>({ jobId: "", status: "idle" });
  const visibleIdsKey = visibleTripIds.join("|");

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  useEffect(() => {
    if (!jobId || !companyId || !driverId || !historyReady) return;
    if (!online) { setResult({ jobId, status: "offline" }); return; }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    setResult({ jobId, status: "checking" });
    const reconcile = httpsCallable<{ jobId: string }, ServerResult>(functions, "reconcileOperationTrips", { timeout: 15000 });
    void (async () => {
      try {
        const { data } = await reconcile({ jobId });
        if (cancelled) return;
        if (data.status === "conflict") {
          // Only this backend classification is a server inconsistency. A
          // local list that has not ingested a server-confirmed row is stale,
          // not a conflicting operation projection.
          setResult({
            jobId,
            status: "conflict",
            confirmedCount: data.confirmedCount,
            serverProgress: data.serverProgress,
            reason: data.reason,
          });
        } else {
          // A legacy recovery can update an already-visible receipt by adding
          // its canonical operation binding. Refresh those rows immediately
          // instead of waiting for a realtime listener tick; otherwise the
          // card can remain 3/12 for a few seconds after the server has already
          // repaired 12/12.
          const rowsToRefresh = data.tripIds.filter((id) => {
            const cached = CanonicalTripQueryService.getTrip(id);
            const binding = String((cached as any)?.jobId || "").trim();
            return !visibleTripIds.includes(id) || !cached || binding !== jobId || Boolean(data.legacyRecoveredCount);
          });
          let accepted = true;
          for (const id of rowsToRefresh) {
            const snapshot = await getDocFromServer(doc(db, "historico_viagens", id));
            if (cancelled) return;
            if (!snapshot.exists() || !ingestOperationTripSnapshot(id, snapshot.data(), {
              jobId, companyId, contractId, driverId,
            })) { accepted = false; continue; }
            const trip = CanonicalTripQueryService.getTrip(id);
            if (trip && !trip.deleted) publishDriverTripOptimistically(driverId, trip);
            else accepted = false;
          }
          // A missing ID in a reconciliation result proves neither an explicit
          // server deletion nor a rejected/deduplicated pending local attempt.
          // Hide an outdated optimistic projection, but NEVER permanently
          // tombstone the identity from absence alone. Explicit delete ACKs
          // and deleted=true server records remain authoritative elsewhere.
          for (const id of visibleTripIds.filter((id) => !data.tripIds.includes(id))) {
            const cached = CanonicalTripQueryService.getTrip(id);
            if (cached && String(cached.jobId || "") === jobId) {
              removeDriverTripOptimistically(driverId, id);
            } else accepted = false;
          }
          setResult({
            jobId,
            status: accepted ? "repaired" : "stale",
            confirmedCount: data.confirmedCount,
            serverProgress: data.serverProgress,
            reason: data.reason,
          });
          if (accepted) settleTimer = setTimeout(() => {
            if (!cancelled) setResult({ jobId, status: "stale" });
          }, 15_000);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("[NVU] Reconciliação da operação indisponível", error);
          setResult({ jobId, status: "unavailable" });
        }
      }
      if (!cancelled) retryTimer = setTimeout(() => setRetryRevision((n) => n + 1), 60_000);
    })();
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer);
      if (settleTimer) clearTimeout(settleTimer); };
  }, [jobId, companyId, contractId, driverId, visibleIdsKey, historyReady, online, retryRevision]);

  const status = !jobId || !historyReady ? "idle"
    : !online ? "offline" : result.jobId === jobId ? result.status : "checking";
  return {
    jobId,
    status,
    confirmedCount: result.jobId === jobId ? result.confirmedCount : undefined,
    serverProgress: result.jobId === jobId ? result.serverProgress : undefined,
    reason: result.jobId === jobId ? result.reason : undefined,
    retry: () => setRetryRevision((n) => n + 1),
  };
}
