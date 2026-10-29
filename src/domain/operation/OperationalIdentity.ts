export interface OperationalIdentity {
  uid: string;
  companyId: string;
  contractId: string;
  driverId: string;
  operationId: string;
}

const text = (...values: unknown[]): string => {
  for (const value of values) {
    const candidate = String(value ?? '').trim();
    if (candidate) return candidate;
  }
  return '';
};

export function resolveOperationalIdentity(input: Record<string, unknown>): OperationalIdentity {
  return {
    uid: text(input.uid, input.userId, input.criadoPor),
    companyId: text(input.companyId, input.empresaId),
    contractId: text(input.contractId, input.contratoId),
    driverId: text(input.driverId, input.motoristaId, input.userId, input.uid),
    operationId: text(input.operationId, input.jobId, input.trabalhoId),
  };
}

export function assertOperationalIdentity(identity: OperationalIdentity): OperationalIdentity {
  const required: Array<keyof OperationalIdentity> = ['uid', 'companyId', 'contractId', 'driverId', 'operationId'];
  for (const key of required) {
    if (!String(identity[key] || '').trim()) throw new Error(`OPERATIONAL_IDENTITY_${key.toUpperCase()}_REQUIRED`);
  }
  if (identity.uid !== identity.driverId) throw new Error('OPERATIONAL_IDENTITY_USER_DRIVER_MISMATCH');
  return identity;
}

export function sameOperationalIdentity(a: OperationalIdentity, b: OperationalIdentity): boolean {
  return a.uid === b.uid && a.companyId === b.companyId && a.contractId === b.contractId &&
    a.driverId === b.driverId && a.operationId === b.operationId;
}
