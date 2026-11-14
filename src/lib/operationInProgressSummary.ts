import type { OperationResultData } from '../components/OperationResultModal';
import type { HistoryMoneyGroup } from './tripMoneySummary';
import { getNomeContratoHistorico } from './utils';

const DAY_MS = 24 * 60 * 60 * 1000;

function timestamp(value: unknown): number | null {
  if (value == null || value === '') return null;
  try {
    const record = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    const milliseconds = typeof record.toMillis === 'function'
      ? record.toMillis()
      : typeof record.seconds === 'number'
        ? record.seconds * 1000 + (record.nanoseconds || 0) / 1_000_000
        : new Date(value as string | number | Date).getTime();
    return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : null;
  } catch {
    return null;
  }
}

function duration(milliseconds: number): string {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor(minutes / 60) % 24;
  return `${days > 0 ? `${days}d ` : ''}${hours}h ${minutes % 60}min`;
}

/** Read-only presentation of the same confirmed trips already visible in the operation. */
export function buildOperationInProgressSummary(input: {
  job: Record<string, any>;
  contract?: Record<string, any> | null;
  totalViagens: number;
  moneyGroups: HistoryMoneyGroup[];
  vehicleName?: string;
  trailerName?: string;
  showTrailer: boolean;
  now: number;
}): OperationResultData {
  const { job, contract, now } = input;
  const startedAt = timestamp(job.startedAt) ?? timestamp(job.assignedAt) ?? timestamp(job.createdAt);
  // An explicit operation deadline wins over the reusable contract template.
  const deadline = timestamp(job.dueAt) ?? timestamp(job.deadlineDate);
  const configuredDays = Number(job.deadlineDays || contract?.deadlineDays || 0);
  const totalDays = deadline !== null && startedAt !== null && deadline > startedAt
    ? Math.ceil((deadline - startedAt) / DAY_MS)
    : Number.isFinite(configuredDays) && configuredDays > 0 ? configuredDays : null;

  return {
    contractName: getNomeContratoHistorico(job, contract),
    totalViagens: input.totalViagens,
    moneyGroups: input.moneyGroups,
    vehicleName: input.vehicleName || job.vehicleName || job.veiculoNome || 'Não informado',
    trailerName: input.showTrailer
      ? input.trailerName || job.trailerName || job.reboqueNome || contract?.trailerName || 'Nenhum'
      : undefined,
    showTrailer: input.showTrailer,
    prazoTotal: totalDays === null ? 'Não definido' : `${totalDays} ${totalDays === 1 ? 'dia' : 'dias'}`,
    tempoExecucao: startedAt === null ? 'Não informado' : duration(now - startedAt),
    tempoRestante: deadline === null ? 'Prazo não definido' : duration(Math.abs(deadline - now)),
    isAtrasado: deadline !== null && now > deadline,
    hasDeadline: deadline !== null,
  };
}
