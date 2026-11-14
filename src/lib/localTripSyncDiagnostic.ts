import { readCanonicalOutboxSnapshot } from "../services/offline/OfflineDatabase";
import type { OfflineTripRecord } from "../services/offline/OfflineDatabase";
import { buildSafeProAttemptDiagnostic, type SafeProAttemptDiagnostic } from "./proAttemptDiagnostic";

type LocalState = "LOCAL_ONLY" | "PENDING_SYNC" | "SYNCING" | "CONFLICT" | "UNKNOWN";
type QueueState = "PENDING_SYNC" | "SYNCING" | "SERVER_CONFIRMED" | "FAILED" | "CONFLICT" | "UNKNOWN";
type QueueOperation = "UPSERT" | "UPDATE" | "DELETE" | "UNKNOWN";
export type LocalTripSyncDiagnostic = {
  inspectedRows: number;
  hiddenRows: number;
  queueReadState: "read" | "unavailable" | "invalid";
  localStates: Array<{ state: LocalState; rows: number }>;
  rows: Array<{
    record: number;
    /** Private in-memory join keys; never rendered or copied. */
    privateRecordId: string;
    privateJobId: string;
    privateDriverId: string;
    privateAttemptId: string;
    localState: LocalState;
    seenInQuery: boolean;
    queueStates: QueueState[];
    operations: QueueOperation[];
    actorScope: "current" | "other" | "unknown";
    identityLink: "verified" | "divergent" | "unverified";
    alternatives: number;
    errorCodes: string[];
    recognizedReasons: string[];
    safeMessages: string[];
    failureStages?: string[];
    safeDiagnostic?: SafeProAttemptDiagnostic;
    result: "SERVER_CONFIRMED" | "NO_SERVER_CONFIRMATION" | "PENDING" | "UNKNOWN";
  }>;
};

