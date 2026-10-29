import { createHash } from "node:crypto";

type Data = Record<string, any>;
export type MigrationMode = "DRY_APPLY" | "APPLY";
export type MigrationClassification = "HISTORY_SAFE" | "ACTIVE_SAFE" | "COMPLETED_SAFE" | "MANUAL_REVIEW" | "BLOCKED" | "CRITICAL_OVERFLOW";

export type MigrationPlan = {
  operationId: string;
  operationIdHash: string;
  classification: MigrationClassification;
  before: Data;
  canonicalTruth: Data;
  proposedPatch: Data;
  writesRequired: boolean;
  preconditions: Data;
  postconditions: Data;
  rollbackPatch: Data;
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  blockers: string[];
  evidenceHash: string;
  beforeHash: string;
  expectedAfterHash: string;
  expectedAfter: Data;
};
export type MigrationDecision = MigrationPlan & {
  structuralClassification: MigrationClassification;
  eligible: boolean;
  migrationBlockers: string[];
  divergenceClass: string | null;
  patchHash: string;
};

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value, Object.keys(value as object || {}).sort())).digest("hex");
const clean = (v: unknown) => String(v ?? "").trim();

function classificationFor(row: Data): MigrationClassification {
  if (row.terminalState === "CRITICAL_OVERFLOW" || row.canonicalProgress > row.requiredTrips && row.requiredTrips !== null) return "CRITICAL_OVERFLOW";
  if (["MISSING", "CONFLICT", "INVALID", "PROBABLE"].includes(String(row.requiredTripsClassification))) return "BLOCKED";
  if (row.requiredTrips === null || row.requiredTrips === undefined) return "BLOCKED";
  const blockers = (Array.isArray(row.blockingReasons) ? row.blockingReasons : []).filter((reason: unknown) => !String(reason).startsWith("REQUIRED_TRIPS_") && !String(reason).startsWith("no totalDeliveries/requiredTrips"));
  if (blockers.length || row.ambiguousCount > 0 || row.invalidCount > 0 || row.probableCount > 0 || row.unresolvedSlots > 0 && row.currentStatus === "active") return "MANUAL_REVIEW";
  if (row.canonicalProgress === row.requiredTrips) return "COMPLETED_SAFE";
  const active = ["active", "pending", "delayed", "awaiting_completion", "in_progress"].includes(clean(row.currentStatus).toLowerCase());
  if (active && row.canonicalProgress < row.requiredTrips && row.reconstructionConfidence !== "UNRESOLVED") return "ACTIVE_SAFE";
  return "HISTORY_SAFE";
}

export function planCanonicalMigration(row: Data): MigrationPlan {
  const operationId = clean(row.operationId);
  const classification = classificationFor(row);
  const before = { progress: row.storedProgress, status: row.currentStatus, requiredTrips: row.requiredTripsBefore ?? row.requiredTrips, operationReconciliationVersion: row.operationReconciliationVersion ?? null, operationProjectionSource: row.operationProjectionSource ?? null };
  const canonicalTruth = { canonicalProgress: row.canonicalProgress, requiredTrips: row.requiredTrips, projectedStatus: row.projectedStatus, reconstructionConfidence: row.reconstructionConfidence, evidenceReason: row.evidenceReason ?? null };
  const blockers = [...(row.blockingReasons || [])].filter((reason) => !String(reason).startsWith("REQUIRED_TRIPS_") && !String(reason).startsWith("no totalDeliveries/requiredTrips"));
  if (classification === "BLOCKED") blockers.push("requiredTrips is not proven");
  if (classification === "CRITICAL_OVERFLOW") blockers.push("canonicalProgress exceeds requiredTrips; no clamp or exclusion allowed");
  if (classification === "MANUAL_REVIEW") blockers.push("evidence requires human review before any APPLY");
  const proposedPatch: Data = {};
  if (["HISTORY_SAFE", "ACTIVE_SAFE", "COMPLETED_SAFE"].includes(classification)) {
    if (row.storedProgress !== row.canonicalProgress) proposedPatch.progress = row.canonicalProgress;
    if (row.requiredTripsBefore !== row.requiredTrips) proposedPatch.requiredTrips = row.requiredTrips;
    if (classification === "COMPLETED_SAFE" && clean(row.currentStatus).toLowerCase() !== "completed") {
      proposedPatch.status = "completed";
      proposedPatch.operationCompletedByCanonicalGateway = true;
      proposedPatch.completionSource = "canonical-migration-planner-v5";
    }
    if (Object.keys(proposedPatch).length) {
      proposedPatch.operationProjectionSource = "canonical-migration-planner-v5";
      proposedPatch.operationReconciliationVersion = 5;
    }
  }
  const expectedAfter = { ...before, ...proposedPatch };
  const rollbackPatch: Data = {};
  const beforeData = before as Data;
  for (const key of Object.keys(proposedPatch)) rollbackPatch[key] = beforeData[key] ?? null;
  const preconditions = { beforeHash: hash(before), storedProgress: row.storedProgress, storedStatus: row.currentStatus, requiredTrips: row.requiredTrips, expectedVersion: row.operationReconciliationVersion ?? null, noNewCanonicalTrip: true };
  const postconditions = { progress: row.canonicalProgress, requiredTrips: row.requiredTrips, status: classification === "COMPLETED_SAFE" ? "completed" : row.currentStatus, noHistoricalTimestampChanges: true };
  const risk = classification === "COMPLETED_SAFE" ? "MEDIUM" : classification === "ACTIVE_SAFE" ? "LOW" : classification === "HISTORY_SAFE" ? "LOW" : classification === "CRITICAL_OVERFLOW" ? "CRITICAL" : "HIGH";
  const evidenceHash = hash({ operationId, canonicalTruth, classification, blockers });
  return { operationId, operationIdHash: hash(operationId), classification, before, canonicalTruth, proposedPatch, writesRequired: Object.keys(proposedPatch).length > 0, preconditions, postconditions, rollbackPatch, risk, blockers, evidenceHash, beforeHash: hash(before), expectedAfterHash: hash(expectedAfter), expectedAfter };
}

