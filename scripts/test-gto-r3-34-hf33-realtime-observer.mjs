import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const pkg = JSON.parse(read("package.json"));
const checks=[];
const ck=(n,v,d="")=>{checks.push({n,v:!!v});console.log(`${v?"PASS":"FAIL"} ${n}${d?` — ${d}`:""}`)};

ck("HF33 Android identity", gradle.includes("versionCode 85") && gradle.includes('versionName "1.0.85"'));
ck("HF33 workflow identity", workflow.includes("HF33") && workflow.includes('EXPECTED_VERSION_CODE: "85"'));
ck("HF33 gate registered", String(pkg.scripts?.["verify:release"]||"").includes("test:gto-r3.34-hf33-realtime-observer"));
const captureMethod=(service.match(/private boolean captureIsNeededForCurrentState\(\) \{[\s\S]*?\n    \}/)||[])[0]||"";
ck("capture ownership is observer-scoped", captureMethod.includes('prefs.getBoolean("enabled", false)') && !captureMethod.includes("STATE_WAITING_FREIGHT") && !captureMethod.includes("STATE_TRIP_IN_PROGRESS"));
ck("IDLE foreground-lag bridge can run detector", service.includes("if (!freshGto && captureIsNeededForCurrentState())"));
ck("strict freight pixels can restore stale foreground in any Observe state", service.includes("boolean waitingForFreight = captureIsNeededForCurrentState();"));
ck("manual new-trip screen removed", !service.includes('menuButton(STATE_IDLE.equals(state) ? "Iniciar viagem" : "Iniciar nova viagem")') && service.includes("Automação ativa · abra uma tela compatível do GTO"));
ck("active trip is immutable against unarmed list", service.includes("FREIGHT_LIST_INFORMATIONAL_DURING_TRIP") && service.includes("Never infer cancellation from a jobs-list return"));
ck("non-explicit promotion is hard-blocked", service.includes("if (!explicitReplacement) {\n                // Never infer cancellation from a jobs-list return"));
ck("selected-row OCR no longer waits behind page OCR", service.includes("if (preciseSelectionOcrBusy || focusedFreightConflictRetryBusy) {") && !service.includes("if (preciseSelectionOcrBusy || focusedFreightConflictRetryBusy || ocrBusy.get())"));
ck("screen classifier cadence is realtime", service.includes("ACTIVE_TRIP_VISUAL_PROBE_MS = 70L"));
ck("semantic result OCR cadence is responsive", service.includes("ACTIVE_TRIP_RESULT_FALLBACK_OCR_MS = 320L"));
ck("freight page semantic refresh is sub-second", service.includes("FREIGHT_PAGE_OCR_REFRESH_MS = 900L"));
ck("origin has automatic retry before manual review", service.includes("ORIGIN_AUTO_RETRY") && service.includes("origin-auto-retry"));
ck("origin can use unanimous same-page context", service.includes("PAGE_UNANIMOUS_ROUTE_CONTEXT") && service.includes("GtoFreightContextPolicy.unanimousOrigin"));
ck("all three rejected-HF32 screenshots packaged", ["hf33-user-page2-auto-list.png","hf33-user-active-trip-review.png","hf33-user-page2-review-overlay.png"].every(x=>fs.existsSync(path.join(root,"scripts/fixtures",x))));

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"nvu-hf33-"));
try {
  let r=spawnSync("java",["scripts/java-tests/JavaTestRunner.java",tmp,"com.nvu.operacional.GtoHf33RealtimeFlowPolicyTest",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightContextPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoListOriginTextPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoOriginGeometryPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoHf33RealtimeFlowPolicyTest.java"],{cwd:root,encoding:"utf8"});
  ck("HF33 pure realtime policies compile",r.status===0,`${r.stderr||""} ${r.stdout||""}`.trim());
  ck("HF33 origin/state policy scenarios pass",r.status===0 && String(r.stdout||"").includes("PASS"));
  r=spawnSync("java",["-Djava.awt.headless=true","scripts/java-tests/JavaTestRunner.java",tmp,"com.nvu.operacional.GtoHf33UserRegressionScreenshotTest",
    "scripts/java-tests/android/graphics/Rect.java","scripts/java-tests/android/media/Image.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
    "scripts/java-tests/com/nvu/operacional/GtoHf33UserRegressionScreenshotTest.java"],{cwd:root,encoding:"utf8"});
  ck("HF33 exact user screenshots detector compiles",r.status===0,`${r.stderr||""} ${r.stdout||""}`.trim());
  ck("HF33 exact user screenshot classifications pass",r.status===0 && String(r.stdout||"").includes("PASS"));
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }

const fail=checks.filter(x=>!x.v); console.log(`\n${checks.length-fail.length}/${checks.length} HF33 realtime-observer checks passed.`); if(fail.length) process.exit(1);
