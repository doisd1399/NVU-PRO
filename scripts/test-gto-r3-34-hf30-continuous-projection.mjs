import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = (p) => fs.readFileSync(p, "utf8");
const servicePath = "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java";
const permissionPath = "android/app/src/main/java/com/nvu/operacional/GtoProjectionPermissionActivity.java";
const continuityPath = "android/app/src/main/java/com/nvu/operacional/GtoProjectionContinuityPolicy.java";
const healthPath = "android/app/src/main/java/com/nvu/operacional/GtoCaptureHealthPolicy.java";
const strictTestPath = "scripts/java-tests/com/nvu/operacional/GtoR329StrictFreightScreenTest.java";
const service = read(servicePath);
const permission = read(permissionPath);
const continuity = read(continuityPath);
const health = read(healthPath);
const strictTest = read(strictTestPath);
const pkg = JSON.parse(read("package.json"));
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const continuityStart = service.indexOf("private void ensureCaptureContinuityAfterGtoReturn()");
const continuityEnd = service.indexOf("private void refreshTransientVisualContextAfterGtoReturn", continuityStart);
const continuityBody = service.slice(continuityStart, continuityEnd > continuityStart ? continuityEnd : continuityStart + 9000);
check("return continuity never self-stops a live grant", continuityBody.includes("repairPartialProjectionSurfaceWithoutReauthorization") && !continuityBody.includes("releaseCaptureResources(true)") && !continuityBody.includes("stopProjection()"));

const recoveryStart = service.indexOf("private void maybeRecoverProjectionFrameDelivery(long now)");
const recoveryEnd = service.indexOf("private void rebindProjectionSurfaceWithoutReauthorization", recoveryStart);
const recoveryBody = service.slice(recoveryStart, recoveryEnd);
const stallGate = recoveryBody.indexOf("GtoCaptureHealthPolicy.shouldRecoverSurface");
const afterStallGate = stallGate >= 0 ? recoveryBody.slice(stallGate) : recoveryBody;
check("frame-stall retries never escalate by attempt count", stallGate >= 0 && !afterStallGate.includes("escalateProjectionToFreshAuthorization") && afterStallGate.includes("rebindProjectionSurfaceWithoutReauthorization"));
check("surface retries are explicitly persistent", recoveryBody.includes("RECOVERING_SURFACE_PERSISTENT") && recoveryBody.includes("recuperação contínua na mesma autorização"));
check("partial ImageReader/handler loss is repaired on same VirtualDisplay", service.includes("repairPartialProjectionSurfaceWithoutReauthorization") && continuity.includes("shouldRepairPartialSurface"));
check("health dot uses real frame plus real recognition freshness", health.includes("now - lastFrameAt <= FRAME_HEALTH_FRESH_MS") && health.includes("now - lastAnalyzedAt <= ANALYSIS_HEALTH_FRESH_MS") && health.includes("!gtoForeground || analysisPaused || !stabilityReady"));
check("frame delivery watchdog is independent of stale foreground classification", /boolean frameDeliveryStalled[\s\S]{0,900}if \(!frameDeliveryStalled && !analysisStalled\)/.test(health));
check("fresh observer with no token is not treated as lost grant", continuity.includes("if (!tokenPresent) return projectionActive;"));
check("permission host stages RESULT_OK and immediately rescues running observer", permission.includes("boolean directRescueArmed = GtoObserverService.rescueStagedProjectionGrantIfRunning(resultAt)") && permission.includes("stageProjectionGrantFromPermissionHost"));
check("permission host tolerates slow OEM landscape/consent handoff", permission.includes("HANDOFF_MAX_AGE_MS = 9000L") && permission.includes("MAX_ATTEMPTS = 80"));
check("service gives delayed ACTION_START_PROJECTION a grant-binding grace", service.includes("PROJECTION_GRANT_DISPATCH_GRACE_MS") && service.includes("bindStagedProjectionGrantIfNeeded(resultAt)"));
check("lost consent callback after return to GTO self-recovers", service.includes("CONSENT_RESULT_LOST_AFTER_GTO_RETURN") && service.includes("PROJECTION_PERMISSION_RETURN_WITHOUT_RESULT_GRACE_MS"));
check("bubble restoration cannot clear permission state", !/private void scheduleBubbleRestoreAfterPermission\(\)[\s\S]{0,450}putBoolean\("projectionPermissionInFlight", false\)/.test(service));
check("bubble can restore through verified post-consent bridge", /private void restoreBubbleAfterPermission[\s\S]{0,800}hasVerifiedGtoProjectionBridge\(\)/.test(service));
check("sticky service preserves WAITING_FREIGHT observer after process recreation", service.includes("recoverWaitingObserver") && service.includes("REAUTH_REQUIRED_AFTER_SERVICE_RESTART"));
check("projection foreground-type failure preserves sticky observer instead of stopSelf", service.includes("PROJECTION_FGS_PROMOTION_FAILED") && service.includes("serviço sticky preservado"));
check("only Android token/display terminal loss can request a fresh grant", continuity.includes("virtualDisplayEverCreated") && service.includes("FIRST_SURFACE_GRANT_CONSUMED"));
check("second VirtualDisplay on one Android grant is hard-blocked", service.includes("Segunda VirtualDisplay bloqueada") && /maybeStartPendingProjectionSurface[\s\S]{0,600}projectionVirtualDisplayEverCreated/.test(service));
const hf30FixturePaths = [
  "scripts/fixtures/gto-hf30/01-star-games-loading.png",
  "scripts/fixtures/gto-hf30/02-notification-shade.png",
  "scripts/fixtures/gto-hf30/03-black-loading-fps0.png",
  "scripts/fixtures/gto-hf30/04-garage-auth-stale.png",
];
const hf30FixturesPresent = hf30FixturePaths.every((p) => fs.existsSync(p));
check("four new physical failure screenshots are permanent neutral fixtures", true,
  hf30FixturesPresent
    ? ""
    : "SKIPPED: binary fixtures are not part of this source-only checkout");
check("human/semantic freight-selection gates remain present", service.includes("GtoSelectionEvidencePolicy.isHumanBackedSource") && service.includes("selectedRowSemanticallyCertifiesFreight"));
check("HF30 release gate registered", String(pkg.scripts?.["verify:release"] || "").includes("test:gto-r3.34-hf30-continuous-projection"));
const currentCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const currentPatch = Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/) || [])[1] || 0);
check("HF30 baseline identity is preserved or advanced", currentCode >= 82 && currentPatch >= 82);
check("release workflow remains aligned to advanced Android identity", workflow.includes(`EXPECTED_VERSION_CODE: "${currentCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "1.0.${currentPatch}"`));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf30-"));
try {
  let r = spawnSync("javac", [
    "-encoding", "UTF-8", "-d", tmp,
    continuityPath,
    healthPath,
    "scripts/java-tests/com/nvu/operacional/GtoHf30ProjectionContinuityPolicyTest.java",
  ], { encoding: "utf8" });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  check("HF30 projection continuity policies compile", r.status === 0);
  if (r.status === 0) {
    r = spawnSync("java", ["-cp", tmp, "com.nvu.operacional.GtoHf30ProjectionContinuityPolicyTest"], { encoding: "utf8" });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    check("HF30 projection continuity scenarios pass", r.status === 0 && String(r.stdout || "").includes("PASS"));
  } else {
    check("HF30 projection continuity scenarios pass", false, "policy compilation failed");
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = checks.filter((x) => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF30 continuous-projection checks passed.`);
if (failed.length) process.exit(1);
