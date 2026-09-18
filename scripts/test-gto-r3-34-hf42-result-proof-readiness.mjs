import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const plugin = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const resultPolicy = read("android/app/src/main/java/com/nvu/operacional/GtoResultCompletionPolicy.java");
const readinessPolicy = read("android/app/src/main/java/com/nvu/operacional/GtoObserverOperationalPolicy.java");
const proofStore = read("android/app/src/main/java/com/nvu/operacional/GtoResultProofStore.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks = [];
const ck = (name, ok) => { checks.push({name, ok: !!ok}); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };

const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const version = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
ck("HF42+ Android identity", code >= 94 && Number((version.match(/^1\.0\.(\d+)$/) || [])[1] || 0) >= 94);
ck("HF42+ workflow identity", workflow.includes(`EXPECTED_VERSION_CODE: "${code}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${version}"`));
ck("certified result is written to a separate crash-safe escrow", service.includes("GtoResultProofStore.certify(") && proofStore.includes('nvu_gto_result_proof_v1'));
ck("proof escrow is written before fast Receive branch can return", service.indexOf("GtoResultProofStore.certify(") < service.indexOf("if (receiveAlreadyLatched)"));
ck("process restart restores protected certified result before state recovery", service.includes("GtoResultProofStore.protectedSessionId(this)") && service.includes("GtoResultProofStore.restoreToRuntime"));
ck("runtime certified proof is promoted back to escrow before startup cleanup", service.includes("runtimeCertifiedSession") && service.includes("!GtoResultProofStore.hasCertified(this, runtimeCertifiedSession)") && service.indexOf("runtimeCertifiedSession") < service.indexOf("String protectedResultSession"));
ck("failed proof-store write retries automatically without requiring the result screen again", service.includes("scheduleCertifiedResultProofEscrowRetry(") && service.includes("resultProofEscrowRetryAttempt"));
ck("certified unresolved result cannot be destructively cleared", service.includes("CERTIFIED_RESULT_RESET_BLOCKED") && service.includes("GtoResultProofStore.isProtectedPending"));
ck("manual cancel cannot destroy a certified pending result", service.includes("if (!clearTripAnalysis())") && service.includes("Entrega já comprovada pelo GTO"));
ck("result screenshot survives until sealed queue", service.indexOf("boolean queued = GtoAutoTripSync.enqueueConfirmedTrip") < service.indexOf("deleteResultSnapshot();", service.indexOf("boolean queued = GtoAutoTripSync.enqueueConfirmedTrip")));
ck("proof escrow is cleared only after local completed queue is sealed", service.includes("if (queued) {") && service.includes("GtoResultProofStore.markNormalResolved") && service.includes("GtoResultProofStore.clear"));
ck("generic ad UI is hold evidence, never rejection evidence", resultPolicy.includes("isAdInProgressEvidence") && resultPolicy.includes("This never rejects a trip"));
ck("only positive watched/reward evidence rejects", resultPolicy.includes("isWatchedAdEvidence") && service.includes("resultWatchedAdEvidence"));
ck("exact ADS touch during freight review is hold-only, never rejection", service.includes('putBoolean("pendingAdsActionDuringFreightReview", true)') && !service.slice(service.indexOf("private void latchExactAdsTouch"), service.indexOf("private void queueFreightTouchMarker")).includes('putBoolean("pendingBonusDuringFreightReview", true)'));
ck("post-review ADS action resumes AWAITING_BONUS instead of rejected state", service.includes('if (prefs.getBoolean("pendingAdsActionDuringFreightReview", false))') && service.includes('setTripState(STATE_AWAITING_BONUS, "Opção ADS preservada · aguardando evidência real do anúncio")'));
ck("device/player HUD strings are absent from completion decision", !service.includes('normalized.contains("fps")') && !service.includes('normalized.contains("desligado")') && !service.includes('normalized.contains("km/h")'));
ck("post-result full-frame scan remains available without HUD dependency", service.includes("postResultFullFrame") && service.includes("adInProgressEvidence"));
ck("certified next freight list seals previous delivery before replacement", service.includes("RECEIVE_CERTIFIED_LIST_BOUNDARY") && service.includes("sealCertifiedResultForReplacementBoundary") && service.indexOf("sealCertifiedResultForReplacementBoundary(replacedState, previousSessionId)") < service.indexOf("// Detach the candidate resources only after a protected result has been sealed."));
ck("observer READY requires overlay + GTO + projection + healthy analyzed frames", readinessPolicy.includes("observeEnabled && bubbleAttached && gtoForeground") && readinessPolicy.includes("projectionActive && projectionBound && captureHealthy"));
ck("startup repairs missing bubble", service.includes("showBubbleIfAllowed();") && readinessPolicy.includes("RECOVERING_BUBBLE"));
ck("startup repairs a lost projection permission bootstrap latch", service.includes("projectionPermissionAfterGtoOpenPending = true") && service.includes("autorização de captura rearmada automaticamente"));
ck("bound but unhealthy capture self-repairs", service.includes("repairPartialProjectionSurfaceWithoutReauthorization(now)") && service.includes("maybeRecoverProjectionFrameDelivery(now)"));
ck("white bubble health dot uses detector transport health with hysteresis",
  service.includes("boolean rawHealthy = isDetectorSessionOperational(now)")
  && service.includes("lastCaptureHealthIndicatorState")
  && service.includes('putString("captureHealth", current)'));
ck("menu never claims automation is active from bubble visibility alone", service.includes("Automação operacional · captura e detector estão recebendo e analisando o GTO em tempo real.") && service.includes("a bolinha sozinha não significa detecção ativa"));
ck("plugin exposes operational truth and certified result proof", plugin.includes('observerOperationalReady') && plugin.includes('observerOperationalStatus') && plugin.includes('resultCertifiedLatched') && plugin.includes('resultWatchedAdEvidence'));
const hf41FixturePaths = [
  "scripts/fixtures/hf41-receive-flow/result-screen-receive.png",
  "scripts/fixtures/hf41-receive-flow/gameplay-after-receive.png",
];
const hf41FixturesPresent = hf41FixturePaths.every(fs.existsSync);
ck("HF41 physical result fixtures remain packaged", true,
  hf41FixturesPresent ? "" : "SKIPPED: binary fixtures are not part of this source-only checkout");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf42-policy-"));
try {
  let r = spawnSync("javac", ["-encoding", "UTF-8", "-d", tmp,
    "android/app/src/main/java/com/nvu/operacional/GtoResultCompletionPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoObserverOperationalPolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoHf42ResultProofPolicyTest.java",
  ], {encoding:"utf8"});
  if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
  ck("HF42 pure policies compile", r.status === 0);
  if (r.status === 0) {
    r = spawnSync("java", ["-cp", tmp, "com.nvu.operacional.GtoHf42ResultProofPolicyTest"], {encoding:"utf8"});
    if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
    ck("HF42 policy scenarios pass", r.status === 0 && String(r.stdout || "").includes("PASS HF42"));
  }
} finally { fs.rmSync(tmp, {recursive:true, force:true}); }

if (hf41FixturesPresent) {
  const shotTmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf42-shot-"));
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
    ck("physical result screenshot remains detected without relying on post-result HUD", r.status === 0 && String(r.stdout || "").includes("PASS"));
  } finally { fs.rmSync(shotTmp, {recursive:true, force:true}); }
} else {
  ck("physical result screenshot remains detected without relying on post-result HUD", true,
    "SKIPPED: binary fixtures are not part of this source-only checkout");
}

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF42 certified-result/readiness checks passed.`);
if (failed.length) process.exit(1);
