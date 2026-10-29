import { canonicalTripField, isTrustedServerConfirmedTrip } from "./isCanonicalConfirmedTrip";

type Data = Record<string, any>;

export type LegacyAttributionResult = {
  ownerOperationId: string;
  matchingOperationIds: string[];
  ambiguous: boolean;
};

const text = (value: unknown): string => String(value ?? "").trim();

export function timestampMillis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof (value as any)?.toMillis === "function") {
    const millis = Number((value as any).toMillis());
    return Number.isFinite(millis) ? millis : 0;
  }
  if (typeof (value as any)?.toDate === "function") {
    const date = (value as any).toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.getTime() : 0;
  }
  if (typeof (value as any)?.seconds === "number") {
    const millis = Number((value as any).seconds) * 1000 + Number((value as any).nanoseconds || 0) / 1e6;
    return Number.isFinite(millis) ? millis : 0;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function legacyTripMetricMillis(trip: Data): number {
  for (const candidate of [
    trip.completedAt,
    trip.completedAtLocal,
    trip.dataFechamento,
    trip.dataLancamento,
    trip.serverValidatedAt,
    trip.uploadedAt,
    trip.createdAt,
    trip.createdAtLocal,
  ]) {
    const millis = timestampMillis(candidate);
    if (millis > 0) return millis;
  }
  return 0;
}

export function operationIdOf(row: Data): string {
  return canonicalTripField(row, "operationId", "jobId", "trabalhoId", "id");
}

export function tripOperationIdOf(row: Data): string {
  return canonicalTripField(row, "jobId", "operationId", "trabalhoId");
}

export function hasExplicitOperationBinding(trip: Data): boolean {
  return Boolean(tripOperationIdOf(trip));
}

function operationWindow(operation: Data): { start: number; end: number } | null {
  const start = timestampMillis(
    operation.startedAt || operation.assignedAt || operation.acceptedAt || operation.createdAt,
  );
  if (!start) return null;

  const status = text(operation.status).toLowerCase();
  const closed = ["completed", "cancelled", "canceled", "finalizado", "finalizada"].includes(status);
  const explicitEnd = timestampMillis(
    operation.completedAt || operation.cancelledAt || operation.canceledAt || operation.closedAt,
  );
  const end = explicitEnd > 0
    ? explicitEnd
    : closed
      ? timestampMillis(operation.updatedAt) || start
      : Number.POSITIVE_INFINITY;
  return { start, end: Math.max(start, end) };
}

/**
 * Legacy rows created before jobId became mandatory may be attributed only
 * when driver+contract+time identify exactly one operation. An explicit link
 * to another operation is never overridden.
 */
export function legacyTripMatchesOperation(trip: Data, operation: Data): boolean {
  if (hasExplicitOperationBinding(trip)) return false;
  if (!isTrustedServerConfirmedTrip(trip)) return false;

  const operationId = operationIdOf(operation);
  if (!operationId) return false;

  const operationDriver = canonicalTripField(operation, "driverId", "motoristaId", "userId");
  const tripDriver = canonicalTripField(trip, "driverId", "motoristaId", "userId", "criadoPor");
  if (!operationDriver || !tripDriver || operationDriver !== tripDriver) return false;

  // Contract is mandatory for a safe legacy attribution. Company may be absent
  // on old server rows; when present it must agree.
  const operationContract = canonicalTripField(operation, "contractId", "contratoId");
  const tripContract = canonicalTripField(trip, "contractId", "contratoId");
  if (!operationContract || !tripContract || operationContract !== tripContract) return false;

  const operationCompany = canonicalTripField(operation, "companyId", "empresaId");
  const tripCompany = canonicalTripField(trip, "companyId", "empresaId");
  if (tripCompany && operationCompany && tripCompany !== operationCompany) return false;

  const time = legacyTripMetricMillis(trip);
  const window = operationWindow(operation);
  if (!time || !window) return false;
  return time >= window.start && time <= window.end;
}

export function resolveLegacyOperationAttribution(
  trip: Data,
  operations: readonly Data[],
): LegacyAttributionResult {
  if (hasExplicitOperationBinding(trip)) {
    return { ownerOperationId: "", matchingOperationIds: [], ambiguous: false };
  }
  const matchingOperationIds = Array.from(new Set(
    operations
      .filter((operation) => legacyTripMatchesOperation(trip, operation))
      .map((operation) => operationIdOf(operation))
      .filter(Boolean),
  ));
  return {
    ownerOperationId: matchingOperationIds.length === 1 ? matchingOperationIds[0] : "",
    matchingOperationIds,
    ambiguous: matchingOperationIds.length > 1,
  };
}
