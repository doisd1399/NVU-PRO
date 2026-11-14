import type { CanonicalTrip, TripStatus } from "../../domain/trip/CanonicalTrip";
import { resolveOperationalIdentity } from "../../domain/operation/OperationalIdentity";
import { isCanonicalConfirmedTrip, isTrustedServerConfirmedTrip } from "../../../functions/src/isCanonicalConfirmedTrip";

const text = (...values: unknown[]): string => {
  for (const value of values) {
    if (value && typeof value === "object" && "toDate" in value && typeof (value as any).toDate === "function") {
      const date = (value as any).toDate();
      if (date instanceof Date && Number.isFinite(date.getTime())) return date.toISOString();
    }
    if (value && typeof value === "object" && "seconds" in value) {
      const seconds = Number((value as any).seconds);
      const nanoseconds = Number((value as any).nanoseconds || 0);
      if (Number.isFinite(seconds)) return new Date(seconds * 1000 + nanoseconds / 1e6).toISOString();
    }
    const candidate = String(value ?? "").trim();
    if (candidate === "[object Object]") continue;
    if (candidate) return candidate;
  }
  return "";
};

const lifecycleStatuses = new Set<TripStatus>([
  "CREATED",
  "CAPTURED",
  "REGISTERED_LOCAL",
  "PENDING_SYNC",
  "SYNCING",
  "SERVER_CONFIRMED",
  "HISTORY_CONFIRMED",
  "DELETED",
]);

function lifecycleOf(input: Partial<CanonicalTrip>, deleted: boolean, scope: {
  operationId: string; driverId: string; companyId: string; contractId: string;
}): TripStatus {
  if (deleted) return "DELETED";
  if (isCanonicalConfirmedTrip(input as any, scope)) {
    return "SERVER_CONFIRMED";
  }
  const status = String(input.status || "").trim() as TripStatus;
  if (status === "SERVER_CONFIRMED" || status === "HISTORY_CONFIRMED") return "REGISTERED_LOCAL";
  return lifecycleStatuses.has(status) ? status : "REGISTERED_LOCAL";
}

