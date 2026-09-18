import fs from "node:fs";

const read = relative => fs.readFileSync(relative, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const dismissPolicy = read("android/app/src/main/java/com/nvu/operacional/GtoBubbleDismissPolicy.java");
const listPolicy = read("android/app/src/main/java/com/nvu/operacional/GtoFreightListTextAuthorityPolicy.java");
const evidencePolicy = read("android/app/src/main/java/com/nvu/operacional/GtoFreightFieldEvidencePolicy.java");
const acceptedPolicy = read("android/app/src/main/java/com/nvu/operacional/GtoAcceptedFreightFieldPolicy.java");
const cityResolver = read("android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java");
const plugin = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const autoSync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const launcher = read("src/services/gtoWorkLauncher.ts");
const dashboard = read("src/pages/driver/Dashboard.tsx");
const setup = read("src/components/GtoObserverSetup.tsx");
const runtime = read("src/lib/gtoRuntimeRevision.ts");
const packageJson = JSON.parse(read("package.json"));
const gradle = read("android/app/build.gradle");
const commitStart = service.indexOf("private void commitPreciseFreight");
const commitEnd = service.indexOf("private void clearUncommittedSelectedFreight");
const commit = commitStart >= 0 && commitEnd > commitStart ? service.slice(commitStart, commitEnd) : "";
const checks = [];
const check = (name, ok) => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

check("first real drag shows removal target without long press", service.includes("if (!bubbleDragging && Math.hypot(dx, dy) >= touchSlop)") && service.includes("showBubbleRemoveTarget(bubbleActiveGestureGeneration)") && !service.includes("showBubbleRemoveTarget(longPressGeneration)"));
check("same removal visibility rule applies inside and outside GTO", dismissPolicy.includes("boolean eligibleOrigin = dragging") && dismissPolicy.includes("return gestureActive && dragging") && service.includes("boolean eligibleOrigin = bubbleDragging"));
check("drop remains fail-safe and requires actual drag", dismissPolicy.includes("!gestureActive || !dragging") && dismissPolicy.includes("pointerMatches") && dismissPolicy.includes("targetVisible") && dismissPolicy.includes("targetHighlighted") && dismissPolicy.includes("generationMatches") && dismissPolicy.includes("geometryInside") && dismissPolicy.includes("releaseFreshnessMs"));
check("card has no destructive action", !service.includes("Remover botão flutuante") && !service.includes("stopObserverFromMenuRemoval"));
check("Pause remains isolated from removal and List composition", !read("android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java").includes("acceptedListDestination") && !read("android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java").includes("dispatchObserverStop"));
check("List destination authority is synchronized before and after canonicalization", commit.indexOf("synchronizeDirectListAuthorities(selected);") < commit.indexOf("canonicalizeAcceptedListOrigin(selected);") && commit.indexOf("canonicalizeAcceptedListDestination(selected);") < commit.lastIndexOf("synchronizeDirectListAuthorities(selected);"));
check("selected destination is persisted in all List authorities", (service.includes('putString("selectedDestination", selected.destination)') || service.includes('GtoCertifiedFreight.applyToPrefs')) && (service.includes('putString("selectedAcceptedListDestination", selected.acceptedListDestination)') || service.includes('GtoCertifiedFreight.applyToPrefs')) && service.includes("freightOptionToJson(selected)"));
check("two-read text authority is required", listPolicy.includes("GtoFreightFieldEvidencePolicy.text") && evidencePolicy.includes("votes >= 2") && commit.includes("isDirectSelectedRowCommitStillValid(selected)"));
check("full destination reconstruction is supported", acceptedPolicy.includes("acceptedVisibleDestination") && acceptedPolicy.includes("destinationCompany") && cityResolver.includes("Itapetuna"));
check("Operation summary is rendered and invalidated by current context", service.includes("operationSummaryText()") && service.includes("operationSummaryExpanded") && service.includes("gtoOperationContextChanged"));
check("Operation context reaches native bridge", launcher.includes("GtoObserver.setContext(runtimeContext)") && launcher.includes("buildGtoOperationContext(context)") && launcher.includes("GTO_WEB_RUNTIME_REVISION") && dashboard.includes("jobId: myJob.id") && setup.includes("buildGtoOperationContext(context)"));
check("native bridge exposes Web compatibility", plugin.includes('status.put("webRuntimeCompatible"') && plugin.includes("EXPECTED_WEB_RUNTIME_REVISION"));
check("snapshot records runtime revision", autoSync.includes("webRuntimeRevision") && autoSync.includes("validateContextSnapshot"));
check("one runtime revision is used across source and package", (() => {
  const expectedRuntimeRevision = String(packageJson.gtoWebRuntimeRevision || "").trim();
  return expectedRuntimeRevision && runtime.includes(`GTO_WEB_RUNTIME_REVISION = "${expectedRuntimeRevision}"`) && packageJson.gtoWebRuntimeRevision === expectedRuntimeRevision;
})());
const releaseVersionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const releaseVersionTail = Number(((gradle.match(/versionName\s+"1\.0\.(\d+)"/) || [])[1]) || 0);
check("official candidate has Android identity above 1.0.223", releaseVersionCode > 223 && releaseVersionTail > 223);

const failed = checks.filter(item => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} official GTO release-contract checks passed.`);
if (failed.length) process.exitCode = 1;
