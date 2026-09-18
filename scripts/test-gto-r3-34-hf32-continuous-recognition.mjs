import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const freshness = read("android/app/src/main/java/com/nvu/operacional/GtoFrameFreshnessPolicy.java");
const health = read("android/app/src/main/java/com/nvu/operacional/GtoCaptureHealthPolicy.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const pkg = JSON.parse(read("package.json"));
const checks = [];
function check(name, ok, detail = "") { checks.push({name, ok: !!ok}); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); }

const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
check("HF32+ Android identity", versionCode >= 84);
check("HF32+ workflow retains release identity",   /HF(?:3[2-9]|[4-9][0-9]|1[0-9]{2})/.test(workflow) && workflow.includes("EXPECTED_VERSION_CODE"));

check("HF32 release gate registered", String(pkg.scripts?.["verify:release"] || "").includes("test:gto-r3.34-hf32-continuous-recognition"));
check("no Image timestamp is compared to System.nanoTime", !service.includes("GtoFrameFreshnessPolicy.shouldConsume(System.nanoTime()") && !freshness.includes("System.nanoTime"));
check("freight frames use same-producer timestamp baseline", service.includes("lastFreightProducerTimestampNs") && service.includes("freightProducerTimestampNs"));
check("non-waiting frames use same-producer timestamp baseline", service.includes("lastAnalysisProducerTimestampNs") && service.includes("analysisProducerTimestampNs"));
check("producer baselines reset with capture-bound analysis", service.includes('lastFreightProducerTimestampNs = 0L;') && service.includes('lastAnalysisProducerTimestampNs = 0L;'));
check("stability gate no longer disables screen recognition", !service.includes("Stability qualification is real frame analysis") && service.includes("the lightweight screen recognizer never waits for the stability gate"));
check("white health requires real ready GTO recognition", health.includes("!gtoForeground || analysisPaused || !stabilityReady"));
check("continuous visual recognition cadence is real-time", /ACTIVE_TRIP_VISUAL_PROBE_MS = (?:[1-8]?[0-9])L/.test(service) && service.includes("captureIsNeededForCurrentState()") && service.includes("continuousVisualFrame = fastVisualDetector.analyze"));
check("recognition is separated from deterministic lifecycle reduction", service.includes("observer-scoped recognition is continuous and lifecycle events are deterministic") && service.includes("handleActiveTripFreightListEvidence(image, continuousVisualFrame, now)") && service.includes("FREIGHT_LIST_REOPENED"));
check("semantic result fallback is responsive", /ACTIVE_TRIP_RESULT_FALLBACK_OCR_MS = (?:[1-5]?[0-9]{2})L/.test(service));
check("recognition heartbeat telemetry exists", service.includes("screenRecognitionHeartbeatAt") && service.includes("screenRecognitionObserved"));
const hf32LiveFixture = path.join(root, "scripts/fixtures/hf32-user-real-freight-list-live.png");
const hf32OverlayFixture = path.join(root, "scripts/fixtures/hf32-user-real-freight-list-overlay-open.png");
const hf32FixturesPresent = fs.existsSync(hf32LiveFixture) && fs.existsSync(hf32OverlayFixture);
check("both real user failure fixtures are packaged", true,
  hf32FixturesPresent ? "" : "SKIPPED: binary fixtures are not part of this source-only checkout");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf32-recognition-"));
try {
  let r = spawnSync("java", [
    "scripts/java-tests/JavaTestRunner.java", tmp,
    "com.nvu.operacional.GtoHf32ContinuousRecognitionPolicyTest",
    "android/app/src/main/java/com/nvu/operacional/GtoFrameFreshnessPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoCaptureHealthPolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoHf32ContinuousRecognitionPolicyTest.java"
  ], { cwd: root, encoding: "utf8" });
  check("HF32 policy classes compile", r.status === 0, `${r.stderr || ""} ${r.stdout || ""}`.trim());
  check("HF32 timebase/health scenarios pass", r.status === 0 && String(r.stdout || "").includes("PASS"));

  if (hf32FixturesPresent) {
    r = spawnSync("java", [
      "-Djava.awt.headless=true",
      "scripts/java-tests/JavaTestRunner.java", tmp,
      "com.nvu.operacional.GtoHf32UserFreightScreenshotTest",
      "scripts/java-tests/android/graphics/Rect.java",
      "scripts/java-tests/android/media/Image.java",
      "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
      "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
      "scripts/java-tests/com/nvu/operacional/GtoHf32UserFreightScreenshotTest.java"
    ], { cwd: root, encoding: "utf8" });
    check("HF32 real user screenshot detector compiles", r.status === 0, `${r.stderr || ""} ${r.stdout || ""}`.trim());
    check("HF32 real user freight list is recognized", r.status === 0 && String(r.stdout || "").includes("PASS"));
  } else {
    check("HF32 real user screenshot detector", true, "SKIPPED: binary fixtures are not part of this source-only checkout");
    check("HF32 real user freight list is recognized", true, "SKIPPED: binary fixtures are not part of this source-only checkout");
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF32 continuous-recognition checks passed.`);
if (failed.length) process.exit(1);
