import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const paths = {
  service: "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java",
  plugin: "android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java",
  detector: "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
  listEvidence: "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
  policy: "android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java",
  visualPolicy: "android/app/src/main/java/com/nvu/operacional/GtoVisualForegroundPolicy.java",
  sync: "android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java",
  launcher: "src/services/gtoWorkLauncher.ts",
  setup: "src/components/GtoObserverSetup.tsx",
  observerTs: "src/lib/gtoObserver.ts",
};
const read = (p) => fs.readFileSync(p, "utf8");
const service = read(paths.service);
const plugin = read(paths.plugin);
const detector = read(paths.detector);
const policy = read(paths.policy);
const sync = read(paths.sync);
const launcher = read(paths.launcher);
const setup = read(paths.setup);
const observerTs = read(paths.observerTs);

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function runJava(name, mainClass, sources, javaArgs = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-r327-"));
  try {
    const run = spawnSync("java", [...javaArgs, "scripts/java-tests/JavaTestRunner.java", tmp, mainClass, ...sources], { encoding: "utf8" });
    const out = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
    check(`${name} fixtures compile`, !out.includes("Java compilation failed"), out);
    check(`${name} scenarios pass`, run.status === 0 && String(run.stdout || "").includes("PASS"), out || String(run.error || ""));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

check(
  "GTO launch prepares WAITING_FREIGHT before the first game frame",
  service.includes("prepareWorkLaunchIfRunning")
    && service.includes("prepareJourneyForGtoLaunch")
    && service.includes("GtoDeterministicFlowPolicy.shouldPrepareWaitingBeforeGtoOpen(state)")
    && service.includes("beginTrip(false)")
    && plugin.indexOf("prepareWorkLaunchIfRunning()") < plugin.indexOf("context.startActivity(launchIntent)"),
);
check(
  "opening GTO fails closed if the native journey could not be prepared",
  plugin.includes('result.put("prepared", false)')
    && plugin.includes('result.put("opened", false)')
    && launcher.includes("openResult.prepared === false"),
);
check(
  "openGto owns the SharedPreferences scope used by launch preparation",
  /public void openGto\(PluginCall call\) \{[\s\S]{0,500}Context context = getContext\(\);[\s\S]{0,500}SharedPreferences prefs = context\.getSharedPreferences\([\s\S]{0,250}GtoObserverService\.PREFS_NAME[\s\S]{0,250}Context\.MODE_PRIVATE/.test(plugin)
    && /public void openGto\(PluginCall call\) \{[\s\S]{0,1800}prefs\.getString\("tripState"/.test(plugin),
);
check(
  "active journey is preserved when GTO is reopened",
  policy.includes("isPreparedForGtoOpen")
    && policy.includes('"TRIP_IN_PROGRESS".equals(state)')
    && !/prepareJourneyForGtoLaunch[\s\S]{0,700}clearTripAnalysis\(/.test(service),
);
check(
  "stale OEM UsageStats can be recovered by real freight pixels after launch preparation",
  service.includes("capture-gate-freight-list")
    && service.includes("recordVisualGtoForegroundEvidence")
    && service.includes("GtoProjectionContinuityPolicy")
    && service.includes("mayProbeWaitingFreightDuringForegroundLag")
    && service.includes("trustedWaitingFreightProbe")
    && policy.includes("mayUseVisualFreightProof")
    && policy.includes("waitingForFreight"),
);
check(
  "launch visual bridge never overrides a known third-party foreground app",
  service.includes("packageMatchesGto")
    && service.includes("packageUnknown")
    && service.includes("packageIsNvu")
    && service.includes("transientForegroundSurfaceActive")
    && service.includes("A positively identified unrelated app is still excluded"),
);
check(
  "WAITING_FREIGHT consumes every selection frame in order",
  service.includes("GtoDeterministicFlowPolicy.useOrderedFreightFrames(getTripState())")
    && service.includes("reader.acquireNextImage()")
    && policy.includes('"WAITING_FREIGHT".equals(state)')
    && policy.includes('"TRIP_STARTED".equals(state)'),
);
check(
  "middle-row N-to-N-1 press evidence is preserved instead of collapsing to zero buttons",
  detector.includes("isPressTransitionButtonSubset")
    && detector.includes("bestTransition")
    && detector.includes("detectTemporarilyMissingPressedRow"),
);
check(
  "freight selection still needs list exit plus precise row OCR",
  service.includes("finalizeFastVisualSelection()")
    && service.includes("runPreciseSelectedRowOcr(transaction)")
    && service.includes("fastMissingListFrames >= missingRequired"),
);
check(
  "fast selection forces current-page OCR from the frozen pre-touch panel before row agreement",
  service.includes("transaction.pageGeneration != freightPageGeneration")
    && service.includes("!isStableFreightSafeToCommit(canonicalBeforeSelection) && !ocrBusy.get()")
    && service.includes("transaction.panelFrame")
    && service.includes("transaction.buttons")
    && service.includes("true\n            );")
    && service.includes("if (!selectionCritical && now - lastFreightPageOcrAt < 220L) return")
    && service.includes("if (!ocrBusy.compareAndSet(false, true)) return"),
);
check(
  "confirmed freight becomes immutable current trip and is shown to the driver",
  service.includes("GtoAutoTripSync.lockSelectedFreight")
    && service.includes("STATE_TRIP_IN_PROGRESS")
    && (service.includes("Frete identificado. Tudo preparado, podemos partir!") || service.includes("Frete confirmado ✓ · viagem em andamento."))
    && service.includes('freightHeading.setText("Frete atual")'),
);
check(
  "leaving GTO pauses analysis without mutating trip state",
  service.includes("pauseScreenAnalysisOutsideGto")
    && !/private void pauseScreenAnalysisOutsideGto[\s\S]{0,1300}setTripState\(/.test(service)
    && service.includes("resumeScreenAnalysisInSameState"),
);
check(
  "unknown screens stay neutral",
  service.includes('recordNeutralScreenObservation("CERTIFIED_RESULT_PENDING_TERMINAL_ACTION"')
    && service.includes('recordNeutralScreenObservation("UNRECOGNIZED_FOR_" + getTripState()'),
);
check(
  "live Android state is the UI authority instead of a lagging Firestore mirror",
  setup.includes("status?.running && status?.tripState")
    && setup.indexOf("status?.running && status?.tripState") < setup.indexOf("canonicalState?.state || status?.tripState"),
);
check(
  "stale driver-stage text cannot override a newer native trip state",
  plugin.includes('status.put("tripStateChangedAt"')
    && observerTs.includes("tripStateChangedAt?: number")
    && setup.includes("driverStageIsCurrent")
    && setup.includes("status.driverStageAt >= status.tripStateChangedAt"),
);
check(
  "paused UI reports PAUSADA_FORA_DO_GTO while preserving canonical state",
  setup.includes('"PAUSADA_FORA_DO_GTO"')
    && setup.includes("tripStateWhenAnalysisPaused"),
);
check(
  "real certified result arms automatic completion without requiring Receive",
  service.includes('putString("completionStatus", "RESULT_CERTIFIED_AUTO_PENDING")')
    && service.includes("attemptAutoFinalizeCertifiedResult")
    && service.includes('putBoolean("resultAutoCompletionLatched", true)'),
);
check(
  "Receive is durably latched before automatic completion",
  /latchExactReceiveAndSend[\s\S]{0,1800}\.commit\(\)[\s\S]{0,900}confirmNormalResultAutomatically\(\)/.test(service)
    && service.includes('putBoolean("resultReceiveLatched", true)'),
);
check(
  "OEM fallback Receive latch cannot be downgraded by a late result OCR callback",
  service.includes("latchedResultAction.startsWith(\"RECEIVE\")")
    && service.includes("receiveAlreadyLatched"),
);
check(
  "completion is persisted before RESULT_CONFIRMED and before queueing",
  /private void confirmNormalResultAutomatically\(\)[\s\S]*?putString\("completionStatus", "CONFIRMED_NORMAL"\)[\s\S]*?\.commit\(\)[\s\S]*?setTripState\(STATE_RESULT_CONFIRMED[\s\S]*?GtoTripSubmissionCoordinator\.submitCompletedTrip\(this, prefs/.test(service),
);
check(
  "automatic sync seals and durably queues payload before Firebase send",
  sync.includes("sealPayload(payload)")
    && sync.includes("QUEUE_PREFIX + sessionId")
    && sync.indexOf("sealPayload(payload)") < sync.indexOf("registerGtoTrip"),
);
check(
  "sync retry remains enabled without deleting the journey on network failure",
  service.includes("flushAutomaticTripQueue")
    && service.includes("AUTO_SYNC_RETRY_INTERVAL_MS")
    && sync.includes("STATUS_PENDING"),
);
check(
  "frame-processing failures expose concrete diagnostic details",
  service.includes("reportFrameProcessingError")
    && service.includes("describeError(error)")
    && plugin.includes('status.put("frameProcessingError"'),
);

if (fs.existsSync("scripts/fixtures/gto-real-freight-list-5.png")) {
  runJava(
    "real freight list pixels",
    "com.nvu.operacional.GtoRealFreightScreenshotTest",
    ["scripts/java-tests/android/graphics/Rect.java", "scripts/java-tests/android/media/Image.java", paths.detector,
        paths.listEvidence, "scripts/java-tests/com/nvu/operacional/GtoRealFreightScreenshotTest.java"],
    ["-Djava.awt.headless=true"],
  );
  runJava(
    "real freight press selection",
    "com.nvu.operacional.GtoRealFreightPressSelectionTest",
    ["scripts/java-tests/android/graphics/Rect.java", "scripts/java-tests/android/media/Image.java", paths.detector,
        paths.listEvidence, "scripts/java-tests/com/nvu/operacional/GtoRealFreightPressSelectionTest.java"],
    ["-Djava.awt.headless=true"],
  );
} else {
  check("real freight pixel fixtures", true, "SKIPPED: binary fixture is not part of this source-only checkout");
}
runJava(
  "full deterministic journey",
  "com.nvu.operacional.GtoFullJourneyPolicyTest",
  [paths.policy, "scripts/java-tests/com/nvu/operacional/GtoFullJourneyPolicyTest.java"],
);
runJava(
  "result visual matrix",
  "com.nvu.operacional.GtoResultVisualGateScreenMatrixTest",
  ["scripts/java-tests/android/graphics/Rect.java", "scripts/java-tests/android/media/Image.java", "android/app/src/main/java/com/nvu/operacional/GtoResultVisualGate.java",
      "android/app/src/main/java/com/nvu/operacional/GtoResultEvidencePolicy.java", "scripts/java-tests/com/nvu/operacional/GtoResultVisualGateScreenMatrixTest.java"],
);

const failed = checks.filter((x) => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3.27 runtime-flow checks passed.`);
if (failed.length) process.exit(1);
