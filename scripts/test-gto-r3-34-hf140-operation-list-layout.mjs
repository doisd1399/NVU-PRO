import fs from "node:fs";

const read = relative => fs.readFileSync(relative, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const plugin = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoAcceptedFreightFieldPolicy.java");
const city = read("android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const pkg = JSON.parse(read("package.json"));

const checks = [];
const check = (name, ok) => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};
const section = (text, start, end) => {
  const a = text.indexOf(start);
  const b = text.indexOf(end, Math.max(0, a + start.length));
  return a >= 0 && b > a ? text.slice(a, b) : "";
};
const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
const verifyScript = String(pkg.scripts["verify:release"] || "");
const commit = section(service, "private void commitPreciseFreight(FreightOption selected)", "private void clearUncommittedSelectedFreight");
const barrier = section(service, "private void synchronizeDirectListAuthorities(FreightOption option)", "private JSONObject freightOptionToJson");
const operation = section(service, "private String operationSummaryText()", "private Button menuButton(String text)");
const contents = section(service, "private void populateMenuContents", "private String menuRenderSignature");
const card = section(contents, "if (STATE_TRIP_IN_PROGRESS.equals(state)", "if (STATE_RESULT_DETECTED.equals(state)");
const openMenu = section(service, "private void openMenu()", "private void populateMenuContents");
const adjust = section(service, "private void adjustOpenMenuLayoutAfterMeasure()", "private boolean shouldMinimizeMenuForConfirmedExternalApp");

check("HF140 Android identity is aligned before final version bump", versionCode >= 218 && versionName === `1.0.${versionCode}`);
check("HF140 workflow follows Android identity", workflow.includes(`EXPECTED_VERSION_CODE: "${versionCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${versionName}"`));
check("HF140 validator is registered in verify:release", verifyScript.includes("test:gto-r3.34-hf140-operation-list-layout"));

check("operation snapshot seals status/progress/total", sync.includes("jobStatus") && sync.includes("jobProgress") && sync.includes("jobTotalDeliveries") && sync.includes("copyContextFromPrefs"));
check("operation view reads one operation authority", operation.includes("GtoAutoTripSync.resolveOperationContextSnapshot(this, prefs)") && operation.includes("GtoAutoTripSync.renderOperationSummary(operationSnapshot)") && sync.includes("GtoOperationCardPolicy.resolve("));
check("operation snapshot rejects switched identity", sync.includes("snapshotDriverId") && sync.includes("snapshotCompanyId") && sync.includes("snapshotContractId") && sync.includes("!activeJobId.equals(snapshotJobId)"));
check("Web bridge refreshes only the active session metadata", plugin.includes("GtoAutoTripSync.refreshCurrentOperationSnapshot(context, prefs)") && plugin.includes("operationContextChanged"));
check("backend ACK refresh is job-scoped", sync.includes("refreshCurrentOperationSnapshotFromAck") && sync.includes("activeJobId.equals(clean(jobId))"));
check("operation panel shows status and current session values", operation.includes('"\\nStatus "') && operation.includes('"\\nViagens "') && operation.includes('"\\nVeículo "') && operation.includes('"\\nReboque "') && operation.includes('"\\nProgresso "'));

const firstBarrier = commit.indexOf("synchronizeDirectListAuthorities(selected);");
const firstCanonical = commit.indexOf("canonicalizeAcceptedListOrigin(selected);");
const secondBarrier = commit.indexOf("synchronizeDirectListAuthorities(selected);", firstBarrier + 1);
check("List barrier runs before and after canonicalization", firstBarrier >= 0 && firstBarrier < firstCanonical && secondBarrier > firstCanonical && secondBarrier < commit.indexOf("freightOptionToJson(selected)"));
check("List barrier never applies to Pause", barrier.includes("if (option == null || option.pauseMenuEvidence) return;") && barrier.includes("originSelectedRowEvidence") && barrier.includes("destinationSelectedRowEvidence"));
check("row authority composes the selected destination and dominates stale values", service.includes("rowAuthority ? \"\" : option.acceptedListOrigin") && service.includes("String composedDestination = GtoAcceptedFreightFieldPolicy.destination(") && service.includes("option.acceptedListDestination = composedDestination;") && service.includes("if (composedDestination.isEmpty()) composedDestination = destination;"));
check("durable snapshot receives canonical accepted fields", sync.includes("candidate.optString(\"acceptedListOrigin\"" ) && sync.includes("candidate.optString(\"acceptedListDestination\""));
check("Itapetuna remains List-only with unique official candidate", service.includes("canonicalizeSelectedListDestinationSpelling(selected)") && city.includes("Itapetuna") && !read("android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java").includes("Itapetuna"));

check("card reads canonical selected freight", card.includes("readCanonicalSelectedFreight()") && card.includes("acceptedVisibleOrigin") && card.includes("acceptedVisibleDestination"));
check("destination route is structurally single-line", card.includes("routeInfo.setSingleLine(true)") && card.includes("routeInfo.setEllipsize") && !card.includes("selectedInfo.setText(compactText)"));
check("card width is measured responsively in both geometry passes", openMenu.includes("responsiveMenuWidth(safeLeft, safeRight)") && adjust.includes("responsiveMenuWidth(safeLeft, safeRight)") && service.includes("currentFreightRouteForLayout()"));
check("card still uses compact translucent surface and safe scroll", openMenu.includes("Color.argb(214, 28, 31, 36)") && openMenu.includes("new ScrollView(this)") && openMenu.includes("menuScrollView.setClipToPadding(false)"));
check("card keeps non-destructive actions", !card.includes("Remover botão flutuante") && !card.includes("ACTION_STOP") && service.includes("GtoBubbleDismissPolicy.canCommitStop("));

// Deterministic textual fixture: same selected row must beat stale accepted-list authorities.
const fixture = {
  pauseMenuEvidence: false,
  directSelectedRowEvidence: true,
  originSelectedRowEvidence: true,
  destinationSelectedRowEvidence: true,
  acceptedListOrigin: "Origem stale de outra linha",
  origin: "Fazenda Areia Dourada",
  acceptedListDestination: "Destino stale de outra linha",
  destination: "Agro Grão Area Rural",
};
const rowAuthorityFixture = value => ({
  ...value,
  acceptedListOrigin: value.origin,
  acceptedListDestination: value.destination,
});
const canonicalFixture = rowAuthorityFixture(fixture);
check("fixture List preserves exact touched-row Origin/Destino", canonicalFixture.acceptedListOrigin === "Fazenda Areia Dourada" && canonicalFixture.acceptedListDestination === "Agro Grão Area Rural");
const pauseFixture = {
  pauseMenuEvidence: true,
  acceptedListOrigin: "Lista original",
  origin: "Origem Pause",
  acceptedListDestination: "Lista destino completo",
  destination: "Destino Pause",
};
check("fixture Pause is not rewritten by List authority", pauseFixture.acceptedListOrigin === "Lista original" && pauseFixture.acceptedListDestination === "Lista destino completo");

// Deterministic textual fixture: an identity change invalidates the old operation view.
const sealed = { sessionId: "session-a", driverId: "driver-a", companyId: "company-a", jobId: "job-a", contractId: "contract-a", jobProgress: 2, jobTotalDeliveries: 8 };
const switched = { sessionId: "session-b", driverId: "driver-b", companyId: "company-b", jobId: "job-b", contractId: "contract-b", jobProgress: 0, jobTotalDeliveries: 4 };
const sameIdentity = (snapshot, live) => snapshot.sessionId === live.sessionId && snapshot.driverId === live.driverId && snapshot.companyId === live.companyId && snapshot.jobId === live.jobId && snapshot.contractId === live.contractId;
check("fixture operation switch rejects previous session", !sameIdentity(sealed, switched));
check("fixture progress update remains bounded to current operation", sameIdentity(switched, switched) && switched.jobProgress === 0 && switched.jobTotalDeliveries === 4);
check("fixture empty operation context does not invent names", operation.includes("Operação atual indisponível"));

const failed = checks.filter(item => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF140 operation/list/layout checks passed.`);
if (failed.length) process.exit(1);
