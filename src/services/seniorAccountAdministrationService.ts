import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";

async function callSenior<T extends Record<string, unknown>>(name: string, payload: T) {
  const callable = httpsCallable(functions, name);
  const response = await callable(payload);
  if ((response.data as any)?.pending) throw Object.assign(new Error("Ação salva e em processamento. O servidor retomará automaticamente as etapas pendentes."), { code: "ADMIN_ACTION_PENDING", actionId: (response.data as any).actionId });
  if (!(response.data as any)?.success) throw new Error("O servidor não confirmou a operação.");
  return response.data as any;
}

export const removeDriverFromFleetSenior = (targetUserId: string, companyId: string, reason: string) =>
  callSenior("removeDriverFromFleetSenior", { targetUserId, companyId, reason });

export const suspendSeniorAccount = (targetUserId: string, reason: string, expiresAt: string | undefined, companyId: string) =>
  callSenior("suspendSeniorAccount", { targetUserId, reason, companyId, ...(expiresAt ? { expiresAt } : {}) });

export const reactivateSeniorAccount = (targetUserId: string, companyId: string) =>
  callSenior("reactivateSeniorAccount", { targetUserId, companyId });

export const deleteSeniorProfile = (targetUserId: string, reason: string, confirmation: boolean, companyId: string) =>
  callSenior("deleteSeniorProfile", { targetUserId, reason, confirmation, companyId });

export const reverseSeniorSuspension = (targetUserId: string, companyId: string, originalActionId?: string) =>
  callSenior("reverseSeniorSuspension", { targetUserId, companyId, ...(originalActionId ? { originalActionId } : {}) });

export const endSeniorOperationalSuspension = (targetUserId: string, companyId: string) =>
  callSenior("endSeniorOperationalSuspension", { targetUserId, companyId });

export async function listSeniorSuspendedMembers() {
  const callable = httpsCallable(functions, "listSeniorSuspendedMembers");
  try {
    const response = await callable({});
    const data = response.data as any;
    if (!data?.success) throw new Error("O servidor não confirmou a consulta de suspensos.");
    return Array.isArray(data.members) ? data.members : [];
  } catch (error: any) {
    const code = String(error?.code || "").trim();
    const message = String(error?.message || "Não foi possível consultar os membros suspensos no servidor.").trim();
    throw new Error(code ? `${message} [${code}]` : message);
  }
}

export const deleteCompanyCanonical = (companyId: string) => callSenior("deleteCompanyCanonical", { companyId });
