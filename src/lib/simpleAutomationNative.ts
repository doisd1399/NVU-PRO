import { Capacitor, registerPlugin } from "@capacitor/core";
import type { SimpleAutomationSimulatorKey } from "./simpleAutomation";

export type SimpleAutomationNativeStatus = {
  status?: string;
  running?: boolean;
  overlayPermission?: boolean;
  persistentOverlayPermission?: boolean;
  overlayValidationAt?: number;
  overlayValidationReason?: string;
  overlayVisible?: boolean;
  simulatorKey?: string;
  simulatorCode?: "GTO" | "TOE3" | "WTDS" | "WBDS" | string;
  simulatorLabel?: string;
  contextEpoch?: string;
  simulatorVisibility?: "VISIBLE" | "OUTSIDE" | "UNKNOWN";
  proLastStage?: string;
  proLastDecision?: string;
  proLastFailureCode?: string;
  proLastExpectedPackage?: string;
  proLastObservedPackage?: string;
  proLastDiagnosticAt?: number;
  captureStage?: string;
  captureAcceptedByGate?: boolean;
  companyName?: string;
  operationName?: string;
  contractName?: string;
  jobId?: string;
  contractId?: string;
  companyId?: string;
  driverId?: string;
  nativeSubmissionState?: "IDLE" | "SUBMITTING_NATIVE" | "SYNCED" | "AUTH_REQUIRED" | string;
  nativeTripId?: string;
  nativeSubmissionError?: string;
  nativeAuthState?: "UNKNOWN" | "MATCH" | "MISSING" | "DIVERGENT" | string;
  nativeAuthRequired?: boolean;
  nativeAuthDiagnosticAt?: number;
  jobProgress?: number;
  pendingProTrips?: Array<{
    attemptId: string;
    jobId: string;
    companyId: string;
    driverId: string;
    origin: string;
    destination: string;
    amountCents: number;
    currency: string;
    queuedAt: number;
    queueClaimedAt?: number;
    queueStatus: string;
    retryAllowed?: boolean;
    /** Allows an explicit compatibility check; does not authorize submission. */
    contractRecoveryAvailable?: boolean;
    lastQueueError?: string;
    lastQueueErrorCode?: string;
    attemptCount?: number;
    reasonCode?: string;
    stage?: string;
    callable?: string;
    serverReason?: string;
    canonicalTripId?: string;
    tripId?: string;
    operationId?: string;
    lastAttemptAt?: number;
  }>;
  jobTotalDeliveries?: number;
  jobStatus?: string;
  operationClosed?: boolean;
  vehicleName?: string;
  trailerName?: string;
  packageId?: string;
  simpleState?: string;
  origin?: string;
  destination?: string;
  lastEvent?: string;
  captureRequestedAt?: number;
  captureStarted?: boolean;
  captureRequiresNativeImplementation?: boolean;
  receiptText?: string;
  receiptCapturedAt?: number;
  captureAttemptId?: string;
  captureContextEpoch?: string;
  captureSimulatorKey?: string;
  captureSimulatorCode?: string;
  captureOrigin?: string;
  captureDestination?: string;
  captureCompanyId?: string;
  captureDriverId?: string;
  captureJobId?: string;
  captureContractId?: string;
  capturePackageId?: string;
};

