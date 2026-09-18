import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
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
ck("HF36 Android baseline identity preserved or advanced", currentCode >= 88 && /^1\.0\.(?:8[8-9]|9\d|\d{3,})$/.test(currentName));
ck("HF36 workflow remains aligned to current Android identity", workflow.includes(`EXPECTED_VERSION_CODE: "${currentCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${currentName}"`));
ck("missing selected-row field triggers automatic focused reread before manual review",
  service.includes("missingOperationalField") && service.includes("lastFreightAutoRecoveryField") && service.includes("scheduleFocusedFreightConflictRetry"));
ck("focused reread runs a second attempt while any required field is still unresolved",
  service.includes("attempt < 2 && (!unresolved.isEmpty()"));
ck("focused retry resolver can fill fields missed by both initial reads",
  !service.includes("target == null || !GtoFreightFieldConflictPolicy.needsRetry(field, exact, frozen)")
  && service.includes("boolean conflictingInitialReads = GtoFreightFieldConflictPolicy.needsRetry(field, exact, frozen)"));
ck("failed reread clears only actual conflicting fields",
  service.includes("if (conflictingInitialReads) clearReviewField(target, field)"));
ck("manual review remains available only after automatic rereads",
  service.indexOf("scheduleFocusedFreightConflictRetry(") < service.indexOf("enterFreightReview(canonicalCandidate, exactRow"));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf36-"));
const sources = [
  "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightTextGuard.java",
  "android/app/src/main/java/com/nvu/operacional/GtoManualRouteSelectionPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoListOriginTextPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightFieldConflictPolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf36CargoRecoveryPolicyTest.java",
];
let r = spawnSync("javac", ["-encoding", "UTF-8", "-d", temp, ...sources], {encoding:"utf8"});
if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
ck("HF36 recovery policies compile", r.status === 0);
if (r.status === 0) {
  r = spawnSync("java", ["-cp", temp, "com.nvu.operacional.GtoHf36CargoRecoveryPolicyTest"], {encoding:"utf8"});
  if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
  ck("HF36 cargo recovery matrix passes", r.status === 0 && String(r.stdout || "").includes("PASS"));
}
fs.rmSync(temp, {recursive:true, force:true});

// HF25 and HF35 are separate Release prerequisites and are executed once by verify:release.
// HF36 keeps only its cargo-recovery assertions and policy probe here.

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF36 cargo auto-recovery checks passed.`);
if (failed.length) process.exit(1);
