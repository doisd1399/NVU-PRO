import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoFreightFieldConflictPolicy.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const lifecycle = read("scripts/audit-gto-r2-lifecycle.mjs");
const checks = [];
const check = (name, ok) => { checks.push({name, ok: !!ok}); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };

const code = Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0);
const patch = Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/)||[])[1]||0);
check("HF25+ identity remains at or above 1.0.77 / 77", code >= 77 && patch >= 77);
check("workflow remains aligned to current HF25+ identity", workflow.includes(`EXPECTED_VERSION_CODE: "${code}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "1.0.${patch}"`));
check("clean checkout lifecycle validation does not require generated Capacitor assets", !lifecycle.includes("readdirSync('android/app/src/main/assets/public/assets')"));
check("modern apksigner certificate parser retained", workflow.includes("certificate SHA-256 digest:[[:space:]]"));
check("text conflicts use focused retry instead of immediate driver review", service.includes("scheduleFocusedFreightConflictRetry") && service.includes("runFocusedFreightConflictRetry"));
check("focused retry is attempted at two image scales", service.includes("attempt <= 1 ? 1.18f : 1.42f") && service.includes("attempt < 2"));
check("origin uses same focused conflict policy", service.includes("GtoFreightReviewPolicy.ORIGIN_COMPANY") && service.includes("FOCUSED_RETRY_GEOMETRY"));
check("destination uses same focused conflict policy", service.includes("GtoFreightReviewPolicy.DESTINATION") && policy.includes("FOCUSED_RETRY_CONFIRMED_SELECTED"));
check("distance and money are resolved only by literal/semantic agreement", policy.includes("GtoFreightReviewPolicy.DISTANCE") && policy.includes("GtoFreightReviewPolicy.VALUE"));
check("frozen touch baseline fields become selected-row evidence without vote inflation", service.includes("markFrozenTouchBaselineEvidence") && service.includes("not manufacture an OCR vote"));
check("destinationCompany remains outside required-field conflict flow", !policy.includes("DESTINATION_COMPANY"));
check("no fuzzy destination correction introduced", !policy.includes("GtoCityTextResolver"));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf25-"));
const sources = [
  "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightTextGuard.java",
  "android/app/src/main/java/com/nvu/operacional/GtoManualRouteSelectionPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoListOriginTextPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightFieldConflictPolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf25FocusedRetryProbe.java",
];
let r = spawnSync("javac", ["-encoding", "UTF-8", "-d", temp, ...sources], {encoding:"utf8"});
if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
check("HF25 focused retry policy compiles", r.status === 0);
if (r.status === 0) {
  r = spawnSync("java", ["-cp", temp, "com.nvu.operacional.GtoHf25FocusedRetryProbe"], {encoding:"utf8"});
  if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
  check("cargo/origin/destination/distance/value retry matrix passes", r.status === 0);
}
fs.rmSync(temp, {recursive:true, force:true});

// HF23 and HF24 are separate Release prerequisites and are executed once by verify:release.
// HF25 keeps only its focused-field assertions and policy probe here.

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF25 focused-field checks passed.`);
if (failed.length) process.exit(1);