const QUEUE_KEY = "nvu_sync_queue_v2";
const MAX_DETAILS = 10;
const text = (value: unknown) => String(value ?? "").trim();
const physicalId = (trip: Record<string, unknown>) => text(trip.physicalDocumentId || trip.canonicalTripId || trip.tripId || trip.clientRequestId || trip.idempotencyKey);
const localStates = new Set(["LOCAL_ONLY", "PENDING_SYNC", "SYNCING", "CONFLICT"]);
const queueStates = new Set(["PENDING_SYNC", "SYNCING", "SERVER_CONFIRMED", "FAILED", "CONFLICT"]);
const operations = new Set(["UPSERT", "UPDATE", "DELETE"]);
const failureStages = new Set(["LOCAL_VALIDATION", "RECEIPT_LOAD", "RECEIPT_UPLOAD", "RECEIPT_LOCAL_SAVE", "CALLABLE_REGISTRATION", "CALLABLE_ACK", "SERVER_READ", "SERVER_ACK"]);
const safeCodes = new Set([
  "functions/not-found", "functions/unavailable", "functions/internal", "functions/deadline-exceeded",
  "functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition",
  "permission-denied", "unauthenticated", "unavailable", "deadline-exceeded", "invalid-argument",
  "failed-precondition", "network-request-failed", "storage/retry-limit-exceeded",
  "CANONICAL_TRIP_REQUIRED_FIELDS_MISSING", "CANONICAL_TRIP_AUTH_REQUIRED",
  "CANONICAL_TRIP_DRIVER_SCOPE_MISMATCH", "CANONICAL_TRIP_JOB_ID_REQUIRED",
  "CANONICAL_TRIP_CONFLICT", "CANONICAL_TRIP_CONFLICT_SERVER_WON",
  "CANONICAL_TRIP_EDIT_ACK_INVALID", "SERVER_TRIP_ACK_INVALID", "SERVER_SIMPLE_TRIP_ACK_MISSING",
  "SERVER_TRIP_EDIT_ACK_INVALID", "SERVER_TRIP_DELETE_ACK_INVALID", "OPERATION_ALREADY_FULL",
  "OFFLINE_STORAGE_WRITE_FAILED", "OFFLINE_STORAGE_READ_FAILED", "SYNC_QUEUE_STORAGE_WRITE_FAILED",
]);
const safeError = (value: unknown) => {
  const candidate = text(value).split(":", 1)[0];
  return safeCodes.has(candidate) ? candidate : "UNKNOWN_SYNC_FAILURE";
};
const safeServerMessages = new Set([
  "A viagem não pertence ao usuário autenticado.",
  "Vínculo da operação inválido.",
  "Atividades operacionais suspensas.",
  "Replay não pertence à tentativa original.",
  "Tentativa idempotente divergente.",
  "Reserva sem histórico confirmado; reconciliação necessária.",
  "Tentativa existente sem confirmação válida; revisão necessária.",
  "Captura reservada sem histórico confirmado; revisão necessária.",
  "Operação, contrato ou empresa não disponíveis.",
  "Operação não iniciada ou não disponível.",
  "OPERATION_RECONCILIATION_REQUIRED",
  "Limite da operação atingido.",
  "Não há slot livre para a operação.",
  "A captura salva diverge da viagem registrada.",
  "Viagem anterior alterada ou excluída; revisão necessária.",
]);
const safeErrorMessage = (value: unknown) => {
  const raw = text(value);
  const separator = raw.indexOf(":");
  if (separator < 0) return raw && safeCodes.has(raw) ? "" : raw ? "Mensagem específica preservada no aparelho; não exportada." : "";
  const message = raw.slice(separator + 1).trim();
  return safeServerMessages.has(message) ? message : message ? "Mensagem específica preservada no aparelho; não exportada." : "";
};
const recognizedReason = (value: unknown) => {
  const code = safeError(value).toLowerCase();
  if (code.includes("permission-denied")) return "AUTORIZAÇÃO_REJEITADA";
  if (code.includes("unauthenticated")) return "AUTENTICAÇÃO_NECESSÁRIA";
  if (code.includes("failed-precondition")) return "CONDIÇÃO_DO_SERVIDOR_REJEITADA";
  if (code.includes("invalid-argument")) return "DADOS_REJEITADOS";
  if (["functions/internal", "functions/unavailable", "functions/deadline-exceeded", "unavailable", "deadline-exceeded", "network-request-failed", "storage/retry-limit-exceeded"].includes(code)) return "FALHA_TRANSITÓRIA_OU_INTERNA";
  return "FALHA_NÃO_RECONHECIDA";
};
const resultFor = (states: QueueState[], localState: LocalState): LocalTripSyncDiagnostic["rows"][number]["result"] => {
  if (states.includes("SERVER_CONFIRMED")) return "SERVER_CONFIRMED";
  if (states.includes("FAILED") || states.includes("CONFLICT") || localState === "CONFLICT") return "NO_SERVER_CONFIRMATION";
  if (states.includes("PENDING_SYNC") || states.includes("SYNCING") || localState === "PENDING_SYNC" || localState === "SYNCING") return "PENDING";
  return "UNKNOWN";
};

export type NativeProQueueDiagnosticEntry = {
  attemptId?: string; jobId?: string; companyId?: string; driverId?: string;
  queueStatus?: string; retryAllowed?: boolean; lastQueueError?: string; lastQueueErrorCode?: string;
  attemptCount?: number; reasonCode?: string; stage?: string; callable?: string;
  serverReason?: string; canonicalTripId?: string; tripId?: string;
  operationId?: string; queuedAt?: number; queueClaimedAt?: number; lastAttemptAt?: number;
};

function deterministicNativeTripId(driverId: string, attemptId: string): string {
  return (`simple_${driverId}_${attemptId}`).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180);
}

