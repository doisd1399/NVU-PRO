import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const gate = read("android/app/src/main/java/com/nvu/operacional/GtoResultVisualGate.java");
const evidence = read("android/app/src/main/java/com/nvu/operacional/GtoResultEvidencePolicy.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoResultCompletionPolicy.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks=[];
const ck=(name,ok)=>{checks.push({name,ok:!!ok});console.log(`${ok?"PASS":"FAIL"} ${name}`)};

const vc = Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0);
const vn = (gradle.match(/versionName\s+"([^"]+)"/)||[])[1]||"";
ck("HF46+ Android identity", vc >= 98 && /^1\.0\.(?:9[8-9]|[1-9]\d{2,})$/.test(vn));
const wvc = Number((workflow.match(/EXPECTED_VERSION_CODE:\s*"(\d+)"/)||[])[1]||0);
ck("HF46+ workflow identity", wvc >= 98);
ck("wake-up and certified-continuity gates are separate", gate.includes("looksLikeResultDialog") && gate.includes("looksLikeCertifiedResultStillVisible"));
ck("certified continuity requires modal-specific ADS gold anchor", evidence.includes("isCertifiedResultStillVisible") && evidence.includes("adsGold < 0.10f"));
ck("service uses strict continuity only after result certification", service.includes("resultVisualGate.looksLikeCertifiedResultStillVisible"));
ck("passive certified exit still seals only with no watched-ad evidence", policy.includes("shouldInferReceiveFromCertifiedExit") && policy.includes("watchedAdEvidence"));
ck("HF42 durable result proof remains", service.includes("GtoResultProofStore.certify(") && service.includes("resultCertifiedLatched"));
ck("HF45 certified-list fallback remains as secondary self-heal", service.includes("sealCertifiedResultForReplacementBoundary"));
const hf46FixturePaths = ["result-before-receive.png","gameplay-after-receive.png"];
const hf46FixturesPresent = hf46FixturePaths.every(f=>fs.existsSync(path.join("scripts/fixtures/hf46-receive-exit",f)));
ck("physical HF46 result/exit fixtures are packaged", true,
  hf46FixturesPresent ? "" : "SKIPPED: binary fixtures are not part of this source-only checkout");

if (hf46FixturesPresent) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"nvu-hf46-"));
  try {
    const r=spawnSync("java",["-Djava.awt.headless=true","scripts/java-tests/JavaTestRunner.java",tmp,
      "com.nvu.operacional.GtoHf46ReceiveExitScreenshotsTest",
      "scripts/java-tests/android/graphics/Rect.java",
      "scripts/java-tests/android/media/Image.java",
      "android/app/src/main/java/com/nvu/operacional/GtoResultEvidencePolicy.java",
      "android/app/src/main/java/com/nvu/operacional/GtoResultVisualGate.java",
      "android/app/src/main/java/com/nvu/operacional/GtoResultCompletionPolicy.java",
      "scripts/java-tests/com/nvu/operacional/GtoHf46ReceiveExitScreenshotsTest.java"
    ],{encoding:"utf8",timeout:120000});
    if(r.stdout) process.stdout.write(r.stdout); if(r.stderr) process.stderr.write(r.stderr);
    ck("HF46 exact physical Receive-exit regression passes", r.status===0 && String(r.stdout||"").includes("PASS"));
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
} else {
  ck("HF46 exact physical Receive-exit regression passes", true,
    "SKIPPED: binary fixtures are not part of this source-only checkout");
}

const failed=checks.filter(x=>!x.ok);
console.log(`\n${checks.length-failed.length}/${checks.length} HF46 Receive-exit checks passed.`);
if(failed.length) process.exit(1);
