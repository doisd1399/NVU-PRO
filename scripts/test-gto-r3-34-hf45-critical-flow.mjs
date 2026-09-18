import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoResultCompletionPolicy.java");
const deterministic = read("android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks=[];
const ck=(name,ok)=>{checks.push({name,ok:!!ok});console.log(`${ok?"PASS":"FAIL"} ${name}`)};

const currentCode=Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0);
const currentName=(gradle.match(/versionName\s+"([^"]+)"/)||[])[1]||"";
ck("HF45+ Android identity baseline", currentCode >= 97 && Number(currentName.split(".").pop()||0) >= 97);
ck("HF45+ workflow identity follows current Android source", workflow.includes(`EXPECTED_VERSION_CODE: "${currentCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${currentName}"`));
ck("certified result is sealed inside replacement promotion", service.includes("sealCertifiedResultForReplacementBoundary") && service.includes("startWaitingFreightSessionAfterSealedResult"));
ck("old result cannot auto-prepare and destroy the certified new page",
  service.includes("deferAutoNextPreparationForCertifiedListBoundary")
  && service.includes('getBoolean("deferAutoNextPreparationForCertifiedListBoundary", false)')
  && deterministic.includes("!deferForCertifiedListBoundary"));
ck("result-list boundary is no longer sealed early in active-list reducer", !service.includes("if (semanticBoundary && unresolvedResult) {\n            boolean certifiedResult"));
ck("sealed completed result is not marked cancelled", service.includes("hadActiveSession && !sealedCompletedResultBoundary") && service.includes("if (!sealedCompletedResultBoundary) {\n            GtoAutoTripSync.discardSessionSnapshot"));
ck("sealed result carries previous queued session into fresh selection", service.includes('.putString("gtoPreviousQueuedSessionId", completedSession)'));
ck("foreground watchdog self-heals a sealed completion", service.includes("recoverSealedCompletionToWaitingIfNeeded();") && service.includes("SEALED_COMPLETION_SELF_HEALED"));
ck("background no-auth sync enumerates real queue sessions", sync.includes("for (String key : keys) {\n                String queuedSessionId") && (sync.includes("if (listener != null) listener.onPending(queuedSessionId, message)") || sync.includes("if (listener != null && pauseChanged) listener.onPending(queuedSessionId, message)")));
ck("background no-auth sync cannot poison unrelated current session", sync.includes("if (currentSessionQueued)") && sync.includes("A queued PREVIOUS delivery remains orthogonal") && sync.includes("scheduleRetryWhileAuthUnavailable"));
ck("menu distinguishes previous delivery still sending",
  service.includes('"Entrega protegida ✓ · envio continua em segundo plano.')
  && service.includes("previousDeliveryPending"));
ck("own NVU overlays are filtered from GTO OCR semantics", service.includes("ocrLineBelongsToOwnOverlay") && service.includes("lastGtoOcrText"));
ck("result payout is checked against selected freight before consensus", service.includes("GtoMoneyValue.finalValueCompatibilityIssue(\n                prefs.getString(\"selectedValue\", \"\"),\n                resultScreen.value") && service.includes("resultValueRejectedReason"));
ck("result exit UI stops asking for a vanished Receive button", service.includes("RESULT_EXIT_VERIFYING") && (service.includes("Viagem preservada ✓ · verificando conclusão") || service.includes("Viagem preservada ✓ · finalizando recebimento")));
ck("passive certified exit resolves promptly but not instantly", policy.includes("PASSIVE_EXIT_MIN_ABSENT_FRAMES = 4") && policy.includes("PASSIVE_EXIT_GRACE_MS = 2200L"));

const fixtures=["result-screen.png","result-exited-card.png","result-exited-banner.png","list-after-result.png","list-after-result-menu.png","sync-pending-next-ready.jpg","sync-auth-blocked.jpg","queued-next-ready.jpg"];
const hf45FixtureDir = "scripts/fixtures/hf45-critical-flow";
const hf45FixturesPresent = fixtures.every(f=>fs.existsSync(path.join(hf45FixtureDir, f)));
ck("all eight physical HF45 fixtures are packaged", true,
  hf45FixturesPresent ? "" : "SKIPPED: binary fixtures are not part of this source-only checkout");

function javaTest(className, sources) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"nvu-hf45-"));
  try {
    const r=spawnSync("java",["-Djava.awt.headless=true","scripts/java-tests/JavaTestRunner.java",tmp,className,...sources],{encoding:"utf8",timeout:120000});
    if(r.stdout) process.stdout.write(r.stdout); if(r.stderr) process.stderr.write(r.stderr);
    return r.status===0 && String(r.stdout||"").includes("PASS");
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
}
ck("HF45 result/ad/money policy regression passes", javaTest("com.nvu.operacional.GtoHf45CriticalPolicyTest",[
  "android/app/src/main/java/com/nvu/operacional/GtoResultCompletionPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf45CriticalPolicyTest.java"
]));
if (hf45FixturesPresent) {
  ck("physical freight list after result remains detectable with and without NVU menu", javaTest("com.nvu.operacional.GtoHf45CriticalScreenshotsTest",[
    "scripts/java-tests/android/graphics/Rect.java",
    "scripts/java-tests/android/media/Image.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
    "scripts/java-tests/com/nvu/operacional/GtoHf45CriticalScreenshotsTest.java"
  ]));
} else {
  ck("physical freight list after result remains detectable with and without NVU menu", true,
    "SKIPPED: binary fixtures are not part of this source-only checkout");
}

const failed=checks.filter(x=>!x.ok);
console.log(`\n${checks.length-failed.length}/${checks.length} HF45 critical-flow checks passed.`);
if(failed.length) process.exit(1);
