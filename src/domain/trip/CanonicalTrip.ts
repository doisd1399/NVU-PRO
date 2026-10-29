export type TripStatus =
  | "CREATED"
  | "CAPTURED"
  | "REGISTERED_LOCAL"
  | "PENDING_SYNC"
  | "SYNCING"
  | "SERVER_CONFIRMED"
  | "HISTORY_CONFIRMED"
  | "DELETED";

import type { OperationalIdentity } from "../operation/OperationalIdentity";

export interface CanonicalTrip {
  /** Stable identity shared by Print, Pro, offline queue and server. */
  canonicalTripId: string;
  tripId: string;
  clientRequestId: string;
  idempotencyKey: string;
  status: TripStatus;
  /** Business status persisted for compatibility with historico_viagens. */
  recordStatus?: string;
  origin?: string;
  destination?: string;
  earnings?: number;
  cacheValue?: number;
  source: "PRINT" | "PRO" | string;
  createdAt: string;
  updatedAt: string;
  clientUpdatedAt: string;
  serverUpdatedAt?: string;
  serverVersion?: number;
  baseSyncVersion?: number;
  syncVersion: number;
  /** Result of the single ranking eligibility decision. */
  rankingEligible?: boolean;
  rankingEligibilityReason?: string;
  deleted: boolean;
  deletedAt?: string;
  conflictResolution?: "SERVER_WON" | "CLIENT_WON" | "MANUAL_REVIEW";
  /** Required operational identity shared by every Print and Pro record. */
  operationId: string;
  driverId: string;
  companyId: string;
  simulatorId: string;
  contractId: string;
  /** Normalized identity shared by Web, Android and the outbox contract. */
  operationalIdentity?: OperationalIdentity;
  jobId?: string;
  imageHash?: string;
  [key: string]: unknown;
}
