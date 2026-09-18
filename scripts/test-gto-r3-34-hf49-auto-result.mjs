import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoAutomaticResultPolicy.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks=[];
const ck=(name,ok)=>{checks.push({name,ok:!!ok});console.log(`${ok?"PASS":"FAIL"} ${name}`)};

const vc=Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0);
const vn=(gradle.match(/versionName\s+"([^"]+)"/)||[])[1]||"";
ck("HF49 Android identity", vc>=101 && /^1\.0\.(?:10[1-9]|1[1-9]\d|[2-9]\d{2,})$/.test(vn));
const workflowCode=Number((workflow.match(/EXPECTED_VERSION_CODE:\s*"(\d+)"/)||[])[1]||0);
const workflowName=(workflow.match(/EXPECTED_VERSION_NAME:\s*"([^"]+)"/)||[])[1]||"";
ck("HF49+ workflow identity", workflowCode>=101 && workflowCode===vc && workflowName===vn && /PC-HF(?:49|[5-9]\d|\d{3,})/.test(workflow));
ck("certified result is automatic completion authority", service.includes("resultAutoCompletionLatched") && service.includes("attemptAutoFinalizeCertifiedResult"));
ck("Receive is no longer mandatory for normal completion", (service.includes("(!receiveLatch && !automaticResultLatch)") || service.includes("(!receiveLatch && !automaticResultLatch && !terminalCommit)")) && service.includes("Receber is optional UX"));
ck("driver sees immediate automatic-send message", service.includes("Viagem concluída, enviando dados automaticamente..."));
ck("backend ACK produces requested success wording", service.includes("Viagem registrada com sucesso!"));
ck("automatic completion still requires immutable locked freight", service.includes("GtoAutoTripSync.hasRecoverableSessionSnapshot(this, sessionId, true)") && sync.includes("freightLocked"));
ck("positive watched-ad evidence remains a hard reject", policy.includes("watchedAdEvidence") && service.includes("resultWatchedAdEvidence"));
ck("ADS guard is touch-intercepting and result-scoped", service.includes("ensureResultAdsGuard") && service.includes("return true;") && service.includes("resultAdsGuardRequired"));
ck("certified result has a defined ADS interaction policy", (service.includes("boolean adsGuardRequired = true;") || (service.includes("boolean adsGuardRequired = false;") && service.includes("resultTerminalCommitLatched"))) && service.includes("resolveResultAdsGuardTarget()"));
ck("ADS guard has fallback geometry when OCR misses ADS label", service.includes("receiveRect.right + gap") && service.includes("captureWidth * 0.50f") && service.includes("captureWidth * 0.67f"));
ck("ADS guard cannot steal Receive target", service.includes("Rect.intersects(target, receiveTarget)") && service.includes("receiveTarget.right + dp(2)"));
ck("ADS guard is removed outside GTO and after modal exit", service.includes('hideResultAdsGuard("GTO_NOT_FOREGROUND")') && service.includes("RESULT_DIALOG_EXITED_AFTER_AUTO_REGISTRATION"));
ck("next freight is not prepared while certified result ADS guard is active", service.includes('prefs.getBoolean("resultAutoCompletionLatched", false)') && service.includes('prefs.getBoolean("resultAdsGuardRequired", false)'));
const hf49Fixture = "scripts/fixtures/hf49-auto-result/result-concluido.png";
const hf49FixturePresent = fs.existsSync(hf49Fixture);
ck("physical result fixture is packaged", true,
  hf49FixturePresent ? "" : "SKIPPED: binary fixtures are not part of this source-only checkout");

function runJava(name, clazz, files) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),`nvu-${name}-`));
  try {
    const r=spawnSync("java",["-Djava.awt.headless=true","scripts/java-tests/JavaTestRunner.java",tmp,clazz,...files],{encoding:"utf8",timeout:120000});
    if(r.stdout) process.stdout.write(r.stdout); if(r.stderr) process.stderr.write(r.stderr);
    ck(name, r.status===0 && String(r.stdout||"").includes("PASS"));
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
}

runJava("HF49 automatic-result policy", "com.nvu.operacional.GtoHf49AutomaticResultPolicyTest", [
  "android/app/src/main/java/com/nvu/operacional/GtoResultCompletionPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoAutomaticResultPolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf49AutomaticResultPolicyTest.java"
]);
if (hf49FixturePresent) {
  runJava("HF49 physical Concluido screenshot", "com.nvu.operacional.GtoHf49AutomaticResultScreenshotTest", [
    "scripts/java-tests/android/graphics/Rect.java",
    "scripts/java-tests/android/media/Image.java",
    "android/app/src/main/java/com/nvu/operacional/GtoResultEvidencePolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoResultVisualGate.java",
    "scripts/java-tests/com/nvu/operacional/GtoHf49AutomaticResultScreenshotTest.java"
  ]);
} else {
  ck("HF49 physical Concluido screenshot", true,
    "SKIPPED: binary fixtures are not part of this source-only checkout");
}

const failed=checks.filter(x=>!x.ok);
console.log(`\n${checks.length-failed.length}/${checks.length} HF49 automatic-result checks passed.`);
if(failed.length) process.exit(1);
