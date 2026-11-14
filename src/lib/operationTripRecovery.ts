import { canonicalTripRepository } from "../repositories/CanonicalTripRepository";
import type { CanonicalTrip } from "../domain/trip/CanonicalTrip";
import { normalizeTrip } from "./tripNormalizer";
import { getCanonicalTripCompanyId, getCanonicalTripDriverId } from "./tripIdentity";

export type OperationTripScope = {
  jobId: string;
  companyId: string;
  driverId: string;
  contractId: string;
};

/** Accept only the exact server document referenced by the active operation. */
export function ingestOperationTripSnapshot(
  documentId: string,
  data: Record<string, unknown>,
  scope: OperationTripScope,
  save: (trip: CanonicalTrip) => unknown = (trip) => canonicalTripRepository.applyServerSnapshot(trip),
): boolean {
  const trip: Record<string, unknown> = { ...data, id: documentId };
  if (!documentId || !scope.jobId || !scope.driverId || !scope.companyId
      || String(trip.tripId || documentId) !== documentId
      || String(trip.canonicalTripId || documentId) !== documentId
      || String(trip.jobId || "") !== scope.jobId
      || getCanonicalTripDriverId(trip) !== scope.driverId
      || getCanonicalTripCompanyId(trip) !== scope.companyId
      || (scope.contractId && String(trip.contractId || trip.contratoId || "") !== scope.contractId)) {
    return false;
  }
  const deleted = trip.deleted === true || String(trip.status || "").toUpperCase() === "DELETED";
  if (!deleted && !normalizeTrip(trip as any).isValid) return false;
  save(trip as unknown as CanonicalTrip);
  return true;
}
