import { canonicalTripField, isCanonicalConfirmedTrip, isTrustedServerConfirmedTrip } from "./isCanonicalConfirmedTrip";
import { resolveLegacyOperationAttribution, tripOperationIdOf } from "./legacyOperationTripRecovery";

type Data = Record<string, any>;
export type LegacyMigrationCategory =
  | "CANONICAL"
  | "RECOVERABLE_EXACT"
  | "RECOVERABLE_FROM_SLOT"
  | "RECOVERABLE_FROM_OPERATION"
  | "RECOVERABLE_FROM_CONTRACT_WINDOW"
  | "DUPLICATE"
  | "ORPHAN"
  | "AMBIGUOUS"
  | "INVALID";
export type LegacyTripClassification = {
  category: LegacyMigrationCategory;
  reason: string;
  evidence: string[];
  currentBindings: Record<string, string | number>;
  proposedBindings: Record<string, string | number>;
  proposedSlot: number | null;
  fieldsToPatch: string[];
  confidenceBasis: string[];
  safeToAutoRepair: boolean;
};
export type MigrationOperation = Data & { id?: string };
export type MigrationSlotClaim = Data & { id?: string };

const text = (value: unknown) => String(value ?? "").trim();
const operationIdOf = (row: Data) => canonicalTripField(row, "operationId", "jobId", "trabalhoId", "id");
const slotOf = (row: Data) => {
  const value = Number(row.operationSlot);
  return Number.isInteger(value) && value > 0 ? value : null;
};
const identityOf = (row: Data, fallback = "") => canonicalTripField(row, "canonicalTripId", "tripId", "idempotencyKey", "id") || fallback;
const bindings = (row: Data) => ({
  operationId: canonicalTripField(row, "jobId", "operationId", "trabalhoId"),
  driverId: canonicalTripField(row, "driverId", "motoristaId", "userId", "criadoPor"),
  companyId: canonicalTripField(row, "companyId", "empresaId"),
  contractId: canonicalTripField(row, "contractId", "contratoId"),
});
function operationScope(operation: Data) {
  return {
    operationId: operationIdOf(operation),
    driverId: canonicalTripField(operation, "driverId", "motoristaId", "userId"),
    companyId: canonicalTripField(operation, "companyId", "empresaId"),
    contractId: canonicalTripField(operation, "contractId", "contratoId"),
  };
}
function patchFor(operation: Data, slot: number | null): Record<string, string | number> {
  const scope = operationScope(operation);
  return {
    jobId: scope.operationId,
    operationId: scope.operationId,
    trabalhoId: scope.operationId,
    driverId: scope.driverId,
    motoristaId: scope.driverId,
    companyId: scope.companyId,
    empresaId: scope.companyId,
    contractId: scope.contractId,
    contratoId: scope.contractId,
    ...(slot ? { operationSlot: slot, operationSlotKey: "<tripId>" } : {}),
  };
}
function result(input: Partial<LegacyTripClassification> & Pick<LegacyTripClassification, "category" | "reason">): LegacyTripClassification {
  return {
    category: input.category,
    reason: input.reason,
    evidence: input.evidence || [],
    currentBindings: input.currentBindings || {},
    proposedBindings: input.proposedBindings || {},
    proposedSlot: input.proposedSlot ?? null,
    fieldsToPatch: input.fieldsToPatch || [],
    confidenceBasis: input.confidenceBasis || [],
    safeToAutoRepair: input.safeToAutoRepair ?? false,
  };
}
/**
 * Pure, deterministic classifier. It never guesses from similarity or AI.
 * The caller must persist only classifications with safeToAutoRepair=true.
 */