/** Joins a native attempt to one general-diagnostic row using persisted/deterministic IDs and explicit owner aliases. */
export function findSafeNativeAttemptForLocalRow(
  row: LocalTripSyncDiagnostic["rows"][number],
  nativeEntries: readonly NativeProQueueDiagnosticEntry[],
  authenticatedUserId: string,
  ownerAuthenticated: boolean,
  authorizedDriverIds: readonly string[] = [],
): SafeProAttemptDiagnostic | null {
  if (!ownerAuthenticated || row.identityLink !== "verified" || !row.privateRecordId) return null;
  const ownerIds = new Set([authenticatedUserId, ...authorizedDriverIds].map(text).filter(Boolean));
  if (!row.privateDriverId || !ownerIds.has(row.privateDriverId)) return null;
  const match = nativeEntries
    .filter((entry) => {
      const driverId = text(entry.driverId);
      const attemptId = text(entry.attemptId);
      if (!driverId || !ownerIds.has(driverId) || !attemptId) return false;
      if (row.privateJobId && entry.jobId && row.privateJobId !== text(entry.jobId)) return false;
      const candidateIds = [entry.canonicalTripId, entry.tripId, deterministicNativeTripId(driverId, attemptId)]
        .map(text).filter(Boolean);
      return candidateIds.includes(row.privateRecordId) || Boolean(row.privateAttemptId && row.privateAttemptId === attemptId);
    })
    .sort((left, right) => Number(right.lastAttemptAt || right.queueClaimedAt || right.queuedAt || 0)
      - Number(left.lastAttemptAt || left.queueClaimedAt || left.queuedAt || 0))[0];
  if (!match) return null;
  return buildSafeProAttemptDiagnostic({
    attemptId: match.attemptId,
    jobId: match.jobId,
    operationId: match.operationId,
    driverId: match.driverId,
    canonicalTripId: match.canonicalTripId,
    tripId: match.tripId,
    queuedAt: asMillis(match.queuedAt),
    queueClaimedAt: asMillis(match.queueClaimedAt),
    lastAttemptAt: asMillis(match.lastAttemptAt),
    attemptCount: match.attemptCount,
    queueStatus: match.queueStatus,
    lastQueueErrorCode: match.lastQueueErrorCode || match.lastQueueError,
    reasonCode: match.reasonCode || recognizedReason(match.lastQueueErrorCode || match.lastQueueError),
    stage: match.stage,
    callable: match.callable,
    lastQueueError: match.lastQueueError,
    serverReason: match.serverReason,
  }, authenticatedUserId, true, [...authorizedDriverIds]);
}

type IdentityProfile = { id?: unknown; driverId?: unknown; motoristaId?: unknown } | null | undefined;
type IdentityMembership = { userId?: unknown; status?: unknown; driverId?: unknown; motoristaId?: unknown };

/** Resolve only explicit aliases on the authenticated user's own profile or active membership. */
export function resolveAuthenticatedDriverAliases(
  authenticatedUserId: string,
  profile: IdentityProfile,
  memberships: IdentityMembership[] = [],
): string[] {
  const uid = text(authenticatedUserId);
  if (!uid || text(profile?.id) !== uid) return [];
  const aliases = new Set<string>([uid]);
  for (const candidate of [profile?.driverId, profile?.motoristaId]) {
    const value = text(candidate);
    if (value) aliases.add(value);
  }
  for (const membership of memberships) {
    if (text(membership.userId) !== uid || text(membership.status) !== "active") continue;
    for (const candidate of [membership.driverId, membership.motoristaId]) {
      const value = text(candidate);
      if (value) aliases.add(value);
    }
  }
  return [...aliases];
}

