import { canonicalTripOperationService } from "../application/trip/CanonicalTripOperationService";

export type IntegrityGuardReason =
  | "operation-open"
  | "pro-entry"
  | "before-trip"
  | "online-resume"
  | "sync-complete";

/**
 * Single entry point for operation self-healing. The operation progress field
 * is treated as a cache; confirmed canonical trips are the source of truth.
 */
export async function ensureOperationIntegrity(
  jobId: string,
  totalDeliveries = 0,
  _reason: IntegrityGuardReason = "operation-open",
) {
  return canonicalTripOperationService.ensureOperationIntegrity(jobId, totalDeliveries);
}
