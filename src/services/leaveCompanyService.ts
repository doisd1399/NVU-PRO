import { auth } from "../lib/firebase";
import { manageFleetMembership } from "./fleetMembershipService";
import { syncEngine } from "./sync/SyncEngine";
import { operationOutbox } from "./operationOutbox";
import { getOfflineTrips } from "../lib/offlineTripQueue";
import { isSimpleAutomationNativeAvailable, SimpleAutomation } from "../lib/simpleAutomationNative";
import { isLeaveCommandAcknowledged, isLeaveUnsupported, localLeavePreflight, parseLeavePreview, type LeavePreflight, type LeavePreview } from "./leaveCompanyCore";

const TERMINAL_NATIVE = ["SYNCED", "FAILED", "CONFLICT", "DISCARDED_OPERATION_COMPLETED"];
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const probes = new Map<string, { at: number; value: Promise<LeavePreview | "unsupported"> }>();
const PROBE_TTL_MS = 60_000;

/** Read-only summary of what leaving would do. "unsupported" means the server has not been updated yet. */
export function previewLeaveCompany(companyId: string, options: { fresh?: boolean } = {}): Promise<LeavePreview | "unsupported"> {
  const uid = auth.currentUser?.uid || "";
  const key = `${uid}:${companyId}`;
  const cached = probes.get(key);
  if (!options.fresh && cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.value;
  const value = manageFleetMembership({ action: "leave-preview", companyId }).then(
    data => parseLeavePreview(data, companyId) || "unsupported" as const,
    error => { if (isLeaveUnsupported(error)) return "unsupported" as const; throw error; });
  probes.set(key, { at: Date.now(), value });
  // A failed read is never remembered.
  value.catch(() => { if (probes.get(key)?.value === value) probes.delete(key); });
  return value;
}

/** Trips, receipts and commands that exist only on this device (the server cannot see them). */
export function checkLocalPendingForLeave(companyId: string): Promise<LeavePreflight> {
  const uid = auth.currentUser?.uid || "";
  return localLeavePreflight({
    online: typeof navigator === "undefined" || navigator.onLine !== false,
    registrations: () => uid ? syncEngine.getOwnedPendingRegistrations(companyId).length : 0,
    legacyTrips: () => getOfflineTrips().filter(item => {
      const payload = item.payload || {};
      const owner = text(payload.driverId || payload.motoristaId || payload.userId);
      const company = text(payload.companyId || payload.empresaId);
      return owner === uid && (!company || company === companyId) && !["FAILED", "VALIDATED"].includes(item.status);
    }).length,
    operations: () => uid ? operationOutbox.entries(uid).filter(entry => entry.companyId === companyId && !["CONFIRMED", "REJECTED"].includes(entry.state)).length : 0,
    native: async () => {
      if (!uid || !isSimpleAutomationNativeAvailable()) return 0;
      const data = await SimpleAutomation.getReadOnlyProQueueDiagnostics({ driverId: uid, companyId });
      if (!data.ownerAuthenticated) throw new Error("native-owner-not-authenticated");
      return (data.pendingProTrips || []).filter(trip => trip.driverId === uid && trip.companyId === companyId && !TERMINAL_NATIVE.includes(trip.queueStatus)).length +
        new Set(data.pendingGtoTripIds || []).size;
    },
  });
}

/** Success is reported only when the server confirms the exit. `diagnosticId` makes a retry replay the same command. */
export async function leaveCompany(companyId: string, diagnosticId: string) {
  const uid = auth.currentUser?.uid || "";
  const data = await manageFleetMembership({ action: "leave", companyId, diagnosticId });
  if (!isLeaveCommandAcknowledged(data, companyId, uid)) {
    throw Object.assign(new Error("O servidor não confirmou a saída da empresa."), { code: "functions/internal", details: { reasonCode: "MEMBERSHIP_ACK_INVALID", diagnosticId } });
  }
  probes.clear();
  return data as { success: true; left: true; companyId: string; cancelledJobs: number };
}