export function executeCanonicalMigration(input: { mode: MigrationMode; plans: readonly MigrationPlan[]; currentRows?: ReadonlyMap<string, Data>; approvedManifest?: boolean; migrationId?: string }) {
  if (input.mode === "APPLY") throw new Error("APPLY_BLOCKED_PHASE_5");
  const rows = new Map<string, Data>(input.currentRows ? [...input.currentRows.entries()].map(([id, row]) => [id, { ...row }]) : []);
  const results = input.plans.map((plan) => {
    const current = rows.get(plan.operationId) || plan.before;
    const currentHash = hash({ progress: current.progress, status: current.status, requiredTrips: current.requiredTrips, operationReconciliationVersion: current.operationReconciliationVersion ?? null, operationProjectionSource: current.operationProjectionSource ?? null });
    const preconditionOk = currentHash === plan.beforeHash;
    const expectedHash = hash({ ...plan.before, ...plan.proposedPatch });
    if (currentHash === expectedHash) return { operationId: plan.operationId, result: "NO_OP", writes: 0 } as const;
    if (!preconditionOk) return { operationId: plan.operationId, result: "ABORT_PRECONDITION_MISMATCH", writes: 0 } as const;
    if (!plan.writesRequired) return { operationId: plan.operationId, result: "NO_OP", writes: 0 } as const;
    const after = { ...current, ...plan.proposedPatch };
    rows.set(plan.operationId, after);
    return { operationId: plan.operationId, result: "SIMULATED", writes: 1, afterHash: hash(after) } as const;
  });
  return { mode: input.mode, mutation: "none", results, rows };
}

export function buildMigrationDecision(plan: MigrationPlan, row: Data): MigrationDecision {
  const difference = row.shadowMode?.divergence;
  const divergenceClass = difference === undefined || difference === null || difference === 0
    ? null
    : row.requiredTripsClassification === "MISSING" || row.requiredTripsClassification === "CONFLICT" || row.requiredTripsClassification === "INVALID"
      ? "LEGACY_ASSOCIATION_PROBLEM"
      : row.invalidCount > 0 || row.ambiguousCount > 0 ? "CANONICAL_DATA_PROBLEM"
        : Number(difference) > 0 ? "OLD_PROGRESS_UNDERCOUNT" : "OLD_PROGRESS_GHOST";
  const migrationBlockers = [...plan.blockers];
  if (!divergenceClass) migrationBlockers.push("no certified divergence candidate");
  if (divergenceClass && !["OLD_PROGRESS_GHOST", "OLD_PROGRESS_UNDERCOUNT"].includes(divergenceClass)) migrationBlockers.push("divergence class requires manual review");
  const eligible = ["HISTORY_SAFE", "ACTIVE_SAFE", "COMPLETED_SAFE"].includes(plan.classification) && migrationBlockers.length === 0 && plan.writesRequired;
  return { ...plan, structuralClassification: plan.classification, eligible, migrationBlockers, divergenceClass, patchHash: hash(plan.proposedPatch) };
}

export const migrationPlanHash = hash;
