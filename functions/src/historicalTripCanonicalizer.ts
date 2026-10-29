import { canonicalTripField, isCanonicalConfirmedTrip } from "./isCanonicalConfirmedTrip";
import { legacyTripMetricMillis, timestampMillis } from "./legacyOperationTripRecovery";

type Data = Record<string, any>;

export type HistoricalSchemaGeneration =
  | "CANONICAL_V4"
  | "LEGACY_SERVER_GTO_V18"
  | "LEGACY_PRE_CANONICAL_JOB_BOUND"
  | "LEGACY_UNBOUND_HISTORICAL"
  | "UNKNOWN";

export type HistoricalClassification =
  | "CANONICAL"
  | "LEGACY_PROVEN"
  | "LEGACY_PROBABLE_NOT_SAFE"
  | "LEGACY_AMBIGUOUS"
  | "LEGACY_INVALID";

export type HistoricalTripCanonicalization = {
  tripId: string;
  schemaGeneration: HistoricalSchemaGeneration;
  classification: HistoricalClassification;
  historicallyValid: boolean;
  historicalValidationReason: string;
  legacyEvidence: string[];
  operationCandidates: string[];
  determinedOperationId: string;
  canonicalMigrationCandidate: boolean;
  safeToAutoRepair: boolean;
  proposedBindings: Record<string, string | number>;
  migrationMetadata: { migrationVersion: string; canonicalizedFrom: HistoricalSchemaGeneration; validationEvidence: string[]; originalFieldsPreserved: true; migratedAtDeferred: true };
  proposedSlot: number | null;
  requirementsBlockingRepair: string[];
};

const text = (v: unknown) => String(v ?? "").trim();
const confirmedStatuses = new Set(["concluida", "concluido", "completed", "finalizado", "finalizada", "entregue", "server_confirmed", "history_confirmed"]);
const deletedStatuses = new Set(["deleted", "cancelado", "cancelada", "canceled", "cancelled", "excluido", "excluida"]);

