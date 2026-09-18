import { Capacitor, registerPlugin } from "@capacitor/core";

export interface GtoObserverStatus {
  overlayPermission: boolean;
  usageAccess: boolean;
  preciseTouchPermission: boolean;
  preciseTouchActive: boolean;
  running: boolean;
  enabled: boolean;
  observerHealthy?: boolean;
  observerLifecycleActive?: boolean;
  observerLifecycleStatus?:
    | "OBSERVER_ACTIVE"
    | "GTO_FOREGROUND_CAPTURE"
    | "GTO_BACKGROUND_OBSERVER_ACTIVE"
    | "WAITING_ANDROID_REAUTH"
    | "SERVICE_STOPPED"
    | string;
  observerLifecycleChangedAt?: number;
  gtoCaptureReady?: boolean;
  detectorActive?: boolean;
  detectorHeartbeatAt?: number;
  detectorProbeHeartbeatAt?: number;
  captureHealth?: "HEALTHY_REAL_DETECTOR" | "NOT_HEALTHY" | string;
  captureHealthChangedAt?: number;
  captureLastFrameAt?: number;
  captureLastAnalyzedFrameAt?: number;
  serviceStartedAt?: number;
  serviceHeartbeatAt?: number;
  overlayVisible?: boolean;
  overlayError?: string;
  overlayErrorAt?: number;
  overlayFailureCount?: number;
  menuOverlayError?: string;
  menuOverlayErrorAt?: number;
  statusOverlayError?: string;
  statusOverlayErrorAt?: number;
  notificationError?: string;
  notificationErrorAt?: number;
  touchPulseSensorVisible?: boolean;
  touchPulseSensorError?: string;
  touchPulseSensorErrorAt?: number;
  touchPulseSensorLifecycle?: "ATTACHED" | "DETACHED" | "ATTACH_FAILED" | string;
  touchPulseSensorAttachedAt?: number;
  touchPulseSensorDetachedAt?: number;
  touchDiagnosticMode?: boolean;
  physicalTouchAttemptId?: string;
  physicalTouchAttemptAt?: number;
  physicalTouchExpectedAt?: number;
  physicalTouchStage?: string;
  physicalTouchEventReceived?: boolean;
  physicalActionOutsideReceived?: boolean;
  physicalActionOutsideAt?: number;
  physicalTouchRawX?: number;
  physicalTouchRawY?: number;
  physicalTouchLocalX?: number;
  physicalTouchLocalY?: number;
  physicalTouchDisplayWidth?: number;
  physicalTouchDisplayHeight?: number;
  physicalTouchCaptureWidth?: number;
  physicalTouchCaptureHeight?: number;
  physicalTouchCoordinateSpace?: string;
  physicalTouchListGeneration?: number;
  physicalTouchFreightPageGeneration?: number;
  physicalTouchRowCount?: number;
  physicalTouchAcceptRectCount?: number;
  physicalTouchResolvedRow?: number;
  physicalTouchResolutionReason?: string;
  physicalTouchTargetLocked?: boolean;
  physicalTouchValidationResult?: string;
  physicalTouchCommitResult?: string;
  touchDiagnosticOverlayError?: string;
  captureWidth?: number;
  captureHeight?: number;
  captureExpectedWidth?: number;
  captureExpectedHeight?: number;
  captureStableFrames?: number;
  captureReadiness?:
    | "INACTIVE"
    | "CAPTURE_STARTING"
    | "CAPTURE_WAITING_GTO_FOREGROUND"
    | "CAPTURE_WAITING_ORIENTATION"
    | "CAPTURE_WAITING_STABLE_FRAMES"
    | "GTO_READY"
    | "CAPTURE_RESIZE_FAILED";
  captureReadyForAnalysis?: boolean;
  captureSurfaceReady?: boolean;
  captureStabilityGeneration?: number;
  captureStabilityStartedAt?: number;
  captureDensityDpi?: number;
  captureAndroidApi?: number;
  freightButtonBandLeft?: number;
  freightButtonBandRight?: number;
  freightDetectedButtonCount?: number;
  lastFreightConflict?: string;
  lastFreightConflictAt?: number;
  selectionConfirmationStatus?: "" | "FAILED" | "CONFIRMED";
  selectionFailureReason?: string;
  selectionFailureAt?: number;
  overlayOcclusionPreventedAt?: number;
  foregroundPackage?: string;
  lastVisualGtoForegroundEvidenceAt?: number;
  lastVisualGtoFreightCount?: number;
  lastVisualGtoEvidenceSource?: string;
  gtoWorkLaunchPrepared?: boolean;
  gtoWorkLaunchPreparedState?: string;
  gtoWorkLaunchPreparedAt?: number;
  startError?: string;
  projectionActive: boolean;
  projectionSessionBound?: boolean;
  projectionSurfacePending?: boolean;
  projectionGrantValidated?: boolean;
  projectionGrantValidatedAt?: number;
  projectionStatus?: string;
  projectionError?: string;
  projectionReauthRequired?: boolean;
  projectionPermissionInFlight?: boolean;
  resultTouchFallbackRequired?: boolean;
  resultTouchFallbackReady?: boolean;
  resultTouchFallbackContinuityBroken?: boolean;
  resultSnapshotError?: string;
  resultSnapshotErrorAt?: number;
  logoutCleanupError?: string;
  runtimePermissionError?: string;
  runtimePermissionErrorCode?: string;
  gtoForeground: boolean;
  screenAnalysisPaused?: boolean;
  screenAnalysisPauseReason?: string;
  tripStateWhenAnalysisPaused?: string;
  activeTripFreightListVisible?: boolean;
  frameProcessingErrorArea?: string;
  frameProcessingError?: string;
  frameProcessingErrorAt?: number;
  tripState: string;
  tripStateChangedAt?: number;
  screenState: string;
  lastEvent: string;
  driverStageCode?: string;
  driverStageMessage?: string;
  driverStageAt?: number;
  pausePromptVisible?: boolean;
  pauseScreenDetected?: boolean;
  pauseReadStatus?: string;
  pauseMissingField?: string;
  pauseScreenDetectedAt?: number;
  pauseLastReadAt?: number;
  lastCancellationReason?: string;
  lastCancelledAt?: number;
  selectedFreight: string;
  floatingButtonActivationArmed?: boolean;
  floatingButtonActivatedAt?: number;
  expectedGtoOrigin?: string;
  expectedGtoDestination?: string;
  lastDestinationCorrectionFrom?: string;
  lastDestinationCorrectionTo?: string;
  lastDestinationCorrectionSource?: string;
  lastDestinationCorrectionAt?: number;
  selectedFreightRow?: number;
  selectedCargo?: string;
  selectedOrigin?: string;
  selectedCompany?: string;
  selectedDestination?: string;
  selectedKm?: string;
  selectedValue?: string;
  resultValue: string;
  resultValueEvidenceCount?: number;
  resultValueEvidenceConflict?: boolean;
  finalGain?: string;
  completionStatus?: string;
  completionDetectedAt?: number;
  gtoTripSessionId?: string;
  gtoTripSyncStatus?: string;
  gtoTripSyncTransport?: "LOCAL_ONLY" | "REMOTE" | string;
  gtoLocalTripId?: string;
  gtoLocalSavedAt?: number;
  gtoRemoteSyncEnabled?: boolean;
  gtoSubmissionAutoSendEnabled?: boolean;
  gtoRemoteSyncRequestedAt?: number;
  gtoDurableQueueCount?: number;
  gtoCurrentSessionQueued?: boolean;
  gtoLocalOnlyMode?: boolean;
  tripSubmissionState?: "READY" | "SENDING" | "SYNCED" | "LOCAL_SAVED" | "PENDING_RETRY" | string;
  tripSubmissionStateAt?: number;
  gtoRegisteredTripId?: string;
  gtoTripSyncError?: string;
  gtoTripSyncLastAttemptAt?: number;
  gtoTripSyncLastErrorCode?: string;
  gtoTripIntegrityStatus?: string;
  gtoTripIntegrityError?: string;
  gtoCanonicalStatePending?: boolean;
  gtoCanonicalStateLastSynced?: string;
  gtoCanonicalStateLastSyncedAt?: number;
  gtoCanonicalStateError?: string;
  jobStatus?: string;
  jobProgress?: number;
  jobTotalDeliveries?: number;
  gtoJobStatus?: string;
  gtoJobProgress?: number;
  gtoBackendJobClosed?: boolean;
  gtoContractVersion?: number;
  gtoPackage: string;
  started?: boolean;
  stopping?: boolean;
  missingPermission?: "overlay" | "usage";
}

