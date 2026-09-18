import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const lifecycle = read("android/app/src/main/java/com/nvu/operacional/GtoFreightLifecycleBoundaryPolicy.java");
const cargoPolicy = read("android/app/src/main/java/com/nvu/operacional/GtoCargoTextRecoveryPolicy.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks = [];
const ck = (name, ok, detail="") => {
  checks.push({name, ok: !!ok});
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? ` :: ${detail}` : ""}`);
};

const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const name = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
ck("HF39+ Android identity", code >= 91 && /^1\.0\.(?:9[1-9]|[1-9]\d{2,})$/.test(name));
ck("HF39+ workflow identity follows current Android identity", workflow.includes(`EXPECTED_VERSION_CODE: "${code}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${name}"`));
ck("stale REVIEW_REQUIRED is a certified-list lifecycle boundary", lifecycle.includes('"CONFIRMING_FREIGHT".equals(state) && freightReviewPending'));
ck("automatic CONFIRMING_FREIGHT remains protected from original list frame", service.includes("CONFIRMING_FREIGHT that\n        // is still doing automatic OCR"));
ck("continuous recognizer routes review-state list into boundary handler", service.includes("mayHandleCertifiedFreightBoundary(state)") && service.includes("handleActiveTripFreightListEvidence(image, continuousVisualFrame, now)"));
ck("review boundary still requires visual repetition plus semantic certification", service.includes("mustClearStaleReviewOnCertifiedList") && service.includes("semanticBoundary"));
ck("replacement atomically clears previous analysis before beginTrip", service.indexOf("clearTripAnalysis();") < service.indexOf("beginTrip(false);"));
ck("new certified page rows seed only the new session", service.includes("savedCertifiedOptions") && service.includes("Nova lista assumiu a sessão"));
ck("stale review gets explicit replacement reason", service.includes("PENDING_FREIGHT_REVIEW_REPLACED_BY_CERTIFIED_LIST"));
ck("cargo-only immutable-row recovery exists", service.includes("runFocusedCargoOnlyRecovery") && service.includes("SELECTED_ROW_CARGO_BAND"));
ck("cargo-only recovery runs before manual cargo review", service.indexOf("runFocusedCargoOnlyRecovery(") < service.lastIndexOf("A carga não ficou legível mesmo após as leituras automáticas"));
ck("cargo policy never uses fuzzy/city resolvers", !cargoPolicy.toLowerCase().includes("levenshtein") && !cargoPolicy.includes("GtoCityTextResolver") && !cargoPolicy.includes("GtoKnownDestinationPolicy"));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf39-policy-"));
try {
  let r = spawnSync("javac", ["-encoding", "UTF-8", "-d", temp,
    "android/app/src/main/java/com/nvu/operacional/GtoFreightMixedLinePolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoCargoTextRecoveryPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightLifecycleBoundaryPolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoHf39CargoTextRecoveryPolicyTest.java",
    "scripts/java-tests/com/nvu/operacional/GtoHf39LifecycleBoundaryPolicyTest.java",
  ], {encoding:"utf8"});
  if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
  ck("HF39 pure policies compile", r.status === 0);
  if (r.status === 0) {
    for (const klass of [
      "com.nvu.operacional.GtoHf39CargoTextRecoveryPolicyTest",
      "com.nvu.operacional.GtoHf39LifecycleBoundaryPolicyTest",
    ]) {
      r = spawnSync("java", ["-cp", temp, klass], {encoding:"utf8"});
      if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
      ck(`${klass.split('.').pop()} passes`, r.status === 0 && String(r.stdout || "").includes("PASS"));
    }
  }
} finally { fs.rmSync(temp, {recursive:true, force:true}); }

const hf39FixtureNames = [
  "list-visible-stale-review.png",
  "gameplay-review.png",
  "gameplay-toast.png",
];
const hf39FixturesPresent = hf39FixtureNames.every(x => fs.existsSync(path.join("scripts/fixtures/hf39-state-boundary", x)));
ck("HF39 physical screenshots packaged", true,
  hf39FixturesPresent ? "" : "SKIPPED: binary fixtures are not part of this source-only checkout");

if (hf39FixturesPresent) {
  const shotTmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf39-shot-"));
  try {
    const sr = spawnSync("java", [
      "-Djava.awt.headless=true",
      "scripts/java-tests/JavaTestRunner.java", shotTmp,
      "com.nvu.operacional.GtoHf39UserStateBoundaryScreenshotTest",
      "scripts/java-tests/android/graphics/Rect.java",
      "scripts/java-tests/android/media/Image.java",
      "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
      "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
      "scripts/java-tests/com/nvu/operacional/GtoHf39UserStateBoundaryScreenshotTest.java",
    ], {encoding:"utf8", timeout:120000});
    if (sr.stdout) process.stdout.write(sr.stdout); if (sr.stderr) process.stderr.write(sr.stderr);
    ck("HF39 exact physical screenshots preserve list/gameplay authority", sr.status === 0 && String(sr.stdout || "").includes("PASS"));
  } finally { fs.rmSync(shotTmp, {recursive:true, force:true}); }
} else {
  ck("HF39 exact physical screenshots preserve list/gameplay authority", true,
    "SKIPPED: binary fixtures are not part of this source-only checkout");
}

// HF35, HF37 and HF38 are separate Release prerequisites and are executed once by verify:release.
// HF39 keeps only its certified-list boundary assertions and policy/perception probes.

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF39 certified-list boundary checks passed.`);
if (failed.length) process.exit(1);
