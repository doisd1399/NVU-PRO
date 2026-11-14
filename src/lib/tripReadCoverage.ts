export type TripReadCoverageStatus = "unknown" | "partial" | "complete";
export type TripReadSourceStatus = "waiting" | "cache" | "pending" | "server" | "failed";

/** Local read metadata, never backend validation or an atomic/global census. */
export type TripReadCoverage = {
  generation: number;
  status: TripReadCoverageStatus;
  scope: { driverId?: string; companyIds: string[]; authenticatedUserId: string };
  expectedSources: number;
  respondedSources: number;
  confirmedSources: number;
  failedSources: number;
  physicalRows: number;
  projectedRows: number;
  unverifiedProjectionRows: number;
  unobservedProjectionRows?: number;
  pendingLocalRows?: number;
  projectionMode?: "scoped-history";
  commandStorageAvailable?: boolean;
  historyAssessment?: import("./scopedHistoryReadProjection").HistoryReadAssessment;
  localSyncDiagnostic?: LocalTripSyncDiagnostic;
  rejectedRows: number;
  fromCache: boolean;
  hasPendingWrites: boolean;
  atomic: false;
  sources: Array<{
    field: "driverId" | "motoristaId" | "userId" | "criadoPor" | "companyId" | "empresaId";
    status: TripReadSourceStatus;
    rows: number;
    errorCode?: string;
  }>;
};

export type TripReadCoverageHandler = (coverage: TripReadCoverage) => void;
import type { LocalTripSyncDiagnostic } from "./localTripSyncDiagnostic";
