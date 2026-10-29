import { readCanonicalOutboxSnapshot } from "../services/offline/OfflineDatabase";
import type { OfflineTripRecord } from "../services/offline/OfflineDatabase";
import type { SyncItem } from "../services/sync/SyncEngine";
import { buildCanonicalTripRegistrationRequest } from "../services/sync/CanonicalTripRegistrationRequest";
import { isEligiblePrintProtocolReplay } from "./printProtocolRecovery509";

export type FailedRegistrationRecoveryReason = "READY" | "PERMISSION_DENIED" | "OTHER_ACCOUNT" |
  "SERVER_PRECONDITION" | "PRINT_PROTOCOL_RETRY" |
  "COMMAND_UNAVAILABLE" | "COMMAND_AMBIGUOUS" | "COMMAND_NOT_FAILED" | "FAILURE_REQUIRES_REVIEW" |
  "IDENTITY_REQUIRES_REVIEW" | "PAYLOAD_REQUIRES_REVIEW";
export type FailedRegistrationRecovery = {
  // These private references stay inside the command UI. They are never added
  // to public coverage, diagnostic exports, DOM attributes or support logs.
  commandKey: string;
  tripId: string;
  expectedCommand: string;
  expectedLocalRecord: string;
  companyId: string;
  driverId: string;
  label: string;
  reason: FailedRegistrationRecoveryReason;
};
const text = (value: unknown) => String(value ?? "").trim();
const idOf = (trip: Record<string, unknown>) => text(trip.physicalDocumentId || trip.canonicalTripId || trip.tripId || trip.clientRequestId || trip.idempotencyKey);
const companyOf = (trip: Record<string, unknown>) => text(trip.companyId || trip.empresaId);
const ownerOf = (trip: Record<string, unknown>) => text(trip.driverId || trip.motoristaId);
const deleted = (trip: Record<string, unknown>) => trip.deleted === true || text(trip.status).toUpperCase() === "DELETED";
const retryableSavedCodes = new Set(["functions/internal", "functions/unavailable", "functions/deadline-exceeded"]);
const savedCode = (item: SyncItem) => text(item.lastError).split(":", 1)[0].toLowerCase();
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export function failedRegistrationRecoveryReason(
  commandKey: string, item: SyncItem, record: OfflineTripRecord,
  queue: Record<string, SyncItem>, uid: string, companyId: string,
): FailedRegistrationRecoveryReason {
  const trip = item.trip, local = record.trip, id = idOf(trip);
  if (!uid || ownerOf(trip) !== uid || ownerOf(local) !== uid) return "OTHER_ACCOUNT";
  const accessDenied = ["permission-denied", "functions/permission-denied", "storage/unauthorized", "storage/unauthenticated", "functions/unauthenticated"].includes(savedCode(item));
  const precondition = ["failed-precondition", "functions/failed-precondition"].includes(savedCode(item));
  if (item.state !== "FAILED") return "COMMAND_NOT_FAILED";
  const protocolRetry = item.manualHistoryRecoveryAttempt !== true &&
    (!item.lastFailureStage || item.lastFailureStage === "CALLABLE_REGISTRATION" || item.lastFailureStage === "UNKNOWN") &&
    isEligiblePrintProtocolReplay(trip as Record<string, unknown>, item.lastError);
  if (!accessDenied && !precondition && !retryableSavedCodes.has(savedCode(item)) && !protocolRetry) return "FAILURE_REQUIRES_REVIEW";
  if ((item.operation || "UPSERT") !== "UPSERT" || item.alternatives?.length ||
      Object.values(queue).filter(entry => entry?.trip && idOf(entry.trip) === id).length !== 1) return "COMMAND_AMBIGUOUS";
  const identity = [id, text(trip.jobId), companyOf(trip), text(trip.contractId), text(trip.idempotencyKey)];
  if (identity.some(value => !value || value.includes("/")) || commandKey !== id || idOf(local) !== id ||
      companyOf(trip) !== companyId || companyOf(local) !== companyId ||
      text(trip.canonicalTripId) !== id || text(trip.tripId) !== id ||
      text(local.jobId) !== text(trip.jobId) || text(local.contractId) !== text(trip.contractId) ||
      deleted(trip) || deleted(local) || trip.historicalReadOnly || local.historicalReadOnly ||
      local.serverValidatedAt || record.syncStatus === "SERVER_CONFIRMED") return "IDENTITY_REQUIRES_REVIEW";
  try {
    if (Number(record.syncVersion) !== Number(trip.syncVersion) || Number(local.syncVersion) !== Number(trip.syncVersion) ||
        text(local.offlineReceiptKey) !== text(trip.offlineReceiptKey) ||
        stable(buildCanonicalTripRegistrationRequest(local, text(local.comprovanteUrl))) !==
        stable(buildCanonicalTripRegistrationRequest(trip, text(trip.comprovanteUrl)))) return "PAYLOAD_REQUIRES_REVIEW";
  } catch { return "PAYLOAD_REQUIRES_REVIEW"; }
  return accessDenied ? "PERMISSION_DENIED" : precondition ? "SERVER_PRECONDITION" : protocolRetry ? "PRINT_PROTOCOL_RETRY" : "READY";
}

/** Pure inspection: no key migration, no enqueue, no ACK and no storage writes. */
export function inspectFailedRegistrationRecovery(
  records: OfflineTripRecord[], uid: string, companyId: string,
  storage: Pick<Storage, "getItem"> | null,
): { readState: "read" | "invalid" | "unavailable"; rows: FailedRegistrationRecovery[] } {
  let queue: Record<string, SyncItem>;
  if (!storage) return { readState: "unavailable", rows: [] };
  try {
    const parsed: unknown = readCanonicalOutboxSnapshot(storage);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        Object.values(parsed).some(entry => !entry || typeof entry !== "object" || Array.isArray(entry) ||
          !entry.trip || typeof entry.trip !== "object" || Array.isArray(entry.trip)))
      return { readState: "invalid", rows: [] };
    queue = parsed as Record<string, SyncItem>;
  } catch (error) { return { readState: error instanceof SyntaxError ? "invalid" : "unavailable", rows: [] }; }
  const rows: FailedRegistrationRecovery[] = [];
  for (const record of records) {
    const local = record.trip, id = idOf(local);
    if (!id || !companyId || companyOf(local) !== companyId || record.syncStatus === "SERVER_CONFIRMED" || deleted(local)) continue;
    const matches = Object.entries(queue).filter(([, entry]) => idOf(entry.trip) === id);
    if (!matches.some(([, item]) => item.state === "FAILED" || item.state === "CONFLICT")) continue;
    const [key, item] = matches[0];
    rows.push({ commandKey: key, tripId: id, companyId, driverId: ownerOf(local),
      expectedCommand: JSON.stringify(item), expectedLocalRecord: JSON.stringify(record),
      label: [text(local.origem || local.origin), text(local.destino || local.destination)].filter(Boolean).join(" → ") || "Registro salvo neste aparelho",
      reason: matches.length === 1 ? failedRegistrationRecoveryReason(key, item, record, queue, uid, companyId) : "COMMAND_AMBIGUOUS" });
  }
  return { readState: "read", rows };
}
