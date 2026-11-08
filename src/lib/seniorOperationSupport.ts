// Suporte do Painel Sênior às operações de uma empresa: o que listar, como nomear e quem pode agir.
// Regras puras (sem Firebase) para poderem ser testadas e usadas pela tela e pelo serviço.

export type SupportJob = {
  id: string;
  companyId?: string;
  driverId?: string;
  motoristaId?: string;
  vehicleId?: string;
  vehicleName?: string;
  contractName?: string;
  contractNameSnapshot?: string;
  contractSnapshot?: { name?: string };
  status?: string;
  progress?: number;
  totalDeliveries?: number;
  operationalCommandVersion?: number;
  assignedAt?: unknown;
  createdAt?: unknown;
  startedAt?: unknown;
  dueAt?: unknown;
  deadlineDate?: unknown;
  deleted?: boolean;
  archived?: boolean;
};

export const OPEN_SUPPORT_STATUSES = ["pending", "active", "delayed", "awaiting_completion"] as const;

const STATUS_LABEL: Record<string, string> = {
  pending: "Não iniciado",
  active: "Em andamento",
  delayed: "Atrasado",
  awaiting_completion: "Aguardando finalização",
};
const STATUS_ORDER: Record<string, number> = { awaiting_completion: 0, active: 1, delayed: 2, pending: 3 };

export const supportStatusLabel = (status: unknown): string => STATUS_LABEL[String(status || "").toLowerCase()] || String(status || "—");
export const isOpenSupportJob = (job: Pick<SupportJob, "status" | "deleted">): boolean =>
  job.deleted !== true && (OPEN_SUPPORT_STATUSES as readonly string[]).includes(String(job.status || "").toLowerCase());

const millis = (value: unknown): number => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const toDate = (value as { toDate?: () => Date }).toDate;
  if (typeof toDate === "function") { try { return toDate.call(value).getTime(); } catch { return 0; } }
  const seconds = (value as { seconds?: unknown }).seconds;
  if (typeof seconds === "number") return seconds * 1000;
  const parsed = typeof value === "number" ? value : new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Every open job of the company (not only the "current" one per driver), running first, then by assignment date. */
export function listOpenSupportJobs<T extends SupportJob>(jobs: readonly T[], companyId: string): T[] {
  return jobs
    .filter((job) => String(job.companyId || "") === companyId && isOpenSupportJob(job))
    .slice()
    .sort((a, b) => {
      const byStatus = (STATUS_ORDER[String(a.status)] ?? 9) - (STATUS_ORDER[String(b.status)] ?? 9);
      if (byStatus) return byStatus;
      return millis(b.assignedAt || b.createdAt || b.startedAt) - millis(a.assignedAt || a.createdAt || a.startedAt);
    });
}

export const supportJobName = (job: SupportJob): string =>
  String(job.contractNameSnapshot || job.contractName || job.contractSnapshot?.name || "").trim() || "Operação sem nome";

/** The command channel: managed companies/jobs go through the server command; legacy ones update the job document. */
export const isManagedOperation = (company: { operationalCommandVersion?: unknown } | null | undefined, job: Pick<SupportJob, "operationalCommandVersion"> | null | undefined): boolean =>
  company?.operationalCommandVersion === 1 || job?.operationalCommandVersion === 1;

/**
 * Who may cancel jobs and change their vehicle on the company screens: the company's owner/admin, or the Senior who is
 * inside this company's preview (the same rule canManageCompanyProfile applies to the company profile).
 */
export function canManageCompanyOperations(input: {
  viewerIds: readonly (string | undefined | null)[];
  company: { id?: string; ownerId?: string; userId?: string } | null | undefined;
  members: readonly { companyId?: string; userId?: string; status?: string; roles?: readonly string[] }[];
  seniorCompanyId?: string | null;
  seniorAccess?: boolean;
}): boolean {
  const ids = input.viewerIds.map((value) => String(value || "")).filter(Boolean);
  const companyId = String(input.company?.id || "");
  if (!ids.length || !companyId) return false;
  if (input.seniorAccess === true && String(input.seniorCompanyId || "") === companyId) return true;
  if (ids.includes(String(input.company?.ownerId || "")) || ids.includes(String(input.company?.userId || ""))) return true;
  return input.members.some((member) =>
    member.companyId === companyId && ids.includes(String(member.userId || "")) && member.status === "active" &&
    (member.roles || []).some((role) => role === "admin" || role === "owner"));
}

/**
 * A job of a driver who is no longer an active member of the company. Removing a driver used to leave his open jobs behind (the
 * vehicle stayed "in use", the company kept counting them), so they show up as orphans. Unknown membership data is never an
 * orphan: only a loaded member list can say that someone left.
 */
export function isDriverOutsideCompany(input: {
  driverId?: string | null;
  company: { id?: string; ownerId?: string; userId?: string } | null | undefined;
  members: readonly { companyId?: string; userId?: string; status?: string }[] | null | undefined;
  membersReady: boolean;
}): boolean {
  const driverId = String(input.driverId || "");
  const companyId = String(input.company?.id || "");
  if (!driverId || !companyId || !input.membersReady || !input.members) return false;
  if (driverId === String(input.company?.ownerId || "") || driverId === String(input.company?.userId || "")) return false;
  return !input.members.some((member) => member.companyId === companyId && member.userId === driverId && member.status === "active");
}
