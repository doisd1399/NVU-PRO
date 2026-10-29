package com.nvu.operacional;

import java.text.Normalizer;
import java.util.Locale;

/** Single domain policy for durable Pro/Print submission failures.
 * Transport/Firebase status codes are never terminal by themselves.
 */
final class PendingTripFailurePolicy {
    private PendingTripFailurePolicy() {}

    static boolean isReconciliationRequired(String reason) {
        String value = normalizeText(reason);
        return value.contains("OPERATION_RECONCILIATION_REQUIRED")
            || value.contains("RESERVA OPERACIONAL SEM HISTORICO CONFIRMADO")
            || value.contains("RESERVA SEM HISTORICO CONFIRMADO")
            || value.contains("RECONCILIE A OPERACAO ANTES DO ENVIO")
            || value.contains("RECONCILIACAO NECESSARIA");
    }

    /** Terminal operation errors must remain blocked; failed-precondition alone is not enough to retry. */
    static boolean isTerminalOperationRejection(String reason) {
        String value = normalizeText(reason);
        if (value.contains("OPERATION_RECONCILIATION_REQUIRED")
            || value.contains("RESERVA OPERACIONAL SEM HISTORICO CONFIRMADO")
            || value.contains("RECONCILIE A OPERACAO ANTES DO ENVIO")) return false;
        return value.contains("OPERATION_CLOSED")
            || value.contains("OPERACAO NAO INICIADA") && value.contains("NAO DISPONIVEL")
            || value.contains("OPERACAO CONCLUIDA")
            || value.contains("OPERACAO ENCERRADA")
            || value.contains("OPERATION NOT STARTED") && value.contains("UNAVAILABLE")
            || value.contains("OPERATION COMPLETED")
            || value.contains("OPERATION CLOSED");
    }

    private static String normalizeText(String reason) {
        return Normalizer.normalize(reason == null ? "" : reason, Normalizer.Form.NFD)
            .replaceAll("\\p{M}+", "")
            .toUpperCase(Locale.ROOT)
            .replaceAll("\\s+", " ")
            .trim();
    }

    static boolean isPermanentRejection(String reason) {
        String value = reason == null ? "" : reason;
        if (isReconciliationRequired(value)) return false;
        if (isTerminalOperationRejection(value)) return true;
        // A rejected immutable receipt is not a transport failure. Older APKs
        // preserved the server's Portuguese message but lost details.retryable.
        // Keep those attempts for owner review, never retry the same evidence.
        String normalized = normalizeText(value);
        if (normalized.contains("SIMPLE_EVIDENCE_UNCONFIRMED")
            || normalized.contains("SIMPLE_RESULT_SCREEN_UNCONFIRMED")
            || normalized.contains("SIMPLE_BONUS_EVIDENCE_INVALID")
            || normalized.contains("EVIDENCIA SIMPLE NAO CONFIRMADA")) return true;
        if (value.matches("(?s).*(?:GTO_(?:CONTEXT|ROUTE|RECEIPT|AMOUNT|CURRENCY|SIMULATOR|BONUS|PREVIOUS_TRIP)_INVALID|GTO_CURRENCY_CONFLICT|DRIVER_SCOPE_MISMATCH|OPERATION_SCOPE_MISMATCH|RECEIPT_REPLAY_CONFLICT|RECEIPT_EVENT_CONFLICT|CONFIRMED_TRIP_CHANGED|OPERATION_LIMIT_REACHED|OPERATION_SUSPENDED|PREVIOUS_RECEIPT_CONFLICT).*")) return true;
        return value.contains("Recibo Pro não aprovado")
            || value.contains("Rota Pro inválida")
            || value.contains("Recibo ou contexto GTO inválido")
            || value.contains("Os vínculos da operação não pertencem ao motorista")
            || value.contains("Simulador Pro incompatível")
            || value.contains("mesmo valor já foi registrado consecutivamente")
            || value.contains("Operação concluída ou indisponível")
            || value.contains("Operação não iniciada ou não disponível")
            || value.contains("Operação encerrada ou sem entregas disponíveis")
            || value.contains("Limite da operação atingido")
            || value.contains("Viagem removida no servidor")
            || value.contains("NATIVE_RECEIPT_EVIDENCE_CONFLICT")
            || value.contains("SCOPE_MISMATCH")
            || value.contains("diverge do registro anterior")
            || value.contains("diverge da viagem registrada")
            || value.contains("alterada ou excluída; revisão necessária")
            || value.contains("Slot anterior não pertence")
            || value.contains("Comprovante anterior não corresponde")
            || value.contains("Tentativa idempotente divergente")
            || value.contains("Replay não pertence")
            || value.contains("já pertence a outra viagem")
            || value.contains("já pertence a uma viagem registrada")
            || value.contains("Atividades operacionais suspensas")
            || value.contains("LOW_VALUE_REPAIR_NOT_CONFIRMED")
            || value.contains("SIMPLE_REGISTRATION_FAILED:ALREADY_EXISTS");
    }

