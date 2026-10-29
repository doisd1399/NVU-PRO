import { auth } from "../lib/firebase";
import { isAuthTeardownActive } from "../lib/authLifecycle";
import { DurableOperationOutbox, type OperationOutboxEntry } from "../application/operation/DurableOperationOutbox";
import { configureOperationSyncBarrier } from "../application/operation/OperationSyncBarrier";
import { canonicalOperationCommandService } from "../application/operation/CanonicalOperationCommandService";
import { canonicalTripOperationService } from "../application/trip/CanonicalTripOperationService";
import { assertServerNewOperationAllowed } from "./workModeAvailabilityService";
import { confirmCompletedOperationQueueCleanup } from "./completedOperationQueueCleanup";
import { isSimpleAutomationNativeAvailable, SimpleAutomation } from "../lib/simpleAutomationNative";

export const OPERATION_OUTBOX_CHANGED = "nvu-operation-outbox-changed";
const mirrored = new Map<string, boolean>();
const pausedCapture = new Map<string, boolean>();
let pendingTripIds = (_uid: string, _jobId: string): string[] => [];
export function setOperationPendingTripReader(reader: typeof pendingTripIds) { pendingTripIds = reader; }
export function operationPendingTripCount(uid: string, jobId: string) { return pendingTripIds(uid, jobId).length; }

export async function mirrorOperationStart(driverId: string, companyId: string, jobId: string, pending: boolean) {
  if (!isSimpleAutomationNativeAvailable()) return;
  const key = JSON.stringify([driverId, companyId, jobId]);
  if (mirrored.get(key) === pending) return;
  const result = await SimpleAutomation.markOperationStartPending({ driverId, companyId, jobId, pending });
  if (!result?.saved) throw new Error("Não foi possível salvar o início com segurança neste aparelho.");
  mirrored.set(key, pending);
}
export async function mirrorOperationCapturePause(driverId: string, companyId: string, jobId: string, paused: boolean) {
  if (!isSimpleAutomationNativeAvailable()) return;
  const key = JSON.stringify([driverId, companyId, jobId]);
  if (pausedCapture.get(key) === paused) return;
  const result = await SimpleAutomation.markOperationCapturePaused({ driverId, companyId, jobId, paused });
  if (!result?.saved) throw new Error("Não foi possível salvar a pausa de captura neste aparelho.");
  pausedCapture.set(key, paused);
}
export async function pendingNativeOperationTripIds(driverId: string, companyId: string, jobId: string): Promise<string[]> {
  if (!isSimpleAutomationNativeAvailable()) return [];
  const data = await SimpleAutomation.getReadOnlyProQueueDiagnostics({ driverId, companyId, jobId });
  return data.ownerAuthenticated ? [...new Set([...(data.pendingProTrips || []).filter(trip =>
    trip.driverId === driverId && trip.companyId === companyId && trip.jobId === jobId &&
    !["SYNCED", "FAILED", "CONFLICT", "DISCARDED_OPERATION_COMPLETED"].includes(trip.queueStatus))
    .map(trip => trip.canonicalTripId || trip.tripId || trip.attemptId), ...(data.pendingGtoTripIds || [])])] : [];
}
export async function pendingNativeOperationTrips(uid: string, companyId: string, jobId: string) {
  return (await pendingNativeOperationTripIds(uid, companyId, jobId)).length;
}
export async function pendingOperationTripCount(uid: string, companyId: string, jobId: string) {
  const native = await pendingNativeOperationTripIds(uid, companyId, jobId);
  return new Set([...pendingTripIds(uid, jobId), ...native]).size;
}

export const operationOutbox = new DurableOperationOutbox({
  uid: () => isAuthTeardownActive() ? "" : auth.currentUser?.uid || "",
  online: () => !isAuthTeardownActive() && (typeof navigator === "undefined" || navigator.onLine !== false),
  storage: () => window.localStorage,
  notify: uid => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPERATION_OUTBOX_CHANGED, { detail: { uid } })); },
  sendStart: async entry => {
    if (auth.currentUser?.uid !== entry.actorId) throw new Error("OPERATIONAL_COMMAND_SESSION_CHANGED");
    await mirrorOperationStart(entry.actorId, entry.companyId, entry.jobId, true);
    if (entry.transport === "managed") {
      const result = await canonicalOperationCommandService.executeManaged(entry.input!, entry.requestId);
      return { ...(result.currentJob || result.job), id: result.jobId } as any;
    }
    await assertServerNewOperationAllowed(entry.job.simulatorId || entry.job.contractSnapshot?.simulator);
    return canonicalOperationCommandService.startLegacyOperation({ id: entry.jobId, driverId: entry.actorId,
      companyId: entry.companyId, contractId: entry.job.contractId, vehicleId: entry.job.vehicleId });
  },
  sendFinish: entry => canonicalTripOperationService.finalizeOperation(entry.jobId),
  canFinish: async entry => pendingTripIds(entry.actorId, entry.jobId).length === 0 &&
    await pendingNativeOperationTrips(entry.actorId, entry.companyId, entry.jobId) === 0,
});

const cleaned = new Set<string>();
configureOperationSyncBarrier((uid, jobId) => typeof window !== "undefined" && auth.currentUser?.uid === uid && operationOutbox.startUnsettled(uid, jobId));
/** Replay barriers are repaired on resume too, including a crash between the
 * durable server ACK and the native bridge acknowledgement. */
export async function reconcileOperationOutboxNativeState() {
  const uid = auth.currentUser?.uid || "";
  if (!uid) return;
  const entries = operationOutbox.entries(uid);
  for (const entry of entries) {
    if (auth.currentUser?.uid !== uid) break;
    if (entry.kind === "start") await mirrorOperationStart(uid, entry.companyId, entry.jobId, entry.state !== "CONFIRMED");
    const pause = entries.some(row => row.jobId === entry.jobId && row.companyId === entry.companyId &&
      (row.kind === "start" && row.state === "REJECTED" || row.kind === "finish" && row.state !== "REJECTED"));
    await mirrorOperationCapturePause(uid, entry.companyId, entry.jobId, pause);
    if (entry.kind === "finish" && entry.state === "CONFIRMED" && !entry.nativeCleanupDone && !cleaned.has(entry.id + uid)) {
      cleaned.add(entry.id + uid);
      void confirmCompletedOperationQueueCleanup(entry.jobId).then(verified => {
        if (verified) operationOutbox.acknowledgeNativeCleanup(uid, entry.id);
        else cleaned.delete(entry.id + uid);
      }).catch(() => cleaned.delete(entry.id + uid));
    }
  }
}
