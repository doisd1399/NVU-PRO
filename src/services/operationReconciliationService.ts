import type { CanonicalTrip } from "../domain/trip/CanonicalTrip";
import { normalizeCanonicalOperation, operationIdentityOf, type CanonicalOperation } from "../domain/operation/CanonicalOperation";
import { canonicalTripRepository } from "../repositories/CanonicalTripRepository";
import { clearActiveOperationSnapshot } from "../lib/activeOperationSnapshot";
import { buildOperationProjection } from "../application/operation/OperationProjectionEngine";
import { normalizeTrip } from "../lib/tripNormalizer";
import { isCanonicalConfirmedTrip } from "../../functions/src/isCanonicalConfirmedTrip";

export type OperationProjection = CanonicalOperation & {
  projectionVersion: 2;
  generatedAt: string;
  tripIds: string[];
  confirmedProgress: number;
  pendingProgress: number;
  progress: number;
  status: string;
  closed: boolean;
  readyToFinalize: boolean;
  sourceStatus: string;
};

const STORAGE_KEY = "nvu.canonical.operation-projections.v2";
const projections = new Map<string, OperationProjection>();
let hydrated = false;
const clean = (value: unknown) => String(value ?? "").trim();

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  const target = storage();
  if (!target) return;
  try {
    const raw = target.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    Object.values(parsed as Record<string, unknown>).forEach((value) => {
      if (!value || typeof value !== "object") return;
      const projection = value as OperationProjection;
      if (projection.projectionVersion !== 2) return;
      try {
        const operation = normalizeCanonicalOperation(projection);
        projections.set(operationIdentityOf(operation), projection);
      } catch { /* invalid old artifact is ignored */ }
    });
  } catch {
    target.removeItem(STORAGE_KEY);
  }
}

function persist(): void {
  const target = storage();
  if (!target) return;
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(projections.entries())));
  } catch { /* projection is reconstructible from the repository */ }
}

function tripMatchesOperation(trip: CanonicalTrip, operation: CanonicalOperation): boolean {
  if (clean(trip.jobId) !== operation.operationId) return false;
  if (clean(trip.driverId) !== operation.driverId) return false;
  if (clean(trip.companyId) !== operation.companyId) return false;
  if (clean(trip.contractId) !== operation.contractId) return false;
  const simulatorId = clean(trip.simulatorId);
  return !simulatorId || simulatorId === "unknown" || simulatorId === operation.simulatorId;
}

/**
 * One operation projection for both web Print and Pro. It intentionally counts
 * pending trips separately; only confirmed, distinct trips advance progress.
 * Target readiness and manual lifecycle completion are separate states.
 */
export class OperationReconciliationService {
  registerOperation(input: Record<string, unknown>): CanonicalOperation {
    hydrate();
    const operation = normalizeCanonicalOperation(input);
    const current = projections.get(operationIdentityOf(operation));
    if (!current) {
      this.rebuild(operation);
    }
    return operation;
  }

  rebuild(input: Record<string, unknown> | CanonicalOperation): OperationProjection {
    hydrate();
    const operation = normalizeCanonicalOperation(input as Record<string, unknown>);
    const trips = canonicalTripRepository.list().filter((trip) => tripMatchesOperation(trip, operation));
    const validated = trips.filter((trip) => isCanonicalConfirmedTrip(trip, {
      operationId: operation.operationId, driverId: operation.driverId,
      companyId: operation.companyId, contractId: operation.contractId,
    }) && normalizeTrip(trip as any).isValid);
    const canonical = buildOperationProjection({
      identity: { uid: operation.driverId, ...operation },
      operation,
      confirmedHistory: validated,
    });
    const tripIds = canonical.confirmedTripIds;
    const confirmedProgress = canonical.confirmedTripCount;
    const pendingProgress = trips.filter((trip) => !isCanonicalConfirmedTrip(trip, {
      operationId: operation.operationId, driverId: operation.driverId,
      companyId: operation.companyId, contractId: operation.contractId,
    }) && trip.status !== "DELETED").length;
    const progress = confirmedProgress;
    const totalDeliveries = Math.max(0, Number(operation.totalDeliveries || 0));
    const closed = canonical.status === "completed" || canonical.status === "cancelled";
    const projection: OperationProjection = {
      ...operation,
      projectionVersion: 2,
      generatedAt: new Date().toISOString(),
      tripIds,
      confirmedProgress,
      pendingProgress,
      progress: Math.min(progress, totalDeliveries || progress),
      status: canonical.status,
      closed,
      readyToFinalize: canonical.nextAllowedAction === "FINALIZE_OPERATION",
      sourceStatus: clean(operation.status || "active"),
    };
    const key = operationIdentityOf(operation);
    const current = projections.get(key);
    // Repeated reads must still see tombstones, but an unchanged ledger should
    // reuse its projection and avoid serializing every operation on each read.
    if (current && JSON.stringify({ ...current, generatedAt: "" }) ===
      JSON.stringify({ ...projection, generatedAt: "" })) return current;
    projections.set(key, projection);
    persist();
    return projection;
  }

  reconcileAfterTripChange(trip: CanonicalTrip, operation?: Record<string, unknown>): OperationProjection | null {
    hydrate();
    const previous = [...projections.values()].find((value) => tripMatchesOperation(trip, value));
    const candidate = operation || (previous && {
      ...previous,
      // Older v2 artifacts inferred completion from progress. Only the source
      // lifecycle captured by this implementation may preserve that status.
      status: previous.sourceStatus || "active",
    }) || {
      operationId: trip.jobId,
      driverId: trip.driverId,
      companyId: trip.companyId,
      simulatorId: trip.simulatorId || "unknown",
      contractId: trip.contractId,
      totalDeliveries: 0,
      status: "active",
    };
    try {
      return this.rebuild(candidate);
    } catch {
      return null;
    }
  }

  get(operation: Record<string, unknown> | CanonicalOperation): OperationProjection | null {
    hydrate();
    try {
      const normalized = normalizeCanonicalOperation(operation);
      // A stored projection is only an acceleration artifact. A deletion can
      // happen while this screen is unmounted, so derive from active trips.
      return this.rebuild(normalized);
    } catch {
      return null;
    }
  }

  invalidate(operationId?: string): void {
    hydrate();
    if (!operationId) projections.clear();
    else for (const [key, projection] of projections) if (projection.operationId === operationId) projections.delete(key);
    persist();
  }
}

export const operationReconciliationService = new OperationReconciliationService();

/** Backward-compatible event entry point used by CanonicalTripUpdateEvent. */
export function reconcileOperationProjection(trip: CanonicalTrip): void {
  const projection = operationReconciliationService.reconcileAfterTripChange(trip);
  if (typeof window === "undefined") return;
  clearActiveOperationSnapshot(trip.driverId, trip.companyId);
  window.dispatchEvent(new CustomEvent("nvu:operation-reconciliation-required", {
    detail: {
      tripId: trip.canonicalTripId || trip.tripId,
      operationId: trip.jobId || null,
      reason: trip.deleted ? "TRIP_DELETED" : "TRIP_UPDATED",
      projection,
    },
  }));
}

export function registerOperationReconciliationListener(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail || {};
    window.dispatchEvent(new CustomEvent("nvu:operation-projection-refresh-required", { detail }));
  };
  window.addEventListener("nvu:operation-reconciliation-required", handler);
  return () => window.removeEventListener("nvu:operation-reconciliation-required", handler);
}

export function getCurrentOperationProjection(operation: Record<string, unknown>): OperationProjection | null {
  return operationReconciliationService.get(operation);
}
