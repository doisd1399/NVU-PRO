import fs from "node:fs";

const read = relative => fs.readFileSync(relative, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const parser = read("android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java");
const dismissPolicy = read("android/app/src/main/java/com/nvu/operacional/GtoBubbleDismissPolicy.java");
const autoSync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const pkg = JSON.parse(read("package.json"));
const checks = [];
const check = (name, ok) => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};
const section = (start, end) => {
  const a = service.indexOf(start);
  const b = service.indexOf(end, Math.max(0, a + start.length));
  return a >= 0 && b > a ? service.slice(a, b) : "";
};

const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
const contents = section("private void populateMenuContents", "private String menuRenderSignature");
const title = section("private String menuTitle()", "private String operationSummaryText");
const button = section("private Button menuButton(String text)", "private android.graphics.drawable.GradientDrawable makeRoundedBackground");
const stop = section("private void stopObserverFromFloatingBubble", "private void recordOverlayFailure");
const workflowAligned = workflow.includes(`EXPECTED_VERSION_CODE: "${versionCode}"`)
  && workflow.includes(`EXPECTED_VERSION_NAME: "${versionName}"`);
const verifyScript = String(pkg.scripts["verify:release"] || "");

check("HF134 Android identity is 1.0.214 or newer", versionCode >= 214 && versionName === `1.0.${versionCode}`);
check("HF134 workflow follows Android identity", workflowAligned);
check("HF134 validator is registered in verify:release", verifyScript.includes("test:gto-r3.34-hf134-floating-panel-removal"));
check("card header uses only the operational company name", title.includes('return company.isEmpty() ? "GTO" : company;') && !title.includes('"NVU · " + company'));
check("brand remains available on the floating pill", service.includes('label.setText("NVU")') && service.includes("makeNvuBubbleBackground(false)"));
check("in-panel removal action is absent by contract", !contents.includes("Remover botão flutuante") && !service.includes("stopObserverFromMenuRemoval"));
check("destructive removal remains available through the drag target", service.includes('target.setText("Remover e parar NVU")') && service.includes('inside ? "Solte para remover" : "Remover e parar NVU"'));
check("no card tap can dispatch the destructive stop", !contents.includes("dispatchObserverStop") && !contents.includes("ACTION_STOP"));
check("gesture removal still uses generation-bound fail-safe policy", service.includes("GtoBubbleDismissPolicy.canCommitStop(") && service.includes("stopObserverFromFloatingBubble(releaseGeneration)"));
check("first drag shows target in either context without immediate stop", dismissPolicy.includes("boolean eligibleOrigin = dragging") && dismissPolicy.includes("return gestureActive && dragging") && service.includes("boolean eligibleOrigin = bubbleDragging") && service.includes("GtoBubbleDismissPolicy.canCommitStop("));
check("long press remains optional for removal and independent for card opening", service.includes("bubbleLongPressTriggered = true;") && service.includes("openMenu();") && service.includes("if (!bubbleDragging && Math.hypot(dx, dy) >= touchSlop)") && service.includes("showBubbleRemoveTarget(bubbleActiveGestureGeneration)"));
check("drag removal uses the single ACTION_STOP dispatcher", stop.includes("dispatchObserverStop(") && stop.includes("Intent stopIntent") && stop.includes("setAction(ACTION_STOP)") && !service.includes("stopObserverFromMenuRemoval"));
check("ACTION_STOP remains the authoritative cleanup reducer", service.includes('if (ACTION_STOP.equals(action))') && service.includes("removeAllOverlays();") && service.includes("stopForeground(STOP_FOREGROUND_REMOVE);"));
check("card actions and operation switch remain compact", contents.includes('menuButton("Cancelar")') && contents.includes('menuButton(operationSummaryExpanded ? "Voltar ao frete atual" : "Operação atual")') && contents.includes("actionRow") && contents.includes("operationSummaryExpanded = !operationSummaryExpanded") && !contents.includes("Remover botão flutuante"));
check("compact card typography is more visible", contents.includes("routeInfo.setTextColor(Color.rgb(242, 245, 248))") && contents.includes("routeInfo.setTextSize(12.1f)") && contents.includes("cargoInfo.setTextSize(12.1f)") && button.includes("button.setTextSize(12.3f)") && button.includes("button.setAlpha(1.0f)"));
check("card reads canonical origin and destination authorities", service.includes("readCanonicalSelectedFreight()") && service.includes("GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(") && service.includes("GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination("));
check("record path preserves the same canonical visible fields", autoSync.includes("acceptedVisibleOrigin(") && autoSync.includes("acceptedVisibleDestination(") && autoSync.includes("acceptedListOrigin") && autoSync.includes("acceptedListDestination"));
check("cargo remains sourced from the canonical selected snapshot", service.includes("canonicalFreight.optString(\"cargo\", \"\")") && autoSync.includes("cargo"));
check("Pause parser remains isolated from card removal and title", !parser.includes("Remover botão flutuante") && !parser.includes("menuTitle") && !parser.includes("dispatchObserverStop"));
check("approved card/Itapetuna gates remain in release gate", verifyScript.includes("test:gto-r3.34-hf132-floating-card") && verifyScript.includes("test:gto-r3.34-hf131-itapetuna-direct-list"));

const failed = checks.filter(item => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF134 floating-panel checks passed.`);
if (failed.length) process.exit(1);

