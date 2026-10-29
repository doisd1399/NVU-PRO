import type { CanonicalTrip } from './CanonicalTrip';
import type { OperationalIdentity } from '../operation/OperationalIdentity';

export type CanonicalOutboxOperation = 'UPSERT' | 'UPDATE' | 'DELETE';
export type CanonicalOutboxState = 'PENDING_SYNC' | 'SYNCING' | 'SERVER_CONFIRMED' | 'FAILED' | 'CONFLICT';

export interface CanonicalTripOutboxEntry {
  schemaVersion: 1;
  trip: CanonicalTrip;
  identity: OperationalIdentity;
  operation: CanonicalOutboxOperation;
  idempotencyKey: string;
  state: CanonicalOutboxState;
  attempts: number;
  queuedAt: string;
  syncingAt?: string;
  retryAt?: string;
  lastError?: string;
  ack?: {
    tripId: string;
    serverValidatedAt: string;
    serverVersion?: number;
  };
  remoteDeleteRequired?: boolean;
  actorUserId?: string;
  editPatch?: Record<string, unknown>;
  baseVersion?: number;
  editId?: string;
  beforeEdit?: CanonicalTrip;
  conflictResolution?: 'SERVER_WON' | 'CLIENT_WON' | 'MANUAL_REVIEW';
}

export function createCanonicalOutboxEntry(input: {
  trip: CanonicalTrip;
  identity: OperationalIdentity;
  operation?: CanonicalOutboxOperation;
  existing?: Partial<CanonicalTripOutboxEntry>;
}): CanonicalTripOutboxEntry {
  const operation = input.operation || 'UPSERT';
  return {
    schemaVersion: 1,
    trip: input.trip,
    identity: input.identity,
    operation,
    idempotencyKey: input.trip.idempotencyKey,
    state: 'PENDING_SYNC',
    attempts: Number(input.existing?.attempts || 0),
    queuedAt: input.existing?.queuedAt || new Date().toISOString(),
    remoteDeleteRequired: input.existing?.remoteDeleteRequired,
    actorUserId: input.existing?.actorUserId,
    editPatch: input.existing?.editPatch,
    baseVersion: input.existing?.baseVersion,
    editId: input.existing?.editId,
    beforeEdit: input.existing?.beforeEdit,
  };
}

export function isCanonicalAck(ack: unknown): ack is NonNullable<CanonicalTripOutboxEntry['ack']> {
  const value = ack as Record<string, unknown> | null;
  return Boolean(value && String(value.tripId || '').trim() && String(value.serverValidatedAt || '').trim());
}
