export type WindowsAuthFailure = { kind: "expired" | "network" | "client" | "unavailable" | "unknown"; code: string; message: string; retryable: boolean };

/**
 * The Windows application throws errors whose message starts with a stable code (see desktop/windows/core/google-auth.cjs).
 * Electron wraps them as "Error invoking remote method '…': Error: CODE: text", so the code is searched, not assumed to be first.
 * A rejected or expired credential is never reported as "no internet".
 */
export function classifyWindowsAuthError(error: unknown): WindowsAuthFailure {
  const text = String((error as { message?: string } | null)?.message ?? error ?? "");
  const code = text.match(/\b(GOOGLE_[A-Z_]+|WINDOWS_CREDENTIAL_STORAGE_UNAVAILABLE)\b/)?.[1] ?? "UNKNOWN";
  switch (code) {
    case "GOOGLE_TOKEN_REVOKED": return { kind: "expired", code, retryable: false, message: "Sua sessão do Google expirou ou foi revogada. Entre novamente para continuar." };
    case "GOOGLE_NETWORK": return { kind: "network", code, retryable: true, message: "Sem conexão com o Google. Sua sessão está salva neste computador; tentaremos de novo quando a rede voltar." };
    case "GOOGLE_UNAVAILABLE": return { kind: "unavailable", code, retryable: true, message: "O Google está indisponível no momento. Tentaremos de novo em instantes." };
    case "GOOGLE_CLIENT_INVALID": return { kind: "client", code, retryable: false, message: "O login Windows foi recusado pelo Google (cliente OAuth). Avise o administrador da NVU." };
    case "WINDOWS_CREDENTIAL_STORAGE_UNAVAILABLE": return { kind: "client", code, retryable: false, message: "O Windows não liberou o cofre de credenciais para a NVU. Entre novamente; se persistir, avise o suporte." };
    default: return { kind: "unknown", code, retryable: false, message: "Não foi possível restaurar a sessão do Google. Entre novamente." };
  }
}
