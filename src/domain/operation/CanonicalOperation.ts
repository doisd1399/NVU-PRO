export type CanonicalOperation = {
  operationId: string;
  driverId: string;
  companyId: string;
  simulatorId: string;
  contractId: string;
  status?: string;
  progress: number;
  totalDeliveries: number;
  [key: string]: unknown;
};

const clean = (value: unknown): string => String(value ?? "").trim();

export function normalizeCanonicalOperation(
  input: Record<string, unknown>,
): CanonicalOperation {
  const operationId = clean(input.operationId || input.jobId || input.id);
  const driverId = clean(input.driverId || input.motoristaId || input.userId);
  const companyId = clean(input.companyId || input.empresaId);
  const contractId = clean(input.contractId || input.contratoId);
  const simulatorId = clean(
    input.simulatorId ||
      input.simuladorId ||
      input.simulatorCode ||
      input.simuladorCodigo ||
      input.simulatorKey ||
      input.simulator ||
      input.contractSimulator ||
      "unknown",
  );
  if (!operationId || !driverId || !companyId || !contractId) {
    throw new Error("CANONICAL_OPERATION_REQUIRED_FIELDS_MISSING");
  }
  return {
    ...input,
    operationId,
    driverId,
    companyId,
    simulatorId,
    contractId,
    progress: Math.max(0, Number(input.progress || 0)),
    totalDeliveries: Math.max(0, Number(input.totalDeliveries || 0)),
  } as CanonicalOperation;
}

export function operationIdentityOf(value: Partial<CanonicalOperation> | null | undefined): string {
  return [
    clean(value?.operationId),
    clean(value?.driverId),
    clean(value?.companyId),
    clean(value?.simulatorId),
    clean(value?.contractId),
  ].join("|");
}
