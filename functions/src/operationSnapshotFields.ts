type Data = Record<string, any>;
const text = (v: unknown): string => typeof v === "string" ? v.trim() : "";
export function operationTrailerId(job: Data, contract: Data): string {
  if (job.operationalCommandVersion === 1) return text(job.trailerId);
  return text(job.trailerId || job.reboqueId) || text(contract.trailerId || contract.reboqueId);
}
export function operationContractName(job: Data, contract: Data): string {
  return text(job.contractSnapshot?.name) || text(job.contractNameSnapshot || job.contractName) || text(contract.name || contract.nome);
}

export function operationContractMode(job: Data, contract: Data): string {
  return text(job.operationalCommandVersion === 1 ? job.contractSnapshot?.mode : contract.mode).toLowerCase();
}
export function operationTarget(job: Data, contract: Data): number {
  return Number(job.totalDeliveries ?? job.contractSnapshot?.totalDeliveries ?? contract.totalDeliveries ?? 0);
}
export function managedOperationRevisionPatch(job: Data): Data {
  return job.operationalCommandVersion === 1 ? { operationalRevision: Number(job.operationalRevision || 0) + 1 } : {};
}
