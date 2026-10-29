// Shared, read-only diagnosis. A candidate patch is never applied implicitly.
export type PreparationJob = {
  jobId: string;
  driverId: string;
  contractId: string;
  vehicleIds: string[];
  trailerIds: string[];
  name: string;
  status: string;
  issues: string[];
  canNormalize: boolean;
  patch: Record<string, string>;
};
export type OperationalPreparation = {
  ready: boolean;
  conflicts: { driverId: string; jobIds: string[] }[];
  invalidScopes: string[];
  jobs: PreparationJob[];
  token: string;
};
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const validId = (v: string) => Boolean(v) && v.length <= 180 &&
  !v.includes("/") && !v.includes("\0") && ![".", ".."].includes(v);
export const preparationRunning = ["active", "delayed", "awaiting_completion"];

export function analyzeOperationalPreparation(
  records: { id: string; data: Record<string, any> }[],
  companyId: string,
): Omit<OperationalPreparation, "token"> {
  const jobs: PreparationJob[] = [], active = new Map<string, string[]>();
  for (const row of records) {
    const data = row.data, status = text(data.status).toLowerCase();
    if (data.deleted === true || ["completed", "cancelled", "canceled"].includes(status)) continue;
    const issues: string[] = [], patch: Record<string, string> = {};
    let safe = true;
    const resolved: Record<string, string> = {};
    for (const [canonical, alias, label, required] of [
      ["companyId", "empresaId", "Empresa", true],
      ["driverId", "motoristaId", "Motorista", true],
      ["contractId", "contratoId", "Operação", true],
      ["vehicleId", "veiculoId", "Veículo", true],
      ["trailerId", "reboqueId", "Reboque", false],
    ] as const) {
      const primary = text(data[canonical]), old = text(data[alias]);
      const value = primary || old;
      resolved[canonical] = value;
      if (primary && old && primary !== old) {
        issues.push(`${label}: identificadores divergentes`);
        safe = false;
      }
      if ((!value && required) || (value && !validId(value)) ||
          (data[canonical] != null && typeof data[canonical] !== "string")) {
        issues.push(`${label}: identificador ausente ou inválido`);
        safe = false;
      } else if (value && data[canonical] !== value) {
        issues.push(`${label}: campo antigo ou fora do padrão`);
        patch[canonical] = value;
      }
    }
    if (resolved.companyId !== companyId ||
        (text(data.empresaId) && text(data.empresaId) !== companyId)) {
      issues.push("Empresa: vínculo divergente");
      safe = false;
    }
    if (![...preparationRunning, "pending"].includes(status)) {
      issues.push("Estado do trabalho não reconhecido");
      safe = false;
    } else if (data.status !== status) {
      issues.push("Estado do trabalho fora do padrão");
      patch.status = status;
    }
    const resourceIds = (canonical: string, alias: string) =>
      [...new Set([text(data[canonical]), text(data[alias])].filter(Boolean))];
    jobs.push({
      jobId: row.id,
      driverId: resolved.driverId,
      contractId: resolved.contractId,
      vehicleIds: resourceIds("vehicleId", "veiculoId"),
      trailerIds: resourceIds("trailerId", "reboqueId"),
      name: text(data.contractNameSnapshot) || text(data.contractName) || row.id,
      status, issues,
      canNormalize: safe && issues.length > 0 && Object.keys(patch).length > 0,
      patch: safe ? patch : {},
    });
    if (preparationRunning.includes(status))
      active.set(resolved.driverId, [...(active.get(resolved.driverId) || []), row.id]);
  }
  const conflicts = [...active].filter(([, ids]) => ids.length > 1)
    .map(([driverId, jobIds]) => ({ driverId, jobIds: jobIds.sort() }))
    .sort((a, b) => a.driverId.localeCompare(b.driverId));
  const invalidScopes = jobs.filter((job) => job.issues.length).map((job) => job.jobId).sort();
  return { ready: !conflicts.length && !invalidScopes.length, conflicts, invalidScopes,
    jobs: jobs.sort((a, b) => a.jobId.localeCompare(b.jobId)) };
}