/** Converts Print, Pro, realtime and legacy server shapes to one contract. */
export class TripRegistrationService {
  static register(input: Partial<CanonicalTrip>): CanonicalTrip {
    const now = new Date().toISOString();
    const key = text(input.idempotencyKey, input.clientRequestId, `trip-${Date.now()}`);
    const requestedTripId = text(input.tripId, (input as any).deterministicTripId);
    const suppliedCanonicalTripId = text(input.canonicalTripId);
    if (requestedTripId && suppliedCanonicalTripId && requestedTripId !== suppliedCanonicalTripId) {
      throw new Error("CANONICAL_TRIP_IDENTITY_MISMATCH");
    }
    const tripId = text(
      suppliedCanonicalTripId,
      requestedTripId,
      (input as any).id,
      (input as any).firestoreId,
      key,
    );
    if (!tripId) throw new Error("CANONICAL_TRIP_ID_REQUIRED");

    const deleted = input.deleted === true || String(input.status || "").toUpperCase() === "DELETED";
    const driverId = text(input.driverId, (input as any).motoristaId, (input as any).userId);
    const companyId = text(input.companyId, (input as any).empresaId);
    const jobId = text(input.jobId, (input as any).trabalhoId);
    if (!jobId) throw new Error("CANONICAL_TRIP_JOB_ID_REQUIRED");
    const operationId = jobId;
    const contractId = text(input.contractId, (input as any).contratoId);
    const simulatorId = text(
      input.simulatorId,
      (input as any).simuladorId,
      (input as any).simulatorCode,
      (input as any).simuladorCodigo,
      (input as any).simulatorKey,
      (input as any).simulator,
      "unknown",
    );
    const recordStatus = text(
      (input as any).recordStatus,
      lifecycleStatuses.has(String(input.status || "") as TripStatus) ? "concluida" : input.status,
      "concluida",
    );
    const lifecycle = lifecycleOf(input, deleted, { operationId, driverId, companyId, contractId });
    const operationalIdentity = resolveOperationalIdentity({
      ...input,
      uid: (input as any).uid || (input as any).userId || driverId,
      driverId,
      companyId,
      contractId,
      operationId,
    });
    return {
      ...input,
      canonicalTripId: tripId,
      tripId,
      clientRequestId: text(input.clientRequestId, key),
      idempotencyKey: text(input.idempotencyKey, input.clientRequestId, key),
      status: lifecycle,
      recordStatus,
      source: text(input.source, "UNKNOWN"),
      earnings: Number.isFinite(Number(input.earnings)) ? Number(input.earnings) : Number((input as any).valor || 0) || 0,
      cacheValue: Number.isFinite(Number(input.cacheValue)) ? Number(input.cacheValue) : Number(input.earnings || 0) || 0,
      createdAt: text(input.createdAt, (input as any).createdAtLocal, now),
      updatedAt: text(input.updatedAt, now),
      clientUpdatedAt: text(input.clientUpdatedAt, input.updatedAt, now),
      serverUpdatedAt: text(input.serverUpdatedAt) || undefined,
      syncVersion: Math.max(1, Number(input.syncVersion || 1)),
      deleted,
      operationId,
      jobId,
      driverId,
      companyId,
      simulatorId,
      contractId,
      operationalIdentity,
      rankingEligible: deleted ? false : input.rankingEligible,
      rankingEligibilityReason: deleted ? "DELETED" : input.rankingEligibilityReason,
    } as CanonicalTrip;
  }
  /** Read-only normalization for historical rows. It never creates a LIVE operation. */
  static registerHistoricalRead(input: Partial<CanonicalTrip>): CanonicalTrip {
    const physicalId = text((input as any).physicalDocumentId);
    if (!physicalId) throw new Error("HISTORICAL_TRIP_PHYSICAL_ID_REQUIRED");
    const deleted = input.deleted === true || String(input.status || input.recordStatus || "").toUpperCase() === "DELETED";
    const trustedProof = isTrustedServerConfirmedTrip(input as any);
    const driverId = text(input.driverId, (input as any).motoristaId, (input as any).userId, (input as any).criadoPor);
    const companyId = text(input.companyId, (input as any).empresaId);
    const contractId = text(input.contractId, (input as any).contratoId);
    const simulatorId = text(input.simulatorId, (input as any).simuladorId, (input as any).simulatorKey, "unknown");
    const originalTripId = text(input.tripId, (input as any).deterministicTripId);
    const originalCanonicalTripId = text(input.canonicalTripId);
    const originalOperationId = text(input.operationId, (input as any).trabalhoId, input.jobId);
    const businessStatus = text(input.recordStatus, input.status);
    return {
      ...input,
      physicalDocumentId: physicalId,
      originalTripId: originalTripId || undefined,
      originalCanonicalTripId: originalCanonicalTripId || undefined,
      originalOperationId: originalOperationId || undefined,
      canonicalTripId: originalCanonicalTripId || originalTripId || physicalId,
      tripId: originalTripId || originalCanonicalTripId || physicalId,
      clientRequestId: text(input.clientRequestId, physicalId),
      idempotencyKey: text(input.idempotencyKey, physicalId),
      status: deleted ? "DELETED" : trustedProof ? "HISTORY_CONFIRMED" : "REGISTERED_LOCAL",
      recordStatus: businessStatus || undefined,
      historicalReadOnly: true,
      historicalEvidenceStatus: deleted ? "DELETED" : trustedProof ? "SERVER_PROVEN" : "UNPROVEN",
      source: text(input.source, "HISTORICAL_READ"),
      createdAt: text(input.createdAt),
      updatedAt: text(input.updatedAt, input.createdAt),
      clientUpdatedAt: text(input.clientUpdatedAt, input.updatedAt, input.createdAt),
      syncVersion: Math.max(1, Number(input.syncVersion || 1)),
      deleted,
      operationId: "",
      jobId: undefined,
      driverId,
      companyId,
      simulatorId,
      contractId,
    } as CanonicalTrip;
  }
}
