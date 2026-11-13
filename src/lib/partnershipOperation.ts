import type { ManagementOperation } from "../components/admin/management/ManagementOperationCard";
import { formatDriverName } from "./utils";
import { formatDays, roleIn, shortName, type Partnership } from "./partnerships";

/**
 * Uma parceria como "operação" do card de Trabalhos ativos (Central de gestão). A Central e a página de Parcerias B2P usam este mesmo
 * mapeamento e o mesmo card (`ManagementOperationCard`): o que muda de um lado para o outro é só a origem dos dados.
 */
const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });
const TWO_DAYS = 2 * 86_400_000;

/** Tempo restante no formato do card de Trabalhos ativos: "3d · 22h · 4min". */
export function operationClock(due: number, now: number): string {
  if (!due) return "Não definido";
  const diff = due - now;
  return diff <= 0 ? "Prazo vencido" : `${Math.floor(diff / 86_400_000)}d · ${Math.floor(diff / 3_600_000) % 24}h · ${Math.floor(diff / 60_000) % 60}min`;
}

export type PartnershipOperationContext = {
  /** Empresa de quem está olhando. */
  me: string; companyName: string; simulatorLabel: string; now: number;
  /** Foto do motorista (perfil público). Sem motorista, a imagem é o logo da outra empresa. */
  driverPhoto?: string; companyLogo?: string;
};

export function partnershipOperation(p: Partnership, ctx: PartnershipOperationContext): ManagementOperation {
  const role = roleIn(p, ctx.me) || "contractor";
  const otherName = shortName(role === "contractor" ? p.executorName : p.contractorName);
  const due = p.deadlineMs || 0, diff = due - ctx.now, required = p.totalTrips;
  const open = p.status === "accepted" || p.status === "active";
  const state: ManagementOperation["state"] = p.status === "completed" ? "done" : p.status === "declined" || p.status === "cancelled" ? "closed"
    : p.status === "pending" || p.status === "accepted" ? "pending" : due && diff < 0 ? "overdue" : "active";
  const statusLabel = p.status === "pending" ? "Aguardando resposta" : p.status === "declined" ? "Recusada" : p.status === "cancelled" ? "Cancelada"
    : p.status === "completed" ? "Concluída" : p.status === "accepted" && !p.jobId ? "Aguardando motorista" : undefined;
  const timeLabel = open ? undefined : "Prazo:";
  const timeRemaining = open ? operationClock(due, ctx.now)
    : p.status === "completed" ? (p.settlement ? (p.settlement.goalMissed ? "Concluída sem a meta" : p.settlement.late ? "Concluída fora do prazo" : "Concluída no prazo") : "Concluída")
    : p.status === "pending" ? (p.durationDays ? `${formatDays(p.durationDays)} após o aceite` : "Não definido") : "Encerrada";
  const trailerName = p.trailerName || p.trailerRequirement || undefined;
  return {
    id: `pn_${p.id}`, companyId: ctx.me, companyName: ctx.companyName || "Empresa",
    driverId: p.driverId || "", driverName: p.driverName ? formatDriverName(p.driverName) : otherName, driverPhoto: (p.driverId ? ctx.driverPhoto : ctx.companyLogo) || undefined,
    name: p.operationName, vehicleId: p.vehicleId || "", vehicleName: p.vehicleName || "Veículo a definir", trailerName, showTrailer: Boolean(trailerName),
    simulatorId: p.simulatorId, simulatorLabel: ctx.simulatorLabel, contractId: "",
    completed: p.progress, required, remaining: Math.max(0, required - p.progress), progress: required ? Math.min(100, Math.round(p.progress / required * 100)) : 0,
    deadline: due ? dateFormat.format(new Date(due)) : "Não definido", deadlineTimestamp: due, timeRemaining, timeLabel, statusLabel,
    nearDeadline: Boolean(open && due && diff <= TWO_DAYS), state,
    jobStatus: p.status === "accepted" ? "pending" : p.status === "completed" ? "completed" : p.status === "declined" || p.status === "cancelled" ? "cancelled" : "active",
    partnership: { id: p.id, role, contractorName: p.contractorName, executorName: p.executorName, photoUrl: p.startPhotoUrl },
  };
}
