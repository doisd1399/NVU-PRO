import { doc, updateDoc, runTransaction } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { auth, functions } from '../../lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { OperationalCommandClient, type OperationalCommandInput, type OperationalCommandResult } from './OperationalCommandClient';
import { operationalRequestId } from '../../lib/operationalRequestId';

export type OperationLifecycleStatus = 'active' | 'completed' | 'cancelled';

export interface OperationLifecyclePatch {
  status: OperationLifecycleStatus;
  completedAt?: string;
  completionStatus?: 'on_time' | 'late';
  completionTimeOffset?: string;
  contractNameSnapshot?: string;
}

/** Sole Web gateway for operational status mutations. */
export class CanonicalOperationCommandService {
  private readonly managed = new OperationalCommandClient({
    getUid: () => auth.currentUser?.uid,
    getStorage: () => window.localStorage,
    randomId: operationalRequestId,
    transport: async (input) => (await httpsCallable<typeof input, OperationalCommandResult>(functions, 'operationalCommand', { timeout: 30_000 })(input)).data,
  });
  constructor(private readonly firestore = db) {}

  reserveManagedRequestId(input: OperationalCommandInput): string {
    return this.managed.reserveRequestId(input);
  }

  executeManaged(input: OperationalCommandInput, requestId?: string): Promise<OperationalCommandResult> {
    return this.managed.execute(input, requestId);
  }

  /** Legacy companies retain their existing rules, with an atomic status
   * precondition. A replay cannot reactivate a completed/cancelled assignment. */
  async startLegacyOperation(scope: { id: string; driverId: string; companyId: string; contractId: string; vehicleId?: string }): Promise<any> {
    return runTransaction(this.firestore, async transaction => {
      const ref = doc(this.firestore, 'trabalhos', scope.id), row = await transaction.get(ref), job = row.data();
      if (!row.exists() || job?.driverId !== scope.driverId || job.companyId !== scope.companyId || job.contractId !== scope.contractId || job.vehicleId !== scope.vehicleId)
        throw new Error('Esta operação não está atribuída ao usuário e veículo atuais.');
      if (['active', 'delayed', 'awaiting_completion', 'completed', 'cancelled'].includes(job.status)) return { ...job, id: scope.id };
      if (job.status !== 'pending') throw new Error('A operação não está aguardando início.');
      transaction.update(ref, { status: 'active' });
      return { ...job, id: scope.id, status: 'active' };
    });
  }

  async setLifecycleStatus(operationId: string, patch: OperationLifecyclePatch): Promise<void> {
    const id = String(operationId || '').trim();
    if (!id) throw new Error('OPERATION_ID_REQUIRED');
    if (!patch || !patch.status) throw new Error('OPERATION_STATUS_REQUIRED');
    // Client lifecycle commands are intentionally limited to non-terminal
    // transitions. Completion is owned by the server-side canonical projection.
    if (patch.status === 'completed') throw new Error('SERVER_OWNED_OPERATION_COMPLETION');
    await updateDoc(doc(this.firestore, 'trabalhos', id), patch as any);
  }
}

export const canonicalOperationCommandService = new CanonicalOperationCommandService();
