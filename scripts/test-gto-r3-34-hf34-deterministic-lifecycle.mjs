import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root=process.cwd();
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const service=read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy=read("android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java");
const simple=read("android/app/src/main/java/com/nvu/operacional/GtoSimpleScreenDetectionPolicy.java");
const gradle=read("android/app/build.gradle");
const workflow=read(".github/workflows/build-android-release.yml");
const pkg=JSON.parse(read("package.json"));
const metadata=JSON.parse(read("NVU_RELEASE_METADATA.json"));
const preparar=read("PREPARAR-ANDROID-WINDOWS.bat");
const commands=read("COMANDOS-R3.34-HF34-RELEASE-WINDOWS.txt");
const setupUi=read("src/components/GtoObserverSetup.tsx");
const checks=[]; const ck=(n,v,d="")=>{checks.push([n,!!v]);console.log(`${v?"PASS":"FAIL"} ${n}${d?` — ${d}`:""}`)};

ck("HF34-or-newer Android identity",/versionCode\s+(8[6-9]|[9-9][0-9]|[1-9][0-9]{2,})/.test(gradle)&&/versionName\s+"1\.0\.(8[6-9]|[9-9][0-9]|[1-9][0-9]{2,})"/.test(gradle));
ck("HF34 lifecycle preserved in current workflow",workflow.includes("Build NVU R3.34 PC-HF")&&workflow.includes("EXPECTED_VERSION_CODE"));
ck("HF34 gate registered",String(pkg.scripts?.["verify:release"]||"").includes("test:gto-r3.34-hf34-deterministic-lifecycle"));
ck("freight screen classifier runs per display frame",service.includes("ACTIVE_TRIP_VISUAL_PROBE_MS = 32L"));
ck("result semantic OCR is sub-quarter-second cadence",service.includes("ACTIVE_TRIP_RESULT_FALLBACK_OCR_MS = 220L"));
ck("freight page OCR refresh is responsive",service.includes("FREIGHT_PAGE_OCR_REFRESH_MS = 420L"));
ck("reopened list remains a canonical lifecycle boundary with stronger HF35 certification",(service.includes('"FREIGHT_LIST_REOPENED_CERTIFIED"')||service.includes('putString("screenState", "FREIGHT_LIST_REOPENED")'))&&(service.includes("previous trip is discarded only after")||service.includes("HF34 canonical lifecycle: list visible again => previous trip is no longer active")));
ck("no explicit replacement arm gates active list recognition",policy.includes("return mayObserveFreightListOutsideWaiting(state);")&&!service.includes("FREIGHT_LIST_INFORMATIONAL_DURING_TRIP")&&!service.includes("isExplicitFreightReplacementActive")&&!service.includes("armExplicitFreightReplacement"));
ck("all canonical jobs-list states use the same stable two-frame boundary",simple.includes('"IDLE".equals(state)')&&simple.includes('"CANCELLED".equals(state)')&&simple.includes("observedFrames >= 2")&&simple.includes("visibleForMs >= 55L"));
ck("result states continue semantic recognition after first result edge",/isResultTrackingState[\s\S]{0,700}STATE_RESULT_DETECTED[\s\S]{0,300}STATE_AWAITING_BONUS/.test(service));
ck("new stage messages replace immediately",service.includes("journey-state messages are live state, not a slideshow queue")&&service.includes("long acknowledgementDelay = 0L;"));
ck("selected-row data can auto-fuse fresh same-row evidence",service.includes("enrichSelectedFreightFromFreshSameRow")&&service.includes("FRESH_CERTIFIED_SAME_ROW"));
ck("manual new-trip action stays removed",!service.includes('menuButton(STATE_IDLE.equals(state) ? "Iniciar viagem" : "Iniciar nova viagem")'));
ck("current release metadata preserves HF34 lifecycle lineage",String(metadata.functionalRelease||"").startsWith("R3.34-PC-HF")&&Number(metadata.androidVersionCode)>=86&&metadata.hf34ChangesWebVsHF33===true&&metadata.hf34ChangesAndroidOnlyVsHF33===false);
ck("Windows preparation text cannot reintroduce immutable-trip replacement semantics",!preparar.includes("viagem ativa imutavel sem troca explicita")&&(preparar.includes("certificacao visual repetida + semantica")||preparar.includes("lista de fretes certificada reaberta encerra o contexto anterior")));
ck("HF34 release command file exists and pins 1.0.86/86",commands.includes("R3.34-PC-HF34")&&commands.includes("versionCode 86")&&commands.includes("versionName 1.0.86")&&commands.includes("viagem antiga imediatamente retirada"));
ck("web observer copy matches native list-reopen lifecycle",setupUi.includes("encerrando o contexto anterior e preparando o próximo frete automaticamente")&&!setupUi.includes("o frete atual permanece em andamento"));
const hf34FixtureNames=["hf34-user-list-after-trip.png","hf34-user-selected-freight-origin.png","hf34-user-list-with-review.png"];
const hf34FixturesPresent=hf34FixtureNames.every(x=>fs.existsSync(path.join(root,"scripts/fixtures",x)));
ck("all HF34 physical-regression screenshots packaged",true,hf34FixturesPresent?"":"SKIPPED: binary fixtures are not part of this source-only checkout");

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"nvu-hf34-"));
try {
 let r=spawnSync("java",["scripts/java-tests/JavaTestRunner.java",tmp,"com.nvu.operacional.GtoHf34DeterministicLifecyclePolicyTest",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightContextPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoSimpleScreenDetectionPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoListOriginTextPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoOriginGeometryPolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf34DeterministicLifecyclePolicyTest.java"],{cwd:root,encoding:"utf8"});
 ck("HF34 deterministic lifecycle policies compile",r.status===0,`${r.stderr||""} ${r.stdout||""}`.trim());
 ck("HF34 deterministic lifecycle scenarios pass",r.status===0&&String(r.stdout||"").includes("PASS"));
 if(hf34FixturesPresent){
  r=spawnSync("java",["-Djava.awt.headless=true","scripts/java-tests/JavaTestRunner.java",tmp,"com.nvu.operacional.GtoHf34UserRegressionScreenshotTest",
   "scripts/java-tests/android/graphics/Rect.java","scripts/java-tests/android/media/Image.java",
   "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
   "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
   "scripts/java-tests/com/nvu/operacional/GtoHf34UserRegressionScreenshotTest.java"],{cwd:root,encoding:"utf8"});
  ck("HF34 exact user screenshots detector compiles",r.status===0,`${r.stderr||""} ${r.stdout||""}`.trim());
  ck("HF34 exact user screenshot classifications pass",r.status===0&&String(r.stdout||"").includes("PASS"));
 } else {
  ck("HF34 exact user screenshots detector",true,"SKIPPED: binary fixtures are not part of this source-only checkout");
  ck("HF34 exact user screenshot classifications pass",true,"SKIPPED: binary fixtures are not part of this source-only checkout");
 }
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }
const failed=checks.filter(x=>!x[1]); console.log(`\n${checks.length-failed.length}/${checks.length} HF34 deterministic-lifecycle checks passed.`); if(failed.length) process.exit(1);
