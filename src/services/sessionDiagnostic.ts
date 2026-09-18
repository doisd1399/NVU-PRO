export type SessionDiagnosticCode =
  | "AUTH_SIGNED_OUT"
  | "AUTH_UID_CONFIRMED"
  | "IDENTITY_RECONCILIATION_PENDING"
  | "IDENTITY_RECONCILIATION_COMPLETE"
  | "IDENTITY_RECONCILIATION_FAILED"
  | "MEMBERSHIP_SERVER_PENDING"
  | "MEMBERSHIP_CACHE_ONLY"
  | "MEMBERSHIP_SERVER_FOUND"
  | "MEMBERSHIP_SERVER_EMPTY"
  | "MEMBERSHIP_SERVER_ERROR"
  | "LOGOUT_COMPLETE";

export interface SessionDiagnostic {
  code: SessionDiagnosticCode;
  uidSuffix: string | null;
  generation: number;
  at: string;
  detail?: string;
}

const STORAGE_KEY = "nvu.session.diagnostic.v1";

export const redactUid = (uid: string | null | undefined) => {
  if (!uid) return null;
  const value = String(uid);
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
};

export const sessionDiagnosticMessage = (diagnostic: SessionDiagnostic) => {
  switch (diagnostic.code) {
    case "AUTH_SIGNED_OUT":
      return "Nenhuma sessão Firebase está autenticada.";
    case "AUTH_UID_CONFIRMED":
      return "A conta Google foi autenticada e a UID foi confirmada.";
    case "IDENTITY_RECONCILIATION_PENDING":
      return "A identidade está sendo reconciliada antes da leitura dos vínculos.";
    case "IDENTITY_RECONCILIATION_COMPLETE":
      return "A reconciliação da identidade terminou; a consulta canônica será avaliada.";
    case "IDENTITY_RECONCILIATION_FAILED":
      return "A autenticação foi concluída, mas a reconciliação da identidade falhou ou expirou.";
    case "MEMBERSHIP_SERVER_PENDING":
      return "A consulta canônica de vínculos ainda não recebeu uma resposta do servidor.";
    case "MEMBERSHIP_CACHE_ONLY":
      return "Há dados locais de apresentação, mas ainda não há confirmação do servidor.";
    case "MEMBERSHIP_SERVER_FOUND":
      return "O servidor confirmou um ou mais vínculos para a UID atual.";
    case "MEMBERSHIP_SERVER_EMPTY":
      return "O servidor confirmou zero vínculos ativos para a UID atual.";
    case "MEMBERSHIP_SERVER_ERROR":
      return "A leitura canônica de vínculos falhou antes de confirmar o resultado.";
    case "LOGOUT_COMPLETE":
      return "A sessão anterior foi encerrada e seus dados privados foram limpos.";
    default:
      return "Estado de sessão não identificado.";
  }
};

export const createSessionDiagnostic = (
  code: SessionDiagnosticCode,
  uid: string | null | undefined,
  generation: number,
  detail?: string,
): SessionDiagnostic => ({
  code,
  uidSuffix: redactUid(uid),
  generation,
  at: new Date().toISOString(),
  ...(detail ? { detail } : {}),
});

export const persistSessionDiagnostic = (diagnostic: SessionDiagnostic | null) => {
  try {
    if (!diagnostic) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(diagnostic));
  } catch {
    // Diagnostics are best-effort and must never block Auth.
  }
};

export const readPersistedSessionDiagnostic = (): SessionDiagnostic | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionDiagnostic;
    if (!parsed || typeof parsed.code !== "string" || typeof parsed.at !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};
