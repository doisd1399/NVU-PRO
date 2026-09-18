import fs from "node:fs";

const read = relative => fs.readFileSync(relative, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoBubbleDismissPolicy.java");
const pause = read("android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java");
const autoSync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const pkg = JSON.parse(read("package.json"));

const checks = [];
const check = (name, ok) => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};
const between = (text, start, end) => {
  const a = text.indexOf(start);
  const b = text.indexOf(end, Math.max(0, a + start.length));
  return a >= 0 && b > a ? text.slice(a, b) : "";
};

const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
const verifyScript = String(pkg.scripts["verify:release"] || "");
const contents = between(service, "private void populateMenuContents", "private String menuRenderSignature");
const trip = between(contents, "if (STATE_TRIP_IN_PROGRESS.equals(state))", "if (STATE_RESULT_DETECTED.equals(state)");
const button = between(service, "private Button menuButton(String text)", "private android.graphics.drawable.GradientDrawable makeRoundedBackground");
const commit = between(service, "private void commitPreciseFreight(FreightOption selected)", "private void clearUncommittedSelectedFreight");
const directBarrier = between(service, "private void synchronizeDirectListAuthorities(FreightOption option)", "private JSONObject freightOptionToJson");
const menuTitle = between(service, "private String menuTitle()", "private String operationSummaryText");

check("HF139 active Android identity is 1.0.218 or newer", versionCode >= 218 && versionName === `1.0.${versionCode}`);
check("HF139 workflow follows the active Android identity", workflow.includes(`EXPECTED_VERSION_CODE: "${versionCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${versionName}"`));
check("HF139 validator is registered in verify:release", verifyScript.includes("test:gto-r3.34-hf139-production-parity"));
check("HF139 card uses compact structural composition", contents.includes("routeLine") && contents.includes("metricsLine") && contents.includes("routeInfo.setSingleLine(true)") && contents.includes("metricsInfo") && !contents.includes("selectedInfo.setText(compactText)"));
check("HF139 card reads canonical snapshot and measures route", contents.includes("readCanonicalSelectedFreight()") && contents.includes("acceptedListOrigin") && contents.includes("acceptedListDestination") && contents.includes("acceptedVisibleOrigin") && contents.includes("acceptedVisibleDestination") && service.includes("responsiveMenuWidth(safeLeft, safeRight)"));
check("HF139 card typography has high contrast", contents.includes("Color.rgb(242, 245, 248)") && contents.includes("routeInfo.setTextSize(12.1f)") && contents.includes("cargoInfo.setTextSize(12.1f)") && button.includes("Color.rgb(248, 250, 252)") && button.includes("button.setTextSize(12.3f)") && button.includes("button.setAlpha(1.0f)"));
check("HF139 card actions are compact and non-destructive", contents.includes('menuButton("Cancelar")') && contents.includes('menuButton(operationSummaryExpanded ? "Voltar ao frete atual" : "Operação atual")') && contents.includes("actionRow") && !contents.includes("Remover botão flutuante") && !contents.includes("dispatchObserverStop") && !contents.includes("ACTION_STOP"));
check("HF139 card header does not duplicate NVU", menuTitle.includes('return company.isEmpty() ? "GTO" : company;') && !menuTitle.includes('"NVU · " + company'));
check("HF139 direct-list commit synchronizes authorities before persistence", commit.indexOf("synchronizeDirectListAuthorities(selected);") >= 0 && commit.indexOf("synchronizeDirectListAuthorities(selected);") < commit.indexOf("freightOptionToJson(selected)") && commit.indexOf("synchronizeDirectListAuthorities(selected);") < commit.indexOf("GtoAutoTripSync.lockSelectedFreight(this, prefs)") );
check("HF139 direct-list barrier uses selected-row evidence only", directBarrier.includes("selectedRowEvidence") && directBarrier.includes("originSelectedRowEvidence") && directBarrier.includes("destinationSelectedRowEvidence") && directBarrier.includes("acceptedListOrigin") && directBarrier.includes("acceptedListDestination") && directBarrier.includes("if (option == null || option.pauseMenuEvidence) return;"));
check("HF139 durable record keeps accepted-list authorities", autoSync.includes("acceptedListOrigin") && autoSync.includes("acceptedListDestination") && autoSync.includes("acceptedVisibleOrigin(") && autoSync.includes("acceptedVisibleDestination("));
check("HF139 removal uses first drag in either context and one stop dispatcher", policy.includes("boolean eligibleOrigin = dragging") && policy.includes("canCommitStop") && !policy.includes("!gtoForeground || dragRemovalArmed") && service.includes("showBubbleRemoveTarget(bubbleActiveGestureGeneration)") && service.includes("setAction(ACTION_STOP)"));
check("HF139 Pause remains isolated from list-only barrier and card UI", !pause.includes("synchronizeDirectListAuthorities") && !pause.includes("compactText") && !pause.includes("Color.argb(214") && !pause.includes("acceptedListDestination"));
check("HF139 canonical city fix remains List-only", service.includes("canonicalizeSelectedListDestinationSpelling(selected)") && service.includes("if (!selected.pauseMenuEvidence && selected.destinationSelectedRowEvidence)") && !pause.includes("Itapetuna"));

const failed = checks.filter(item => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF139 production-parity checks passed.`);
if (failed.length) process.exit(1);
