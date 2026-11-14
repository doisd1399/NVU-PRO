export type ProAttemptDiagnosticSource = {
  attemptId?: string;
  jobId?: string;
  driverId?: string;
  queueStatus?: string;
  queuedAt?: number;
  queueClaimedAt?: number;
  lastAttemptAt?: number;
  attemptCount?: number;
  lastQueueError?: string;
  lastQueueErrorCode?: string;
  reasonCode?: string;
  stage?: string;
  callable?: string;
  serverReason?: string;
  canonicalTripId?: string;
  tripId?: string;
  operationId?: string;
};

export type SafeProAttemptDiagnostic = {
  attemptId: string;
  jobId: string;
  operationId: string;
  canonicalTripId: string;
  timestampLabel: string;
  timestamp: string;
  queueStatus: string;
  rawCode: string;
  reasonCode: string;
  stage: string;
  callable: string;
  serverMessage: string;
  attemptCount: string;
  text: string;
};

const NOT_RECORDED = "não registrado";
const CALLABLE_BY_MARKER: Record<string, string> = {
  SIMPLE_REGISTRATION_FAILED: "registerCanonicalSimpleTrip",
  GTO_PRO_REGISTRATION_FAILED: "registerGtoProReceipt",
};
const ALLOWED_CALLABLES = new Set([
  "registerCanonicalSimpleTrip",
  "registerGtoProReceipt",
  "registerGtoTrip",
  "reconcileOperationTrips",
  "completeCanonicalOperation",
]);
const ALLOWED_STAGES = new Set([
  "LOCAL_VALIDATION", "RECEIPT_LOAD", "RECEIPT_UPLOAD", "RECEIPT_LOCAL_SAVE",
  "CALLABLE_REGISTRATION", "CALLABLE_ACK", "SERVER_READ", "SERVER_ACK",
]);

export function maskDiagnosticId(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!id) return NOT_RECORDED;
  if (id.length <= 7) return "•••";
  return `${id.slice(0, 3)}…${id.slice(-3)}`;
}

