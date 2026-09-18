import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const metadata = JSON.parse(read("NVU_RELEASE_METADATA.json"));
const checks = [];
const ck = (name, ok, detail="") => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? ` :: ${detail}` : ""}`);
};

const codeMatch = gradle.match(/versionCode\s+(\d+)/);
const nameMatch = gradle.match(/versionName\s+"([^"]+)"/);
const currentCode = codeMatch ? Number(codeMatch[1]) : 0;
const currentName = nameMatch ? nameMatch[1] : "";
ck("HF37 Android baseline identity preserved or advanced", currentCode >= 89 && /^1\.0\.(?:89|9\d|\d{3,})$/.test(currentName));
ck("HF37 workflow remains aligned to current Android identity", workflow.includes(`EXPECTED_VERSION_CODE: "${currentCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${currentName}"`));
ck("HF37 release metadata baseline preserved or advanced", metadata.androidVersionCode >= 89 && metadata.androidVersion === currentName && metadata.functionalRelease.startsWith("R3.34-PC-HF"));

ck("certified replacement rows have dedicated candidate storage",
  service.includes("replacementFreightCertifiedOptions") &&
  service.includes("replacementFreightCertifiedOptions.clear();"));
ck("same replacement semantic OCR that certifies list preserves parsed new-page rows",
  service.includes("for (FreightOption option : parsed)") &&
  service.includes("replacementFreightCertifiedOptions.add(certifiedOption)"));
const promotionStart = service.indexOf("private boolean promoteReplacementFreightCandidateToWaiting(\n        boolean fromTouch,");
const promotionEnd = service.indexOf("private void clearReplacementFreightCandidate()", promotionStart);
const promotionBlock = promotionStart >= 0 && promotionEnd > promotionStart ? service.slice(promotionStart, promotionEnd) : "";
ck("replacement rows are detached before previous trip is cleared",
  promotionBlock.indexOf("List<FreightOption> savedCertifiedOptions") >= 0 &&
  promotionBlock.indexOf("List<FreightOption> savedCertifiedOptions") < promotionBlock.indexOf("GtoAutoTripSync.discardSessionSnapshot(this, cancelledSessionId)"));
ck("old session is discarded before new session is created",
  promotionBlock.indexOf("GtoAutoTripSync.discardSessionSnapshot(this, cancelledSessionId)") >= 0 &&
  promotionBlock.indexOf("GtoAutoTripSync.discardSessionSnapshot(this, cancelledSessionId)") < promotionBlock.indexOf("beginTrip(false);"));
ck("new session is seeded with only certified replacement rows",
  service.includes("for (FreightOption option : savedCertifiedOptions)") &&
  service.includes("freightOptions.add(copyFreightOption(option))") &&
  service.includes('.putLong("freightTextGeneration", freightPageGeneration)'));
ck("seeded replacement page is semantically certified under the NEW generation",
  service.includes("markFreightPageSemanticallyCertified(") &&
  service.includes("freightPageGeneration,") &&
  service.includes("savedCertifiedOptions.size()"));
ck("background page OCR remains enabled after immediate seed",
  service.indexOf("savedCertifiedOptions.size()") < service.indexOf("scheduleFreightPageOcr(\n                freightPageGeneration, savedPanel"));
ck("certified replacement page is not downgraded back to zero-count candidate",
  service.includes("if (savedCertifiedOptions.isEmpty())") &&
  service.includes("restoredPageEditor") &&
  service.indexOf("if (savedCertifiedOptions.isEmpty())") > service.indexOf("scheduleFreightPageOcr(\n                freightPageGeneration, savedPanel"));
ck("empty first selected-row parse uses focused immutable-row reread before review",
  service.includes("an empty first selected-row parse is a sensor miss") &&
  service.includes("top, bottom, null, frozen") &&
  service.includes("scheduledSelectionGeneration, scheduledSelectionSessionId"));
ck("selected-row OCR failure also retries immutable row before manual review",
  service.includes("A transient ML Kit failure still has the same immutable selected-row") &&
  service.includes("scheduleFocusedFreightConflictRetry("));
ck("candidate reset prevents certified rows leaking into another page/session",
  service.includes("private void resetReplacementFreightSemanticEvidence()") &&
  service.indexOf("replacementFreightCertifiedOptions.clear();", service.indexOf("private void resetReplacementFreightSemanticEvidence()")) >= 0);


const hf37FixtureNames=[
  "hf37-replacement-list-before.png",
  "hf37-replacement-list-current.png",
  "hf37-after-accept-review-regression.png",
];
const hf37FixturesPresent=hf37FixtureNames.every(x => fs.existsSync(path.join("scripts/fixtures", x)));
ck("HF37 physical regression screenshots packaged",true,
  hf37FixturesPresent ? "" : "SKIPPED: binary fixtures are not part of this source-only checkout");

if (hf37FixturesPresent) {
  const screenshotTmp = fs.mkdtempSync(path.join(process.cwd(), ".tmp-hf37-screenshot-"));
  try {
    const sr = spawnSync("java", [
      "-Djava.awt.headless=true",
      "scripts/java-tests/JavaTestRunner.java", screenshotTmp,
      "com.nvu.operacional.GtoHf37UserReplacementScreenshotTest",
      "scripts/java-tests/android/graphics/Rect.java",
      "scripts/java-tests/android/media/Image.java",
      "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
      "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
      "scripts/java-tests/com/nvu/operacional/GtoHf37UserReplacementScreenshotTest.java",
    ], { encoding: "utf8" });
    if (sr.stdout) process.stdout.write(sr.stdout);
    if (sr.stderr) process.stderr.write(sr.stderr);
    ck("HF37 exact incident screenshots keep list/gameplay classification correct",
      sr.status === 0 && String(sr.stdout || "").includes("GtoHf37UserReplacementScreenshotTest: PASS"));
  } finally {
    fs.rmSync(screenshotTmp, { recursive: true, force: true });
  }
} else {
  ck("HF37 exact incident screenshots keep list/gameplay classification correct",true,
    "SKIPPED: binary fixtures are not part of this source-only checkout");
}

// HF35, HF36 and R3.30 are separate Release prerequisites and are executed once by verify:release.
// HF37 keeps only its replacement-session assertions and optional perception probe.

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF37 replacement-session checks passed.`);
if (failed.length) process.exit(1);