    /** A user action cannot override an explicit domain rejection. Unknown
     * FAILED/CONFLICT records also need review; only recognizable old transport
     * failures and reconciliation requests may be released without new evidence. */
    static boolean isSpecificGtoContractMismatch(String queueStatus, String canonicalState,
                                                   String reasonCode, String errorCode,
                                                   String error, String callable, String stage) {
        String raw = error == null ? "" : error;
        return "FAILED".equals(queueStatus) && "FAILED".equals(canonicalState)
            && ("GTO_SERVER_CONTRACT_MISMATCH".equals(reasonCode)
                || reasonCode == null || reasonCode.isEmpty())
            && ("INVALID_ARGUMENT".equals(errorCode)
                || "GTO_PRO_REGISTRATION_FAILED:INVALID_ARGUMENT:Recibo ou contexto GTO inválido.".equals(errorCode))
            && "registerGtoProReceipt".equals(callable)
            && "CALLABLE_REGISTRATION".equals(stage)
            && (raw.equals("GTO_PRO_REGISTRATION_FAILED:INVALID_ARGUMENT:Recibo ou contexto GTO inválido.")
                || "GTO_PRO_REGISTRATION_FAILED:INVALID_ARGUMENT:Recibo ou contexto GTO inválido.".equals(errorCode));
    }

    static boolean canRetry(String queueStatus, String canonicalState, String reason) {
        if (isPermanentRejection(reason) || "CONFLICT".equals(queueStatus)
            || "CONFLICT".equals(canonicalState)) return false;
        boolean failed = "FAILED".equals(queueStatus) || "FAILED".equals(canonicalState);
        return !failed || isReconciliationRequired(reason) || isLegacyRecoverableFailure(reason);
    }

    static boolean isAutomaticRecoveryAllowed(String reason) {
        if (isPermanentRejection(reason)) return false;
        String value = normalizeText(reason);
        return isReconciliationRequired(reason)
            || value.matches("(?s).*(?:UNAVAILABLE|DEADLINE_EXCEEDED|NETWORK_REQUEST_FAILED|RESOURCE_EXHAUSTED|ABORTED|REGISTRATION_FAILED:INTERNAL|BACKEND_NOT_DEPLOYED|BACKEND_UNAVAILABLE).*?");
    }

    private static boolean isLegacyRecoverableFailure(String reason) {
        String value = normalizeText(reason);
        return value.matches("(?s).*(?:GTO_PRO_REGISTRATION_FAILED|SIMPLE_REGISTRATION_FAILED):(?:FAILED_PRECONDITION|UNAVAILABLE|DEADLINE_EXCEEDED|ABORTED|RESOURCE_EXHAUSTED|INTERNAL)(?::.*)?")
            && !isPermanentRejection(reason);
    }
}
