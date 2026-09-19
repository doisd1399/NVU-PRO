import { Capacitor, registerPlugin } from "@capacitor/core";
import type { SimpleAutomationSimulatorKey } from "./simpleAutomation";

export type SimpleAutomationNativeStatus = {
  status?: string;
  running?: boolean;
  overlayPermission?: boolean;
  overlayVisible?: boolean;
  overlayType?: string;
  bubbleVisible?: boolean;
  captureUiHidden?: boolean;
  overlayLastAction?: string;
  overlayLastError?: string;
  overlayLastErrorAt?: number;
  projectionPermissionState?: string;
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
  nativeSubmissionState?: "IDLE" | "SUBMITTING_NATIVE" | "SYNCED" | "WEB_FALLBACK" | string;
  nativeTripId?: string;
  nativeSubmissionError?: string;
  jobProgress?: number;
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
    jobProgress?: number;
    jobTotalDeliveries?: number;
    jobStatus?: string;
    operationClosed?: boolean;
    vehicleName?: string;
    trailerName?: string;
    packageId: string;
    cities: string[];
  }): Promise<SimpleAutomationNativeStatus>;
  openSimulator(input: { packageId: string }): Promise<SimpleAutomationNativeStatus>;
  setRoute(input: { origin: string; destination: string }): Promise<SimpleAutomationNativeStatus>;
  finishTrip(): Promise<SimpleAutomationNativeStatus>;
  showStatusMessage(input: { message: string; durationMs?: number }): Promise<SimpleAutomationNativeStatus>;
  refreshOperationSnapshot(input: {
    companyName?: string;
    operationName?: string;
    contractName?: string;
    jobId?: string;
    contractId?: string;
    companyId?: string;
    driverId?: string;
    jobProgress: number;
    jobTotalDeliveries: number;
    jobStatus: string;
    operationClosed: boolean;
    vehicleName?: string;
    trailerName?: string;
  }): Promise<SimpleAutomationNativeStatus>;
  refreshOperationState(input: {
    jobProgress: number;
    jobTotalDeliveries: number;
    jobStatus: string;
    operationClosed: boolean;
  }): Promise<SimpleAutomationNativeStatus>;
  acknowledgeReceipt(input: { accepted: boolean; reason: string }): Promise<SimpleAutomationNativeStatus>;
  cancelTrip(): Promise<SimpleAutomationNativeStatus>;
}

export const SimpleAutomation = registerPlugin<SimpleAutomationPlugin>("SimpleAutomation");

export const isSimpleAutomationNativeAvailable = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("SimpleAutomation");

export function recordSimpleAutomationProTiming(stage: string, elapsedMs?: number): void {
  if (!isSimpleAutomationNativeAvailable()) return;
  void SimpleAutomation.recordProTiming({ stage, elapsedMs }).catch(() => undefined);
}
