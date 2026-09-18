import {
  hasRemainingDeliveries,
  isClosedJobStatus,
  isTripRecordableJobStatus,
  normalizeJobStatus,
} from "./jobStatus";

export type ProLaunchAvailabilityState =
  | "missing-operation"
  | "pending"
  | "ready"
  | "awaiting-completion"
  | "closed"
  | "invalid-context";

export type ProLaunchAvailability = {
  state: ProLaunchAvailabilityState;
  canLaunch: boolean;
  message: string;
};

export type ProLaunchContext = {
  job?: {
    status?: unknown;
    progress?: unknown;
  } | null;
  totalDeliveries?: unknown;
  hasContract: boolean;
  hasUser: boolean;
  hasCompany: boolean;
};

const messages: Record<ProLaunchAvailabilityState, string> = {
  "missing-operation": "Inicie uma operação para começar o Modo Pro.",
  pending:
    "Operação atribuída, aguardando início. O Modo Pro será liberado quando a operação for iniciada.",
  ready: "",
  "awaiting-completion": "",
  closed: "Esta operação foi concluída ou encerrada. Solicite uma nova operação.",
  "invalid-context":
    "Não foi possível confirmar o contexto da operação. Aguarde a sincronização e tente novamente.",
};

export function getProLaunchAvailability(
  context: ProLaunchContext,
): ProLaunchAvailability {
  if (!context.job) {
    return {
      state: "missing-operation",
      canLaunch: false,
      message: messages["missing-operation"],
    };
  }

  if (!context.hasContract || !context.hasUser || !context.hasCompany) {
    return {
      state: "invalid-context",
      canLaunch: false,
      message: messages["invalid-context"],
    };
  }

  const status = normalizeJobStatus(context.job.status);
  const progress = Number.isFinite(Number(context.job.progress))
    ? Math.max(0, Number(context.job.progress))
    : 0;
  const totalDeliveries = Number.isFinite(Number(context.totalDeliveries))
    ? Math.max(0, Number(context.totalDeliveries))
    : 0;

  if (status === "pending") {
    return {
      state: "pending",
      canLaunch: false,
      message: messages.pending,
    };
  }

  if (status === "awaiting_completion" && hasRemainingDeliveries(status, progress, totalDeliveries)) {
    return {
      state: "awaiting-completion",
      canLaunch: true,
      message: messages["awaiting-completion"],
    };
  }

  if (isTripRecordableJobStatus(status, progress, totalDeliveries)) {
    return {
      state: "ready",
      canLaunch: true,
      message: messages.ready,
    };
  }

  if (isClosedJobStatus(status, progress, totalDeliveries) || status === "cancelled" || status === "completed") {
    return {
      state: "closed",
      canLaunch: false,
      message: messages.closed,
    };
  }

  return {
    state: "invalid-context",
    canLaunch: false,
    message: messages["invalid-context"],
  };
}

export function proLaunchAvailabilityMessage(
  availability: ProLaunchAvailability,
): string {
  return availability.message;
}
