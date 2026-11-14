import type { OperationalIdentity } from '../../domain/operation/OperationalIdentity';
import { assertOperationalIdentity } from '../../domain/operation/OperationalIdentity';

/**
 * Token/contract for operational writes. UI and platform adapters must call a
 * canonical command/Function instead of writing historico_viagens, trabalhos,
 * trip_operation_slots or operational status directly.
 */
export interface OperationalMutationGateway {
  registerTrip(input: { identity: OperationalIdentity; payload: Record<string, unknown> }): Promise<unknown>;
  deleteTrip(input: { identity: OperationalIdentity; tripId: string }): Promise<unknown>;
  reconcileOperation(input: { identity: OperationalIdentity }): Promise<unknown>;
}

export function assertMutationIdentity(identity: OperationalIdentity): OperationalIdentity {
  return assertOperationalIdentity(identity);
}
