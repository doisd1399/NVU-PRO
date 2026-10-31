/** Client-side rules for withdrawing an own application. The server decides; this only words and validates. */

export function parseCapabilities(data: any): string[] {
  if (!data || data.success !== true || !Array.isArray(data.capabilities)) return [];
  return data.capabilities.filter((item: unknown): item is string => typeof item === "string");
}

const codeOf = (error: any) => String(error?.code || "").replace(/^functions\//, "");

export function isWithdrawAcknowledged(data: any, companyId: string, applicationId: string): boolean {
  return Boolean(data && data.success === true && data.withdrawn === true && data.companyId === companyId && data.applicationId === applicationId);
}

export function withdrawFailureMessage(error: any): string {
  switch (String(error?.details?.reasonCode || "")) {
    case "WITHDRAW_ALREADY_APPROVED": return "Esta inscrição já foi aprovada pela empresa.";
    case "WITHDRAW_ALREADY_ANSWERED": return "A empresa já respondeu esta inscrição.";
    case "WITHDRAW_NOT_FOUND": return "Esta inscrição não existe mais.";
    case "WITHDRAW_ACCOUNT_UNAVAILABLE": return "Sua conta está indisponível no momento.";
  }
  const reference = String(error?.details?.diagnosticId || "").trim();
  const suffix = reference ? ` Referência: ${reference}.` : "";
  if (["unavailable", "deadline-exceeded", "internal", "unknown"].includes(codeOf(error)))
    return `Não foi possível confirmar a retirada. Tente novamente.${suffix}`;
  return `Não foi possível retirar a inscrição agora.${suffix}`;
}
