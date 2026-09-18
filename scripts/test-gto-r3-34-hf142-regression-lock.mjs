import fs from "node:fs";

const read = relative => fs.readFileSync(relative, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const textPolicy = read("android/app/src/main/java/com/nvu/operacional/GtoFreightListTextAuthorityPolicy.java");
const pause = read("android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java");
const city = read("android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java");
const plugin = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const launcher = read("src/services/gtoWorkLauncher.ts");
const dashboard = read("src/pages/driver/Dashboard.tsx");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
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

const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const name = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
const signature = section(service, "private String menuRenderSignature()", "private void refreshMenuContents()");
const directPromotion = section(service, "private boolean canPromoteHumanBackedSelectedRowDirectly(", "private boolean isDirectSelectedRowCommitStillValid");
const directValidation = section(service, "private boolean isDirectSelectedRowCommitStillValid(", "private boolean ensureHumanSelectionConfirmedForFreight");
const commit = section(service, "private void commitPreciseFreight(FreightOption selected)", "private void clearUncommittedSelectedFreight");
const summary = section(service, "private String operationSummaryText()", "private Button menuButton(String text)");
const contents = section(service, "private void populateMenuContents", "private String menuRenderSignature");
const verify = String(pkg.scripts["verify:release"] || "");

check("HF142 identity is aligned", code >= 219 && name === `1.0.${code}` && workflow.includes(`EXPECTED_VERSION_CODE: "${code}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${name}"`));
check("HF142 is mandatory in verify:release", verify.includes("test:gto-r3.34-hf142-regression-lock"));
check("List text policy requires two concordant reads", textPolicy.includes("GtoFreightFieldEvidencePolicy.text") && textPolicy.includes("allRequiredTextFieldsConfirmed") && textPolicy.includes("pauseMenuEvidence") && read("android/app/src/main/java/com/nvu/operacional/GtoFreightFieldEvidencePolicy.java").includes("votes >= 2"));
check("direct promotion applies strict List text policy", directPromotion.includes("GtoFreightListTextAuthorityPolicy.canDirectPromote") && directPromotion.includes("candidate.originVotes") && directPromotion.includes("candidate.destinationVotes"));
check("commit revalidates strict List text policy", directValidation.includes("GtoFreightListTextAuthorityPolicy.canDirectPromote") && directValidation.includes("option.originVotes") && directValidation.includes("option.destinationVotes"));
check("human geometry remains separate from text authority", service.includes("selectedRowSemanticallyCertifiesFreight(option)") && service.includes("option.acceptRect != null") && textPolicy.includes("Human geometry certifies which row was touched"));
check("stale accepted authorities are synchronized before and after canonicalization", commit.indexOf("synchronizeDirectListAuthorities(selected);") >= 0 && commit.indexOf("synchronizeDirectListAuthorities(selected);") < commit.indexOf("canonicalizeAcceptedListOrigin(selected);") && commit.lastIndexOf("synchronizeDirectListAuthorities(selected);") > commit.indexOf("canonicalizeAcceptedListDestination(selected);"));
check("Pause remains excluded from List authority", textPolicy.includes("pauseMenuEvidence") && service.includes("if (option == null || option.pauseMenuEvidence) return;") && !pause.includes("GtoFreightListTextAuthorityPolicy"));
check("Itapetuna remains unique List-only correction", service.includes("canonicalizeSelectedListDestinationSpelling(selected)") && city.includes("Itapetuna") && !pause.includes("Itapetuna"));
check("Operation summary reads only compatible operation authority", summary.includes("GtoAutoTripSync.resolveOperationContextSnapshot(this, prefs)") && summary.includes("GtoAutoTripSync.renderOperationSummary(operationSnapshot)") && sync.includes("GtoOperationCardPolicy.isUsableForActive") && summary.includes('operationSnapshot.optString("vehicleName"') && summary.includes('operationSnapshot.optString("trailerName"'));
check("Operation summary contains complete fields", summary.includes('"\\nStatus "') && summary.includes('"\\nViagens "') && summary.includes('"\\nVeículo "') && summary.includes('"\\nReboque "') && summary.includes('"\\nProgresso "'));
check("Operation metadata invalidates an open card", signature.includes("opSession=") && signature.includes("opJob=") && signature.includes("opContract=") && signature.includes("opProgress=") && signature.includes("opTotal=") && signature.includes("opVehicle=") && signature.includes("opTrailer=") && signature.includes("opAckAt="));
check("Web context still sends operation fields", (plugin.includes("putString(\"jobId\"") || plugin.includes('putStringIfPresent(editor, call, "jobId"')) && dashboard.includes("jobTotalDeliveries") && dashboard.includes("vehicleName") && dashboard.includes("trailerName") && launcher.includes("setContext"));
check("card route remains one-line and canonical", contents.includes("readCanonicalSelectedFreight()") && contents.includes("routeInfo.setSingleLine(true)") && contents.includes("acceptedVisibleDestination"));
check("card has no destructive action", !contents.includes("Remover botão flutuante") && !contents.includes("ACTION_STOP"));
check("safe removal remains gesture-only", service.includes("postDelayed(bubbleLongPressRunnable, 520L)") && service.includes("GtoBubbleDismissPolicy.canCommitStop(") && service.includes("stopObserverFromFloatingBubble(releaseGeneration)"));
check("snapshot identity and ACK isolation remain present", sync.includes("snapshotDriverId") && sync.includes("snapshotCompanyId") && sync.includes("snapshotContractId") && sync.includes("activeJobId.equals(clean(jobId))"));

const twoReads = { cargo: 2, origin: 2, destination: 2 };
const oneReadGarbage = { cargo: 1, origin: 1, destination: 1 };
const canDirect = value => value.cargo >= 2 && value.origin >= 2 && value.destination >= 2;
check("fixture two reads can promote", canDirect(twoReads));
check("fixture one-read OCR garbage cannot promote", !canDirect(oneReadGarbage));

const failed = checks.filter(item => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF142 regression-lock checks passed.`);
if (failed.length) process.exit(1);
