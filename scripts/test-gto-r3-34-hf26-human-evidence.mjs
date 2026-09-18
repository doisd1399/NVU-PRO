import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const review = read("android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java");
const autoSync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const pkg = JSON.parse(read("package.json"));
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks = [];
function ck(name, ok, detail="") { checks.push({name,ok:!!ok}); console.log(`${ok?"PASS":"FAIL"} ${name}${detail?` — ${detail}`:""}`); }
function java(name, main, sources, args=[]) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"nvu-hf26-"));
  try {
    const r=spawnSync("java",[...args,"scripts/java-tests/JavaTestRunner.java",tmp,main,...sources],{encoding:"utf8"});
    const out=`${r.stderr||""}\n${r.stdout||""}`.trim();
    ck(`${name} compiles`,!out.includes("Java compilation failed"),out);
    ck(`${name} passes`,r.status===0 && String(r.stdout||"").includes("PASS"),out);
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
}

ck("visual-only direct button press is diagnostic, not selection",
  service.includes('"VISUAL_PRESS_IGNORED"') &&
  !/detectDirectButtonPress[\s\S]{0,5000}armSelectionProbe\(/.test(service));
ck("confirmed selection persistence rejects non-human source",
  service.includes('"SELECTION_CONFIRMATION_REJECTED"') &&
  service.includes('!GtoSelectionEvidencePolicy.isHumanBackedSource(safeSource)'));
ck("confirmed identity reads human provenance",
  service.includes('GtoSelectionEvidencePolicy.isHumanBackedSource(') &&
  /hasConfirmedSelectionIdentity\(\)[\s\S]{0,500}selectionIdentitySource/.test(service));
ck("visual freight list remains candidate until semantic certification",
  service.includes('"FREIGHT_LIST_CANDIDATE"') &&
  service.includes('GtoFreightSemanticCertificationPolicy.isCertifiedPage'));
ck("certified freight list requires Aceitar text plus same-row money",
  service.includes('option.acceptTextEvidence') &&
  /semanticFreightAnchorRows[\s\S]{0,1200}!option\.acceptTextEvidence/.test(service));
ck("active-trip visual list is informational only unless replacement is explicit",
  service.includes('"FREIGHT_LIST_INFORMATIONAL_DURING_TRIP"') &&
  /handleActiveTripFreightListEvidence[\s\S]{0,5000}!explicitReplacement[\s\S]{0,3000}FREIGHT_LIST_INFORMATIONAL_DURING_TRIP[\s\S]{0,1000}return false/.test(service) &&
  /promoteReplacementFreightCandidateToWaiting[\s\S]{0,3500}TRIP_IN_PROGRESS[\s\S]{0,1000}!explicitReplacement[\s\S]{0,500}return false/.test(service));
ck("manual review blocked when automatic evidence is too sparse",
  service.includes('GtoFreightReviewEligibilityPolicy.mayAskDriver') &&
  service.includes('"FREIGHT_REVIEW_BLOCKED_LOW_EVIDENCE"'));
ck("review commit requires already confirmed human identity",
  /commitReviewedFreight\(FreightOption selected\)[\s\S]{0,500}!hasConfirmedSelectionIdentity\(\)/.test(service));
ck("durable freight lock rejects non-human selection provenance",
  autoSync.includes('Frete sem evidência humana de seleção; bloqueio durável recusado.') &&
  autoSync.includes('GtoSelectionEvidencePolicy.isHumanBackedSource(selectionEvidenceSource)'));
ck("durable freight restore rejects non-human selection provenance",
  autoSync.includes('Snapshot de frete sem evidência humana de seleção; restauração bloqueada.') &&
  autoSync.includes('GtoSelectionEvidencePolicy.isHumanBackedSource(durableSelectionSource)'));
ck("legacy untrusted pending review is sanitized on startup",
  service.includes('sanitizeLegacyUntrustedPendingSelectionOnStartup()') &&
  service.includes('"LEGACY_UNTRUSTED_SELECTION_DROPPED"'));
ck("physical HF26 negative fixtures packaged",
  [1,2,3,4,5].every(n=>fs.existsSync(`scripts/fixtures/hf26-negative-gameplay-${n}.png`)));
ck("known garbage is rejected from freight text", review.includes('normalized.equals("oi")') && review.includes('normalized.equals("nvu")'));
const versionCode = Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0);
const versionName = (gradle.match(/versionName\s+["']([^"']+)["']/)||[])[1]||"";
const patch = Number((versionName.match(/^1\.0\.(\d+)$/)||[])[1]||0);
ck("HF26+ version identity remains at or above 1.0.78 / 78", versionCode >= 78 && patch >= 78);
ck("workflow remains aligned to current HF26+ identity", workflow.includes(`versionCode ${versionCode}`) && workflow.includes(versionName));
ck("HF26 test is part of release gate", String(pkg.scripts?.["verify:release"]||"").includes("test:gto-r3.34-hf26-human-evidence"));

java("HF26 human evidence policy", "com.nvu.operacional.GtoHf26HumanEvidenceGateTest", [
  "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
  "android/app/src/main/java/com/nvu/operacional/GtoManualRouteSelectionPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightReviewEligibilityPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightSemanticCertificationPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoSelectionEvidencePolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoSelectionIdentityPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoSessionRecoveryPolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf26HumanEvidenceGateTest.java",
]);

java("HF26 physical negative/list fixtures", "com.nvu.operacional.GtoR329StrictFreightScreenTest", [
  "scripts/java-tests/android/graphics/Rect.java",
  "scripts/java-tests/android/media/Image.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoR329StrictFreightScreenTest.java",
], ["-Djava.awt.headless=true"]);

const failed=checks.filter(x=>!x.ok);
console.log(`\n${checks.length-failed.length}/${checks.length} HF26 human-evidence checks passed.`);
if(failed.length) process.exit(1);
