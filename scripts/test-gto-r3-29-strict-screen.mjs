import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
const servicePath = "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java";
const detectorPath = "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java";
const listEvidencePath = "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java";
const service = read(servicePath);
const detector = read(detectorPath);
const listEvidence = read(listEvidencePath);
const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function runJava(name, mainClass, sources, javaArgs = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-r329-"));
  try {
    const run = spawnSync("java", [...javaArgs, "scripts/java-tests/JavaTestRunner.java", tmp, mainClass, ...sources], { encoding: "utf8" });
    const out = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
    check(`${name} fixtures compile`, !out.includes("Java compilation failed"), out);
    check(`${name} scenarios pass`, run.status === 0 && String(run.stdout || "").includes("PASS"), out || String(run.error || ""));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

check("freight list requires a bounded top-panel first row", detector.includes("screenHeight * 0.055f") && detector.includes("screenHeight * 0.20f"));
check("freight list requires repeated same-row Aceitar + freight-information anchors on multi-row pages", detector.includes("acceptAndInfoAnchorRows") && detector.includes("GtoFreightListEvidencePolicy.isPlausibleSimpleList") && listEvidence.includes("requiredAnchors") && listEvidence.includes("Math.min(2, rowCount)"));
check("freight list rejects inconsistent button widths", detector.includes("largestWidth > Math.round(smallestWidth * 1.70f)"));
check("freight list uses narrow repeated-card vertical cadence", detector.includes("screenHeight * 0.100f") && detector.includes("screenHeight * 0.235f"));
check("bitmap/OCR fallback has the same strict refined list gate", service.includes("plausibleRefinedAcceptStack(bitmap, best)"));
check("non-list frames clear runtime freight count instead of preserving stale UI", service.includes('persistFreightRuntimeStatus("OTHER", 0, now, sequence)'));
check("selection OCR busy watchdog allows slow devices without silent lock", service.includes("PRECISE_OCR_BUSY_WAIT_TIMEOUT_MS = 8000L"));
check("selected freight still requires list exit and precise OCR", service.includes("finalizeFastVisualSelection()") && service.includes("runPreciseSelectedRowOcr"));
check("result completion remains gated and durable", service.includes('putBoolean("resultReceiveLatched", true)')
  && service.includes("GtoTripSubmissionCoordinator.submitCompletedTrip"));

if (fs.existsSync("scripts/fixtures/r329-real-freight-list.png")) {
  runJava(
    "real/neutral R3.29 screen classifier",
    "com.nvu.operacional.GtoR329StrictFreightScreenTest",
    [
      "scripts/java-tests/android/graphics/Rect.java",
      "scripts/java-tests/android/media/Image.java",
      detectorPath,
      listEvidencePath,
      "scripts/java-tests/com/nvu/operacional/GtoR329StrictFreightScreenTest.java",
    ],
    ["-Djava.awt.headless=true"],
  );
} else {
  check("real/neutral R3.29 pixel fixtures", true, "SKIPPED: binary fixtures are not part of this source-only checkout");
}
runJava(
  "1-6 freight geometry and selection",
  "com.nvu.operacional.GtoFreightSelectionRegressionTest",
  [
    "scripts/java-tests/android/graphics/Rect.java",
    "scripts/java-tests/android/media/Image.java",
    detectorPath,
    listEvidencePath,
    "scripts/java-tests/com/nvu/operacional/GtoFreightSelectionRegressionTest.java",
  ],
);
runJava(
  "full deterministic journey",
  "com.nvu.operacional.GtoFullJourneyPolicyTest",
  [
    "android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoFullJourneyPolicyTest.java",
  ],
);

const failed = checks.filter((x) => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3.29 strict-screen checks passed.`);
if (failed.length) process.exit(1);
