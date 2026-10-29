import { buildCanonicalProductionAudit } from "./canonicalProductionAudit";
import { resolveHistoricalRequiredTrips, buildShadowModeComparison, RequiredTripsProvenance } from "./historicalRequiredTripsResolver";

type Data = Record<string, any>;

export type CanonicalProductionAuditV4 = Omit<ReturnType<typeof buildCanonicalProductionAudit>, "auditorVersion" | "operations"> & {
  auditorVersion: "historical-required-trips-v4";
  operations: Array<Record<string, any>>;
  requiredTripsBefore: Record<string, number>;
  requiredTripsAfter: Record<RequiredTripsProvenance, number>;
  shadowMode: { authority: "canonical-future-only"; mutation: "none"; divergentOperations: number };
};

const idOf = (row: Data) => String(row.id ?? row.operationId ?? row.jobId ?? "").trim();

export function buildCanonicalProductionAuditV4(input: {
  operations: readonly Data[];
  trips: readonly Data[];
  claims?: readonly Data[];
  contracts?: readonly Data[];
}): CanonicalProductionAuditV4 {
  const base = buildCanonicalProductionAudit(input);
  const contracts = new Map((input.contracts || []).map((contract) => [idOf(contract), contract]));
  const after: Record<RequiredTripsProvenance, number> = { CURRENT_PROVEN: 0, LEGACY_PROVEN: 0, MULTISOURCE_PROVEN: 0, PROBABLE: 0, MISSING: 0, CONFLICT: 0, INVALID: 0 };
  const before: Record<string, number> = { PROVEN: 0, MISSING: 0 };
  let divergentOperations = 0;
  const operations = base.operations.map((row) => {
    const operation = input.operations.find((candidate) => idOf(candidate) === String(row.operationId)) || { id: row.operationId };
    const contractId = String(operation.contractId ?? operation.contratoId ?? "").trim();
    const resolution = resolveHistoricalRequiredTrips({ operation, contract: contracts.get(contractId), canonicalProgress: Number.isInteger(Number(row.canonicalProgress)) ? Number(row.canonicalProgress) : null });
    if (row.requiredTripsClassification === "REQUIRED_TRIPS_PROVEN") before.PROVEN += 1; else before.MISSING += 1;
    after[resolution.provenance] += 1;
    if (resolution.shadow.divergence !== null && resolution.shadow.divergence !== 0) divergentOperations += 1;
    const terminalState = resolution.value === null ? row.terminalState : row.canonicalProgress > resolution.value ? "CRITICAL_OVERFLOW" : row.canonicalProgress === resolution.value ? "COMPLETED_CANDIDATE" : "INCOMPLETE";
    const projectedStatus = terminalState === "COMPLETED_CANDIDATE" ? "COMPLETED" : terminalState === "INCOMPLETE" ? "INCOMPLETE" : terminalState;
    const requiredSafe = ["CURRENT_PROVEN", "LEGACY_PROVEN", "MULTISOURCE_PROVEN"].includes(resolution.provenance);
    const shadow = buildShadowModeComparison({ oldProgress: resolution.shadow.oldProgress, canonicalProgress: resolution.shadow.canonicalProgress, requiredTrips: resolution.value });
    return {
      ...row,
      requiredTrips: resolution.value,
      requiredTripsBefore: row.requiredTrips,
      requiredTripsClassification: resolution.provenance,
      evidenceReason: resolution.evidenceReason,
      requiredTripsSources: resolution.sources,
      terminalState,
      projectedStatus,
      expectedStatusAfterRepair: projectedStatus,
      shadowMode: shadow,
      gates: { ...row.gates, terminalSafe: row.gates.terminalSafe || requiredSafe && terminalState !== "CRITICAL_OVERFLOW", migrationSafe: row.gates.migrationSafe && requiredSafe },
      migrationEligibility: row.gates.migrationSafe && requiredSafe ? "C4_MIGRATION_SAFE" : "BLOCKED",
      blockingReasons: requiredSafe ? row.blockingReasons : [...row.blockingReasons, `requiredTrips ${resolution.provenance}: ${resolution.evidenceReason}`],
      safeToAutoRepair: row.gates.migrationSafe && requiredSafe,
    };
  });
  return { ...base, auditorVersion: "historical-required-trips-v4", operations, requiredTripsBefore: before, requiredTripsAfter: after, shadowMode: { authority: "canonical-future-only", mutation: "none", divergentOperations } };
}
