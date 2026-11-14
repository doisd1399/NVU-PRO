import { buildCanonicalOperationProjection, field } from "./canonicalOperationProjection";
import { canonicalizeHistoricalTrip, HistoricalClassification, historicalSchemaContractTable } from "./historicalTripCanonicalizer";
import { reconstructOperationHistoricalState } from "./operationHistoricalReconstructor";

type Data = Record<string, any>;
export type CanonicalProductionAudit = {
  generatedAt: string;
  dryRun: true;
  auditorVersion: "historical-canonicalizer-v3";
  totalOperations: number;
  consistentOperations: number;
  inconsistentOperations: number;
  totals: Record<string, number>;
  schemaGenerations: Record<string, number>;
  classificationReasons: Record<string, number>;
  reconstructionTotals: Record<string, number>;
  schemaContracts: ReturnType<typeof historicalSchemaContractTable>;
  operations: Array<Record<string, any>>;
};
const operationId = (row: Data, id = "") => field(row, "operationId", "jobId", "trabalhoId", "id") || id;
const tripId = (row: Data, id = "") => field(row, "canonicalTripId", "tripId", "deterministicTripId", "idempotencyKey", "id") || id;
const key = (value: unknown) => String(value ?? "").trim();

function uniquePhysicalTrips(trips: readonly Data[]): Data[] {
  const seen = new Set<string>();
  return trips.map((trip, index) => ({ ...trip, __docId: trip.__docId || trip.id || `physical-${index}` })).filter((trip) => {
    const marker = String(trip.__docId);
    if (seen.has(marker)) return false;
    seen.add(marker);
    return Boolean(tripId(trip, marker));
  });
}

