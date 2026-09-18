import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const gradle = read("android/app/build.gradle");
const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures.push(name);
};
const method = (source, start, end) => {
  const a = source.indexOf(start);
  if (a < 0) return "";
  const b = end ? source.indexOf(end, a + start.length) : -1;
  return source.slice(a, b >= 0 ? b : source.length);
};

check("HF15+ Android identity remains at or above 1.0.67 / 67",
  Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0) >= 67 && Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/) || [])[1] || 0) >= 67);

const frameHandler = method(service, "private void onImageAvailable", "private boolean isCaptureReadyForAnalysis");
check("own NVU menu cannot recreate the old visual result false-positive",
  service.includes("resultProbeOccludedByNvuMenu = ownMenuOccludesResultProbe();")
  && !service.includes("tripResultCandidate = resultVisualGate.looksLikeResultDialog"));

check("own-menu frame no longer suspends semantic result OCR",
  !service.includes("&& !resultProbeOccludedByNvuMenu")
  && service.includes("Card NVU aberto sem suspender leitura do resultado"));

check("visual result candidate never closes the driver-opened card",
  !method(service, "if (resultTrackingState) {", "long interval = analysisIntervalForState").includes("mainHandler.post(this::closeMenu)")
  && !method(service, "private void keepOverlaysClearOfResultRegion", "private int dp(int value)").includes("closeMenu()"));

check("result protection repositions card instead of closing it",
  method(service, "private void keepOverlaysClearOfResultRegion", "private int dp(int value)")
    .includes("windowManager.updateViewLayout(menuView, menuParams)")
  && method(service, "private void keepOverlaysClearOfResultRegion", "private int dp(int value)")
    .includes("full-width card"));

check("trip card uses the same bubble-anchored placement as every other state",
  method(service, "private void openMenu()", "private void populateMenuContents")
    .includes("chooseMenuSideForBubble")
  && !method(service, "private void openMenu()", "private void populateMenuContents")
    .includes("proposedX = dp(8)"));

check("freight overlay can minimize only for an actionable list with no safe card room",
  method(service, "private void keepOverlaysClearOfFreightPanel", "private Rect resultProbeRegionOnScreen").includes("freightListInteractionActive")
  && method(service, "private void keepOverlaysClearOfFreightPanel", "private Rect resultProbeRegionOnScreen").includes("availableSafeWidth < menuWidth")
  && method(service, "private void keepOverlaysClearOfFreightPanel", "private Rect resultProbeRegionOnScreen").includes("menuMinimizedForFreightListAt"));

check("stage messages are centered at top",
  service.includes("Gravity.TOP | Gravity.CENTER_HORIZONTAL")
  && service.includes("params.y = safeTopInsetPx() + dp(6)")
  && service.includes("chip.setGravity(driverStage ? Gravity.CENTER"));

check("stage message does not require bubble geometry",
  service.includes("if (!driverStage && bubbleParams == null) return;"));

check("old delayed chip hide is cancelled before showing a new message",
  service.includes("cancelScheduledStatusChipHide();")
  && service.includes("mainHandler.removeCallbacks(statusChipHideRunnable)"));

check("generic diagnostics cannot replace a visible journey-stage banner",
  service.includes("if (!driverStage && statusChipIsDriverStage && statusChipView != null) return;"));

check("foreground oscillation preserves driver-stage banner",
  method(service, "private void suspendPassiveDetectionOverlaysKeepBubbleAndMenu", "private void suspendInteractiveOverlaysKeepBubble")
    .includes("if (!statusChipIsDriverStage) hideStatusChip();"));

check("successful selection still announces prepared-to-depart message",
  (service.includes('"Frete identificado. Tudo preparado, podemos partir!"') || service.includes('"Frete confirmado ✓ · viagem em andamento."')));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf15-"));
try {
  const run = spawnSync("java", [
    "scripts/java-tests/JavaTestRunner.java", tmp,
    "com.nvu.operacional.GtoR334Hf15OverlaySelfInterferenceTest",
    "android/app/src/main/java/com/nvu/operacional/GtoResultEvidencePolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoR334Hf15OverlaySelfInterferenceTest.java"
  ], { cwd: root, encoding: "utf8" });
  const output = `${run.stdout || ""}${run.stderr || ""}`.trim();
  check("HF14 physical screenshot ratios reproduce the false result gate",
    run.status === 0 && output.includes("GtoR334Hf15OverlaySelfInterferenceTest: PASS"));
  if (run.status !== 0) console.error(output);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${13 - failures.length}/13 HF15 overlay/stage checks passed.`);
if (failures.length) process.exit(1);
