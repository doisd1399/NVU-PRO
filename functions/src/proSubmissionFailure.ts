/** Stable, safe domain codes. These contain no UID, route, receipt or payload. */
export function proSubmissionReasonCode(message: string): string {
  const checks: Array<[string, string]> = [
    ["OPERATION_RECONCILIATION_REQUIRED", "OPERATION_RECONCILIATION_REQUIRED"],
    ["reserva operacional sem histórico confirmado", "OPERATION_RECONCILIATION_REQUIRED"],
    ["SCOPE_MISMATCH", "OPERATION_SCOPE_MISMATCH"],
    ["vínculos da operação não pertencem", "OPERATION_SCOPE_MISMATCH"],
    ["tentativa salva diverge", "RECEIPT_REPLAY_CONFLICT"],
    ["captura salva diverge", "RECEIPT_EVENT_CONFLICT"],
    ["alterada ou excluída", "CONFIRMED_TRIP_CHANGED"],
    ["Slot anterior não pertence", "PREVIOUS_RECEIPT_CONFLICT"],
    ["Comprovante anterior não corresponde", "PREVIOUS_RECEIPT_CONFLICT"],
    ["Operação, contrato ou empresa não disponíveis", "OPERATION_CONTEXT_UNAVAILABLE"],
    ["Empresa não vinculada ao GTO", "GTO_COMPANY_SIMULATOR_MISMATCH"],
    ["Atividades operacionais suspensas", "OPERATION_SUSPENDED"],
    ["Operação encerrada ou sem entregas", "OPERATION_LIMIT_REACHED"],
    ["Numeração da operação inválida", "OPERATION_SLOT_INVALID"],
    ["Slot ocupado", "OPERATION_SLOT_CONFLICT"],
    ["Slot reservado", "OPERATION_SLOT_CONFLICT"],
    ["Outra viagem ocupa", "OPERATION_SLOT_CONFLICT"],
    ["Faça login", "AUTH_REQUIRED"],
  ];
  return checks.find(([text]) => message.includes(text))?.[1] || "GTO_REGISTRATION_REJECTED";
}
