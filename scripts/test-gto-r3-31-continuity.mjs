import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
const servicePath = "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java";
const detectorPath = "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java";
const listEvidencePath = "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java";
const policyPath = "android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java";
const service = read(servicePath);
const detector = read(detectorPath);
const gradle = read("android/app/build.gradle");
const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function runJava(name, mainClass, sources, javaArgs = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-r331-"));
  try {
    const run = spawnSync("java", [...javaArgs, "scripts/java-tests/JavaTestRunner.java", tmp, mainClass, ...sources], { encoding: "utf8" });
    const out = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
    check(`${name} fixtures compile`, !out.includes("Java compilation failed"), out);
    check(`${name} scenarios pass`, run.status === 0 && String(run.stdout || "").includes("PASS"), out || String(run.error || ""));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

check("R3.31 Android version", Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0) >= 48 && Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/)||[])[1]||0) >= 48);
check("active trip freight detector is explicitly gated", service.includes("mayProbeFreightListForCurrentState") && service.includes("explicitReplacement"));
check("unarmed trip force-clears stale freight-list UI", service.includes('putString("screenState", "TRIP")') && service.includes('putBoolean("activeTripFreightListVisible", false)'));
check("legacy replacement path is explicit-only but no longer exposed in normal UI", !service.includes('menuButton("Trocar frete atual")') && service.includes("mayProbeFreightListForCurrentState") && service.includes("explicitReplacement"));
check("post-ACK flow automatically prepares next freight", service.includes("shouldAutoPrepareNextFreightAfterSync") && service.includes("beginTrip(false, false)"));
check("driver is explicitly told only ACK-confirmed send succeeded", service.includes("Viagem enviada com sucesso!") || service.includes("Viagem enviada ✓"));
check("app return refreshes only transient visual context", service.includes("refreshTransientVisualContextAfterGtoReturn") && service.includes("Durable selected-freight/result data is never"));
check("post-sync state change while outside GTO is expected", service.includes("expectedPostSyncNextTrip") && service.includes("gtoAutoNextTripPreparedAt"));
check("extreme top HUD cannot be a one-row list", detector.includes("screenHeight * 0.055f"));
check("new real screenshots are packaged as regressions", fs.existsSync("scripts/fixtures/r331-trip-phantom-list.png") && fs.existsSync("scripts/fixtures/r331-post-trip-screen.png"));

runJava(
  "R3.31 state policy",
  "com.nvu.operacional.GtoR331ContinuityPolicyTest",
  [policyPath, "scripts/java-tests/com/nvu/operacional/GtoR331ContinuityPolicyTest.java"],
);
runJava(
  "strict classifier including R3.31 screenshots",
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

const failed = checks.filter((x) => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3.31 continuity checks passed.`);
if (failed.length) process.exit(1);
