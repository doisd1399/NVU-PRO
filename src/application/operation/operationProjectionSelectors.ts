import {
  buildOperationProjection,
  type CanonicalOperationProjection,
} from "./OperationProjectionEngine";
import { resolveOperationalIdentity } from "../../domain/operation/OperationalIdentity";
import type { CanonicalTrip } from "../../domain/trip/CanonicalTrip";

const text = (value: unknown): string => String(value ?? "").trim();

/**
 * Builds the same operation projection for every Web/Admin surface. The job
 * document may be included only as metadata and a stale-projection hint; it is
 * never used as the operational count or limit authority.
 */
export function buildClientOperationProjection(
  operation: unknown,
  confirmedHistory: readonly unknown[],
): CanonicalOperationProjection | null {
  if (!operation || typeof operation !== "object") return null;
  const source = operation as Record<string, unknown>;
  try {
    const identity = resolveOperationalIdentity({
      ...source,
      operationId: source.operationId || source.jobId || source.id,
    });
    if (!identity.operationId || !identity.driverId || !identity.companyId || !identity.contractId) {
      return null;
    }
    return buildOperationProjection({
      identity,
      operation: {
        ...source,
        operationId: identity.operationId,
        driverId: identity.driverId,
        companyId: identity.companyId,
        contractId: identity.contractId,
      },
      confirmedHistory: confirmedHistory as CanonicalTrip[],
      projectionHints: { progress: source.progress },
    });
  } catch {
    return null;
  }
}

export function confirmedTripCountForOperation(
  operation: Record<string, unknown> | null | undefined,
  confirmedHistory: readonly unknown[],
): number {
  return buildClientOperationProjection(operation, confirmedHistory)?.confirmedTripCount ?? 0;
}

export function operationProjectionKey(operation: Record<string, unknown> | null | undefined): string {
  return [
    text(operation?.operationId || operation?.jobId || operation?.id),
    text(operation?.driverId || operation?.motoristaId || operation?.userId),
    text(operation?.companyId || operation?.empresaId),
    text(operation?.contractId || operation?.contratoId),
  ].join("|");
}