function asMillis(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const raw = text(value);
  if (!raw) return 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function serverMessageFromError(value: unknown): string {
  const parts = text(value).split(":").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "";
  if (safeCodes.has(parts[0]) || /^(SIMPLE_REGISTRATION_FAILED|GTO_PRO_REGISTRATION_FAILED)$/.test(parts[0])) parts.shift();
  if (parts.length > 1 && /^[\p{L}0-9_.-]{3,80}$/u.test(parts[0]) && parts[0] === parts[0].toUpperCase()) parts.shift();
  return parts.join(": ");
}

function diagnosticForEntry(
  entry: Record<string, unknown>,
  trip: Record<string, unknown>,
  authenticatedUserId: string,
  authorizedDriverIds: string[],
): SafeProAttemptDiagnostic | undefined {
  const driverId = text(trip.driverId || trip.motoristaId || entry.driverId);
  const rawError = text(entry.lastQueueError || entry.lastError);
  if (!driverId || !rawError) return undefined;
  const rawCodeSource = entry.lastQueueErrorCode || entry.errorCode || rawError;
  const reason = text(entry.reasonCode || entry.lastFailureReasonCode);
  const diagnostic = buildSafeProAttemptDiagnostic({
    attemptId: text(entry.attemptId || trip.attemptId),
    jobId: text(entry.jobId || trip.jobId),
    operationId: text(entry.operationId || trip.operationId),
    driverId,
    canonicalTripId: text(trip.canonicalTripId || trip.physicalDocumentId || trip.tripId || trip.idempotencyKey),
    tripId: text(trip.tripId || trip.physicalDocumentId),
    queuedAt: asMillis(entry.queuedAt || entry.createdAt),
    queueClaimedAt: asMillis(entry.queueClaimedAt || entry.syncingAt),
    lastAttemptAt: asMillis(entry.lastAttemptAt),
    attemptCount: Number.isFinite(Number(entry.attemptCount ?? entry.attempts))
      ? Number(entry.attemptCount ?? entry.attempts) : undefined,
    queueStatus: text(entry.queueStatus || entry.state),
    lastQueueErrorCode: safeError(rawCodeSource),
    reasonCode: reason || recognizedReason(rawCodeSource),
    stage: text(entry.lastFailureStage || entry.stage),
    callable: text(entry.lastQueueCallable || entry.callable),
    lastQueueError: rawError,
    serverReason: serverMessageFromError(rawError),
  }, authenticatedUserId, true, authorizedDriverIds);
  return diagnostic || undefined;
}

/** Inspect saved queue bytes only. Never calls SyncEngine.read(), which can migrate keys. */
export function inspectLocalTripSync(
  records: OfflineTripRecord[],
  serverIds: Set<string>,
  authenticatedUserId: string,
  suppliedStorage?: Pick<Storage, "getItem"> | null,
  authorizedDriverIds: string[] = [],
): LocalTripSyncDiagnostic {
  let queueReadState: LocalTripSyncDiagnostic["queueReadState"] = "read";
  let entries: Record<string, unknown>[] = [];
  try {
    const storage = suppliedStorage === undefined
      ? typeof localStorage === "undefined" ? null : localStorage
      : suppliedStorage;
    if (!storage) queueReadState = "unavailable";
    else {
      const raw = JSON.stringify(readCanonicalOutboxSnapshot(storage));
      let parsed: unknown;
      try { parsed = raw ? JSON.parse(raw) : {}; }
      catch { queueReadState = "invalid"; parsed = null; }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) queueReadState = "invalid";
      else entries = Object.values(parsed).filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)));
    }
  } catch {
    queueReadState = "unavailable";
  }
  const counts = new Map<LocalState, number>();
  const ownerIds = new Set([authenticatedUserId, ...authorizedDriverIds].map(text).filter(Boolean));
  const rows: LocalTripSyncDiagnostic["rows"] = [];
  for (const [index, record] of records.entries()) {
    const state = localStates.has(record.syncStatus) ? record.syncStatus as LocalState : "UNKNOWN";
    counts.set(state, (counts.get(state) || 0) + 1);
    if (index >= MAX_DETAILS) continue;
    const recordTrip = record.trip as unknown as Record<string, unknown>;
    const id = physicalId(recordTrip);
    const recordDriverId = text(recordTrip.driverId || recordTrip.motoristaId);
    const recordJobId = text(recordTrip.jobId);
    const recordAttemptId = text(recordTrip.attemptId || recordTrip.captureAttemptId || recordTrip.simpleReceiptCaptureAttemptId);
    const matched = entries.filter((entry) => id && entry.trip && typeof entry.trip === "object" && !Array.isArray(entry.trip)
      && physicalId(entry.trip as Record<string, unknown>) === id);
    const ownership = matched.map((entry) => {
      const trip = entry.trip as Record<string, unknown>;
      const ownerId = text(trip.driverId || trip.motoristaId || entry.driverId);
      const operation = text(entry.operation || "UPSERT");
      const actorId = operation === "UPDATE" ? text(entry.actorUserId) : text(ownerId || entry.actorUserId);
      return { ownerId, actorId, linked: Boolean(ownerId && actorId && ownerIds.has(ownerId) && ownerIds.has(actorId)) };
    });
    const recordOwnerLinked = Boolean(recordDriverId && ownerIds.has(recordDriverId));
    const allOwnerLinked = recordOwnerLinked || (ownership.length > 0 && ownership.every((item) => item.linked));
    const recordOwnerDivergent = Boolean(recordDriverId && !ownerIds.has(recordDriverId));
    const queueOwnerDivergent = ownership.some((item) =>
      (item.ownerId && !ownerIds.has(item.ownerId)) || (item.actorId && !ownerIds.has(item.actorId)));
    const identityConflict = recordOwnerDivergent || queueOwnerDivergent;
    const identityLink: LocalTripSyncDiagnostic["rows"][number]["identityLink"] = allOwnerLinked
      ? identityConflict ? "divergent" : "verified"
      : identityConflict ? "divergent" : "unverified";
    const actorScope: LocalTripSyncDiagnostic["rows"][number]["actorScope"] = allOwnerLinked && !identityConflict
      ? "current" : identityConflict ? "other" : "unknown";
    const matchedStates = [...new Set(matched.map((entry) => queueStates.has(text(entry.state)) ? text(entry.state) as QueueState : "UNKNOWN"))];
    const matchedErrors = matched.filter((entry) => entry.lastQueueError || entry.lastError);
    const safeErrorSources = matchedErrors.map((entry) => entry.lastQueueErrorCode || entry.errorCode || entry.lastQueueError || entry.lastError);
    const newestErrorEntry = matchedErrors.reduce<Record<string, unknown> | undefined>((newest, entry) => {
      const time = asMillis(entry.lastAttemptAt || entry.queueClaimedAt || entry.syncingAt || entry.queuedAt || entry.createdAt);
      const previousTime = newest ? asMillis(newest.lastAttemptAt || newest.queueClaimedAt || newest.syncingAt || newest.queuedAt || newest.createdAt) : -1;
      return !newest || time >= previousTime ? entry : newest;
    }, undefined);
    const newestTrip = newestErrorEntry?.trip && typeof newestErrorEntry.trip === "object" && !Array.isArray(newestErrorEntry.trip)
      ? newestErrorEntry.trip as Record<string, unknown> : undefined;
    const safeDiagnostic = identityLink === "verified" && newestErrorEntry && newestTrip
      ? diagnosticForEntry(newestErrorEntry, newestTrip, authenticatedUserId, authorizedDriverIds)
      : undefined;
    rows.push({
      record: index + 1, privateRecordId: id, privateJobId: recordJobId,
      privateDriverId: recordDriverId, privateAttemptId: recordAttemptId,
      localState: state, seenInQuery: serverIds.has(id),
      queueStates: matchedStates,
      operations: [...new Set(matched.map((entry) => operations.has(text(entry.operation || "UPSERT")) ? text(entry.operation || "UPSERT") as QueueOperation : "UNKNOWN"))],
      actorScope,
      identityLink,
      alternatives: matched.reduce((sum, entry) => sum + (Array.isArray(entry.alternatives) ? entry.alternatives.length : 0), 0),
      errorCodes: [...new Set(safeErrorSources.map(safeError))],
      recognizedReasons: [...new Set(safeErrorSources.map(recognizedReason))],
      safeMessages: [...new Set(matchedErrors.map((entry) => safeErrorMessage(entry.lastQueueError || entry.lastError)).filter(Boolean))],
      failureStages: [...new Set(matched.filter((entry) => entry.lastFailureStage || entry.stage).map((entry) => failureStages.has(text(entry.lastFailureStage || entry.stage)) ? text(entry.lastFailureStage || entry.stage) : "UNKNOWN"))],
      ...(safeDiagnostic ? { safeDiagnostic } : {}),
      result: resultFor(matchedStates, state),
    });
  }
  return { inspectedRows: records.length, hiddenRows: Math.max(0, records.length - MAX_DETAILS), queueReadState,
    localStates: [...counts].map(([state, count]) => ({ state, rows: count })), rows };
}
