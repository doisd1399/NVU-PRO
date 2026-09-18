import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const read=(p)=>fs.readFileSync(p,"utf8");
const service=read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const detector=read("android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java");
const listEvidence=read("android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java");
const sync=read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const gradle=read("android/app/build.gradle");
const checks=[];
function check(name,ok,detail=""){checks.push({name,ok:Boolean(ok),detail});console.log(`${ok?"PASS":"FAIL"} ${name}${detail?` — ${detail}`:""}`)}
function runJava(name,mainClass,sources,args=[]){const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"nvu-r332-"));try{const r=spawnSync("java",[...args,"scripts/java-tests/JavaTestRunner.java",tmp,mainClass,...sources],{encoding:"utf8"});const out=`${r.stderr||""}\n${r.stdout||""}`.trim();check(`${name} fixtures compile`,!out.includes("Java compilation failed"),out);check(`${name} scenarios pass`,r.status===0&&String(r.stdout||"").includes("PASS"),out||String(r.error||""));}finally{fs.rmSync(tmp,{recursive:true,force:true});}}
check("R3.32+ Android version",Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0)>=49&&Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/)||[])[1]||0)>=49);
check("freight list requires card body + text + green information as aggregated evidence",detector.includes("cardDarkRatios")&&detector.includes("cardLightTextRatios")&&detector.includes("cardGreenInfoRatios")&&detector.includes("cardEvidence")&&listEvidence.includes("requiredCardRows"));
check("return checks actual MediaProjection resources before requesting consent",service.includes("ensureCaptureContinuityAfterGtoReturn")&&service.includes("RESUMED_AUTOMATICALLY")&&service.includes("REAUTH_REQUIRED_ON_RETURN"));
check("initial delayed consent is not misreported as reauthorization",service.includes("projectionPermissionAfterGtoOpenPending")&&service.includes("normal first-use path"));
check("touch sensor is rearmed immediately after GTO return",/resumeScreenAnalysisInSameState[\s\S]{0,5000}updateFreightTouchPulseSensor\(\)/.test(service));
check("completed payload can release known non-final next trip only after durable queue seal",
  service.includes("private boolean prepareNextFreightFromSealedQueue(String completedSessionId)")
    && service.includes("GtoAutoTripSync.STATUS_SYNCED")
    && service.includes("GtoAutoTripSync.hasPendingSession(this, completedSession)")
    && service.includes("GtoDeterministicFlowPolicy.mayPrepareNextFreightAfterSealedQueue"));
check("old queued ACK still updates operation progress without mutating new trip",sync.includes("sameOperation")&&sync.includes("sealed older delivery may finish syncing")&&sync.includes("gtoBackendJobClosed"));
runJava("R3.32 continuity policy","com.nvu.operacional.GtoR332CardContinuityPolicyTest",[
 "android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java",
 "scripts/java-tests/com/nvu/operacional/GtoR332CardContinuityPolicyTest.java"
]);
if (fs.existsSync("scripts/fixtures/r330-real-list-page2.png")) {
 runJava("R3.32 real freight card signature","com.nvu.operacional.GtoR332FreightCardSignatureTest",[
  "scripts/java-tests/android/graphics/Rect.java","scripts/java-tests/android/media/Image.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
       "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoR332FreightCardSignatureTest.java"
 ],["-Djava.awt.headless=true"]);
} else {
 check("R3.32 real freight card signature fixture", true, "SKIPPED: binary fixture is not part of this source-only checkout");
}
const failed=checks.filter(x=>!x.ok);console.log(`\n${checks.length-failed.length}/${checks.length} R3.32 card/continuity checks passed.`);if(failed.length)process.exit(1);
