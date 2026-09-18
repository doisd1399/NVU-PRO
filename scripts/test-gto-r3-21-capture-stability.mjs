import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const paths = {
  gate: "android/app/src/main/java/com/nvu/operacional/GtoCaptureStabilityGate.java",
  service: "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java",
  plugin: "android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java",
  main: "android/app/src/main/java/com/nvu/operacional/MainActivity.java",
  test: "scripts/java-tests/com/nvu/operacional/GtoCaptureStabilityGateTest.java",
};
const source = Object.fromEntries(
  Object.entries(paths).map(([name, file]) => [name, fs.readFileSync(file, "utf8")]),
);
const onImageAvailableStart = source.service.indexOf("private void onImageAvailable(ImageReader reader)");
const onImageAvailableEnd = source.service.indexOf("private boolean isCurrentAnalysisOcr", onImageAvailableStart);
const onImageAvailable = source.service.slice(onImageAvailableStart, onImageAvailableEnd);

const checks = [];
function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

check(
  "gate requires three stable frames",
  source.gate.includes("REQUIRED_STABLE_FRAMES = 3")
    && source.gate.includes("stableFrames >= REQUIRED_STABLE_FRAMES"),
);
check(
  "gate requires a settling interval as well as frame count",
  source.gate.includes("MIN_GEOMETRY_SETTLE_MS") && source.gate.includes("settledLongEnough"),
);
check(
  "gate requires live capture continuity and stable geometry before analysis",
  source.service.includes("hasLiveCaptureContinuity(now)")
    && source.service.includes("captureStabilityGate.isReady()")
    && source.service.includes("capture-gate-freight-list"),
);
check(
  "all frame analysis is blocked before the stability gate",
  onImageAvailable.includes("if (!isCaptureReadyForAnalysis(callbackAt))")
    && onImageAvailable.indexOf("if (!isCaptureReadyForAnalysis(callbackAt))")
      < onImageAvailable.indexOf("if (STATE_WAITING_FREIGHT.equals(getTripState()))"),
);
check(
  "freight selection mutation remains gated while passive result observer may stay armed",
  source.service.includes("isCaptureReadyForAnalysis(now)")
    && source.service.includes("GtoResultActionFlowPolicy.keepPassiveTransportObserver")
    && source.service.includes("Listener presence is continuity infrastructure, not action authority"),
);
check(
  "resize invalidates geometry-bound analysis before rebuilding the reader",
  source.service.includes("invalidateCaptureBoundAnalysis(\"CAPTURE_RESIZE\")")
    && source.service.includes("CAPTURE_WAITING_ORIENTATION"),
);
check(
  "stable-ready edge resets baseline before the next analyzed frame",
  source.service.includes("invalidateCaptureBoundAnalysis(\"GTO_GEOMETRY_STABLE\")"),
);
const invalidationStart = source.service.indexOf("private void invalidateCaptureBoundAnalysis");
const invalidationEnd = source.service.indexOf("private boolean hasFreshGtoForegroundEvidence", invalidationStart);
const invalidationBody = source.service.slice(invalidationStart, invalidationEnd);
check(
  "geometry invalidation does not delete locked freight or durable completion data",
  !invalidationBody.includes("selectedFreight")
    && !invalidationBody.includes("freightFingerprint")
    && !invalidationBody.includes("resultReceiveLatched")
    && !invalidationBody.includes("gtoTripSessionId"),
);
check(
  "Web launch arms a new GTO barrier while projection consent stays service-gated",
  source.plugin.includes("GtoObserverService.markGtoLaunchRequestedIfRunning()")
    && source.service.includes("projectionPermissionAfterGtoOpenPending = true")
    && source.service.includes("WAITING_GTO_FOR_PERMISSION")
    && !source.main.includes("markGtoLaunchRequestedIfRunning()"),
);
check(
  "runtime diagnostics expose readiness separately from projection activity",
  source.plugin.includes('status.put("captureReadyForAnalysis"')
    && source.plugin.includes('status.put("captureReadiness"'),
);
check(
  "resize failure preserves valid MediaProjection and retries automatically",
  source.service.includes('putString("captureReadiness", "RECOVERING_RESIZE")')
    && source.service.includes('handler.postDelayed(() -> resizeProjectionSurface(width, height), retryDelay)')
    && source.service.includes('Only MediaProjection.Callback.onStop() is allowed'),
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-gto-gate-"));
try {
  const run = spawnSync(
    "java",
    [
      "scripts/java-tests/JavaTestRunner.java",
      tmp,
      "com.nvu.operacional.GtoCaptureStabilityGateTest",
      paths.gate,
      paths.test,
    ],
    { encoding: "utf8" },
  );
  const javaOutput = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
  check("capture stability gate compiles", !javaOutput.includes("compilation failed"), javaOutput);
  check(
    "capture stability runtime scenarios pass",
    run.status === 0 && String(run.stdout || "").includes("PASS"),
    javaOutput || String(run.error || ""),
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = checks.filter((item) => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3.21 capture-stability checks passed.`);
if (failed.length) process.exit(1);