/** Removes credentials, proof/OCR material, URLs and full identifiers before display or copy. */
export function sanitizeProAttemptMessage(value: unknown): string {
  let message = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!message) return "";
  message = message.slice(0, 2_000);
  message = message.replace(/\b(?:receipt(?:text)?|proof(?:url)?|ocr(?:text)?|imagehash|comprovante|credencial|credential)\s*[:=]\s*[\s\S]*$/i,
    "[conteúdo de recibo/comprovante removido]");
  message = message.replace(/\bauthorization\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, "Authorization=[redigido]");
  message = message.replace(/\bbearer\s+[^\s,;]+/gi, "Bearer [redigido]");
  message = message.replace(/\b(refresh[_-]?token|auth[_-]?token|id[_-]?token|access[_-]?token|token|password|senha|secret|api[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
    "$1=[redigido]");
  message = message.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[API key redigida]");
  message = message.replace(/\bya29\.[0-9A-Za-z_-]{20,}\b/g, "[token redigido]");
  message = message.replace(/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?\b/g, "[token JWT redigido]");
  message = message.replace(/\b(uid|driverid|motoristaid|companyid|empresaid|jobid|operationid|tripid|canonicaltripid|attemptid)\s*[:=]\s*[^\s,;]+/gi,
    "$1=[ID mascarado]");
  message = message.replace(/https?:\/\/[^\s]+/gi, "[URL removida]");
  message = message.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[e-mail removido]");
  // Firestore IDs and UIDs are not needed to understand the server rejection.
  message = message.replace(/\b(?=[a-z0-9_-]{20,}\b)(?=[a-z0-9_-]*[a-z])(?=[a-z0-9_-]*\d)[a-z0-9_-]+\b/gi,
    "[identificador removido]");
  return message.slice(0, 500).trim();
}

function parsePersistedError(rawValue: unknown) {
  const raw = String(rawValue ?? "").trim();
  const route = raw.match(/^(SIMPLE_REGISTRATION_FAILED|GTO_PRO_REGISTRATION_FAILED):([A-Z_]+)(?::([\s\S]*))?$/);
  if (route) {
    return {
      rawCode: route[2],
      routeMarker: route[1],
      message: route[3] || "",
    };
  }
  const direct = raw.match(/^(functions\/[a-z-]+|[A-Z_]{3,40}|[a-z][a-z0-9-]{2,50})$/);
  return { rawCode: direct?.[1] || "", routeMarker: "", message: "" };
}

function safeKnownField(value: unknown, allowed: Set<string>): string {
  const candidate = String(value ?? "").trim();
  return allowed.has(candidate) ? candidate : NOT_RECORDED;
}

function timestampOf(value: unknown): string {
  const raw = String(value ?? "").trim();
  const numeric = Number(raw);
  const millis = Number.isFinite(numeric) ? numeric : Date.parse(raw);
  if (!Number.isFinite(millis) || millis <= 0) return NOT_RECORDED;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? NOT_RECORDED : date.toISOString();
}

const isBlocked = (value: unknown) => ["FAILED", "CONFLICT", "PERMISSION_PAUSED", "AUTH_REQUIRED"].includes(String(value ?? "").toUpperCase());

/** Pure formatter. It receives no retry, persistence, Firebase or network dependency. */
export function buildSafeProAttemptDiagnostic(
  source: ProAttemptDiagnosticSource,
  authenticatedDriverId: string | null | undefined,
  ownerLinkVerified: boolean,
  authorizedDriverIds: readonly string[] = [],
): SafeProAttemptDiagnostic | null {
  const ownerIds = new Set([authenticatedDriverId, ...authorizedDriverIds].map((value) => String(value ?? "").trim()).filter(Boolean));
  if (!ownerLinkVerified || !authenticatedDriverId || !source.driverId || !ownerIds.has(source.driverId) || !isBlocked(source.queueStatus)) {
    return null;
  }

  const parsed = parsePersistedError(source.lastQueueErrorCode);
  const callableFromPersistedMarker = CALLABLE_BY_MARKER[parsed.routeMarker] || "";
  const persistedCallable = String(source.callable ?? "").trim();
  const callable = ALLOWED_CALLABLES.has(persistedCallable)
    ? persistedCallable
    : callableFromPersistedMarker || NOT_RECORDED;
  const persistedStage = String(source.stage ?? "").trim();
  const stage = ALLOWED_STAGES.has(persistedStage)
    ? persistedStage
    : callableFromPersistedMarker ? "CALLABLE_REGISTRATION" : NOT_RECORDED;
  const rawCode = parsed.rawCode || NOT_RECORDED;
  const reasonCodeCandidate = String(source.reasonCode ?? "").trim();
  const reasonCode = /^[\p{L}0-9_.:-]{2,80}$/u.test(reasonCodeCandidate) && reasonCodeCandidate !== "UNKNOWN"
    ? reasonCodeCandidate : NOT_RECORDED;
  const serverMessage = sanitizeProAttemptMessage(parsed.message || source.serverReason || source.lastQueueError)
    || "Mensagem específica não registrada.";
  const attemptAt = source.lastAttemptAt || source.queueClaimedAt || 0;
  const queuedAt = source.queuedAt || 0;
  const timestampLabel = Number(attemptAt) > 0
    ? source.lastAttemptAt ? "Última tentativa registrada" : "Último claim de envio registrado"
    : Number(queuedAt) > 0 ? "Enfileirado; tentativa não registrada" : "Horário não registrado";
  const timestamp = timestampOf(attemptAt || queuedAt);
  const diagnostic: Omit<SafeProAttemptDiagnostic, "text"> = {
    attemptId: maskDiagnosticId(source.attemptId),
    jobId: maskDiagnosticId(source.jobId),
    operationId: maskDiagnosticId(source.operationId),
    canonicalTripId: maskDiagnosticId(source.canonicalTripId || source.tripId),
    timestampLabel,
    timestamp,
    queueStatus: String(source.queueStatus || NOT_RECORDED).slice(0, 40),
    rawCode,
    reasonCode,
    stage,
    callable,
    serverMessage,
    attemptCount: Number.isFinite(Number(source.attemptCount)) && Number(source.attemptCount) >= 0
      ? String(Math.trunc(Number(source.attemptCount))) : NOT_RECORDED,
  };
  const text = [
    "NVU PRO — diagnóstico local seguro (somente leitura)",
    `attemptId parcial: ${diagnostic.attemptId}`,
    `jobId parcial: ${diagnostic.jobId}`,
    `operationId parcial: ${diagnostic.operationId}`,
    `canonicalTripId parcial: ${diagnostic.canonicalTripId}`,
    `${diagnostic.timestampLabel}: ${diagnostic.timestamp}`,
    `queueStatus: ${diagnostic.queueStatus}`,
    `Código bruto: ${diagnostic.rawCode}`,
    `reasonCode: ${diagnostic.reasonCode}`,
    `stage: ${diagnostic.stage}`,
    `callable/fluxo: ${diagnostic.callable}`,
    `Tentativas registradas: ${diagnostic.attemptCount}`,
    `lastQueueError/mensagem server-side sanitizada: ${diagnostic.serverMessage}`,
  ].join("\n");
  return { ...diagnostic, text };
}

/** Copies only a previously sanitized DTO; no app persistence or retry API is available here. */
export async function copySafeProAttemptDiagnostic(
  diagnostic: SafeProAttemptDiagnostic,
  writeText: (text: string) => Promise<void>,
): Promise<void> {
  await writeText(diagnostic.text);
}
