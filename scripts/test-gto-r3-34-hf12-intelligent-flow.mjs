import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const detector = read("android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java");
const resultGate = read("android/app/src/main/java/com/nvu/operacional/GtoResultVisualGate.java");
const flow = read("android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java");
const gradle = read("android/app/build.gradle");

check("HF13+ Android identity remains at or above 1.0.65 / 65", Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0) >= 65 && Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/) || [])[1] || 0) >= 65);
check("list detection uses one strong same-row Aceitar + freight-info anchor", detector.includes("GtoFreightListEvidencePolicy.isPlausibleSimpleList") && detector.includes("acceptAndInfoAnchorRows") && !detector.includes("orangeRatios[i] < 0.14f"));
check("legacy result visual gate is no longer on the active decision path", resultGate.includes("GtoResultEvidencePolicy.isPlausibleResult") && !service.includes("tripResultCandidate = resultVisualGate.looksLikeResultDialog"));
check("ordered freight queue guards producer order without cross-timebase wall-clock math", service.includes("GtoFrameFreshnessPolicy.shouldConsume") && service.includes("criticalTouchFrame"));
check("touch-row identity invariant is explicit", service.includes("GtoSelectionIdentityPolicy.resolveRow") && service.includes("exactConsistentRowFromOutsideTouch"));
check("field review preserves confirmed human-backed selection", service.includes('persistSelectionIdentity(selected.rowIndex, "CONFIRMED", reviewedIdentitySource)') && service.includes('putString("selectionConfirmationStatus", "REVIEW_REQUIRED")') && service.includes("enterFreightReview"));
check("manual field provenance is persisted", service.includes('"MANUAL_DRIVER"') && service.includes('"reviewDestinationSource"') && service.includes('"selectedDestinationSource"'));
check("manual destination is not silently passed through trusted city resolver", !service.includes("finalDestination = resolveTrustedDestination(canonical.destination)") && !service.includes("option.destination = destinationResolution.value") && service.includes("destination OCR stays literal"));
check("result tracking continues while a freight field is under review", service.includes("pendingResultDuringFreightReview") && service.includes("isResultTrackingState(state)") && service.includes("promotePendingResultAfterFreightReview"));
check("receive latch is idempotently deferred until reviewed freight is locked", service.includes("Receber confirmado · aguardando apenas a revisão do frete") && service.includes("resultReceiveLatched") && service.includes("GtoAutoTripSync.lockSelectedFreight"));
check("GTO return refresh includes confirming state", flow.includes('|| "CONFIRMING_FREIGHT".equals(state)') && service.includes("linha selecionada e campos já confirmados foram preservados"));
check("NVU overlay clears result critical region", service.includes("keepOverlaysClearOfResultRegion") && service.includes('putString("overlayProtectedRegion", "RESULT")'));
check("selection watchdog cannot reset field review", service.includes("if (isFreightReviewPending()) return;"));
check("freight rows persist row identity, geometry, accept rectangle and per-field confidence", service.includes('json.put("rowId", "row-"') && service.includes('json.put("bounds", bounds)') && service.includes('json.put("acceptRect", acceptRect)') && service.includes('json.put("fieldConfidence", fieldConfidence)'));
check("local integrity failure is retryable without resetting selected freight", service.includes('GtoFreightReviewPolicy.LOCAL_INTEGRITY') && service.includes('Tentar confirmar integridade') && !service.includes('clearUncommittedSelectedFreight();\n            enterFreightReview('));
check("visibility return requires three clean stable frames before analysis resumes", service.includes('captureResumeBarrier') && service.includes('GtoCaptureStabilityGate.CAPTURE_WAITING_STABLE_FRAMES') && read("android/app/src/main/java/com/nvu/operacional/GtoCaptureStabilityGate.java").includes('REQUIRED_STABLE_FRAMES = 3'));
check("result detection uses simple Concluido + monetary value semantic pair", service.includes("GtoSimpleScreenDetectionPolicy.isCompletedResult") && service.includes("completionWord, !GtoMoneyValue.canonical(result.value).isEmpty()"));
check("unreadable result value preserves result review instead of completing incomplete trip", service.includes('resultRecognitionStatus') && service.includes('resultReviewRequiredField') && service.includes('RECEIVE_LATCHED_WAITING_VALUE'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-r334-hf12-flow-"));
try {
  const run = spawnSync("java", [
    "scripts/java-tests/JavaTestRunner.java",
    tmp,
    "com.nvu.operacional.GtoR334Hf12IntelligentFlowPolicyTest",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoResultEvidencePolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFrameFreshnessPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoSelectionIdentityPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoManualRouteSelectionPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
    "scripts/java-tests/com/nvu/operacional/GtoR334Hf12IntelligentFlowPolicyTest.java",
  ], { cwd: root, encoding: "utf8" });
  const out = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
  check("HF12 intelligent-flow policies compile", !out.includes("compilation failed") && !out.includes("Java compilation failed"), out);
  check("HF12 intelligent-flow scenarios pass", run.status === 0 && String(run.stdout || "").includes("PASS"), out);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = checks.filter((x) => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3.34 HF12 intelligent-flow checks passed.`);
if (failed.length) process.exit(1);
