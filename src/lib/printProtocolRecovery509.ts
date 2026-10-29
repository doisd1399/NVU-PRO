import { readGtoPrintEvidence } from "../../functions/src/gtoPrintEvidence";

/** A narrow, explicit replay for failures caused by the 506/507 Print contract transition.
 * Never infer success, alter the captured evidence or requeue unrelated refusals. */
export function isEligiblePrintProtocolReplay(trip: Record<string, unknown>, lastError: string | undefined): boolean {
  const error = String(lastError || "");
  const knownContractRejection = /GTO_RECEIPT_AMOUNT_OR_BONUS_INVALID/.test(error) ||
    /Campo não permitido:\s*gtoReceiptEvidence\b/i.test(error) ||
    /Field not allowed:\s*gtoReceiptEvidence\b/i.test(error);
  if (!knownContractRejection || !/(?:^|:)\s*(?:functions\/)?invalid-argument\b/i.test(error)) return false;
  if (trip.gtoEntryMode !== "print" || trip.gtoReceiptAnalyzed !== true ||
      trip.gtoRewardedAdDetected === true || !String(trip.imageHash || "") ||
      !String(trip.offlineReceiptKey || "")) return false;
  const cents = Number(trip.valorCents);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 1_000_000_000 ||
      Math.round(Number(trip.valor) * 100) !== cents) return false;
  const reading = readGtoPrintEvidence(trip.receiptText, trip.gtoReceiptEvidence);
  return reading.amountCents === cents && reading.currencyConflict !== true;
}

/** Human-readable, privacy-safe diagnostics. Does not render full server messages or IDs. */
export function pendingTripFailureExplanation(lastError: string | undefined): string {
  const error = String(lastError || "");
  if (/Campo não permitido:\s*gtoReceiptEvidence\b|Field not allowed:\s*gtoReceiptEvidence\b/i.test(error))
    return "Incompatibilidade entre o contrato Print do aplicativo e o endpoint publicado. É necessário conferir a versão do servidor antes de reenviar.";
  if (/GTO_RECEIPT_AMOUNT_OR_BONUS_INVALID|GTO_RECEIPT_ANALYSIS_REQUIRED/.test(error))
    return "O servidor não aceitou a evidência de valor do comprovante. Compare a política e a revisão do endpoint antes de tentar novamente.";
  if (/CANONICAL_TRIP_ATTEMPT_CONFLICT|CANONICAL_TRIP_CONFLICT|ACK_EVIDENCE_CONFLICT/i.test(error))
    return "Conflito de identidade ou dados da tentativa. Não gere outra viagem; confira o registro existente no servidor.";
  if (/permission-denied|unauthenticated|storage\/unauthorized/i.test(error))
    return "Autenticação ou vínculo não autorizado. Confira a sessão e a associação com a empresa.";
  if (/failed-precondition|OPERATION_RECONCILIATION_REQUIRED/i.test(error))
    return "Uma condição da operação impediu o registro. É necessária revisão do vínculo e do estado da operação.";
  if (/unavailable|deadline-exceeded|functions\/internal/i.test(error))
    return "Falha de comunicação ou do servidor. O comprovante original continua preservado.";
  if (error) return "Recusa ainda não classificada. Consulte o código e a etapa no diagnóstico técnico antes de qualquer alteração.";
  return "Não há diagnóstico completo salvo para esta pendência. Preserve os dados deste aparelho.";
}
