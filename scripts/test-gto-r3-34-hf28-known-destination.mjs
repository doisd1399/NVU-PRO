import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const read = (p) => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const mainActivity = read("android/app/src/main/java/com/nvu/operacional/MainActivity.java");
const city = read("android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoKnownDestinationPolicy.java");
const dashboard = read("src/pages/driver/Dashboard.tsx");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const pkg = JSON.parse(read("package.json"));

const checks=[];
const ck=(name,ok)=>{checks.push({name,ok}); console.log(`${ok?"PASS":"FAIL"} ${name}`)};
ck("official destination canonicalizer exists", city.includes("uniqueOfficialCanonicalCandidate"));
ck("selected-row policy requires unique official destination", policy.includes("resolveSelectedRow") && policy.includes("PRECISE_SELECTED_ROW_OFFICIAL_UNIQUE"));
ck("service canonicalizes only after selected-row flow", service.includes("canonicalizeOfficialSelectedDestination(selected, stableSamePage)"));
ck("dynamic trusted contract destinations remain available", dashboard.includes("trustedGtoCitiesJson") && dashboard.includes("contract?.deliveries?.forEach"));
ck("Itapetuna remains approved canonical spelling", city.includes('"Itapetuna"') && dashboard.includes('"Itapetuna"'));
ck("unknown/ambiguous values are not force-corrected", policy.includes("return Resolution.none()") && city.includes('return ""'));
const currentCode = Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0);
ck("HF28+ Android identity", currentCode >= 80);
ck("HF28+ workflow identity",   /HF(?:2[8-9]|[3-9]\d|1[0-9]{2})/.test(workflow) && workflow.includes("EXPECTED_VERSION_CODE") && workflow.includes("EXPECTED_VERSION_NAME"));

const releaseScript = String(pkg.scripts?.["verify:release"] || "");
const pauseScript = String(pkg.scripts?.["verify:pause-detection"] || "");
ck("HF28 release gate", releaseScript.includes("verify:pause-detection")
  && pauseScript.includes("test-gto-r3-34-hf28-known-destination.mjs"));
ck("HF28 direct javac is pinned to UTF-8", read("scripts/test-gto-r3-34-hf28-known-destination.mjs").includes('"-encoding","UTF-8"'));
ck("MainActivity lifecycle overrides are public for Capacitor 8", /public\s+void\s+onResume\s*\(\s*\)/.test(mainActivity) && /public\s+void\s+onPause\s*\(\s*\)/.test(mainActivity));

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"nvu-hf28-"));
const sources=[
  "android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java",
  "android/app/src/main/java/com/nvu/operacional/GtoKnownDestinationPolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf28KnownDestinationPolicyTest.java",
];
let r=spawnSync("javac",["-encoding","UTF-8","-d",tmp,...sources],{encoding:"utf8"});
if(r.status!==0){console.error(r.stdout,r.stderr); ck("HF28 Java policy compiles",false)} else {
  ck("HF28 Java policy compiles",true);
  r=spawnSync("java",["-cp",tmp,"com.nvu.operacional.GtoHf28KnownDestinationPolicyTest"],{encoding:"utf8"});
  if(r.stdout) process.stdout.write(r.stdout); if(r.stderr) process.stderr.write(r.stderr);
  ck("HF28 known-destination behavior",r.status===0);
}
fs.rmSync(tmp,{recursive:true,force:true});
const failed=checks.filter(x=>!x.ok);
console.log(`\n${checks.length-failed.length}/${checks.length} HF28 known-destination checks passed.`);
if(failed.length) process.exit(1);
