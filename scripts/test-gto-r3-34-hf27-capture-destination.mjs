import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const city = read("android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java");
const mainActivity = read("android/app/src/main/java/com/nvu/operacional/MainActivity.java");
const pkg = JSON.parse(read("package.json"));
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks = [];
function ck(name, ok, detail="") { checks.push({name,ok:!!ok}); console.log(`${ok?"PASS":"FAIL"} ${name}${detail?` — ${detail}`:""}`); }
function java(name, main, sources) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"nvu-hf27-"));
  try {
    const r=spawnSync("java",["scripts/java-tests/JavaTestRunner.java",tmp,main,...sources],{encoding:"utf8"});
    const out=`${r.stderr||""}\n${r.stdout||""}`.trim();
    ck(`${name} compiles`,!out.includes("Java compilation failed"),out);
    ck(`${name} passes`,r.status===0 && String(r.stdout||"").includes("PASS"),out);
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
}

ck("post-consent verified GTO bridge is sticky", service.includes("projectionVerifiedGtoBridgeActive = true"));
ck("foreground poll accepts verified projection bridge", service.includes("verifiedProjectionBridgeAllowed") && service.includes("visualBridgeAllowed || verifiedProjectionBridgeAllowed"));
ck("transient foreground stale recovery accepts verified bridge", service.includes("packageMatchesGto || visualBridgeAllowed || verifiedProjectionBridgeAllowed"));
ck("real NVU MainActivity disables the permission-return bridge",
  mainActivity.includes("reportMainActivityForeground(true)") && mainActivity.includes("reportMainActivityForeground(false)"));
ck("automatic reauthorization accepts verified GTO bridge", service.includes("hasTrustedGtoContextForProjectionRecovery(now)") && service.includes("hasVerifiedGtoProjectionBridge()"));
ck("permission launch hard gate rejects verified bridge without exact GTO package", /launchProjectionPermissionActivityOnlyWhenGtoLandscape[\s\S]{0,700}boolean exactGtoPackage = GTO_PACKAGE\.equals\(foregroundPackage\)/.test(service) && !/launchProjectionPermissionActivityOnlyWhenGtoLandscape[\s\S]{0,700}hasTrustedGtoContextForProjectionRecovery\(now\)/.test(service));
ck("pending surface startup accepts verified GTO bridge", /maybeStartPendingProjectionSurface[\s\S]{0,1200}trustedGtoContext/.test(service));
ck("terminal projection loss still has a fresh-authorization path", service.includes("escalateProjectionToFreshAuthorization") && service.includes("GtoProjectionContinuityPolicy.needsFreshGrant"));
ck("Itopetuna-like known typo triggers verification instead of silent acceptance", city.includes("uniquePreferredNearCandidate") && service.includes("destinationNeedsKnownVerification"));
ck("known destination canonical spelling requires independent selected-row evidence", service.includes("applyKnownDestinationVerificationAfterRetry") && (service.includes("FOCUSED_SELECTED_ROW_CANONICAL_MATCH") || service.includes("GtoKnownDestinationPolicy.resolveRetry")));
ck("failed canonical verification clears only destination for review", /applyKnownDestinationVerificationAfterRetry[\s\S]{0,1800}clearReviewField\(resolved, GtoFreightReviewPolicy\.DESTINATION\)/.test(service));
const currentCode = Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0);
ck("HF27+ version identity remains at or above 1.0.79 / 79", currentCode >= 79);
ck("current workflow remains a post-HF27 release workflow",   /HF(?:2[7-9]|[3-9]\d|1[0-9]{2})/.test(workflow) && workflow.includes("EXPECTED_VERSION_CODE"));

ck("HF27 test is part of release gate", String(pkg.scripts?.["verify:release"]||"").includes("test:gto-r3.34-hf27-capture-destination"));

java("HF27 capture/destination policy", "com.nvu.operacional.GtoHf27CaptureDestinationTest", [
  "android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java",
  "android/app/src/main/java/com/nvu/operacional/GtoProjectionForegroundBridgePolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf27CaptureDestinationTest.java",
]);

const failed=checks.filter(x=>!x.ok);
console.log(`\n${checks.length-failed.length}/${checks.length} HF27 capture/destination checks passed.`);
if(failed.length) process.exit(1);