export function classifyLegacyTripForCanonicalMigration(
  trip: Data,
  operations: readonly MigrationOperation[],
  claims: readonly MigrationSlotClaim[] = [],
): LegacyTripClassification {
  const currentBindings = bindings(trip);
  const tripId = identityOf(trip);
  const explicitOperationId = tripOperationIdOf(trip);
  const hasPhysicalJobId = Boolean(text((trip as any).jobId));
  const matchingSlot = claims.filter((claim) => claim.tripId === tripId || claim.canonicalTripId === tripId);
  if (trip.deleted === true || trip.softDeleted === true || trip.cancelado === true || text(trip.status).toLowerCase() === "deleted") {
    return result({ category: "INVALID", reason: "DELETED", currentBindings, evidence: ["trip is deleted/tombstoned"], confidenceBasis: ["explicit deletion marker"] });
  }
  if (!isTrustedServerConfirmedTrip(trip)) {
    return result({ category: "INVALID", reason: "MISSING_SERVER_CONFIRMATION", currentBindings, evidence: ["trip does not satisfy trusted server confirmation contract"], confidenceBasis: ["server confirmation predicate"] });
  }
  const duplicateIds = tripsWithSameIdentity(trip, tripId);
  if (duplicateIds.length > 1) {
    return result({ category: "DUPLICATE", reason: "DUPLICATE_IDENTITY", currentBindings, evidence: duplicateIds, confidenceBasis: ["same canonical identity appears more than once"] });
  }
  const explicitOperation = explicitOperationId ? operations.find((operation) => operationIdOf(operation) === explicitOperationId) : undefined;
  if (explicitOperation) {
    const scope = operationScope(explicitOperation);
    const canonical = isCanonicalConfirmedTrip(trip, scope);
    const slot = slotOf(trip) || slotOf(matchingSlot[0] || {});
    const slotConflict = slot != null && claims.some((claim) => slotOf(claim) === slot && identityOf(claim, text(claim.tripId)) !== tripId && claim.deleted !== true);
    if (slotConflict) return result({ category: "AMBIGUOUS", reason: "SLOT_CONFLICT", currentBindings, proposedBindings: patchFor(explicitOperation, slot), proposedSlot: slot, fieldsToPatch: [], evidence: ["explicit operation binding", "slot occupied by another trip"], confidenceBasis: ["slot uniqueness invariant"], safeToAutoRepair: false });
    if (canonical && slot != null) return result({ category: "CANONICAL", reason: "ALREADY_CANONICAL", currentBindings, proposedBindings: currentBindings, proposedSlot: slot, evidence: ["explicit binding", "trusted server confirmation", "valid slot"], confidenceBasis: ["canonical predicate", "slot ledger"], safeToAutoRepair: false });
    const patch = patchFor(explicitOperation, slot);
    const fieldsToPatch = Object.keys(patch).filter((key) => key !== "operationSlotKey" && text((trip as any)[key]) !== text(patch[key]));
    return result({ category: "RECOVERABLE_FROM_OPERATION", reason: "MISSING_CANONICAL_BINDING_FIELDS", currentBindings, proposedBindings: patch, proposedSlot: slot, fieldsToPatch, evidence: ["explicit operation binding", "trusted server confirmation", ...(hasPhysicalJobId ? [] : ["legacy row has no physical jobId"])], confidenceBasis: ["immutable operation binding", "server confirmation predicate"], safeToAutoRepair: hasPhysicalJobId && fieldsToPatch.length > 0 && slot != null });
  }
  const attribution = resolveLegacyOperationAttribution(trip, operations);
  if (attribution.ambiguous) return result({ category: "AMBIGUOUS", reason: "OPERATION_MATCH_AMBIGUOUS", currentBindings, evidence: attribution.matchingOperationIds, confidenceBasis: ["more than one deterministic operation window matches"] });
  if (attribution.ownerOperationId) {
    const operation = operations.find((candidate) => operationIdOf(candidate) === attribution.ownerOperationId)!;
    const slot = slotOf(trip) || firstFreeSlot(operation, claims);
    const proposedBindings = patchFor(operation, slot);
    const fieldsToPatch = Object.keys(proposedBindings).filter((key) => key !== "operationSlotKey" && text((trip as any)[key]) !== text(proposedBindings[key]));
    return result({ category: "RECOVERABLE_EXACT", reason: "EXACT_DRIVER_CONTRACT_OPERATION_WINDOW", currentBindings, proposedBindings, proposedSlot: slot, fieldsToPatch, evidence: ["unique driver+contract+time match", ...(hasPhysicalJobId ? [] : ["legacy row has no physical jobId"])], confidenceBasis: ["resolveLegacyOperationAttribution returned one operation", "deterministic timestamp window"], safeToAutoRepair: hasPhysicalJobId && Boolean(slot) });
  }
  const slotOperation = operations.find((operation) => {
    const id = operationIdOf(operation);
    return claims.some((claim) => claim.tripId === tripId && canonicalTripField(claim, "jobId", "operationId", "trabalhoId") === id);
  });
  if (slotOperation) {
    const slot = slotOf(trip) || slotOf(claims.find((claim) => claim.tripId === tripId) || {});
    return result({ category: "RECOVERABLE_FROM_SLOT", reason: "SLOT_BINDS_TRIP_TO_OPERATION", currentBindings, proposedBindings: patchFor(slotOperation, slot), proposedSlot: slot, fieldsToPatch: Object.keys(patchFor(slotOperation, slot)), evidence: ["slot claim explicitly binds trip and operation", ...(hasPhysicalJobId ? [] : ["legacy row has no physical jobId"])], confidenceBasis: ["slot ledger identity"], safeToAutoRepair: hasPhysicalJobId && Boolean(slot) });
  }
  if (operations.some((operation) => canonicalTripField(operation, "contractId", "contratoId") && canonicalTripField(operation, "contractId", "contratoId") === canonicalTripField(trip, "contractId", "contratoId"))) {
    return result({ category: "ORPHAN", reason: "NO_UNIQUE_OPERATION_BINDING", currentBindings, evidence: ["trusted trip has no unique operation binding"], confidenceBasis: ["contract match alone is insufficient"] });
  }
  return result({ category: "ORPHAN", reason: "NO_OPERATION_BINDING", currentBindings, evidence: ["trusted trip is not attached to any known operation"], confidenceBasis: ["no deterministic attribution"] });
}
function firstFreeSlot(operation: Data, claims: readonly MigrationSlotClaim[]): number | null {
  const total = Math.max(0, Math.trunc(Number(operation.totalDeliveries || 0)));
  const used = new Set(claims.filter((claim) => operationIdOf(claim) === operationIdOf(operation) && claim.deleted !== true).map(slotOf).filter((slot): slot is number => slot != null));
  const limit = total || used.size + 1;
  for (let slot = 1; slot <= limit; slot += 1) if (!used.has(slot)) return slot;
  return null;
}
function tripsWithSameIdentity(trip: Data, tripId: string): string[] {
  // Optional fixture convention: callers may pass a private _allTrips array for pure duplicate tests.
  const allTrips = Array.isArray((trip as any)._allTrips) ? (trip as any)._allTrips as Data[] : [trip];
  return allTrips.filter((candidate) => identityOf(candidate) === tripId).map((candidate) => identityOf(candidate)).filter(Boolean);
}
