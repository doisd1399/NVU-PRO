import { assertWorkModeEntryAllowed } from "./workModeAvailabilityService";
import { explainOverlayPermissionBeforeSettings } from "./overlayPermissionGuide";
import {
  GtoObserver,
  type GtoObserverContext,
  type GtoObserverStatus,
  isGtoObserverAvailable,
  isNativeAndroid,
} from "../lib/gtoObserver";
import {
  isClosedJobStatus,
  isTripRecordableJobStatus,
} from "../lib/jobStatus";
import { needsProjectionRearm } from "../lib/projectionRecoveryPolicy";

export type GtoWorkLaunchResult =
  | { status: "opened" }
  | { status: "overlay-permission" }
  | { status: "usage-permission" }
  | { status: "screen-capture-denied" }
  | { status: "not-native" }
  | { status: "module-missing" }
  | { status: "gto-missing" }
  | { status: "observer-failed"; message?: string }
  | { status: "job-not-ready" }
  | { status: "job-closed" };

const isRecordableJobStatus = (
  value: unknown,
  progress = 0,
  total = 0,
): boolean => isTripRecordableJobStatus(value, progress, total);

const contextAlreadyClosed = (context: GtoObserverContext): boolean => {
  const progress = Number(context.confirmedTripCount);
  const total = Math.max(0, Number(context.jobTotalDeliveries || 0));
  if (!Number.isFinite(progress)) return false;
  if (isClosedJobStatus(context.jobStatus, progress, total)) return true;
  return total > 0 && progress >= total;
};

const observerReportsClosedJob = (status: GtoObserverStatus, confirmedTripCount: number, totalDeliveries: number): boolean => {
  const progress = Math.max(0, Number(confirmedTripCount));
  const total = Math.max(0, Number(totalDeliveries || 0));
  // Native counters are telemetry only. A native closed flag can close the
  // flow only after the Web projection confirms the same operation reached its total.
  if (status.gtoBackendJobClosed && total > 0 && progress >= total) return true;
  if (isClosedJobStatus(status.gtoJobStatus || status.jobStatus, progress, total)) return true;
  return total > 0 && progress >= total;
};

/**
 * Starts the native GTO work flow without navigating to the manual trip form.
 * The Google AI Studio/web layer owns the current operation context; the
 * Android R3.1 observer owns freight detection, lifecycle, completion and sync.
 */
export async function launchGtoWork(
  context: GtoObserverContext,
): Promise<GtoWorkLaunchResult> {
  if (!isNativeAndroid()) return { status: "not-native" };
  if (!isGtoObserverAvailable()) return { status: "module-missing" };
  if (!Number.isFinite(Number(context.confirmedTripCount))) return { status: "job-not-ready" };
  if (contextAlreadyClosed(context)) return { status: "job-closed" };
  const contextProgress = Math.max(0, Number(context.confirmedTripCount));
  const contextTotal = Math.max(0, Number(context.jobTotalDeliveries || 0));
  if (context.jobStatus && !isRecordableJobStatus(context.jobStatus, contextProgress, contextTotal)) {
    return { status: "job-not-ready" };
  }

  await assertWorkModeEntryAllowed("max", "gto");
  await GtoObserver.setContext(context);
  let status = await GtoObserver.getStatus();

  if (observerReportsClosedJob(status, contextProgress, contextTotal)) return { status: "job-closed" };
  const firstStatusProgress = contextProgress;
  const firstStatusTotal = contextTotal;
  if (status.jobStatus && !isRecordableJobStatus(status.jobStatus, firstStatusProgress, firstStatusTotal)) {
    return { status: "job-not-ready" };
  }

  if (!status.usageAccess) {
    await GtoObserver.openUsageAccessSettings();
    return { status: "usage-permission" };
  }

  // R3.1 can recover an enabled observer after Android recreated the process.
  // Keep a fallback to startObserver so the web Dev remains compatible while
  // drivers migrate from an older APK.
  if (status.enabled && !status.running) {
    try {
      status = await GtoObserver.recoverObserver();
    } catch (error) {
      console.warn("[GTO] Recuperação nativa indisponível; iniciando serviço normalmente.", error);
    }
  }

  if (!status.running) {
    status = await GtoObserver.startObserver();
    if (status.missingPermission === "overlay") {
      explainOverlayPermissionBeforeSettings();
      await GtoObserver.openOverlaySettings();
      return { status: "overlay-permission" };
    }
    if (status.missingPermission === "usage") {
      await GtoObserver.openUsageAccessSettings();
      return { status: "usage-permission" };
    }

    if (status.started === false || !status.running || status.observerHealthy === false) {
      return {
        status: "observer-failed",
        message: status.startError || status.overlayError || "O Android não confirmou o Observador GTO.",
      };
    }
  } else if (status.observerHealthy === false) {
    return {
      status: "observer-failed",
      message: status.startError || status.overlayError || "O Observador GTO está instável.",
    };
  }

  // Refresh the context after start/recovery so an old native session can never
  // keep another company/job as the active automatic-trip context.
  status = await GtoObserver.setContext(context);
  if (observerReportsClosedJob(status, contextProgress, contextTotal)) return { status: "job-closed" };
  const refreshedStatusProgress = contextProgress;
  const refreshedStatusTotal = contextTotal;
  if (status.jobStatus && !isRecordableJobStatus(status.jobStatus, refreshedStatusProgress, refreshedStatusTotal)) {
    return { status: "job-not-ready" };
  }

  // A prior denial or service restart must never become a terminal Web state.
  // Arm the native consent flow again; Android will display it only after GTO
  // is foreground, preserving the one-shot MediaProjection contract.
  if (needsProjectionRearm(status)) {
    try {
      await GtoObserver.requestScreenCapture();
    } catch (error) {
      console.warn("[GTO] Não foi possível rearmar MediaProjection; o observador continuará recuperável:", error);
    }
  }

  // Every automatic-mode start explicitly rearms the floating control, even when the
  // overlay permission/service were already active. Native code rebuilds only volatile
  // overlay views and preserves the durable freight/trip/result session. This provides a
  // deterministic recovery path if an OEM detached the bubble during an earlier run.
  status = await GtoObserver.prepareFloatingButton();
  if (status.observerHealthy === false || !status.floatingButtonActivationArmed) {
    return {
      status: "observer-failed",
      message: status.overlayError || status.startError || "O botão NVU fixo não pôde ser preparado.",
    };
  }

  // R3.28: open the simulator first. The native observer prepares WAITING_FREIGHT
  // before launch and requests MediaProjection only after UsageStats confirms that the
  // real GTO task is already foreground. This avoids creating the capture surface in
  // NVU portrait geometry and matches the driver's visible flow.
  const openResult = await GtoObserver.openGto();
  if (!openResult.installed) return { status: "gto-missing" };
  if (!openResult.opened || openResult.prepared === false) {
    return {
      status: "observer-failed",
      message: openResult.error || "O estado da viagem não pôde ser preparado antes de abrir o GTO.",
    };
  }

  const afterOpen = await GtoObserver.getStatus();
  if (needsProjectionRearm(afterOpen)) {
    try {
      await GtoObserver.requestScreenCapture();
    } catch (error) {
      console.warn("[GTO] MediaProjection segue sem consentimento; nova tentativa ficará disponível:", error);
    }
  }

  return { status: "opened" };
}