const operationIdOf = (row: Data) => canonicalTripField(row, "operationId", "jobId", "trabalhoId", "id");
const tripBindingOf = (row: Data) => canonicalTripField(row, "operationId", "jobId", "trabalhoId");
const driverOf = (row: Data) => canonicalTripField(row, "driverId", "motoristaId", "userId", "criadoPor");
const companyOf = (row: Data) => canonicalTripField(row, "companyId", "empresaId");
const contractOf = (row: Data) => canonicalTripField(row, "contractId", "contratoId");
const tripIdentity = (row: Data) => canonicalTripField(row, "canonicalTripId", "tripId", "deterministicTripId", "idempotencyKey", "id");
const slotOf = (row: Data) => {
  const n = Number(row.operationSlot);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function generationOf(trip: Data): HistoricalSchemaGeneration {
  if (Number(trip.operationProjectionVersion) >= 4 || (tripBindingOf(trip) && slotOf(trip) && trip.serverValidatedAt != null)) return "CANONICAL_V4";
  const source = text(trip.source).toLowerCase();
  if (tripBindingOf(trip) && ["gto_auto", "simple_auto"].includes(source) && trip.uploadedAt != null) return "LEGACY_SERVER_GTO_V18";
  if (tripBindingOf(trip) && trip.uploadedAt != null && (trip.completedAt != null || trip.createdAt != null || trip.dataLancamento != null)) return "LEGACY_PRE_CANONICAL_JOB_BOUND";
  if (trip.uploadedAt != null || trip.completedAt != null || trip.createdAt != null || trip.dataLancamento != null) return "LEGACY_UNBOUND_HISTORICAL";
  return "UNKNOWN";
}

function operationWindow(operation: Data): { start: number; end: number } | null {
  const start = timestampMillis(operation.startedAt || operation.assignedAt || operation.acceptedAt || operation.createdAt);
  if (!start) return null;
  const status = text(operation.status).toLowerCase();
  const closed = ["completed", "cancelled", "canceled", "finalizado", "finalizada", "completed"].includes(status);
  const explicitEnd = timestampMillis(operation.completedAt || operation.cancelledAt || operation.canceledAt || operation.closedAt || operation.updatedAt);
  return { start, end: explicitEnd > 0 ? Math.max(start, explicitEnd) : closed ? start : Number.POSITIVE_INFINITY };
}

function operationMatches(trip: Data, operation: Data): boolean {
  const tripDriver = driverOf(trip);
  const operationDriver = driverOf(operation);
  const tripContract = contractOf(trip);
  const operationContract = contractOf(operation);
  const tripCompany = companyOf(trip);
  const operationCompany = companyOf(operation);
  const metric = legacyTripMetricMillis(trip);
  const window = operationWindow(operation);
  if (!tripDriver || !operationDriver || tripDriver !== operationDriver || !tripContract || !operationContract || tripContract !== operationContract || !metric || !window || metric < window.start || metric > window.end) return false;
  return !tripCompany || !operationCompany || tripCompany === operationCompany;
}

function requiredLegacyEvidence(trip: Data, generation: HistoricalSchemaGeneration): string[] {
  const missing: string[] = [];
  if (!tripIdentity(trip)) missing.push("tripId/document identity");
  if (!driverOf(trip)) missing.push("driverId/motoristaId");
  if (!contractOf(trip)) missing.push("contractId/contratoId");
  if (!trip.uploadedAt && !trip.serverValidatedAt && !trip.completedAt && !trip.createdAt && !trip.dataLancamento) missing.push("historical timestamp");
  const status = text(trip.recordStatus || trip.status).toLowerCase();
  if (!confirmedStatuses.has(status)) missing.push("confirmed status");
  if (generation !== "LEGACY_UNBOUND_HISTORICAL" && !tripBindingOf(trip)) missing.push("jobId/operationId");
  return missing;
}

function patchFor(operation: Data, trip: Data, slot: number | null): Record<string, string | number> {
  const id = operationIdOf(operation);
  const driver = driverOf(operation);
  const company = companyOf(operation) || companyOf(trip);
  const contract = contractOf(operation);
  return {
    tripId: tripIdentity(trip), canonicalTripId: tripIdentity(trip),
    jobId: id, operationId: id, trabalhoId: id,
    driverId: driver, motoristaId: driver,
    ...(company ? { companyId: company, empresaId: company } : {}),
    contractId: contract, contratoId: contract,
    ...(slot ? { operationSlot: slot, operationSlotKey: tripIdentity(trip) } : {}),
  };
}

/**
 * HistoricalTripCanonicalizer is intentionally not a writer. It validates old
 * documents against the contract generation that produced their shape and
 * returns a migration proposal without manufacturing server confirmation.
 */
export function canonicalizeHistoricalTrip(input: {
  trip: Data;
  operations: readonly Data[];
  claims?: readonly Data[];
  allTrips?: readonly Data[];
}): HistoricalTripCanonicalization {
  const { trip, operations, claims = [], allTrips = [] } = input;
  const tripId = tripIdentity(trip);
  const generation = generationOf(trip);
  const base = (classification: HistoricalClassification, reason: string, evidence: string[], candidates: string[] = [], operation: Data | undefined = undefined, blocking: string[] = []): HistoricalTripCanonicalization => {
    const slot = slotOf(trip) || (claims.find((claim) => tripIdentity(claim) === tripId)?.operationSlot ? Number(claims.find((claim) => tripIdentity(claim) === tripId)?.operationSlot) : null);
    const proposed = operation ? patchFor(operation, trip, slot) : {};
    const candidate = classification === "LEGACY_PROVEN";
    return { tripId, schemaGeneration: generation, classification, historicallyValid: classification === "CANONICAL" || classification === "LEGACY_PROVEN", historicalValidationReason: reason, legacyEvidence: evidence, operationCandidates: candidates, determinedOperationId: operation ? operationIdOf(operation) : "", canonicalMigrationCandidate: candidate, safeToAutoRepair: candidate && Boolean(operation && slot), proposedBindings: proposed, migrationMetadata: { migrationVersion: "historical-canonicalizer-v2", canonicalizedFrom: generation, validationEvidence: evidence, originalFieldsPreserved: true, migratedAtDeferred: true }, proposedSlot: slot, requirementsBlockingRepair: blocking };
  };
  if (trip.deleted === true || trip.softDeleted === true || trip.cancelado === true || deletedStatuses.has(text(trip.status).toLowerCase())) return base("LEGACY_INVALID", "EXPLICITLY_DELETED_OR_CANCELLED", ["deletion/tombstone marker"]);
  const duplicates = allTrips.filter((candidate) => tripIdentity(candidate) && tripIdentity(candidate) === tripId).map((candidate) => String(candidate.__docId || candidate.id || tripIdentity(candidate)));
  if (duplicates.length > 1) return base("LEGACY_AMBIGUOUS", "DUPLICATE_PHYSICAL_IDENTITY", ["same trip identity appears in multiple physical documents"], duplicates, undefined, ["duplicate identity"]);
  if (generation === "CANONICAL_V4") {
    const matching = operations.filter((operation) => operationIdOf(operation) === tripBindingOf(trip));
    const op = matching.find((operation) => isCanonicalConfirmedTrip(trip, { operationId: operationIdOf(operation), driverId: driverOf(operation), companyId: companyOf(operation), contractId: contractOf(operation) }));
    return op ? base("CANONICAL", "CURRENT_CANONICAL_V4_CONTRACT", ["projectionVersion/canonicalTripId/slot/server proof", "exact operation and driver scope"], [operationIdOf(op)], op) : base("LEGACY_INVALID", "CANONICAL_SHAPE_WITHOUT_EXACT_SCOPE", ["V4 markers present but exact operation scope failed"]);
  }
  const missing = requiredLegacyEvidence(trip, generation);
  if (missing.length) return base("LEGACY_INVALID", "HISTORICAL_CONTRACT_FIELDS_MISSING", [`generation=${generation}`], [], undefined, missing);
  const explicitId = tripBindingOf(trip);
  const candidates = explicitId ? operations.filter((operation) => operationIdOf(operation) === explicitId) : operations.filter((operation) => operationMatches(trip, operation));
  const ids = candidates.map(operationIdOf).filter(Boolean);
  if (ids.length === 0) return base("LEGACY_INVALID", "NO_OPERATION_OR_WINDOW_MATCH", ["physical document exists", "no deterministic operation match"], [], undefined, ["unique operation association"]);
  if (ids.length > 1) return base("LEGACY_AMBIGUOUS", "MULTIPLE_COMPATIBLE_OPERATIONS", ["driver+contract+time or explicit identity matches more than one operation"], ids, undefined, ["unique operation association"]);
  const operation = candidates[0];
  if (explicitId && !operationMatches(trip, operation) && generation !== "LEGACY_SERVER_GTO_V18") return base("LEGACY_INVALID", "EXPLICIT_OPERATION_SCOPE_CONTRADICTION", ["explicit jobId exists", "driver/contract/time does not match operation"], ids, undefined, ["scope agreement"]);
  const evidence = [`schema generation ${generation}`, "physical document identity", "confirmed historical status", "driver and contract present", explicitId ? "explicit jobId/operationId binding" : "unique driver+contract+time match"];
  const slot = slotOf(trip) || claims.find((claim) => tripIdentity(claim) === tripId)?.operationSlot;
  const blocking = slot ? [] : ["no explicit historical operationSlot; do not assign by timestamp unless contract proves sequence rule"];
  return base(explicitId ? "LEGACY_PROVEN" : "LEGACY_PROBABLE_NOT_SAFE", explicitId ? "LEGACY_WRITER_CONTRACT_AND_EXACT_OPERATION" : "UNBOUND_LEGACY_REQUIRES_REVIEW", evidence, ids, operation, blocking);
}

export function historicalSchemaContractTable() {
  return [
    { schemaGeneration: "CANONICAL_V4", required: "canonicalTripId/tripId, operation aliases, driver, status, serverValidatedAt or trusted server proof, operationSlot/slot ledger", optional: "company/contract aliases, source, projection metadata", writer: "registerCanonicalSimpleTrip, registerGtoProReceipt, registerGtoTrip", confirmation: "server transaction", identity: "canonicalTripId/idempotencyKey" },
    { schemaGeneration: "LEGACY_SERVER_GTO_V18", required: "tripId, jobId, driver, company, contract, status=concluida, uploadedAt, completedAt/createdAt", optional: "source=gto_auto/simple_auto, route/value metadata", writer: "historical GTO server writer bundle; source marker is not assumed for older rows", confirmation: "server writer accepted status/date and explicit job binding", identity: "tripId or deterministic session id" },
    { schemaGeneration: "LEGACY_PRE_CANONICAL_JOB_BOUND", required: "document identity, jobId, driver, contract, confirmed status, uploadedAt plus historical date", optional: "company aliases, source, server timestamps, slot", writer: "pre-V4 job-bound historical writer contract evidenced by syncJobProgress/isValidTripDocument", confirmation: "historical writer contract + exact operation scope", identity: "document id/tripId" },
    { schemaGeneration: "LEGACY_UNBOUND_HISTORICAL", required: "identity, confirmed status and historical timestamp", optional: "driver/company/contract", writer: "unknown/legacy direct or incomplete writer", confirmation: "insufficient without unique operation", identity: "document id/tripId" },
  ];
}
