import { sanitizeProAttemptMessage, type ProAttemptDiagnosticSource } from "./proAttemptDiagnostic";

/** The native queue owns the retry verdict; the Web surface only presents it. */
type PendingActionSource = ProAttemptDiagnosticSource & { retryAllowed?: boolean; contractRecoveryAvailable?: boolean };
export function presentProPendingTrip(trip: PendingActionSource) {
  const status = String(trip.queueStatus || "").toUpperCase();
  const blocked = trip.retryAllowed === false
    || (trip.retryAllowed === undefined && ["FAILED", "CONFLICT"].includes(status));
  const persistedMessage = String(trip.lastQueueErrorCode || "")
    .match(/^(?:SIMPLE_REGISTRATION_FAILED|GTO_PRO_REGISTRATION_FAILED):[A-Z_]+:([\s\S]+)$/)?.[1];
  const failureMessage = trip.reasonCode === "GTO_SERVER_CONTRACT_MISMATCH"
    ? "O pacote passou pela validação local atual, mas foi recusado pelo servidor. Revise a compatibilidade entre aplicativo e backend."
    : sanitizeProAttemptMessage(trip.serverReason || persistedMessage || trip.lastQueueError || trip.reasonCode);
  const hint = blocked
    ? "O recibo continua salvo. Consulte o diagnóstico para revisar o motivo antes de reenviar."
    : "";
  return { blocked, failureMessage, hint, recoveryAvailable: trip.contractRecoveryAvailable === true };
}

/** Same predicate used by History; an unapproved send stays blocked while the
 * owner can explicitly check whether its saved capture can be recovered. */
export function canShowProPendingRetry(trip: PendingActionSource, uid: string | undefined,
  online: boolean, now = Date.now()): boolean {
  if (!uid || uid !== trip.driverId || !online || trip.queueStatus === "AUTH_REQUIRED") return false;
  const presentation = presentProPendingTrip(trip);
  if (presentation.blocked && !presentation.recoveryAvailable) return false;
  return trip.queueStatus !== "SENDING" || !trip.queueClaimedAt || now - trip.queueClaimedAt > 45_000;
}

/** Unknown/native statuses cannot claim that a send started. */
export function pendingRetryFeedback(status?: string): { kind: "info" | "warning" | "error"; message: string } {
  switch (status) {
    case "retry-backend-update-required":
      return { kind: "warning", message: "O registro de viagens precisa ser atualizado no servidor. A viagem continua salva." };
    case "retry-unavailable":
      return { kind: "warning", message: "Não foi possível verificar o envio agora. A viagem continua salva; tente novamente quando houver conexão." };
    case "pending-retry-requested":
      return { kind: "info", message: "Reenvio solicitado. Aguarde a confirmação do servidor." };
    case "pending-already-sending":
      return { kind: "info", message: "Esta viagem já está sendo enviada. Aguarde a resposta do servidor." };
    case "retry-blocked":
      return { kind: "warning", message: "O servidor rejeitou este registro. Consulte o diagnóstico; o recibo continua salvo." };
    case "pending-not-found":
      return { kind: "info", message: "Esta tentativa não está mais na fila. Atualize o histórico para conferir o registro." };
    case "pending-operation-completed":
      return { kind: "info", message: "Esta operação já foi finalizada. A tentativa local foi encerrada." };
    case "auth-required":
      return { kind: "warning", message: "Confirme a conta Google do motorista para enviar a viagem salva." };
    default:
      return { kind: "error", message: "Não foi possível iniciar o reenvio. Confira o estado da viagem no histórico." };
  }
}