export interface GtoObserverContext {
  driverId?: string;
  driverName?: string;
  companyId?: string;
  companyName?: string;
  jobId?: string;
  jobStatus?: string;
  jobProgress?: number;
  jobTotalDeliveries?: number;
  contractId?: string;
  contractName?: string;
  contractMode?: "simple" | "detailed";
  vehicleId?: string;
  vehicleName?: string;
  trailerId?: string;
  trailerName?: string;
  /** Authoritative current detailed-route origin, used only for conservative OCR reconciliation. */
  expectedGtoOrigin?: string;
  /** Authoritative current detailed-route destination, used only for conservative OCR reconciliation. */
  expectedGtoDestination?: string;
  /** JSON array of trusted NVU city spellings; native code corrects only a unique one-edit OCR variant. */
  trustedGtoCitiesJson?: string;
}

interface GtoObserverPlugin {
  getStatus(): Promise<GtoObserverStatus>;
  recoverObserver(): Promise<GtoObserverStatus>;
  openOverlaySettings(): Promise<GtoObserverStatus>;
  openUsageAccessSettings(): Promise<GtoObserverStatus>;
  openPreciseTouchSettings(): Promise<GtoObserverStatus>;
  startObserver(): Promise<GtoObserverStatus>;
  prepareFloatingButton(): Promise<GtoObserverStatus>;
  stopObserver(): Promise<GtoObserverStatus>;
  syncPendingTrips(): Promise<GtoObserverStatus & { remoteSyncRequested?: boolean }>;
  logoutCleanup(): Promise<GtoObserverStatus & { logoutCleaned?: boolean }>;
  requestScreenCapture(): Promise<GtoObserverStatus>;
  setContext(context: GtoObserverContext): Promise<GtoObserverStatus>;
  openGto(): Promise<{ opened: boolean; installed: boolean; prepared?: boolean; tripState?: string; error?: string }>;
}

export const GtoObserver = registerPlugin<GtoObserverPlugin>("GtoObserver");

export const isNativeAndroid = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

export const isGtoObserverAvailable = (): boolean =>
  Capacitor.isPluginAvailable("GtoObserver");

export const isGtoSimulator = (simulatorId?: string, simulatorName?: string): boolean => {
  const value = `${simulatorId || ""} ${simulatorName || ""}`
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, " ");

  return (
    /(^| )gto($| )/.test(value) ||
    value.includes("global truck online") ||
    value.includes("global truck")
  );
};
