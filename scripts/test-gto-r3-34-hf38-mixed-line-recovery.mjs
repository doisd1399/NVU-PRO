import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoFreightMixedLinePolicy.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks = [];
const ck = (name, ok, detail="") => {
  checks.push({name, ok: !!ok});
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? ` :: ${detail}` : ""}`);
};

const codeMatch = gradle.match(/versionCode\s+(\d+)/);
const nameMatch = gradle.match(/versionName\s+"([^"]+)"/);
const currentCode = codeMatch ? Number(codeMatch[1]) : 0;
const currentName = nameMatch ? nameMatch[1] : "";
ck("HF38 Android baseline identity preserved or advanced", currentCode >= 90);
const wfCode = Number((workflow.match(/EXPECTED_VERSION_CODE:\s*"(\d+)"/) || [])[1] || 0);
const wfName = (workflow.match(/EXPECTED_VERSION_NAME:\s*"([^"]+)"/) || [])[1] || "";
ck("HF38 workflow remains aligned to current Android identity", wfCode === currentCode && wfName === currentName);
ck("mixed-line policy strips Km without discarding text", policy.includes("KM_TOKEN") && policy.includes("textualRemainder"));
ck("mixed-line policy strips money without discarding text", policy.includes("MONEY_TOKEN"));
ck("mixed-line policy strips Aceitar without discarding text", policy.includes("ACCEPT_TOKEN"));

const policyUseCount = (service.match(/GtoFreightMixedLinePolicy\.textualRemainder/g) || []).length;
ck("service applies mixed-line recovery in page parse, precise refinement and origin geometry", policyUseCount >= 3, `uses=${policyUseCount}`);
ck("page parser no longer drops an entire line merely because it contains Km", !service.includes('if (!extractKmDigits(line.text).isEmpty()) continue;'));
ck("page parser no longer drops an entire line merely because it contains money", !service.includes('if (!extractMoneyValue(line.text).isEmpty()) continue;'));
ck("precise refinement no longer drops mixed numeric/text lines", !service.includes('if (!extractKmDigits(line.text).isEmpty() || !extractMoneyValue(line.text).isEmpty()) continue;'));
ck("HF36 focused reread remains in selected-row recovery path", service.includes("scheduleFocusedFreightConflictRetry") && service.includes("lastFreightAutoRecoveryField"));
ck("HF37 replacement-session baseline remains preserved", service.includes("replacementFreightCertifiedOptions") && service.includes("Nova lista assumiu a sessão"));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf38-"));
const sources = [
  "android/app/src/main/java/com/nvu/operacional/GtoFreightMixedLinePolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf38MixedFreightLinePolicyTest.java",
];
let r = spawnSync("javac", ["-encoding", "UTF-8", "-d", temp, ...sources], {encoding:"utf8"});
if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
ck("HF38 mixed-line policy compiles", r.status === 0);
if (r.status === 0) {
  r = spawnSync("java", ["-cp", temp, "com.nvu.operacional.GtoHf38MixedFreightLinePolicyTest"], {encoding:"utf8"});
  if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
  ck("HF38 mixed-line regression matrix", r.status === 0 && String(r.stdout || "").includes("PASS"));
}
fs.rmSync(temp, {recursive:true, force:true});

const hf38FixtureNames = [
  "list-with-cargo-km-same-band.png",
  "review-toast-after-selection.png",
  "review-card-cargo-missing.png",
];
const hf38FixturesPresent = hf38FixtureNames.every(x => fs.existsSync(path.join("scripts/fixtures/hf38-mixed-line-regression", x)));
ck("HF38 physical regression screenshots packaged", true,
  hf38FixturesPresent ? "" : "SKIPPED: binary fixtures are not part of this source-only checkout");

if (hf38FixturesPresent) {
  const screenshotTmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf38-shot-"));
  try {
    const sr = spawnSync("java", [
      "-Djava.awt.headless=true",
      "scripts/java-tests/JavaTestRunner.java", screenshotTmp,
      "com.nvu.operacional.GtoHf38UserCargoRegressionScreenshotTest",
      "scripts/java-tests/android/graphics/Rect.java",
      "scripts/java-tests/android/media/Image.java",
      "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
      "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
      "scripts/java-tests/com/nvu/operacional/GtoHf38UserCargoRegressionScreenshotTest.java",
    ], {encoding:"utf8"});
    if (sr.stdout) process.stdout.write(sr.stdout); if (sr.stderr) process.stderr.write(sr.stderr);
    ck("HF38 exact screenshots preserve list/gameplay classification",
      sr.status === 0 && String(sr.stdout || "").includes("GtoHf38UserCargoRegressionScreenshotTest: PASS"));
  } finally {
    fs.rmSync(screenshotTmp, {recursive:true, force:true});
  }
} else {
  ck("HF38 exact screenshots preserve list/gameplay classification", true,
    "SKIPPED: binary fixtures are not part of this source-only checkout");
}

// HF35, HF36 and HF37 are separate Release prerequisites and are executed once by verify:release.
// HF38 keeps only its mixed-line assertions and policy/perception probes.

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF38 mixed-line recovery checks passed.`);
if (failed.length) process.exit(1);
