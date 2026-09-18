import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoBubbleDismissPolicy.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const lifecycle = read("scripts/audit-gto-r2-lifecycle.mjs");
const checks = [];
const check = (name, ok) => { checks.push({name, ok: !!ok}); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };

const currentCode = Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0);
const currentPatch = Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/)||[])[1]||0);
check("HF24 baseline identity is preserved or advanced", currentCode >= 76 && currentPatch >= 76);
check("release workflow remains aligned to current Android identity", workflow.includes(`EXPECTED_VERSION_CODE: "${currentCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "1.0.${currentPatch}"`));
check("clean checkout lifecycle audit no longer requires generated Capacitor assets", !lifecycle.includes("readdirSync('android/app/src/main/assets/public/assets')"));
check("certificate parser accepts modern apksigner V3 output", workflow.includes("certificate SHA-256 digest:[[:space:]]"));
check("first drag inside and outside GTO exposes generation-bound remove target", service.includes("GtoBubbleDismissPolicy.shouldShowRemoveTarget(") && service.includes("showBubbleRemoveTarget(bubbleActiveGestureGeneration)") && service.includes("Remover e parar NVU") && service.includes("boolean eligibleOrigin = bubbleDragging"));
check("dropping on remove target stops observer only after fail-safe policy", service.includes("GtoBubbleDismissPolicy.canCommitStop(") && service.includes("stopObserverFromFloatingBubble(releaseGeneration)") && service.includes("ACTION_STOP"));
check("normal drag does not stop observer without a valid drop", service.includes("GtoBubbleDismissPolicy.shouldShowRemoveTarget(")
  && service.includes("GtoBubbleDismissPolicy.canCommitStop(")
  && service.includes("bubbleRemoveTargetHighlighted")
  && service.includes("geometryInside"));
check("long press remains optional and only opens the card", service.includes("bubbleLongPressTriggered = true;")
  && service.includes("openMenu();")
  && service.includes("postDelayed(bubbleLongPressRunnable, 520L)")
  && policy.includes("boolean eligibleOrigin = dragging"));
check("capture loss can auto-request fresh authorization", service.includes("ensureProjectionAuthorizationIfNeeded(now)") && service.includes("AUTO_REAUTH_AFTER_CAPTURE_LOSS"));
check("projection reauthorization separates trusted context from exact GTO package", service.includes("boolean exactGtoPackage = GTO_PACKAGE.equals(foregroundPackage);") && service.includes("trustedGtoContext,\n            exactGtoPackage,"));
check("manual and final projection launchers require exact GTO package", service.includes("boolean exactGto = gtoForeground\n            && GTO_PACKAGE.equals(foregroundPackage);") && service.includes("if (!exactGtoPackage\n"));
const recoveryStart = service.indexOf("private void maybeRecoverProjectionFrameDelivery(long now)");
const recoveryEnd = service.indexOf("private void rebindProjectionSurfaceWithoutReauthorization", recoveryStart);
const recoveryBody = service.slice(recoveryStart, recoveryEnd);
check("repeated frame stalls stay on same grant instead of permission escalation",
  service.includes("PROJECTION_SURFACE_REAUTH_ESCALATION_ATTEMPTS")
    && recoveryBody.includes("RECOVERING_SURFACE_PERSISTENT")
    && recoveryBody.includes("rebindProjectionSurfaceWithoutReauthorization")
    && !recoveryBody.slice(recoveryBody.indexOf("GtoCaptureHealthPolicy.shouldRecoverSurface")).includes("escalateProjectionToFreshAuthorization"));
check("explicit permission denial suppresses prompt loop", service.includes('putBoolean("projectionReauthAutoAllowed", false)'));
check("selected-row OCR remains primary", service.includes("runPreciseSelectedRowOcr(")
  && service.includes("mergeVerifiedPreciseWithStable(")
  && service.includes("frozenSelectedPageBaseline")
  && service.includes("!GtoFreightFieldEvidencePolicy.text("));
check("single frozen same-row evidence may fill a missing field", service.includes("GtoFrozenFreightFallbackPolicy.canUse") && service.includes("FROZEN_TOUCH_BASELINE"));
check("destination company remains optional", service.includes("destinationCompany remains optional metadata and never creates REVIEW_REQUIRED"));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf24-"));
const sources = [
  "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
  "android/app/src/main/java/com/nvu/operacional/GtoManualRouteSelectionPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFrozenFreightFallbackPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoProjectionRecoveryPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoBubbleDismissPolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf24ResilienceProbe.java",
  "scripts/java-tests/com/nvu/operacional/GtoProjectionRecoveryPolicyTest.java",
];
let r = spawnSync("javac", ["-encoding", "UTF-8", "-d", temp, ...sources], {encoding:"utf8"});
if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
check("HF24 pure resilience probe compiles", r.status === 0);
if (r.status === 0) {
  r = spawnSync("java", ["-cp", temp, "com.nvu.operacional.GtoHf24ResilienceProbe"], {encoding:"utf8"});
  if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
  check("five freight fields + projection recovery + unified remove gesture policies pass", r.status === 0);
  r = spawnSync("java", ["-cp", temp, "com.nvu.operacional.GtoProjectionRecoveryPolicyTest"], {encoding:"utf8"});
  if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
  check("projection reauthorization requires exact GTO package", r.status === 0);
}
fs.rmSync(temp, {recursive:true, force:true});

// HF23 is a separate Release prerequisite and is executed once by verify:release.
// HF24 keeps only its own resilience assertions here to avoid nested reexecution.

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF24 resilience checks passed.`);
if (failed.length) process.exit(1);
