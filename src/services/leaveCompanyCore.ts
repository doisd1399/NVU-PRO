/**
 * Voluntary exit from a company: everything that can be decided without the network or Firebase.
 * The server stays the authority (it re-checks every rule inside one transaction); this module only prepares the
 * confirmation, refuses to start while the device still holds work the server cannot see, and words the outcome.
 */

export type LeavePreview = {
  companyId: string;
  companyName: string;
  canLeave: boolean;
  /** Server reason code when `canLeave` is false (LEAVE_OWNER, LEAVE_AWAITING_COMPLETION, ...). */
  blocker: string | null;
  jobsToCancel: number;
  awaitingCompletion: number;
  alreadyLeft: boolean;
};

const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;

/** Accepts only a well-formed answer for this company; anything else is treated as "not available". */
export function parseLeavePreview(data: any, companyId: string): LeavePreview | null {
  if (!data || data.success !== true || data.preview !== true || data.companyId !== companyId) return null;
  return {
    companyId,
    companyName: typeof data.companyName === "string" ? data.companyName.trim() : "",
    canLeave: data.canLeave === true,
    blocker: typeof data.blocker === "string" && data.blocker ? data.blocker : null,
    jobsToCancel: count(data.jobsToCancel),
    awaitingCompletion: count(data.awaitingCompletion),
    alreadyLeft: data.alreadyLeft === true,
  };
}

const codeOf = (error: any) => String(error?.code || "").replace(/^functions\//, "");

/** A server published before this feature answers "Ação de vínculo inválida": the exit must stay hidden. */
export function isLeaveUnsupported(error: unknown): boolean {
  const code = codeOf(error);
  return code === "invalid-argument" || code === "not-found" || code === "unimplemented";
}

export function isLeaveCommandAcknowledged(data: any, companyId: string, userId: string): boolean {
  return Boolean(data && data.success === true && data.left === true && data.companyId === companyId && (!data.userId || data.userId === userId));
}

export type LocalPendingPorts = {
  online: boolean;
  /** Canonical trips of this driver and company that the server has not confirmed yet. */
  registrations: () => number;
  /** Older queue records that carry this company, or no company at all (they cannot be proven to belong elsewhere). */
  legacyTrips: () => number;
  /** Start/finish commands of this company still waiting to be delivered. */
  operations: () => number;
  /** Native Pro/GTO queue on the device. A failure to read it is a refusal, never a pass. */
  native: () => Promise<number>;
};

export type LeavePreflight =
  | { ok: true }
  | { ok: false; reason: "offline" | "pending-work" | "unverifiable"; count: number };

export async function localLeavePreflight(ports: LocalPendingPorts): Promise<LeavePreflight> {
  if (!ports.online) return { ok: false, reason: "offline", count: 0 };
  let native: number;
  try { native = await ports.native(); }
  catch { return { ok: false, reason: "unverifiable", count: 0 }; }
  const pending = ports.registrations() + ports.legacyTrips() + ports.operations() + native;
  return pending > 0 ? { ok: false, reason: "pending-work", count: pending } : { ok: true };
}

export function leaveDialogCopy(preview: LeavePreview) {
  const jobs = preview.jobsToCancel;
  return {
    title: preview.companyName ? `Sair da ${preview.companyName}?` : "Sair desta empresa?",
    lines: [
      { text: "Você deixará de receber trabalhos desta empresa e perderá o acesso à área dela." },
      jobs > 0
        ? { strong: `${jobs === 1 ? "1 trabalho em andamento será cancelado." : `${jobs} trabalhos em andamento serão cancelados.`}`, text: " As viagens já registradas serão mantidas." }
        : { text: "As viagens já registradas serão mantidas." },
      { text: "Sua conta e seu histórico pessoal continuam com você. Para voltar, será preciso uma nova inscrição aprovada." },
    ] as Array<{ strong?: string; text: string }>,
    stay: "Continuar na empresa",
    confirm: "Confirmar saída",
  };
}

export function blockedMessage(preview: LeavePreview): string {
  switch (preview.blocker) {
    case "LEAVE_AWAITING_COMPLETION":
      return preview.awaitingCompletion > 1
        ? "Finalize as operações que aguardam conclusão antes de sair da empresa."
        : "Finalize a operação que aguarda conclusão antes de sair da empresa.";
    case "LEAVE_OWNER": return "Transfira a propriedade da empresa antes de sair dela.";
    case "LEAVE_ACCOUNT_UNAVAILABLE": return "Sua conta está indisponível no momento e não pode sair da empresa.";
    case "LEAVE_TOO_MANY_JOBS": return "Há trabalhos demais para encerrar de uma vez. Peça à gestão para cancelá-los.";
    default: return "Não é possível sair da empresa agora. Tente novamente mais tarde.";
  }
}

export function preflightMessage(result: Exclude<LeavePreflight, { ok: true }>): string {
  if (result.reason === "offline") return "Conecte-se à internet para sair da empresa.";
  if (result.reason === "unverifiable") return "Não foi possível verificar as viagens pendentes deste aparelho. Tente novamente em instantes.";
  return result.count === 1
    ? "Você tem 1 viagem ou envio ainda não enviado neste aparelho. Aguarde o envio terminar antes de sair da empresa."
    : `Você tem ${result.count} viagens ou envios ainda não enviados neste aparelho. Aguarde o envio terminar antes de sair da empresa.`;
}

/** Wording for a failure of the exit command itself. The reference is kept so support can find the server log. */
export function leaveFailureMessage(error: any): string {
  const reason = String(error?.details?.reasonCode || "");
  if (reason === "LEAVE_AWAITING_COMPLETION") return "Finalize a operação que aguarda conclusão antes de sair da empresa.";
  if (reason === "LEAVE_OWNER") return "Transfira a propriedade da empresa antes de sair dela.";
  if (reason === "LEAVE_NOT_LINKED") return "Você já não possui vínculo ativo com esta empresa.";
  if (reason === "LEAVE_ACCOUNT_UNAVAILABLE") return "Sua conta está indisponível no momento e não pode sair da empresa.";
  const reference = String(error?.details?.diagnosticId || "").trim();
  const suffix = reference ? ` Referência: ${reference}.` : "";
  if (["unavailable", "deadline-exceeded", "internal", "unknown"].includes(codeOf(error)) || error?.details?.reasonCode === "MEMBERSHIP_RESPONSE_UNCONFIRMED")
    return `Não foi possível confirmar a saída. Nada foi perdido: tente novamente.${suffix}`;
  return `Não foi possível sair da empresa agora.${suffix}`;
}
