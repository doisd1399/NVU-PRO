import type { CompanyProfile, Contract, Job } from "../context/AppContext";
import type { OperationResultData } from "../components/OperationResultModal";
import { normalizeTrip, type RawTrip } from "./tripNormalizer";
import { isTrustedServerConfirmedTrip } from "../../functions/src/isCanonicalConfirmedTrip";
import { getNomeContratoHistorico } from "./utils";
import { summarizeTripMoney } from "./tripMoneySummary";
import { deriveCurrentOperationProgress, selectCanonicalOperationTrips } from "./currentOperation";

const text = (value: unknown) => String(value ?? "").trim();
export function operationDateMs(value: unknown): number {
  const date = value && typeof (value as any).toDate === "function" ? (value as any).toDate()
    : value && typeof (value as any).seconds === "number" ? new Date((value as any).seconds * 1000)
    : new Date(value as any);
  const time = value ? date.getTime() : NaN;
  return Number.isFinite(time) && time > 0 ? time : 0;
}

/** The assignment snapshot defines the current target even if its catalog is
 * unavailable or has subsequently been edited. Missing catalog is not idle. */
export function resolveOperationContract(job: Job | null | undefined, contracts: Contract[]): Contract | null {
  if (!job) return null;
  const source = job as Job & Record<string, any>;
  const catalog = contracts.find(value => value.id === job.contractId && value.companyId === job.companyId);
  const snapshot = source.contractSnapshot && typeof source.contractSnapshot === "object" ? source.contractSnapshot : {};
  const candidates = [source.totalDeliveries, snapshot.totalDeliveries, catalog?.totalDeliveries];
  const total = candidates.map(Number).find(value => Number.isInteger(value) && value > 0) || 0;
  return {
    ...(catalog || {}), ...snapshot,
    id: job.contractId, companyId: job.companyId,
    name: getNomeContratoHistorico(source, catalog || snapshot),
    simulator: text(snapshot.simulator || catalog?.simulator || source.simulatorId),
    totalDeliveries: total,
    deadlineDays: Number(snapshot.deadlineDays || catalog?.deadlineDays || 0),
    mode: snapshot.mode === "simple" || snapshot.mode === "detailed" ? snapshot.mode : catalog?.mode === "detailed" ? "detailed" : "simple",
    status: "active",
  };
}

/** Normalize history once; sorting completed jobs must not rescan it for every
 * comparison. All dates and jobs are restricted to the selected account/company. */
export function indexConfirmedOperationTripDates(history: readonly unknown[], userId: string, companyId?: string | null): Map<string, number> {
  const dates = new Map<string, number>();
  for (const raw of history) {
    const trip = normalizeTrip(raw as any);
    if (!trip.isValid || text(trip.driverId || trip.motoristaId) !== userId || (companyId && text(trip.companyId || trip.empresaId) !== companyId) || !isTrustedServerConfirmedTrip(raw as Record<string, unknown>)) continue;
    const date = trip.metricDate.getTime();
    if (Number.isFinite(date)) dates.set(trip.jobId, Math.max(dates.get(trip.jobId) || 0, date));
  }
  return dates;
}

export const operationJobTimestamp = (job: Job, dates: ReadonlyMap<string, number>): number =>
  operationDateMs(job.completedAt) || dates.get(job.id) || operationDateMs(job.assignedAt || (job as any).startedAt || job.createdAt);

export function selectCompletedOperationJobs(jobs: Job[], history: readonly unknown[], userId: string, companyId: string | null | undefined): Job[] {
  if (!userId || !companyId) return [];
  const dates = indexConfirmedOperationTripDates(history, userId, companyId);
  return jobs.filter(job => job.driverId === userId && job.companyId === companyId && job.status === "completed")
    .map(job => ({ job, date: operationJobTimestamp(job, dates) }))
    .sort((a, b) => b.date - a.date || a.job.id.localeCompare(b.job.id))
    .map(value => value.job);
}

