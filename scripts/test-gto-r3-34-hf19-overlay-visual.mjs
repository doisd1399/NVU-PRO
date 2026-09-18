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
check("HF19+ identity is at least 1.0.71 / 71", code>=71 && patch>=71);
check("signed APK workflow remains aligned to current Android identity",
  workflow.includes(`EXPECTED_VERSION_CODE: "${code}"`)
    && workflow.includes(`EXPECTED_VERSION_NAME: "1.0.${patch}"`));

const open=method(service,"private void openMenu()","private void populateMenuContents");
const refresh=method(service,"private void refreshMenuContents()","private void showStatusChip");
const layout=method(service,"private void adjustOpenMenuLayoutAfterMeasure()","private boolean shouldMinimizeMenuForConfirmedExternalApp");
const result=method(service,"private void keepOverlaysClearOfResultRegion()","private int dp(int value)");
const chip=method(service,"private void showStatusChip(\n        String text","private void announceDriverStage");
const guide=method(service,"private String currentJourneyGuide","private void cancelScheduledStatusChipHide");
const external=method(service,"private boolean shouldMinimizeMenuForConfirmedExternalApp","private void ensureBubbleBesideOpenMenuIfCovered");

check("card uses scroll container for tall states", open.includes("new ScrollView(this)") && open.includes("menuContentView"));
check("card is measured after opening", open.includes("adjustOpenMenuLayoutAfterMeasure"));
check("card height is bounded to 80 percent of usable area", layout.includes("0.80f") && layout.includes("maxCardHeight"));
check("card vertical position uses measured height and safe bounds", (layout.includes("GtoOverlayLayoutPolicy.clampMenuY") || layout.includes("centeredMenuYBesideBubble")) && policy.includes("clampMenuY"));
check("card keeps compact minimum with responsive width", layout.includes("responsiveMenuWidth(safeLeft, safeRight)") && open.includes("responsiveMenuWidth(safeLeft, safeRight)") && service.includes("private int responsiveMenuWidth") && layout.includes("menuParams.width = menuWidth") && !result.includes("menuParams.width = targetWidth"));
check("result protection moves full card instead of shrinking it", result.includes("leftCandidate") && result.includes("rightCandidate") && !result.includes("minReadableWidth"));
check("fixed child widths removed from card", !service.includes("dp(232)") && !service.includes("dp(202)"));
check("layout refresh remeasures card", refresh.includes("adjustOpenMenuLayoutAfterMeasure"));
check("manual review draft survives redraw/minimize", service.includes("activeReviewInputDraft") && service.includes("input.setText(activeReviewInputDraft)"));
check("focused review field is not destroyed by background refresh", refresh.includes("activeReviewInput.hasFocus()") && refresh.includes("requiredField.equals(activeReviewInputField)"));
check("menu focusability follows review state dynamically", service.includes("updateMenuWindowInteractionMode") && layout.includes("interactionChanged"));
check("IME is included in bottom safe inset", service.includes("WindowInsets.Type.ime()"));
check("driver-stage banner respects top system/cutout inset", chip.includes("safeTopInsetPx() + dp(6)"));
check("driver-stage banner has bounded readable exposure without delaying newer state", service.includes("DRIVER_STAGE_MIN_VISIBLE_MS = 650L") && chip.includes("acknowledgementDelay") && service.includes("journey-state messages are live state, not a slideshow queue"));
check("stage acknowledgement occurs after exposure not immediately", !chip.includes("if (onShown != null) onShown.run()") && chip.includes("mainHandler.postDelayed"));
check("persistent card no longer duplicates journey instructions", guide.includes("return \"\""));
check("same-gesture outside guard is narrow", service.includes("OUTSIDE_SAME_GESTURE_GUARD_MS = 140L") && !service.includes("BUBBLE_TAP_DEBOUNCE_MS + 180L"));
check("real third-party app minimizes card only with confirmed GTO background", external.includes("EXTERNAL_APP_MENU_MINIMIZE_MS") && external.includes("lastGtoBackgroundEventAt >= lastGtoForegroundEventAt"));
check("transient notification branch preserves open card", service.includes("transientForegroundSurfaceActive && gtoForeground") && service.includes("suspendPassiveDetectionOverlaysKeepBubbleAndMenu()"));
check("bubble/card docking remains retained", service.includes("chooseMenuSideForBubble") && service.includes("menuXBesideBubble"));

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"nvu-hf19-"));
try {
  const run=spawnSync("java",[
    "scripts/java-tests/JavaTestRunner.java",tmp,
    "com.nvu.operacional.GtoR334Hf19OverlayVisualPolicyTest",
    "android/app/src/main/java/com/nvu/operacional/GtoOverlayLayoutPolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoR334Hf19OverlayVisualPolicyTest.java"
  ],{encoding:"utf8"});
  const out=`${run.stdout||""}${run.stderr||""}`.trim();
  check("HF19 overlay visual policy compiles", !out.includes("Java compilation failed"), out);
  check("HF19 measured layout scenarios pass", run.status===0 && out.includes("PASS HF19 overlay visual policy"), out);
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }

const failed=checks.filter(x=>!x.ok);
console.log(`\n${checks.length-failed.length}/${checks.length} HF19 checks passed.`);
if(failed.length) process.exit(1);