interface SimpleAutomationPlugin {
  addListener(eventName: "receiptCaptured", listenerFunc: (event: { stage?: string }) => void): Promise<{ remove: () => Promise<void> }>;
  getStatus(): Promise<SimpleAutomationNativeStatus>;
  updateOperationHistory(input: {
    jobId: string;
    companyId: string;
    driverId: string;
    confirmedTripCount?: number;
    jobProgress: number;
    trips: Array<{
      tripId: string;
      jobId: string;
      companyId: string;
      driverId: string;
      origin: string;
      destination: string;
      amountCents: number;
      completedAt: number;
    }>;
  }): Promise<SimpleAutomationNativeStatus>;
  recordProTiming(input: { stage: string; elapsedMs?: number }): Promise<SimpleAutomationNativeStatus>;
  openOverlaySettings(): Promise<SimpleAutomationNativeStatus>;
  start(): Promise<SimpleAutomationNativeStatus>;
  stop(): Promise<SimpleAutomationNativeStatus>;
  setContext(input: {
    simulatorKey: SimpleAutomationSimulatorKey;
    simulatorCode: "GTO" | "TOE3" | "WTDS" | "WBDS";
    simulatorLabel: string;
    contextEpoch: string;
    companyName: string;
    operationName?: string;
    contractName?: string;
    jobId?: string;
    contractId?: string;
    companyId?: string;
    driverId?: string;
    confirmedTripCount?: number;
    jobProgress?: number;
    jobTotalDeliveries?: number;
    jobStatus?: string;
    operationClosed?: boolean;
    vehicleName?: string;
    trailerName?: string;
    packageId: string;
    cities?: string[];
  }): Promise<SimpleAutomationNativeStatus>;
  updateCities(input: { cities: string[]; contextEpoch: string }): Promise<SimpleAutomationNativeStatus>;
  openSimulator(input: { packageId: string }): Promise<SimpleAutomationNativeStatus>;
  setRoute(input: { origin: string; destination: string }): Promise<SimpleAutomationNativeStatus>;
  finishTrip(): Promise<SimpleAutomationNativeStatus>;
  retryPending(input?: { attemptId?: string }): Promise<SimpleAutomationNativeStatus>;
  markOperationStartPending(input: { driverId: string; companyId: string; jobId: string; pending: boolean }): Promise<{ saved: boolean }>;
  markOperationCapturePaused(input: { driverId: string; companyId: string; jobId: string; paused: boolean }): Promise<{ saved: boolean }>;
  showStatusMessage(input: { message: string; durationMs?: number }): Promise<SimpleAutomationNativeStatus>;
  refreshOperationSnapshot(input: {
    operationContextRevision?: number;
    companyName?: string;
    operationName?: string;
    contractName?: string;
    jobId?: string;
    contractId?: string;
    companyId?: string;
    driverId?: string;
    confirmedTripCount?: number;
    jobProgress: number;
    jobTotalDeliveries: number;
    jobStatus: string;
    operationClosed: boolean;
    vehicleName?: string;
    trailerName?: string;
  }): Promise<SimpleAutomationNativeStatus>;
  refreshOperationState(input: {
    confirmedTripCount?: number;
    jobProgress: number;
    jobTotalDeliveries: number;
    jobStatus: string;
    operationClosed: boolean;
  }): Promise<SimpleAutomationNativeStatus>;
  acknowledgeReceipt(input: { accepted: boolean; reason: string; pendingSync?: boolean; captureAttemptId?: string }): Promise<SimpleAutomationNativeStatus>;
  cancelTrip(): Promise<SimpleAutomationNativeStatus>;
  discardCompletedOperationQueue(input: { jobId: string }): Promise<{ verified: boolean; discardedCount: number }>;
  reconcileCompletedOperationQueues(): Promise<{ verified: boolean; discardedCount: number }>;
  getReadOnlyProQueueDiagnostics(input: {
    authenticatedUserId?: string;
    authorizedDriverIds?: string[];
    /** Legacy visual-scope arguments remain optional for non-diagnostic notices. */
    driverId?: string;
    companyId?: string;
    jobId?: string;
  }): Promise<{
    ownerAuthenticated: boolean;
    ownerMismatch: boolean;
    pendingProTrips: NonNullable<SimpleAutomationNativeStatus["pendingProTrips"]>;
    pendingGtoTripIds?: string[];
  }>;
}

export const SimpleAutomation = registerPlugin<SimpleAutomationPlugin>("SimpleAutomation");

export const isSimpleAutomationNativeAvailable = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("SimpleAutomation");

export function recordSimpleAutomationProTiming(stage: string, elapsedMs?: number): void {
  if (!isSimpleAutomationNativeAvailable()) return;
  void SimpleAutomation.recordProTiming({ stage, elapsedMs }).catch(() => undefined);
}
