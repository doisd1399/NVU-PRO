/** Presentation rules of the "Informações da operação" card. Pure, so every state can be tested without the screen. */
export type OperationInfoSource = {
  jobStatus?: string;
  state: "active" | "pending" | "overdue" | "ready";
  completed: number;
  required: number;
  deadlineTimestamp?: number;
  timeRemaining?: string;
  nearDeadline?: boolean;
};

export type OperationInfoTone = "active" | "pending" | "overdue" | "ready" | "done" | "cancelled";

export type OperationInfoView = {
  tone: OperationInfoTone;
  statusLabel: string;
  timeLabel: string;
  timeText: string;
  timeWarning: boolean;
  percent: number;
  completed: number;
  required: number;
  remaining: number;
  /** Open jobs only: a finished or cancelled job keeps its vehicle and cannot be cancelled again. */
  editable: boolean;
};

const statusLabels: Record<OperationInfoTone, string> = {
  active: "Em andamento", pending: "Não iniciado", overdue: "Atrasado", ready: "Aguardando conclusão", done: "Concluído", cancelled: "Cancelado",
};

export function formatTimeRemaining(deadline: number | undefined, now: number): string {
  if (!deadline) return "Não definido";
  const diff = deadline - now;
  if (diff <= 0) return "Prazo vencido";
  return `${Math.floor(diff / 86_400_000)}d · ${Math.floor(diff / 3_600_000) % 24}h · ${Math.floor(diff / 60_000) % 60}min`;
}

export function describeOperationInfo(operation: OperationInfoSource, now: number = Date.now()): OperationInfoView {
  const required = Math.max(0, Math.floor(Number(operation.required) || 0));
  const completed = Math.max(0, Math.floor(Number(operation.completed) || 0));
  const cancelled = operation.jobStatus === "cancelled";
  const done = operation.jobStatus === "completed";
  const due = Number(operation.deadlineTimestamp) || 0;
  const overdue = !cancelled && !done && operation.state !== "pending" && operation.state !== "ready" && (operation.state === "overdue" || (due > 0 && due <= now));
  const tone: OperationInfoTone = cancelled ? "cancelled" : done ? "done" : overdue ? "overdue" : operation.state;
  const percent = done ? 100 : required ? Math.min(100, Math.max(0, Math.round(completed / required * 100))) : 0;
  const timeText = cancelled ? "Trabalho cancelado" : done ? "Operação encerrada" : formatTimeRemaining(due, now);
  return {
    tone, statusLabel: statusLabels[tone], timeLabel: cancelled || done ? "Situação" : "Tempo restante", timeText,
    timeWarning: overdue || (!cancelled && !done && Boolean(due) && due - now <= 2 * 86_400_000 && due > now),
    percent, completed, required, remaining: required ? Math.max(0, required - completed) : 0,
    editable: !cancelled && !done,
  };
}
