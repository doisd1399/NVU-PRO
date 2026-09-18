import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const servicePath = "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java";
const pluginPath = "android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java";
const policyPath = "android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java";
const bridgePolicyPath = "android/app/src/main/java/com/nvu/operacional/GtoProjectionForegroundBridgePolicy.java";
const service = fs.readFileSync(servicePath, "utf8");
const plugin = fs.readFileSync(pluginPath, "utf8");
const policy = fs.readFileSync(policyPath, "utf8");
const bridgePolicy = fs.readFileSync(bridgePolicyPath, "utf8");

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

check(
  "CONFIRMING_FREIGHT is isolated from live/reopened-list replacement",
  policy.includes('"TRIP_IN_PROGRESS".equals(state)')
    && !/mayObserveFreightListOutsideWaiting[\s\S]{0,500}"CONFIRMING_FREIGHT"/.test(policy)
    && service.includes("GtoDeterministicFlowPolicy.mayObserveFreightListOutsideWaiting(state)"),
);
check(
  "leaving GTO pauses analysis without changing canonical trip state",
  service.includes("pauseScreenAnalysisOutsideGto(")
    && service.includes('putString("tripStateWhenAnalysisPaused", tripStateWhenAnalysisPaused)')
    && service.includes('putString("lastEvent", "Leitura pausada · estado da viagem preservado")')
    && !/private void pauseScreenAnalysisOutsideGto[\s\S]{0,1200}setTripState\(/.test(service),
);
check(
  "returning to GTO resumes the exact same trip state",
  service.includes("resumeScreenAnalysisInSameState(absenceMs)")
    && service.includes("tripStateWhenAnalysisPaused")
    && !/private void resumeScreenAnalysisInSameState[\s\S]{0,1800}clearTripAnalysis\(/.test(service)
    && !/private void resumeScreenAnalysisInSameState[\s\S]{0,1800}setTripState\(/.test(service),
);
check(
  "known non-GTO foreground app cannot be overridden by freight-like pixels",
  policy.includes("packageMatchesGto || packageUnknown || permissionReturnFromNvu")
    && bridgePolicy.includes("if (!verifiedGtoBridge || transientSurface) return false;")
    && bridgePolicy.includes("return packageUnknown || (packageIsNvu && !nvuMainActivityForeground);")
    && /private boolean hasVerifiedGtoProjectionBridge[\s\S]{0,900}GtoProjectionForegroundBridgePolicy\.allow/.test(service)
    && /private boolean canUseFreightListAsVisualGtoProof[\s\S]{0,1500}hasVerifiedGtoProjectionBridge\(\)/.test(service)
    && service.includes("pauseScreenAnalysisOutsideGto("),
);
check(
  "in-flight OCR cannot mutate state while GTO analysis is paused",
  /private void pauseScreenAnalysisOutsideGto[\s\S]{0,900}analysisOcrGeneration\+\+/.test(service)
    && /private boolean isCurrentAnalysisOcr[\s\S]{0,260}screenAnalysisPausedOutsideGto \|\| !gtoForeground/.test(service)
    && service.includes("deferredPreciseFreightCommit")
    && service.includes("deferredSelectionFailureRow")
    && service.includes("deferredNormalResultConfirmation"),
);
check(
  "confirmation watchdog freezes outside GTO and is rearmed on resume",
  /armFreightConfirmationWatchdog[\s\S]{0,900}screenAnalysisPausedOutsideGto \|\| !gtoForeground/.test(service)
    && /resumeScreenAnalysisInSameState[\s\S]{0,5200}armFreightConfirmationWatchdog\(\)/.test(service),
);
check(
  "unknown screens are diagnostic-only and do not force result transitions",
  service.includes('recordNeutralScreenObservation("UNKNOWN_AFTER_RESULT", normalized)')
    && service.includes('recordNeutralScreenObservation("UNRECOGNIZED_FOR_" + getTripState(), normalized)')
    && (service.match(/setTripState\(STATE_AWAITING_BONUS/g) || []).length === 1,
);
check(
  "unarmed freight-like pixels during trip are neutral and preserve current freight",
  service.includes("mayProbeFreightListForCurrentState")
    && service.includes("if (STATE_TRIP_IN_PROGRESS.equals(activeState) && !explicitReplacement)")
    && service.includes('putString("screenState", "TRIP")')
    && service.includes('putBoolean("activeTripFreightListVisible", false)'),
);
check(
  "active trip replacement requires an explicit driver arm and a real new selection",
  !service.includes('menuButton("Trocar frete atual")')
    && service.includes("armExplicitFreightReplacement()")
    && service.includes("boolean selectedNewRow = replacementFreightTouchPending")
    && policy.includes('return explicitlyArmed && "TRIP_IN_PROGRESS".equals(state);'),
);
check(
  "floating menu names the immutable selected freight as current trip",
  service.includes('freightHeading.setText("Frete atual em andamento")')
    && service.includes("selectedFreightSummary"),
);
check(
  "pressed N-to-N-1 frame preserves the real freight count and clean pre-touch snapshot",
  service.includes("stableFreightRuntimeCount(current)")
    && service.includes("detectTemporarilyMissingPressedRow(")
    && service.includes("int runtimeFreightCount = hasList ? stableFreightRuntimeCount(current) : 0")
    && service.includes("boolean transientPressedCardinality")
    && service.includes("boolean pageChanged = !noSnapshot && panelDistance >= 0.024f")
    && !service.includes("boolean pageChanged = !noSnapshot && !fastVisualDetector.samePage(fastLastSnapshotFrame, current)"),
);
check(
  "reopened-list count is stable during an N-to-N-1 pressed-button frame",
  service.includes("stableActiveTripFreightCount(frame)")
    && service.includes("activeTripFreightListBaseline")
    && service.includes("activeTripFreightListStableCount")
    && service.includes("clearActiveTripFreightListRuntime()")
    && !/private void clearActiveTripFreightListRuntime\(\) \{[\s\S]{0,180}clearActiveTripFreightListRuntime\(\);/.test(service),
);
check(
  "driver notices are acknowledged only after overlay attachment and readable exposure",
  service.includes("windowManager.addView(chip, params)")
    && service.includes("acknowledgementDelay")
    && service.includes("DRIVER_STAGE_MIN_VISIBLE_MS")
    && service.includes("acknowledgeDriverStageShown(key)")
    && service.includes("retryPendingDriverStageIfNeeded(now)"),
);
check(
  "freight confirmation has a bounded watchdog and no silent permanent CONFIRMING state",
  service.includes("FREIGHT_CONFIRMATION_WATCHDOG_MS")
    && service.includes("armFreightConfirmationWatchdog()")
    && service.includes("restoreWaitingAfterSelectionFailure(")
    && service.includes("hasConfirmedSelectionIdentity()")
    && service.includes("A leitura demorou além do esperado"),
);
check(
  "frame failures keep class plus concrete error message",
  service.includes("reportFrameProcessingError(")
    && service.includes("String detail = describeError(error)")
    && service.includes('putString("frameProcessingError", detail)')
    && plugin.includes('status.put("frameProcessingError"'),
);
check(
  "pause/reopen diagnostics are exported to the web panel",
  plugin.includes('status.put("screenAnalysisPaused"')
    && plugin.includes('status.put("tripStateWhenAnalysisPaused"')
    && plugin.includes('status.put("activeTripFreightListVisible"')
    && plugin.includes('status.put("freightReplacementExplicitlyArmed"'),
);

check(
  "all native trip transitions pass through the canonical deterministic policy",
  service.includes("return GtoDeterministicFlowPolicy.isAllowedTripTransition(from, to);")
    && service.includes("private void setTripStateInternal")
    && service.includes("boolean normalTransition = isAllowedTripTransition(previous, state)")
    && service.includes("boolean recoveryTransition = durableRecovery"),
);
check(
  "current GTO page geometry accepts one through six visible freights and fails closed above it",
  service.includes("buttons.size() >= 1 && buttons.size() <= 6")
    && policy.includes("freightCount < 1 || freightCount > 6")
    && policy.includes("stabilizeVisibleFreightCount"),
);

check(
  "canonical state sync ignores callbacks from an older state/session",
  service.includes("canonicalSyncCallbackIsCurrent")
    && service.includes("canonicalSyncSessionId")
    && service.includes("canonicalSyncState")
    && (service.match(/if \(!canonicalSyncCallbackIsCurrent/g) || []).length >= 4,
);

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-r326-policy-"));
  try {
    const run = spawnSync(
      "java",
      [
        "scripts/java-tests/JavaTestRunner.java",
        tmp,
        "com.nvu.operacional.GtoDeterministicFlowPolicyTest",
        policyPath,
        "scripts/java-tests/com/nvu/operacional/GtoDeterministicFlowPolicyTest.java",
      ],
      { encoding: "utf8" },
    );
    const output = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
    check("deterministic state policy fixtures compile", !output.includes("Java compilation failed"), output);
    check("deterministic state policy scenarios pass", run.status === 0 && String(run.stdout || "").includes("PASS"), output || String(run.error || ""));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const failed = checks.filter((item) => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3.26 deterministic-flow checks passed.`);
if (failed.length) process.exit(1);
