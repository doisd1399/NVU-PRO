import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoOverlayLayoutPolicy.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks=[];
const check=(name,ok,detail="")=>{checks.push({name,ok:!!ok}); console.log(`${ok?"PASS":"FAIL"} ${name}${detail?` — ${detail}`:""}`)};
const method=(src,a,b)=>{const i=src.indexOf(a);if(i<0)return"";const j=src.indexOf(b,i+a.length);return src.slice(i,j<0?src.length:j)};

const code=Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0);
const patch=Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/)||[])[1]||0);
check("HF20+ identity remains at or above 1.0.72 / 72", code>=72 && patch>=72);
check("signed APK workflow remains aligned to current Android identity",
  workflow.includes(`EXPECTED_VERSION_CODE: "${code}"`)
    && workflow.includes(`EXPECTED_VERSION_NAME: "1.0.${patch}"`));

const open=method(service,"private void openMenu()","private void populateMenuContents");
const adjust=method(service,"private void adjustOpenMenuLayoutAfterMeasure()","private boolean shouldMinimizeMenuForConfirmedExternalApp");
const close=method(service,"private void closeMenu()","private void suspendPassiveDetectionOverlaysKeepBubbleAndMenu");
const frame=method(service,"private void processImage","private long analysisIntervalForState");
const resultCallback=method(service,"ResultScreen resultScreen =","private void observeGameplayAfterResult");
const freightProtect=method(service,"private void keepOverlaysClearOfFreightPanel","private Rect resultProbeRegionOnScreen");

check("card side is computed from bubble instead of fixed x constants",
  open.includes("chooseMenuSideForBubble")
    && open.includes("menuXBesideBubble")
    && !open.includes("bubbleParams.x - dp(270)")
    && !open.includes("bubbleParams.x + dp(64)"));
check("card is centered vertically around bubble with safe clamps",
  open.includes("centeredMenuYBesideBubble") && adjust.includes("centeredMenuYBesideBubble"));
check("measured layout keeps bubble and card as one docked pair",
  adjust.includes("horizontalPairFits")
    && adjust.includes("bubbleXForMenuSide")
    && adjust.includes("menuXBesideBubble"));
check("automatic docking is not persisted as driver preference",
  adjust.includes("Automatic docking is intentionally NOT persisted")
    && !adjust.includes('putInt("bubbleX"')
    && !adjust.includes('putInt("bubbleY"'));
check("closing card restores pre-open bubble position",
  close.includes("restoreAutoDockedBubble")
    && close.includes("bubbleXBeforeMenuOpen")
    && close.includes("bubbleYBeforeMenuOpen"));
check("dragging bubble closes card without restoring auto dock",
  service.includes("closeMenu(false);")
    && service.includes('putInt("bubbleX", bubbleParams.x).putInt("bubbleY", bubbleParams.y)'));
check("bubble tap debounce is responsive",
  service.includes("BUBBLE_TAP_DEBOUNCE_MS = 180L"));
check("outside touch still minimizes only card",
  open.includes("FLAG_WATCH_OUTSIDE_TOUCH")
    && open.includes("MotionEvent.ACTION_OUTSIDE")
    && open.includes("mainHandler.post(() ->")
    && open.includes("closeMenu();")
    && open.includes("showManualRoutePendingAlert()"));
check("result OCR is not suspended because NVU card overlaps old probe",
  !service.includes("&& !resultProbeOccludedByNvuMenu")
    && service.includes("Card NVU aberto sem suspender leitura do resultado"));
check("result detection no longer repositions card after semantic confirmation",
  !resultCallback.includes("keepOverlaysClearOfResultRegion();"));
check("actionable freight list can minimize card instead of covering Accept",
  freightProtect.includes("menuMinimizedForFreightListAt")
    && freightProtect.includes("closeMenu();"));
check("policy provides deterministic bubble-anchored placement",
  policy.includes("chooseMenuSideForBubble")
    && policy.includes("bubbleXForMenuSide")
    && policy.includes("menuXBesideBubble")
    && policy.includes("centeredMenuYBesideBubble"));

check("bubble itself respects safe top/bottom insets",
  service.includes("int bubbleSafeTop = safeTopInsetPx() + dp(8)")
    && service.includes("int bubbleSafeBottom = safeBottomInsetPx() + dp(8)"));
check("bubble drag remains inside safe insets",
  service.includes("int dragSafeTop = safeTopInsetPx() + dp(8)")
    && service.includes("int dragSafeBottom = safeBottomInsetPx() + dp(8)"));
check("freight protection uses full bubble width including health dot",
  freightProtect.includes("protectedBubbleWidth") && freightProtect.includes("dp(69)"));

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"nvu-hf20-"));
try {
  const run=spawnSync("java",[
    "scripts/java-tests/JavaTestRunner.java",tmp,
    "com.nvu.operacional.GtoR334Hf20OverlayAnchorPolicyTest",
    "android/app/src/main/java/com/nvu/operacional/GtoOverlayLayoutPolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoR334Hf20OverlayAnchorPolicyTest.java"
  ],{encoding:"utf8"});
  const out=`${run.stdout||""}${run.stderr||""}`.trim();
  check("HF20 overlay anchor policy compiles", !out.includes("Java compilation failed"), out);
  check("HF20 overlay anchor scenarios pass", run.status===0 && out.includes("PASS HF20 overlay anchor policy"), out);
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }

const failed=checks.filter(x=>!x.ok);
console.log(`\n${checks.length-failed.length}/${checks.length} HF20 checks passed.`);
if(failed.length) process.exit(1);
