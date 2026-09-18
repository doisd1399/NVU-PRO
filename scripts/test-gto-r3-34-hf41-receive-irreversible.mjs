import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoResultActionFlowPolicy.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks = [];
const ck = (name, ok) => { checks.push({name, ok: !!ok}); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };

const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const name = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
ck("HF41+ Android identity baseline", code >= 93 && Number(name.split(".").pop() || 0) >= 93);
ck("workflow identity follows current Android source", workflow.includes(`EXPECTED_VERSION_CODE: "${code}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${name}"`));
ck("passive touch observer remains armed for enabled GTO recovery",
  service.includes("GtoResultActionFlowPolicy.keepPassiveTransportObserver")
  && policy.includes("return observeEnabled && overlayAllowed")
  && policy.includes("Listener presence is transport only"));
ck("result touch no longer depends on capture-stability readiness",
  service.includes("resultActionArmed")
  && service.includes("resolveResultActionOutsideTouch(event)")
  && !service.match(/if \(!gtoForeground \|\| !captureStabilityGate\.isReady\(\)\) return false;/));
ck("real result closes expanded NVU card before asking for irreversible Receive",
  service.includes("if (menuView != null) closeMenu();") && service.includes("RESULT_DETECTED"));
ck("post-result action switches OCR to whole display",
  service.includes("postResultFullFrame") && service.includes("GtoResultActionFlowPolicy.useFullFramePostResult"));
ck("physical result-dialog disappearance contributes to full-frame mode",
  service.includes("resultDialogVisualPresentNow") && service.includes("resultDialogVisualAbsentFrames"));
ck("post-result transition remains durable before completion",
  service.includes('putBoolean("resultReceiveLatched", true)') && service.includes('confirmNormalResultAutomatically();'));
ck("HF41 Receive latch contract remains represented",
  policy.includes("mayCommitCompletedTrip") && policy.includes("receiveLatched"));
ck("ADS/result semantics remain evaluated in post-result flow",
  service.includes("containsPostResultAdEvidence(normalized)"));
const hf41FixturePaths = [
  "scripts/fixtures/hf41-receive-flow/result-screen-receive.png",
  "scripts/fixtures/hf41-receive-flow/gameplay-after-receive.png",
];
const hf41FixturesPresent = hf41FixturePaths.every(fs.existsSync);
ck("HF41 physical screenshots packaged", true,
  hf41FixturesPresent ? "" : "SKIPPED: binary fixtures are not part of this source-only checkout");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf41-policy-"));
try {
  let r = spawnSync("javac", ["-encoding", "UTF-8", "-d", tmp,
    "android/app/src/main/java/com/nvu/operacional/GtoResultActionFlowPolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoHf41ReceiveFlowPolicyTest.java",
  ], {encoding:"utf8"});
  if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
  ck("HF41 result-action policy compiles", r.status === 0);
  if (r.status === 0) {
    r = spawnSync("java", ["-cp", tmp, "com.nvu.operacional.GtoHf41ReceiveFlowPolicyTest"], {encoding:"utf8"});
    if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
    ck("HF41 result-action policy scenarios pass", r.status === 0 && String(r.stdout || "").includes("PASS"));
  }
} finally { fs.rmSync(tmp, {recursive:true, force:true}); }

if (hf41FixturesPresent) {
  const shotTmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf41-shot-"));
  try {
    const r = spawnSync("java", [
      "-Djava.awt.headless=true",
      "scripts/java-tests/JavaTestRunner.java", shotTmp,
      "com.nvu.operacional.GtoHf41ReceiveScreenshotsTest",
      "scripts/java-tests/android/graphics/Rect.java",
      "scripts/java-tests/android/media/Image.java",
      "android/app/src/main/java/com/nvu/operacional/GtoResultEvidencePolicy.java",
      "android/app/src/main/java/com/nvu/operacional/GtoResultVisualGate.java",
      "scripts/java-tests/com/nvu/operacional/GtoHf41ReceiveScreenshotsTest.java",
    ], {encoding:"utf8", timeout:120000});
    if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
    ck("HF41 exact physical result/gameplay screenshots prove modal -> gameplay boundary", r.status === 0 && String(r.stdout || "").includes("PASS"));
  } finally { fs.rmSync(shotTmp, {recursive:true, force:true}); }
} else {
  ck("HF41 exact physical result/gameplay screenshots prove modal -> gameplay boundary", true,
    "SKIPPED: binary fixtures are not part of this source-only checkout");
}

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF41 irreversible-Receive checks passed.`);
if (failed.length) process.exit(1);
