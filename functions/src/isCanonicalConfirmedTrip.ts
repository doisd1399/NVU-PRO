export type CanonicalConfirmationScope = {
  operationId: string;
  driverId: string;
  companyId: string;
  contractId: string;
};

type Data = Record<string, unknown>;

const text = (value: unknown): string => String(value ?? "").trim();
const field = (row: Data, ...keys: string[]): string => {
  for (const key of keys) {
    const value = text(row[key]);
    if (value) return value;
  }
  return "";
};

const confirmedStatuses = new Set([
  "concluida", "concluido", "completed", "finalizado", "finalizada",
  "entregue", "server_confirmed", "history_confirmed",
]);
const pendingLifecycleStatuses = new Set([
  "pending_sync", "syncing", "created", "captured", "registered_local",
  "pending", "awaiting_connection", "uploading", "server_received",
  "validation_pending", "pending_validation", "validation_failed", "failed",
]);
const trustedLegacyServerSources = new Set([
  "gto_auto", "simple_auto",
]);
const trustedSyncedStates = new Set([
  "synced", "validated", "server_confirmed", "history_confirmed",
]);

export const canonicalTripField = field;

/**
 * Server proof independent from operation scope.
 *
 * There are three server-confirmed historical shapes in production:
 * 1. current rows with serverValidatedAt;
 * 2. sync-adapter rows with serverUpdatedAt + synced state;
 * 3. old server GTO rows with source=gto_auto/simple_auto + uploadedAt.
 *
 * This helper intentionally does not accept a bare client status or bare
 * uploadedAt from an arbitrary source. Operation and driver scope are checked
 * separately by isCanonicalConfirmedTrip().
 */
export function isTrustedServerConfirmedTrip(trip: Data): boolean {
  if (trip.deleted === true || trip.softDeleted === true || trip.cancelado === true) return false;
  const status = text(trip.recordStatus || trip.status).toLowerCase();
  const lifecycle = text(trip.status).toLowerCase();
  if (pendingLifecycleStatuses.has(lifecycle)) return false;
  if (lifecycle === "deleted" || !confirmedStatuses.has(status)) return false;

  const syncStatus = text(trip.offlineSyncStatus || trip.syncStatus || trip.validationStatus).toLowerCase();
  if (pendingLifecycleStatuses.has(syncStatus)) return false;

  if (trip.serverValidatedAt != null) return true;
  if (trip.serverUpdatedAt != null && trustedSyncedStates.has(syncStatus)) return true;

  const source = text(trip.source).toLowerCase();
  return trustedLegacyServerSources.has(source) && trip.uploadedAt != null;
}

/**
 * The only business predicate that can confirm an operational trip.
 *
 * Identity and immutable operation binding are mandatory. Company/contract
 * aliases are optional only for old server-created rows; when present they must
 * agree with the operation. Transport markers by themselves never override a
 * scope mismatch.
 */
export function isCanonicalConfirmedTrip(
  trip: Data,
  scope: CanonicalConfirmationScope,
): boolean {
  if (!isTrustedServerConfirmedTrip(trip)) return false;

  // Operational ownership is the physical job binding. operationId and
  // trabalhoId are compatibility aliases only after a real jobId exists; they
  // must never attach an unbound/legacy row to the current execution.
  if (field(trip, "jobId") !== scope.operationId) return false;
  if (field(trip, "driverId", "motoristaId", "userId", "criadoPor") !== scope.driverId) return false;

  const rowCompany = field(trip, "companyId", "empresaId");
  const rowContract = field(trip, "contractId", "contratoId");
  const source = text(trip.source).toLowerCase();
  const oldServerGtoShape = trustedLegacyServerSources.has(source) &&
    trip.serverValidatedAt == null && trip.serverUpdatedAt == null && trip.uploadedAt != null;
  if ((!rowCompany || !rowContract) && !oldServerGtoShape) return false;
  if (rowCompany && rowCompany !== scope.companyId) return false;
  if (rowContract && rowContract !== scope.contractId) return false;
  return true;
}
