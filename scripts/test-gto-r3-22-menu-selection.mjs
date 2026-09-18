import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const files = {
  service: "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java",
  detector: "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
  listEvidence: "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
  rect: "scripts/java-tests/android/graphics/Rect.java",
  image: "scripts/java-tests/android/media/Image.java",
  test: "scripts/java-tests/com/nvu/operacional/GtoFreightSelectionRegressionTest.java",
};
const service = fs.readFileSync(files.service, "utf8");
const detector = fs.readFileSync(files.detector, "utf8");
const sensorStart = service.indexOf("private void showFreightTouchPulseSensor()");
const sensorEnd = service.indexOf("private void hideFreightTouchPulseSensor()", sensorStart);
const sensor = service.slice(sensorStart, sensorEnd);

const checks = [];
function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

check(
  "open NVU menu no longer blocks a GTO freight touch",
  sensor.includes("if (selectionArmed)")
    && sensor.includes("queueFreightTouchMarker(event)")
    && !sensor.includes("captureStabilityGate.isReady() || menuView != null"),
);
check(
  "touches provably inside the NVU menu are ignored",
  sensor.includes("isTouchInsideOpenMenu(event)")
    && service.includes("x >= menuParams.x && x < menuParams.x + width"),
);
check(
  "exact outside coordinate is mapped only to one frozen Aceitar row",
  service.includes("exactConsistentRowFromOutsideTouch")
    && service.includes("exactUniqueRowForTouch(candidate[0], candidate[1], buttons)")
    && service.includes("rawHit >= 0 && rawHit == localHit")
    && service.includes("bestCount > secondCount ? bestRow : -1"),
);
check(
  "coordinate candidate still requires list closure before finalization",
  service.includes('"exact-outside-touch+frame-lock"')
    && service.includes("fastPendingSelectedRow = exactTouchRow")
    && service.includes("fastMissingListFrames >= missingRequired")
    && service.includes("finalizeFastVisualSelection()"),
);
check(
  "redacted coordinates retain pressed-frame fallback",
  service.includes("detectPressedRowAfterTouch(fastTouchBaseline, current, captureHeight)"),
);
check(
  "button stack geometry rejects inconsistent heights while allowing only a bounded press-transition subset",
  (detector.match(/largestHeight > Math\.round\(smallestHeight \* 1\.75f\)/g) || []).length >= 2
    && detector.includes("isPressTransitionButtonSubset")
    && detector.includes("largeGapCount <= 1"),
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-gto-selection-r322-"));
try {
  const run = spawnSync(
    "java",
    [
      "scripts/java-tests/JavaTestRunner.java",
      tmp,
      "com.nvu.operacional.GtoFreightSelectionRegressionTest",
      files.rect,
      files.image,
      files.detector,
      files.listEvidence,
      files.test,
    ],
    { encoding: "utf8" },
  );
  const output = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
  check("selection regression fixtures compile", !output.includes("compilation failed"), output);
  check(
    "real freight page passes and reported gameplay false positive fails",
    run.status === 0 && String(run.stdout || "").includes("PASS"),
    output || String(run.error || ""),
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = checks.filter((item) => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3.22 menu-selection checks passed.`);
if (failed.length) process.exit(1);
