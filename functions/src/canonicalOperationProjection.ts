type Data = FirebaseFirestore.DocumentData;
import { isCanonicalConfirmedTrip } from "./isCanonicalConfirmedTrip";

export type CanonicalOperationTrip = {
  id: string;
  data: Data;
};

export type CanonicalOperationProjection = {
  operationId: string;
  driverId: string;
  companyId: string;
  contractId: string;
  totalDeliveries: number;
  confirmedTrips: CanonicalOperationTrip[];
  confirmedTripIds: string[];
  confirmedTripCount: number;
  remainingTrips: number;
  nextSlot: number;
};

const text = (value: unknown): string => String(value ?? "").trim();

export const field = (row: Data, ...keys: string[]): string => {
  for (const key of keys) {
    const value = text(row[key]);
    if (value) return value;
  }
  return "";
};

export const active = (row: Data): boolean =>
  row.deleted !== true && row.softDeleted !== true &&
  row.status !== "DELETED" && row.cancelado !== true;

export const matchesOperationScope = (row: Data, operation: Data, physicalJobId: string): boolean => {
  const operationId = text(physicalJobId);
  const driverId = field(operation, "driverId", "motoristaId", "userId");
  const linkedToOperation = field(row, "jobId") === operationId;
  const linkedToDriver = field(row, "driverId", "motoristaId", "userId", "criadoPor") === driverId;
  if (!linkedToOperation || !linkedToDriver) return false;
  return isCanonicalConfirmedTrip(row, {
    operationId,
    driverId,
    companyId: field(operation, "companyId", "empresaId"),
    contractId: field(operation, "contractId", "contratoId"),
  });
};

export const operationTripId = (row: Data, fallback = ""): string =>
  field(row, "canonicalTripId", "tripId", "idempotencyKey", "id") || fallback;

export function buildCanonicalOperationProjection(input: {
  operation: Data;
  physicalJobId: string;
  confirmedHistory: readonly CanonicalOperationTrip[];
}): CanonicalOperationProjection {
  const { operation, confirmedHistory } = input;
  // LIVE authority is the physical trabalhos/{jobId} document id supplied by the caller.
  // Never derive operational scope from mutable/legacy payload aliases.
  const operationId = text(input.physicalJobId);
  const driverId = field(operation, "driverId", "motoristaId", "userId");
  const companyId = field(operation, "companyId", "empresaId");
  const contractId = field(operation, "contractId", "contratoId");
  if (!operationId || !driverId || !companyId || !contractId) {
    throw new Error("CANONICAL_OPERATION_REQUIRED_FIELDS_MISSING");
  }

  const unique = new Map<string, CanonicalOperationTrip>();
  for (const entry of confirmedHistory) {
    const data = entry.data || {};
    const id = operationTripId(data, entry.id);
    if (!id || !isCanonicalConfirmedTrip(data, {
      operationId,
      driverId,
      companyId,
      contractId,
    })) continue;
    unique.set(id, { id, data });
  }

  const confirmedTrips = [...unique.values()];
  const confirmedTripCount = confirmedTrips.length;
  const totalDeliveries = Math.max(0, Number(operation.totalDeliveries || 0));
  return {
    operationId,
    driverId,
    companyId,
    contractId,
    totalDeliveries,
    confirmedTrips,
    confirmedTripIds: confirmedTrips.map((trip) => trip.id),
    confirmedTripCount,
    remainingTrips: totalDeliveries > 0 ? Math.max(0, totalDeliveries - confirmedTripCount) : 0,
    nextSlot: confirmedTripCount + 1,
  };
}

export function latestConfirmedTripId(projection: CanonicalOperationProjection): string {
  const timestamp = (value: unknown): number => {
    if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
      const millis = (value as { toMillis: () => number }).toMillis();
      return Number.isFinite(millis) ? millis : 0;
    }
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return projection.confirmedTrips.slice().sort((left, right) => {
    const rightSlot = Number(right.data.operationSlot);
    const leftSlot = Number(left.data.operationSlot);
    if (Number.isFinite(rightSlot) && Number.isFinite(leftSlot) && rightSlot !== leftSlot) {
      return rightSlot - leftSlot;
    }
    const rightTime = timestamp(right.data.completedAt || right.data.dataFechamento || right.data.dataLancamento || right.data.createdAt);
    const leftTime = timestamp(left.data.completedAt || left.data.dataFechamento || left.data.dataLancamento || left.data.createdAt);
    return rightTime - leftTime || right.id.localeCompare(left.id);
  })[0]?.id || "";
}