export function buildCanonicalProductionAudit(input: {
  operations: readonly (Data & { id?: string })[];
  trips: readonly (Data & { id?: string })[];
  claims?: readonly (Data & { id?: string })[];
}): CanonicalProductionAudit {
  const operations = input.operations.map((item) => ({ ...item, id: item.id || item.__docId || operationId(item) }));
  const trips = uniquePhysicalTrips(input.trips);
  const claims = (input.claims || []).map((claim, index) => ({ ...claim, __docId: claim.__docId || claim.id || `claim-${index}` }));
  const classifications = new Map<string, ReturnType<typeof canonicalizeHistoricalTrip>>();
  for (const trip of trips) classifications.set(String(trip.__docId), canonicalizeHistoricalTrip({ trip, operations, claims, allTrips: trips }));

  const allClassifications = Array.from(classifications.values());
  const totals: Record<string, number> = {
    physicalTrips: trips.length,
    classificationAttempts: trips.length,
    operationClassificationAttempts: 0,
    canonicalTrips: allClassifications.filter((item) => item.classification === "CANONICAL").length,
    legacyProven: allClassifications.filter((item) => item.classification === "LEGACY_PROVEN").length,
    legacyProbableNotSafe: allClassifications.filter((item) => item.classification === "LEGACY_PROBABLE_NOT_SAFE").length,
    legacyAmbiguous: allClassifications.filter((item) => item.classification === "LEGACY_AMBIGUOUS").length,
    legacyInvalid: allClassifications.filter((item) => item.classification === "LEGACY_INVALID").length,
    safeRepairCandidates: allClassifications.filter((item) => item.safeToAutoRepair).length,
  };
  const reconstructionTotals: Record<string, number> = {
    countSafe: 0, slotSafe: 0, terminalSafe: 0, migrationSafe: 0,
    explicitSlots: 0, derivedSlots: 0, unresolvedSlots: 0, slotConflicts: 0,
    exactDuplicates: 0, probableDuplicates: 0, unresolvedDuplicates: 0,
    requiredTripsProven: 0, requiredTripsMissing: 0, requiredTripsConflict: 0, requiredTripsInvalid: 0,
    canonicalProgressGreaterThanStored: 0, canonicalProgressLessThanStored: 0, canonicalProgressEqualStored: 0,
    canonicalProgressGreaterThanRequired: 0, canonicalProgressEqualRequired: 0, canonicalProgressLessThanRequired: 0,
    operationsWithMoreTripsThanRequired: 0, operationsWithStoredProgressAboveCanonical: 0,
  };
  const rows: Array<Record<string, any>> = [];
  let consistentOperations = 0;

  for (const rawOperation of operations) {
    const operation: Data = { ...rawOperation, id: rawOperation.id || operationId(rawOperation) };
    const id = operationId(operation, key(rawOperation.id));
    if (!id) continue;
    const scopedTrips = trips.filter((trip) => {
      // Production audit is deliberately conservative: a row without the
      // physical jobId is reported as unbound elsewhere, never attributed to
      // this operation from driver/contract/time similarity.
      return field(trip, "jobId") === id;
    });
    const scopedClaims = claims.filter((claim) => field(claim, "jobId") === id);
    const projection = buildCanonicalOperationProjection({ physicalJobId: id, operation: { ...operation, id }, confirmedHistory: scopedTrips.map((trip, index) => ({ id: String(trip.id || trip.tripId || index), data: trip })) });
    const scoped = scopedTrips.map((trip) => classifications.get(String(trip.__docId))).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const count = (classification: HistoricalClassification) => scoped.filter((item) => item.classification === classification).length;
    const canonicalCount = count("CANONICAL");
    const provenLegacyCount = count("LEGACY_PROVEN");
    const ambiguousCount = count("LEGACY_AMBIGUOUS");
    const invalidCount = count("LEGACY_INVALID");
    const probableCount = count("LEGACY_PROBABLE_NOT_SAFE");
    const reconstruction = reconstructOperationHistoricalState({
      operation,
      canonicalTrips: scopedTrips.filter((trip) => classifications.get(String(trip.__docId))?.classification === "CANONICAL"),
      legacyProvenTrips: scopedTrips.filter((trip) => classifications.get(String(trip.__docId))?.classification === "LEGACY_PROVEN"),
      slotClaims: scopedClaims,
      allScopedTrips: scopedTrips,
      classificationByTripId: new Map(scopedTrips.map((trip) => [tripId(trip, String(trip.__docId)), classifications.get(String(trip.__docId))?.classification || ""])),
    });
    const requiredTrips = reconstruction.requiredTrips;
    const storedProgress = Number.isInteger(Number(operation.progress)) ? Number(operation.progress) : null;
    const pointer = key(operation.lastTripId || operation.lastValidatedTripId || operation.activeTrip || operation.currentTrip);
    const pointerProblems = pointer ? !projection.confirmedTripIds.includes(pointer) : false;
    const projectedStatus = reconstruction.terminalState === "COMPLETED_CANDIDATE" ? "COMPLETED" : reconstruction.terminalState === "INCOMPLETE" ? "INCOMPLETE" : reconstruction.terminalState;
    const consistent = storedProgress === reconstruction.projectedProgress && !pointerProblems && reconstruction.gates.countSafe && reconstruction.gates.terminalSafe && reconstruction.gates.slotSafe && ambiguousCount === 0 && invalidCount === 0 && probableCount === 0;
    if (consistent) consistentOperations += 1;

    for (const [name, passed] of Object.entries(reconstruction.gates)) if (passed) reconstructionTotals[name === "countSafe" ? "countSafe" : name === "slotSafe" ? "slotSafe" : name === "terminalSafe" ? "terminalSafe" : "migrationSafe"] += 1;
    reconstructionTotals.explicitSlots += reconstruction.explicitSlots;
    reconstructionTotals.derivedSlots += reconstruction.derivedSlots;
    reconstructionTotals.unresolvedSlots += reconstruction.unresolvedSlots;
    reconstructionTotals.slotConflicts += reconstruction.trips.filter((trip) => trip.slotClassification === "SLOT_CONFLICT").length;
    reconstructionTotals.exactDuplicates += reconstruction.exactDuplicates;
    reconstructionTotals.probableDuplicates += reconstruction.probableDuplicates;
    reconstructionTotals.unresolvedDuplicates += reconstruction.unresolvedDuplicates;
    const reqKey = reconstruction.requiredTripsClassification.replace("REQUIRED_TRIPS_", "requiredTrips").replace("PROVEN", "Proven").replace("MISSING", "Missing").replace("CONFLICT", "Conflict").replace("INVALID", "Invalid");
    if (reqKey in reconstructionTotals) reconstructionTotals[reqKey] += 1;
    if (storedProgress !== null) {
      if (reconstruction.projectedProgress > storedProgress) reconstructionTotals.canonicalProgressGreaterThanStored += 1;
      else if (reconstruction.projectedProgress < storedProgress) { reconstructionTotals.canonicalProgressLessThanStored += 1; reconstructionTotals.operationsWithStoredProgressAboveCanonical += 1; }
      else reconstructionTotals.canonicalProgressEqualStored += 1;
    }
    if (requiredTrips !== null) {
      if (reconstruction.projectedProgress > requiredTrips) { reconstructionTotals.canonicalProgressGreaterThanRequired += 1; reconstructionTotals.operationsWithMoreTripsThanRequired += 1; }
      else if (reconstruction.projectedProgress === requiredTrips) reconstructionTotals.canonicalProgressEqualRequired += 1;
      else reconstructionTotals.canonicalProgressLessThanRequired += 1;
    }
    totals.operations = (totals.operations || 0) + 1;
    totals.operationClassificationAttempts += scoped.length;
    rows.push({
      operationId: id,
      requiredTrips,
      requiredTripsClassification: reconstruction.requiredTripsClassification,
      storedProgress,
      provenPhysicalTrips: reconstruction.provenTrips,
      canonicalCount,
      historicallyProvenLegacyCount: provenLegacyCount,
      legacyProbableNotSafeCount: probableCount,
      ambiguousCount,
      invalidCount,
      exactDuplicates: reconstruction.exactDuplicates,
      probableDuplicates: reconstruction.probableDuplicates,
      unresolvedDuplicates: reconstruction.unresolvedDuplicates,
      physicalTripCount: scopedTrips.length,
      classificationAttempts: scoped.length,
      explicitSlots: reconstruction.explicitSlots,
      derivedSlots: reconstruction.derivedSlots,
      deterministicSlots: reconstruction.deterministicSlots,
      unresolvedSlots: reconstruction.unresolvedSlots,
      slotConflicts: reconstruction.trips.filter((trip) => trip.slotClassification === "SLOT_CONFLICT").length,
      canonicalProgress: reconstruction.projectedProgress,
      projectedProgress: reconstruction.projectedProgress,
      projectedStatus,
      currentStatus: key(operation.status),
      terminalState: reconstruction.terminalState,
      reconstructionConfidence: reconstruction.reconstructionConfidence,
      migrationEligibility: reconstruction.gates.migrationSafe ? "C4_MIGRATION_SAFE" : "BLOCKED",
      gates: reconstruction.gates,
      pointerProblems: pointer ? [pointer] : [],
      blockingReasons: [...reconstruction.blockingReasons, ...(pointerProblems ? ["current pointer is not a proven trip"] : [])],
      expectedProgressAfterRepair: reconstruction.projectedProgress,
      expectedStatusAfterRepair: projectedStatus,
      safeToAutoRepair: reconstruction.gates.migrationSafe,
      consistent,
    });
  }
  const schemaGenerations: Record<string, number> = {};
  const classificationReasons: Record<string, number> = {};
  allClassifications.forEach((item) => { schemaGenerations[item.schemaGeneration] = (schemaGenerations[item.schemaGeneration] || 0) + 1; classificationReasons[item.historicalValidationReason] = (classificationReasons[item.historicalValidationReason] || 0) + 1; });
  return { generatedAt: new Date().toISOString(), dryRun: true, auditorVersion: "historical-canonicalizer-v3", totalOperations: rows.length, consistentOperations, inconsistentOperations: rows.length - consistentOperations, totals, schemaGenerations, classificationReasons, reconstructionTotals, schemaContracts: historicalSchemaContractTable(), operations: rows };
}
