export type AdminRejectionCallableName =
  | "rejectDriverRequest"
  | "rejectRecruitmentApplication";

export interface AdminRejectionResult {
  success: true;
  status: "rejected";
  requestId?: string;
  applicationId?: string;
  companyId: string;
  userId?: string;
}

export type AdminRejectionPayload =
  | { requestId: string }
  | { applicationId: string };

export interface AdminRejectionClientDependencies {
  currentUid: () => string | null | Promise<string | null>;
  invoke: (
    name: AdminRejectionCallableName,
    payload: AdminRejectionPayload,
  ) => Promise<{ data: AdminRejectionResult }>;
  refreshCurrentToken?: () => Promise<void>;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  return String((error as { code?: unknown }).code ?? "");
}

export function createAdminRejectionClient(
  dependencies: AdminRejectionClientDependencies,
) {
  async function call(
    name: AdminRejectionCallableName,
    payload: AdminRejectionPayload,
  ): Promise<AdminRejectionResult> {
    const initialUid = await dependencies.currentUid();
    if (!initialUid) {
      throw Object.assign(
        new Error("Sua sessão expirou. Entre novamente para concluir a ação."),
        { code: "functions/unauthenticated" },
      );
    }

    let response: { data: AdminRejectionResult };
    try {
      response = await dependencies.invoke(name, payload);
    } catch (error) {
      if (
        errorCode(error) !== "functions/unauthenticated" ||
        !dependencies.refreshCurrentToken ||
        (await dependencies.currentUid()) !== initialUid
      ) {
        throw error;
      }
      await dependencies.refreshCurrentToken();
      if ((await dependencies.currentUid()) !== initialUid) {
        throw new Error("A conta mudou durante a rejeição. Atualize a lista e tente novamente.");
      }
      response = await dependencies.invoke(name, payload);
    }

    if ((await dependencies.currentUid()) !== initialUid) {
      throw new Error("A conta mudou. Atualize a lista para consultar o resultado da rejeição.");
    }
    if (response.data?.success !== true || response.data.status !== "rejected") {
      throw new Error("O servidor não confirmou a rejeição.");
    }
    return response.data;
  }

  return {
    rejectDriverRequestOnServer(requestId: string) {
      const id = requestId.trim();
      if (!id) throw new Error("requestId é obrigatório.");
      return call("rejectDriverRequest", { requestId: id });
    },
    rejectRecruitmentApplicationOnServer(applicationId: string) {
      const id = applicationId.trim();
      if (!id) throw new Error("applicationId é obrigatório.");
      return call("rejectRecruitmentApplication", { applicationId: id });
    },
  };
}
