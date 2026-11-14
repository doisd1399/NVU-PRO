import { hasHistoricalReadEvidence } from "./historyReadEvidence";

export interface TripMetricDateResult {
  date: Date;
  source: string | null;
  valid: boolean;
}

export interface TripMetricAssessment extends TripMetricDateResult {
  eligible: boolean;
  status: string | null;
  reason: string;
  legacyCompleted: boolean;
  awaitingServerValidation: boolean;
  deletedOrCanceled: boolean;
}

const normalizeStatus = (value: unknown): string => String(value || "")
  .trim()
  .toLocaleLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "");

function parseLocalDate(candidate: any): Date | null {
  if (!candidate) return null;
  const parsed = candidate instanceof Date ? candidate : new Date(candidate);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > 0 ? parsed : null;
}

function parseSelectedDate(rawDate: any): Date | null {
  if (!rawDate) return null;
  if (rawDate instanceof Date) return rawDate.getTime() > 0 ? rawDate : null;
  if (typeof rawDate?.toDate === "function") {
    const parsed = rawDate.toDate();
    return parsed instanceof Date && parsed.getTime() > 0 ? parsed : null;
  }
  if (rawDate?.seconds) {
    const parsed = new Date(Number(rawDate.seconds) * 1000);
    return parsed.getTime() > 0 ? parsed : null;
  }
  const parsed = new Date(rawDate);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > 0 ? parsed : null;
}

/** The one date policy used by historical metrics and the read-only diagnostic. */
export function getTripMetricDateResult(trip: any): TripMetricDateResult {
  const localDateCandidates: [string, any][] = [
    ["createdAtLocal", trip?.createdAtLocal],
    ["localCreatedAt", trip?.localCreatedAt],
    ["offlineCreatedAt", trip?.offlineCreatedAt],
    ["completedAtLocal", trip?.completedAtLocal],
  ];
  for (const [source, candidate] of localDateCandidates) {
    const parsed = parseLocalDate(candidate);
    if (parsed) return { date: parsed, source, valid: true };
  }

  const completedAtDate = trip?.completedAt?.toDate?.();
  const fallbackCandidates: [string, any][] = [
    ["completedAt", completedAtDate || trip?.completedAt],
    ["serverValidatedAt", trip?.serverValidatedAt],
    ["dataFechamento", trip?.dataFechamento],
    ["date", trip?.date],
    ["dataLancamento", trip?.dataLancamento],
    ["createdAt", trip?.createdAt],
  ];
  const selected = fallbackCandidates.find(([, value]) => Boolean(value));
  if (!selected) return { date: new Date(0), source: null, valid: false };
  const [source, rawDate] = selected;
  const parsed = parseSelectedDate(rawDate);
  return parsed
    ? { date: parsed, source, valid: true }
    : { date: new Date(0), source, valid: false };
}

export function getTripMetricDate(trip: any): Date {
  return getTripMetricDateResult(trip).date;
}

/** Shared eligibility decision; the lifecycle marker on a historical adapter is not business completion. */
export function getTripMetricAssessment(trip: any): TripMetricAssessment {
  const lifecycleStatus = normalizeStatus(trip?.status);
  const historicalAdapterLifecycle = trip?.historicalReadOnly === true &&
    (lifecycleStatus === "registered_local" || lifecycleStatus === "history_confirmed");
  const status = normalizeStatus(
    trip?.recordStatus || (historicalAdapterLifecycle ? "" : trip?.status),
  );
  const syncStatus = normalizeStatus(
    trip?.offlineSyncStatus || trip?.syncStatus || trip?.validationStatus,
  );
  const readObserved = hasHistoricalReadEvidence(trip || {});
  const sdkPending = trip?.historyReadEvidence?.transport === "pending";
  const awaitingServerValidation = trip?.historyLocalCommandOnly === true || sdkPending || (!readObserved && [
    "awaiting_connection",
    "pending_sync",
    "local_created",
    "syncing",
    "uploading",
    "server_received",
    "validation_pending",
    "pending_validation",
    "validation_failed",
    "failed",
  ].includes(syncStatus));
  const canceledStatuses = new Set([
    "cancelado", "cancelada", "canceled", "cancelled",
    "excluido", "excluida", "deleted",
  ]);
  const deletedOrCanceled = canceledStatuses.has(status) ||
    trip?.cancelado === true || trip?.deleted === true || trip?.softDeleted === true ||
    Boolean(trip?.deletedAt || trip?.tombstonedAt) || trip?.tripState === "DELETED";
  const completedStatuses = new Set([
    "concluida", "concluido", "completed", "finalizado", "finalizada", "entregue",
  ]);
  const dateResult = getTripMetricDateResult(trip);
  const hasServerConfirmation = Boolean(
    trip?.serverValidatedAt ||
    trip?.syncStatus === "synced" ||
    trip?.offlineSyncStatus === "synced",
  );
  const statusCompleted = completedStatuses.has(status);
  // The historical SDK receipt permits legacy display independently from
  // backend operation proof. It never adds an ACK or a LIVE slot. Pending
  // device commands and SDK writes remain excluded from historical metrics.
  const historicalServerProven = trip?.historicalReadOnly === true &&
    normalizeStatus(trip?.historicalEvidenceStatus) === "server_proven";
  const legacyCompleted = !status && dateResult.valid &&
    (hasServerConfirmation || historicalServerProven || readObserved);
  const eligible = !deletedOrCanceled && !awaitingServerValidation && dateResult.valid &&
    (statusCompleted || legacyCompleted);
  const reasons: string[] = [];
  if (deletedOrCanceled) reasons.push("deleted_or_canceled");
  if (awaitingServerValidation) reasons.push("pending_sync_state");
  if (!dateResult.valid) reasons.push("missing_metric_date");
  if (!statusCompleted && !legacyCompleted) {
    reasons.push(status ? "status_not_completed" : "legacy_status_requires_date_and_server_confirmation");
  }
  return {
    ...dateResult,
    eligible,
    status: status || null,
    reason: eligible
      ? (legacyCompleted
        ? (readObserved ? "legacy_historical_read_and_date" : historicalServerProven ? "legacy_server_proven_historical_read" : "legacy_date_and_server_confirmation")
        : "completed_status_and_date")
      : reasons.join("+"),
    legacyCompleted,
    awaitingServerValidation,
    deletedOrCanceled,
  };
}
