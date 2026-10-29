import type { CanonicalTrip } from "../domain/trip/CanonicalTrip";
import { TripRegistrationService } from "../application/trip/TripRegistrationService";
import { isTrustedServerConfirmedTrip } from "../../functions/src/isCanonicalConfirmedTrip";
import { getTripMetricAssessment } from "./tripMetricPolicy";
import { tripMatchesReadScope } from "./tripReadScope";
import { isTripTombstoned } from "./tripTombstones";
import type { HistoryReadEvidence } from "./historyReadEvidence";
export type HistoryReadAssessment = {
  eligibleRows: number;
  excludedRows: number;
  deletedOrCanceledRows: number;
  missingDateRows: number;
  notCompletedRows: number;
  identityConflictRows: number;
  pendingWriteRows: number;
  locallyHiddenRows: number;
};
type ReadScope = { driverId?: string; companyId?: string; companyIds?: string[] };
const clean = (value: unknown) => String(value ?? "").trim();

export function normalizeHistoryReadDocument(
  physicalId: string, data: Record<string, unknown>,
  metadata: { fromCache: boolean; hasPendingWrites: boolean },
): CanonicalTrip {
  const id = clean(physicalId);
  if (!id) throw new Error("HISTORICAL_TRIP_PHYSICAL_ID_REQUIRED");
  // Projections supplied by document payloads cannot assert SDK provenance.
  const input = { ...data, id, physicalDocumentId: id, historyReadEvidence: undefined,
    historyLocalCommandOnly: undefined } as Partial<CanonicalTrip>;
  const live = Boolean(clean(input.jobId)) && isTrustedServerConfirmedTrip(input as Record<string, unknown>);
  const trip = live ? TripRegistrationService.register(input) : TripRegistrationService.registerHistoricalRead(input);
  return { ...trip, id, physicalDocumentId: id, historyReadEvidence: {
    version: 1, collection: "historico_viagens", physicalDocumentId: id,
    transport: metadata.hasPendingWrites ? "pending" : metadata.fromCache ? "cache" : "server",
  } satisfies HistoryReadEvidence };
}

function hasIdentityConflict(trip: CanonicalTrip): boolean {
  return [[trip.companyId, trip.empresaId], [trip.driverId, trip.motoristaId]]
    .some(([a, b]) => clean(a) && clean(b) && clean(a) !== clean(b));
}

/**
 * One listener generation owns the exact union of its current query snapshots.
 * Replacing a source removes absent rows from this view without deleting a
 * command, writing an ACK, or mutating another reader's projection.
 */
export class ScopedHistoryReadProjection {
  private readonly sources = new Map<string, Map<string, CanonicalTrip>>();
  private readonly rejected = new Map<string, Set<string>>();

  replaceSource(source: string, documents: Array<{ id: string; data: Record<string, unknown>; hasPendingWrites?: boolean }>,
    metadata: { fromCache: boolean; hasPendingWrites: boolean }): number {
    const rows = new Map<string, CanonicalTrip>(), rejected = new Set<string>();
    for (const document of documents) {
      try { rows.set(document.id, normalizeHistoryReadDocument(document.id, document.data,
        { ...metadata, hasPendingWrites: document.hasPendingWrites ?? metadata.hasPendingWrites })); }
      catch { rejected.add(document.id); }
    }
    this.sources.set(source, rows);
    this.rejected.set(source, rejected);
    return rejected.size;
  }

  private union(): CanonicalTrip[] {
    const rows = new Map<string, CanonicalTrip>();
    const revision = (trip: CanonicalTrip) => Number(trip.syncVersion || 0) * 1e12 +
      (Date.parse(String(trip.updatedAt || trip.clientUpdatedAt || trip.createdAt || "")) || 0);
    for (const source of this.sources.values()) for (const [id, trip] of source) {
      const previous = rows.get(id);
      if (!previous || revision(trip) > revision(previous) ||
        (revision(trip) === revision(previous) && (trip.deleted === true ||
          (previous.historyReadEvidence as HistoryReadEvidence)?.transport !== "server"))) rows.set(id, trip);
    }
    return [...rows.values()];
  }

  list(scope: ReadScope): CanonicalTrip[] {
    return this.union().filter(trip => tripMatchesReadScope(trip, scope) && !hasIdentityConflict(trip) &&
      !isTripTombstoned(clean(trip.physicalDocumentId)) && trip.deleted !== true && trip.softDeleted !== true);
  }

  assess(scope: ReadScope): HistoryReadAssessment {
    const result: HistoryReadAssessment = { eligibleRows: 0, excludedRows: 0, deletedOrCanceledRows: 0,
      missingDateRows: 0, notCompletedRows: 0, identityConflictRows: 0, pendingWriteRows: 0, locallyHiddenRows: 0 };
    for (const trip of this.union()) {
      const assessment = getTripMetricAssessment(trip);
      let reason: keyof HistoryReadAssessment | undefined;
      if (!tripMatchesReadScope(trip, scope) || hasIdentityConflict(trip)) reason = "identityConflictRows";
      else if (assessment.deletedOrCanceled) reason = "deletedOrCanceledRows";
      else if (isTripTombstoned(clean(trip.physicalDocumentId))) reason = "locallyHiddenRows";
      else if ((trip.historyReadEvidence as HistoryReadEvidence).transport === "pending") reason = "pendingWriteRows";
      else if (!assessment.valid) reason = "missingDateRows";
      else if (!assessment.eligible) reason = "notCompletedRows";
      if (reason) { result.excludedRows++; result[reason]++; }
      else result.eligibleRows++;
    }
    return result;
  }

  getRejectedRows(): number { return new Set([...this.rejected.values()].flatMap(ids => [...ids])).size; }
}
