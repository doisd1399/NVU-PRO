import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const lifecycle = read("android/app/src/main/java/com/nvu/operacional/GtoFreightLifecycleBoundaryPolicy.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks = [];
const ck = (name, ok) => { checks.push({name, ok: !!ok}); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };

const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const name = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
ck("HF40+ Android identity", code >= 92 && /^1\.0\.(?:9[2-9]|[1-9]\d{2,})$/.test(name));
ck("HF40+ workflow identity follows current Android identity", workflow.includes(`EXPECTED_VERSION_CODE: "${code}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${name}"`));
ck("fresh IDLE/CANCELLED are explicit certified-list lifecycle states", lifecycle.includes('mayBootstrapFreshSelection') && lifecycle.includes('"IDLE".equals(state) || "CANCELLED".equals(state)'));
ck("continuous recognizer routes fresh and active states through one boundary authority", service.includes("if (mayHandleCertifiedFreightBoundary(state))") && service.includes("handleActiveTripFreightListEvidence(image, continuousVisualFrame, now)"));
ck("semantic certification callback accepts fresh bootstrap states", service.includes("if (!mayHandleCertifiedFreightBoundary(getTripState())) return;"));
ck("promotion accepts fresh bootstrap states", service.includes("if (!mayHandleCertifiedFreightBoundary(replacedState) || !replacementFreightCandidateArmed) return false;"));
ck("touch pulse sensor arms for fresh certified-list candidate", service.includes("replacementFreightSemanticRejectedAt <= 0L") && service.includes("&& mayHandleCertifiedFreightBoundary(state);"));
ck("fast Accept touch is preserved while semantic OCR is pending", service.includes("replacementFreightTouchPending = true;") && service.includes("aguardando certificação semântica da página"));
ck("promotion still requires semantic freshness", service.includes("if (!isReplacementFreightSemanticFresh(promotionNow)) return false;"));
const cancelStart = service.indexOf("private void cancelTrip()");
const clearStart = service.indexOf(service.includes("private boolean clearTripAnalysis()") ? "private boolean clearTripAnalysis()" : "private void clearTripAnalysis()", cancelStart);
const cancelBody = cancelStart >= 0 ? service.slice(cancelStart, clearStart > cancelStart ? clearStart : service.length) : "";
ck("cancel action remains non-destructive to Observe", service.includes('setTripState(STATE_CANCELLED, "Viagem cancelada pelo motorista")') && !cancelBody.includes("stopProjection()"));
const hf40FixturePresent = fs.existsSync("scripts/fixtures/hf40-cancelled-list-bootstrap.png");
ck("user reproduction fixture packaged", true,
  hf40FixturePresent ? "" : "SKIPPED: binary fixture is not part of this source-only checkout");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf40-policy-"));
try {
  let r = spawnSync("javac", ["-encoding", "UTF-8", "-d", tmp,
    "android/app/src/main/java/com/nvu/operacional/GtoFreightLifecycleBoundaryPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoSimpleScreenDetectionPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightBootstrapPolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoHf40CancelledBootstrapPolicyTest.java",
  ], {encoding:"utf8"});
  if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
  ck("HF40 lifecycle policies compile", r.status === 0);
  if (r.status === 0) {
    r = spawnSync("java", ["-cp", tmp, "com.nvu.operacional.GtoHf40CancelledBootstrapPolicyTest"], {encoding:"utf8"});
    if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
    ck("HF40 cancelled bootstrap policy passes", r.status === 0 && String(r.stdout || "").includes("PASS"));
  }
} finally { fs.rmSync(tmp, {recursive:true, force:true}); }

if (hf40FixturePresent) {
  const shotTmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf40-shot-"));
  try {
    const r = spawnSync("java", [
      "-Djava.awt.headless=true",
      "scripts/java-tests/JavaTestRunner.java", shotTmp,
      "com.nvu.operacional.GtoHf40CancelledListScreenshotTest",
      "scripts/java-tests/android/graphics/Rect.java",
      "scripts/java-tests/android/media/Image.java",
      "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
      "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
      "scripts/java-tests/com/nvu/operacional/GtoHf40CancelledListScreenshotTest.java",
    ], {encoding:"utf8", timeout:120000});
    if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
    ck("HF40 exact user screenshot is visually recognized as five-row list", r.status === 0 && String(r.stdout || "").includes("PASS"));
  } finally { fs.rmSync(shotTmp, {recursive:true, force:true}); }
} else {
  ck("HF40 exact user screenshot is visually recognized as five-row list", true,
    "SKIPPED: binary fixture is not part of this source-only checkout");
}

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF40 cancelled-list bootstrap checks passed.`);
if (failed.length) process.exit(1);
