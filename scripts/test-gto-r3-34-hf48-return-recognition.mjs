import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks = [];
const ck = (name, ok) => { checks.push({name, ok: !!ok}); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };

const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const version = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
ck("HF48 Android identity", code >= 100 && Number(version.split(".").at(-1) || 0) >= 100);
ck("HF48 workflow identity", workflow.includes(`EXPECTED_VERSION_CODE: "${code}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${version}"`));
ck("foreground return explicitly invalidates pre-switch global OCR", service.includes('abandonGlobalOcrLease("GTO_RETURN_INVALIDATES_PREVIOUS_SCREEN_OCR"'));
ck("global OCR is generation leased", service.includes("activeGlobalOcrLease") && service.includes("globalOcrLeaseGeneration") && service.includes("lease != activeGlobalOcrLease"));
ck("late old OCR callback cannot unlock a newer lease", service.includes("releaseGlobalOcrLease(scheduledGlobalOcrLease)") && service.includes("releaseGlobalOcrLease(pageOcrLease)") && service.includes("releaseGlobalOcrLease(replacementOcrLease)"));
ck("stale OCR lease has bounded self recovery", service.includes("GLOBAL_OCR_LEASE_STALE_MS = 2500L") && service.includes("OCR anterior não respondeu · leitura atual rearmada automaticamente"));
ck("returned WAITING_FREIGHT clears only screen-local semantic evidence", service.includes("freightResumeRecertificationPending = true") && service.includes('.remove("freightSemanticCertifiedGeneration")') && service.includes("fastLastSnapshotFrame = null"));
ck("returned freight list is semantically retried from every live visual frame", service.includes("ensureLiveFreightSemanticCertification(current, now)") && service.includes("LIVE_FREIGHT_SEMANTIC_RETRY_MS = 140L"));
ck("semantic retry remains bound to current immutable page generation", service.includes("scheduleFreightPageOcr(\n            freightPageGeneration, panelSnapshot, panelOffset, buttons, now, true"));
ck("semantic certification still gates list authority", service.includes("if (!isFreightPageSemanticallyCertified(freightPageGeneration)) return;") && service.includes("markFreightPageSemanticallyCertified"));
ck("white health dot cannot remain healthy over a visibly unrecognized freight list", service.includes(") && isFreightSemanticRecognitionHealthy(now);") && service.includes("LIVE_FREIGHT_SEMANTIC_HEALTH_GRACE_MS = 900L"));
ck("app return preserves journey state", service.includes("Returning to GTO is never a journey transition") && service.includes("repairTripStateFromDurableFreightIfNeeded();"));
ck("capture continuity is repaired without ordinary permission loss", service.includes("repairPartialProjectionSurfaceWithoutReauthorization(now)") && service.includes("RESUMED_AUTOMATICALLY"));
ck("fast visual detector remains continuous and OCR-free", service.includes("fastVisualDetector.analyze(") && !read("android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java").includes("TextRecognition"));

const fixture = "scripts/fixtures/hf48-return-recognition/list-after-app-return.png";
const hf48FixturePresent = fs.existsSync(fixture);
ck("exact physical return screenshot is packaged", true,
  hf48FixturePresent ? "" : "SKIPPED: binary fixtures are not part of this source-only checkout");
if (hf48FixturePresent) {
  const digest = crypto.createHash("sha256").update(fs.readFileSync(fixture)).digest("hex");
  ck("exact physical return screenshot hash is fixed", digest === "8db913be1889a873b3805e20f952b8cb2b59865149b1c1c8561d0bd94904683e");
}

if (hf48FixturePresent) {
  const shotTmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf48-shot-"));
  try {
    const r = spawnSync("java", [
      "-Djava.awt.headless=true",
      "scripts/java-tests/JavaTestRunner.java", shotTmp,
      "com.nvu.operacional.GtoHf48ReturnRecognitionScreenshotTest",
      "scripts/java-tests/android/graphics/Rect.java",
      "scripts/java-tests/android/media/Image.java",
      "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
      "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
      "scripts/java-tests/com/nvu/operacional/GtoHf48ReturnRecognitionScreenshotTest.java",
    ], {encoding:"utf8", timeout:120000});
    if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
    ck("exact post-return screenshot is visually detected with all 5 freight rows", r.status === 0 && String(r.stdout || "").includes("visibleFreights=5") && String(r.stdout || "").includes("PASS"));
  } finally { fs.rmSync(shotTmp, {recursive:true, force:true}); }
} else {
  ck("exact post-return screenshot is visually detected with all 5 freight rows", true,
    "SKIPPED: binary fixtures are not part of this source-only checkout");
}

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF48 return-recognition checks passed.`);
if (failed.length) process.exit(1);
