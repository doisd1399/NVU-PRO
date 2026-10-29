import { resolveTripCurrency } from "../../lib/tripNormalizer";

/** Only client-owned registration fields cross the callable boundary. */
const registrationFields = new Set([
  "tripId", "canonicalTripId", "deterministicTripId", "clientRequestId", "idempotencyKey",
  "source", "driverId", "motoristaId", "companyId", "empresaId", "contractId", "contratoId", "currency", "moeda", "moneyCurrency", "receiptCurrency",
  "jobId", "operationId", "trabalhoId", "origem", "origin", "destino", "destination",
  "comprovanteUrl", "comprovanteTituloOriginal", "imageHash", "receiptText",
  "simpleAutomation", "simpleAutomationVersion", "simpleReceiptCurrency", "simpleReceiptSourceField",
  "simpleReceiptResultScreenConfirmed", "simpleReceiptBonusEvidence", "simpleReceiptConfidence",
  "simpleReceiptCapturedAt", "simpleReceiptCaptureAttemptId", "simpleReceiptCaptureContextEpoch",
  "simpleReceiptHash", "simpleDuplicateGuardKey", "gtoEntryMode", "gtoReceiptAnalyzed",
  "gtoRewardedAdDetected", "gtoReceiptValidationMode", "gtoReceiptManualConfirmation",
  "gtoReceiptEvidence",
  "valorDetectadoAutomaticamente", "valorDeteccaoMetodo", "simulatorKey", "simulatorId",
  "simulatorCode", "simulatorName", "simuladorNome", "simuladorCodigo", "veiculoId",
  "veiculoNome", "veiculoPlaca", "reboqueId", "reboqueNome", "registroAutomatico",
  "motoristaNome", "empresaNome", "contratoNumero", "contratoDescricao", "distanciaPercorrida",
  "automationSource", "nativeSubmission", "nativeSubmissionVersion", "createdAtClient",
  "completedAtClient", "createdAtLocal", "completedAtLocal",
]);

export function buildCanonicalTripRegistrationRequest(
  trip: Record<string, unknown>, receiptUrl: string,
): { trip: Record<string, unknown> } {
  const amount = Number(trip.valor ?? trip.earnings);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(cents) || cents <= 0 || cents > 1_000_000_000) {
    throw new Error("CANONICAL_TRIP_AMOUNT_INVALID");
  }
  if (trip.valorCents != null && Number(trip.valorCents) !== cents) {
    throw new Error("CANONICAL_TRIP_AMOUNT_MISMATCH");
  }
  const payload = Object.fromEntries(Object.entries(trip)
    .filter(([key, value]) => value !== undefined && registrationFields.has(key)));
  const money = resolveTripCurrency(trip);
  const explicitCurrency = money.currencyStatus === "known" && money.currency && money.currencySource !== "SIMULATOR_REGISTRY";
  if (trip.simpleAutomation === true) {
    for (const field of ["currency", "moeda", "moneyCurrency", "receiptCurrency", "simpleReceiptCurrency"]) delete payload[field];
    if (explicitCurrency) payload.simpleReceiptCurrency = money.currency;
  } else if (explicitCurrency) {
    // Compatibility boundary: Simple/Pro already had a server contract through
    // simpleReceiptCurrency. Do not widen the callable payload with `currency`
    // for that legacy path; older deployed writers reject the new field before
    // idempotency can run. The server persists canonical currency from the
    // legacy alias when supported. Generic/Print registrations keep `currency`.
    payload.currency = money.currency;
  }
  // `moeda` is a read-side legacy alias, not a callable field. Normalize it
  // without silently discarding conflicting or unsupported currency evidence.
  if (trip.simpleAutomation !== true && payload.moeda !== undefined) {
    if (money.currencyStatus !== "conflict") {
      if (!payload.currency) payload.currency = payload.moeda;
      delete payload.moeda;
    }
  }
  payload.valor = cents / 100;
  payload.valorCents = cents;
  if (receiptUrl) payload.comprovanteUrl = receiptUrl;
  else delete payload.comprovanteUrl;
  return { trip: payload };
}
