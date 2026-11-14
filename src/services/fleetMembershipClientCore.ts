export type MembershipCommand = {
  action: "remove" | "approve-application" | "approve-request" | "set-role" | "leave" | "leave-preview" | "withdraw-application" | "capabilities";
  companyId: string;
  targetUserId?: string;
  applicationId?: string;
  requestId?: string;
  role?: "admin" | "driver";
  diagnosticId?: string;
};
type Ports = {
  ready: () => Promise<unknown>;
  getUser: () => { uid: string; getIdToken: (refresh: boolean) => Promise<unknown> } | null;
  invoke: (payload: Record<string, unknown>) => Promise<{ data: any }>;
  /** Test clock override; production checks the receipt after four seconds. */
  recoveryAfterMs?: number;
};
const codeOf = (error: any) => String(error?.code || "").replace(/^functions\//, "");
const ambiguous = (error: unknown) => ["internal", "unavailable", "deadline-exceeded", "unknown"].includes(codeOf(error));

export async function executeFleetMembershipClient(command: MembershipCommand, ports: Ports) {
  await ports.ready();
  const uid = ports.getUser()?.uid;
  if (!uid) throw Object.assign(new Error("Sua sessão expirou. Entre novamente para alterar o vínculo."), { code: "functions/unauthenticated" });
  const payload = { ...command, diagnosticId: command.diagnosticId || (globalThis.crypto?.randomUUID?.() || `fleet-${Date.now()}-${Math.random().toString(36).slice(2)}`) };
  const assertOwner = () => {
    if (ports.getUser()?.uid !== uid) throw Object.assign(new Error("A conta mudou. Atualize a frota para consultar o resultado."), { code: "MEMBERSHIP_SESSION_CHANGED" });
  };
  const validate = (data: any) => {
    assertOwner();
    // A capability listing is not about one company.
    if (command.action === "capabilities" && data?.success === true) return data;
    if (data?.success !== true || data.companyId !== command.companyId ||
        (data.commandId && data.commandId !== payload.diagnosticId) ||
        (command.targetUserId && (data.userId || data.targetUserId) && (data.userId || data.targetUserId) !== command.targetUserId) ||
        (command.applicationId && data.applicationId && data.applicationId !== command.applicationId) ||
        (command.requestId && data.requestId && data.requestId !== command.requestId))
      throw Object.assign(new Error("O servidor não confirmou o resultado desta ação."), { code: "MEMBERSHIP_ACK_INVALID" });
    return data;
  };
  let refreshed = false;
  const invoke = async (body: Record<string, unknown>) => {
    assertOwner();
    try { const result = await ports.invoke(body); assertOwner(); return result; }
    catch (error) {
      assertOwner();
      if (codeOf(error) !== "unauthenticated" || refreshed) throw error;
      refreshed = true;
      await ports.getUser()!.getIdToken(true);
      assertOwner();
      const result = await ports.invoke(body); assertOwner(); return result;
    }
  };
  const status = async () => {
    const response = await invoke({ ...payload, action: "command-status", commandAction: command.action });
    if (response.data?.membershipProtocolVersion !== 513 || !["COMPLETED", "NOT_FOUND"].includes(response.data?.commandStatus))
      throw Object.assign(new Error("Atualize o serviço de vínculos no servidor para confirmar esta ação."), { code: "MEMBERSHIP_STATUS_UNSUPPORTED" });
    return response.data;
  };
  try {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const initial = invoke(payload).then(response => validate(response.data));
      // A committed approval can lose/delay its HTTP response. Consult the
      // server-owned receipt once while the original request is still pending.
      // NOT_FOUND is never success and never starts a concurrent mutation.
      const earlyReceipt = new Promise<any>(resolve => {
        timer = setTimeout(() => {
          void status().then(saved => {
            if (saved.commandStatus === "COMPLETED") resolve(validate(saved.result));
          }).catch(() => { /* The original request remains authoritative. */ });
        }, ports.recoveryAfterMs ?? 4_000);
      });
      try { return await Promise.race([initial, earlyReceipt]); }
      finally { if (timer !== undefined) clearTimeout(timer); }
    }
    catch (error) {
      if (!ambiguous(error)) throw error;
      // The first transaction may already have committed. Inspect its receipt
      // before replaying, and replay only the exact same command identity.
      let saved;
      try { saved = await status(); } catch { assertOwner(); throw error; }
      if (saved.commandStatus === "COMPLETED") return validate(saved.result);
      try { return validate((await invoke(payload)).data); }
      catch (retryError) {
        if (!ambiguous(retryError)) throw retryError;
        try { const recovered = await status(); if (recovered.commandStatus === "COMPLETED") return validate(recovered.result); }
        catch { assertOwner(); }
        throw retryError;
      }
    }
  } catch (error) {
    assertOwner();
    if (!ambiguous(error)) throw error;
    const failure = new Error(`Não foi possível confirmar a alteração da frota. Consulte o estado atual e tente novamente. Referência: ${payload.diagnosticId}`);
    throw Object.assign(failure, { code: (error as any)?.code || "functions/internal", details: {
      ...(error as any)?.details, diagnosticId: payload.diagnosticId, reasonCode: (error as any)?.details?.reasonCode || "MEMBERSHIP_RESPONSE_UNCONFIRMED",
    } });
  }
}
