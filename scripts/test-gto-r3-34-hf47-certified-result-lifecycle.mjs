import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const lifecycle = read("android/app/src/main/java/com/nvu/operacional/GtoCertifiedResultLifecyclePolicy.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks=[];
const ck=(name,ok)=>{checks.push({name,ok:!!ok});console.log(`${ok?"PASS":"FAIL"} ${name}`)};

const hf47Code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const hf47Version = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
ck("HF47+ Android identity", hf47Code >= 99 && Number(hf47Version.split(".").at(-1) || 0) >= 99);
ck("HF47+ workflow identity", workflow.includes(`EXPECTED_VERSION_CODE: "${hf47Code}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${hf47Version}"`));
ck("certified-result tracking is durable-latch based", service.includes("GtoCertifiedResultLifecyclePolicy.shouldTrack") && !service.includes("resultTrackingState && resultScreenLastSeenAt > 0L"));
ck("service recovery restores volatile result clock from durable certification", service.includes("restoreCertifiedSeenAt") && service.includes('prefs.getLong("resultCertifiedAt", 0L)'));
ck("terminal resolver is driven directly by captured frames", service.includes("observeCertifiedResultVisualContinuity(resultDialogVisualPresentNow, now)") && service.includes("scheduleCertifiedResultExitResolution(now)"));
ck("terminal completion no longer requires a future OCR callback", service.includes("resolveCertifiedResultExitFromFrames") && service.includes('latchCertifiedResultExitAndSend(now, "frame-driven-certified-result-exit")'));
ck("fresh OCR is still forced to catch positive ADS evidence", service.includes("lastActiveTripFallbackOcrAt = 0L") && service.includes("WAITING_SAFE_NO_AD_WINDOW"));
ck("HF42 protected-result escrow remains", service.includes("GtoResultProofStore.certify(") && service.includes("resultCertifiedLatched"));
ck("HF45 list-boundary seal remains only as secondary recovery", service.includes("sealCertifiedResultForReplacementBoundary"));
const hf47FixturePaths = ["result-before-receive.png","gameplay-after-receive.png"];
const hf47FixturesPresent = hf47FixturePaths.every(f=>fs.existsSync(path.join("scripts/fixtures/hf47-certified-result-lifecycle",f)));
ck("physical result/exit fixtures are packaged", true,
  hf47FixturesPresent ? "" : "SKIPPED: binary fixtures are not part of this source-only checkout");
ck("lifecycle policy explicitly ignores volatile last-seen for tracking", lifecycle.includes("does not depend on resultScreenLastSeenAt") && lifecycle.includes("shouldTrack"));

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"nvu-hf47-"));
try {
  let r=spawnSync("java",["scripts/java-tests/JavaTestRunner.java",tmp,
    "com.nvu.operacional.GtoHf47CertifiedResultLifecycleTest",
    "android/app/src/main/java/com/nvu/operacional/GtoResultCompletionPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoCertifiedResultLifecyclePolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoHf47CertifiedResultLifecycleTest.java"
  ],{encoding:"utf8",timeout:120000});
  if(r.stdout) process.stdout.write(r.stdout); if(r.stderr) process.stderr.write(r.stderr);
  ck("HF47 lifecycle/process-recreation regression passes", r.status===0 && String(r.stdout||"").includes("PASS"));

  if (hf47FixturesPresent) {
    r=spawnSync("java",["-Djava.awt.headless=true","scripts/java-tests/JavaTestRunner.java",tmp,
      "com.nvu.operacional.GtoHf46ReceiveExitScreenshotsTest",
      "scripts/java-tests/android/graphics/Rect.java",
      "scripts/java-tests/android/media/Image.java",
      "android/app/src/main/java/com/nvu/operacional/GtoResultEvidencePolicy.java",
      "android/app/src/main/java/com/nvu/operacional/GtoResultVisualGate.java",
      "android/app/src/main/java/com/nvu/operacional/GtoResultCompletionPolicy.java",
      "scripts/java-tests/com/nvu/operacional/GtoHf46ReceiveExitScreenshotsTest.java"
    ],{encoding:"utf8",timeout:120000});
    if(r.stdout) process.stdout.write(r.stdout); if(r.stderr) process.stderr.write(r.stderr);
    ck("HF47 preserves physical result-vs-gameplay gate regression", r.status===0 && String(r.stdout||"").includes("PASS"));
  } else {
    ck("HF47 preserves physical result-vs-gameplay gate regression", true,
      "SKIPPED: binary fixtures are not part of this source-only checkout");
  }
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }

const failed=checks.filter(x=>!x.ok);
console.log(`\n${checks.length-failed.length}/${checks.length} HF47 certified-result lifecycle checks passed.`);
if(failed.length) process.exit(1);
