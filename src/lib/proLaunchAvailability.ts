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
    operationSyncState?: unknown;
  } | null;
  totalDeliveries?: unknown;
  confirmedTripCount?: unknown;
  hasContract: boolean;
  hasUser: boolean;
  hasCompany: boolean;
};

const messages: Record<ProLaunchAvailabilityState, string> = {
  "missing-operation": "Inicie uma operação para começar o Modo Pro.",
  pending:
    "Operação atribuída, aguardando início. O Modo Pro será liberado quando a operação for iniciada.",
  ready: "",
  "awaiting-completion": "Todas as viagens foram registradas. Finalize a operação no painel para continuar.",
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

  if (context.job.operationSyncState === "pending_finish" || context.job.operationSyncState === "start_rejected") {
    return { state: "invalid-context", canLaunch: false,
      message: context.job.operationSyncState === "pending_finish"
        ? "A finalização está salva neste aparelho e aguarda sincronização."
        : "O início desta operação precisa de conferência. Os registros locais foram preservados." };
  }

  const status = normalizeJobStatus(context.job.status);
  if (!Number.isFinite(Number(context.confirmedTripCount))) {
    return {
      state: "invalid-context",
      canLaunch: false,
      message: messages["invalid-context"],
    };
  }
  const progress = Math.max(0, Number(context.confirmedTripCount));
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

  if (status === "awaiting_completion") {
    if (hasRemainingDeliveries(status, progress, totalDeliveries)) {
      return {
        state: "awaiting-completion",
        canLaunch: true,
        message: "",
      };
    }
    return {
      state: "awaiting-completion",
      canLaunch: false,
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