export function operationCompletedAtMs(job: Job, trips: Record<string, unknown>[]): number {
  return operationDateMs(job.completedAt) || Math.max(0, ...trips.map(trip => operationDateMs(trip.completedAt || trip.serverValidatedAt || trip.createdAt)));
}

const duration = (milliseconds: number) => {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60) % 24;
  return `${days ? `${days}d ` : ""}${hours}h ${minutes % 60}min`;
};

/** A live, read-only summary of the same assignment shown in the current card.
 * Never use the last receipt time as the clock of an operation still running. */
export function buildInProgressOperationSummary(input: {
  job: Job; contract: Contract | null; trips: readonly RawTrip[];
  companies: CompanyProfile[]; now: Date;
  driverId?: string; vehicleName?: string; trailerName?: string; showTrailer?: boolean;
}): OperationResultData {
  const { job, contract } = input;
  const company = input.companies.find(value => value.id === job.companyId);
  const snapshot = job as Job & Record<string, any>;
  const companyName = [company?.companyName, company?.name, company?.fleetName,
    snapshot.companyName, snapshot.companySnapshot?.companyName,
    snapshot.companySnapshot?.name, job.contractSnapshot?.companyName,
    contract?.companyId === job.companyId ? contract.companyName : undefined]
    .map(text).find(value => value && value !== "Sem Nome" && value !== "Empresa");
  const driverId = input.driverId || job.driverId || job.motoristaId || "";
  const trips = selectCanonicalOperationTrips(job, input.trips, driverId);
  const start = operationDateMs(job.assignedAt || (job as any).startedAt || job.createdAt);
  const due = operationDateMs(job.dueAt || job.deadlineDate);
  const now = input.now.getTime();
  const totalDays = start && due ? Math.max(0, Math.ceil((due - start) / 86_400_000)) : 0;
  return {
    contractName: getNomeContratoHistorico(job, contract),
    companyName: companyName || "Empresa não informada",
    tempoExecucao: start ? duration(now - start) : "Não informado",
    tempoRestante: due ? duration(Math.abs(due - now)) : "Não definido",
    isAtrasado: Boolean(due && now > due),
    hasDeadline: Boolean(due),
    prazoLimite: due ? new Intl.DateTimeFormat("pt-BR").format(new Date(due)) : "Não definido",
    prazoTotal: start && due ? `${totalDays} dia${totalDays === 1 ? "" : "s"}` : "Não definido",
    totalViagens: deriveCurrentOperationProgress(job, trips, driverId),
    vehicleName: input.vehicleName || snapshot.vehicleName,
    trailerName: input.trailerName || snapshot.trailerName,
    showTrailer: input.showTrailer,
    moneyGroups: summarizeTripMoney(trips),
  };
}

export function buildOperationResultSummary(input: {
  job: Job; contract: Contract | null; trips: Record<string, unknown>[];
  vehicleName?: string; trailerName?: string; showTrailer?: boolean;
}): OperationResultData {
  const { job, contract, trips } = input;
  const end = operationCompletedAtMs(job, trips);
  const start = operationDateMs(job.assignedAt || (job as any).startedAt || job.createdAt);
  const due = operationDateMs(job.dueAt || job.deadlineDate);
  return {
    contractName: getNomeContratoHistorico(job, contract),
    tempoExecucao: start && end ? duration(end - start) : "Não informado",
    tempoRestante: due && end ? duration(Math.abs(due - end)) : "-",
    isAtrasado: Boolean(due && end && end > due), hasDeadline: Boolean(due),
    prazoTotal: start && due ? `${Math.max(0, Math.ceil((due - start) / 86_400_000))} dias` : "Não informado",
    totalViagens: Math.max(trips.length, Number(job.progress || 0)),
    vehicleName: input.vehicleName || (job as any).vehicleName,
    trailerName: input.trailerName || (job as any).trailerName,
    showTrailer: input.showTrailer,
    moneyGroups: summarizeTripMoney(trips),
  };
}
