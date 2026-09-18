import fs from "node:fs";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const parser = read("android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java");
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
const open = section("private void openMenu()", "private void populateMenuContents");
const contents = section("private void populateMenuContents", "private String menuRenderSignature");
const button = section("private Button menuButton(String text)", "private android.graphics.drawable.GradientDrawable makeRoundedBackground");
const operation = section("if (operationSummaryExpanded)", "private String menuRenderSignature");
const toggle = section("private void toggleAutomationFromFloatingButton()", "private void openMenu()");
const workflowAligned = workflow.includes(`EXPECTED_VERSION_CODE: "${versionCode}"`)
  && workflow.includes(`EXPECTED_VERSION_NAME: "${versionName}"`);

check("HF132 Android identity is 1.0.213 or newer", versionCode >= 213 && versionName === `1.0.${versionCode}`);
check("HF132 workflow follows Android identity", workflowAligned);
check("HF132 validator is registered in verify:release", String(pkg.scripts["verify:release"] || "").includes("test:gto-r3.34-hf132-floating-card"));
check("card keeps compact minimum with responsive width", open.includes("dp(256)") && open.includes("responsiveMenuWidth(safeLeft, safeRight)") && service.includes("private int responsiveMenuWidth") && open.includes("WindowManager.LayoutParams.WRAP_CONTENT"));
check("card uses compact translucent surface", open.includes("Color.argb(214, 28, 31, 36)") && open.includes("menuView.setPadding(dp(8), dp(8), dp(8), dp(8))"));
check("card keeps measured scroll-safe layout", open.includes("new ScrollView(this)") && open.includes("menuScrollView.setClipToPadding(false)") && service.includes("adjustOpenMenuLayoutAfterMeasure"));
check("buttons are compact and translucent", button.includes("Color.argb(176, 62, 69, 79)") && button.includes("dp(34)") && button.includes("params.topMargin = dp(4)"));
check("button text remains readable", button.includes("button.setTextSize(12.3f)") && button.includes("Color.rgb(248, 250, 252)") && button.includes("button.setAlpha(1.0f)") && button.includes("Typeface.BOLD"));
check("operation summary is translucent", contents.includes("Color.argb(150, 35, 39, 46)"));
check("card content uses compact canonical single-line route", contents.includes("menuTitle()") && contents.includes("routeLine") && contents.includes("metricsLine") && contents.includes("routeInfo.setSingleLine(true)") && contents.includes("metricsInfo") && !contents.includes("selectedInfo.setText(compactText)") && contents.includes("acceptedListOrigin") && contents.includes("acceptedListDestination") && contents.includes("readCanonicalSelectedFreight"));
check("current freight actions remain compact and non-destructive", contents.includes('menuButton("Cancelar")') && contents.includes('menuButton(operationSummaryExpanded ? "Voltar ao frete atual" : "Operação atual")') && contents.includes("actionRow") && !contents.includes("Remover botão flutuante"));
check("operation view remains a switch with return", contents.includes("operationSummaryExpanded = !operationSummaryExpanded") && (contents.includes('operationSummary.setText("Operação atual\\n" + operationSummaryValue);') || contents.includes('operationTitle.setText("Operação atual")')));
check("short tap still toggles card open/close", service.includes("toggleAutomationFromFloatingButton()") && service.includes("if (menuView != null) {") && service.includes("closeMenu();") && service.includes("else {\n            openMenu();"));
check("long press and safe drag/remove remain intact", service.includes("postDelayed(bubbleLongPressRunnable, 520L)") && service.includes("GtoBubbleDismissPolicy.canCommitStop(") && service.includes("Remover e parar NVU"));
check("Pause parser remains isolated from card style and city rule", !parser.includes("makeRoundedBackground") && !parser.includes("Itapetuna") && !parser.includes("Color.argb(214"));
check("approved HF56/HF57 and HF131 remain in release gate", String(pkg.scripts["verify:release"] || "").includes("test:gto-r3.34-hf56-bubble-position") && String(pkg.scripts["verify:release"] || "").includes("test:gto-r3.34-hf57-instant-messages") && String(pkg.scripts["verify:release"] || "").includes("test:gto-r3.34-hf131-itapetuna-direct-list"));

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF132 floating-card checks passed.`);
if (failed.length) process.exit(1);
