import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const conflict = read("android/app/src/main/java/com/nvu/operacional/GtoFreightFieldConflictPolicy.java");
const acceptedPolicy = read("android/app/src/main/java/com/nvu/operacional/GtoAcceptedFreightFieldPolicy.java");
const restoreStart = sync.indexOf("static boolean restoreLockedFreightToPrefs");
const lockStart = sync.indexOf("static boolean lockSelectedFreight");
const restoreSource = restoreStart >= 0 && lockStart > restoreStart
  ? sync.slice(restoreStart, lockStart)
  : "";
const gradle = read("android/app/build.gradle");
const checks = [];
const check = (name, ok) => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

check("selected-row direct gate is wired before fallback retry",
  service.includes("canPromoteHumanBackedSelectedRowDirectly(")
  && service.includes("directSelectedRowEvidence = true")
  && service.includes("commitPreciseFreight(")
  && service.indexOf("FreightOption reconciledSameRow = mergeVerifiedPreciseWithStable") >= 0
  && service.indexOf("commitPreciseFreight(reconciledSameRow);") > service.indexOf("FreightOption reconciledSameRow = mergeVerifiedPreciseWithStable")
  && service.indexOf("scheduleFocusedFreightConflictRetry(", service.indexOf("FreightOption reconciledSameRow = mergeVerifiedPreciseWithStable")) > service.indexOf("FreightOption reconciledSameRow = mergeVerifiedPreciseWithStable")
);
check("direct commit is revalidated with strict List text authority",
  service.includes("isDirectSelectedRowCommitStillValid")
  && service.includes("!directSelectedRowCommit && !isStableFreightSafeToCommit(selected)")
  && service.includes("GtoFreightListTextAuthorityPolicy.canDirectPromote")
  && service.includes("directSelectedRowEvidence")
);
check("focused retry remains bounded to the same selected row",
  service.includes("runFocusedFreightConflictRetry(")
  && service.includes("attempt < 2")
  && service.includes("copyFreightOption(exact), copyFreightOption(frozen)")
);
check("two focused reads are available when the baseline is absent",
  conflict.includes("resolveWithFocusedReads(")
  && conflict.includes("TWO_FOCUSED_READS_AGREED")
);
check("single focused read remains unresolved",
  conflict.includes("A retry-only value is still a single OCR observation")
  && conflict.includes("if (!exactValid && !frozenValid")
  && conflict.includes("return Resolution.unresolved();")
);
check("selected-row retry uses literal active-origin recovery",
  service.includes("inferFromExpectedOriginPrefix")
  && service.includes('getString("expectedGtoOrigin", "").trim()')
);
check("primary selected-row geometry promotes origin operationally",
  service.includes("selected.origin = GtoAcceptedFreightFieldPolicy.origin(")
  && service.includes("selected.originSelectedRowEvidence = true")
  && service.includes(":OPERATIONAL_ORIGIN")
  && !service.includes(":COMPANY_ONLY")
);
check("human-backed row certification does not require OCR Accept text",
  service.includes("option.acceptRect != null")
  && service.includes("option.cargo, option.origin, option.destination, option.km, option.offeredValue")
);
check("direct List promotion requires two concordant text reads",
  service.includes("GtoFreightListTextAuthorityPolicy.FreightTextEvidence")
  && service.includes("candidate.cargoVotes")
  && service.includes("candidate.originVotes")
  && service.includes("candidate.destinationVotes")
  && service.includes("option.cargoVotes")
  && service.includes("option.originVotes")
  && service.includes("option.destinationVotes")
);
check("direct evidence reaches durable lock and is narrowly honored",
  service.includes('json.put("directSelectedRowEvidence", option.directSelectedRowEvidence)')
  && sync.includes("candidate.optBoolean(\"directSelectedRowEvidence\", false)")
  && sync.includes("!directSelectedRowEvidence && originReads < 2")
  && sync.includes("!directSelectedRowEvidence && destinationReads < 2")
  && sync.includes("!directSelectedRowEvidence && !cargoListSameRowAuthority")
  && sync.includes("GtoCargoConsensusPolicy.confirmed(cargoReads)")
);
check("accepted-list destination is composed before card and snapshot sinks",
  service.includes("canonicalizeAcceptedListDestination(option);")
  && service.includes("canonicalizeAcceptedListDestination(selected);")
  && service.includes("canonicalizeAcceptedListDestination(canonical);")
  && service.includes("GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(")
  && sync.includes("GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(")
  && sync.includes("pauseMenuEvidence")
);
check("accepted-list raw text recovery reaches every durable sink",
  service.includes("option.rawText")
  && sync.includes("snapshot.optString(\"rawText\", \"\")")
  && sync.includes("candidate.optString(\"rawText\", \"\")")
  && sync.includes("payload.optString(\"rawText\", \"\")")
);
check("durable snapshot recovery preserves accepted-list destination without changing Pause",
  restoreSource.includes("acceptedListDestination")
  && restoreSource.includes("GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(")
  && restoreSource.includes("pauseMenuEvidence")
  && restoreSource.includes('freight.put("acceptedListDestination", acceptedListDestination)')
  && sync.includes('snapshot.put(field, candidate.optString(field, ""))')
);
check("current card and payload use persisted CertifiedFreight despite stale Pause state",
  service.includes("GtoCertifiedFreight.isValid")
  && service.includes("readCanonicalSelectedFreight()")
  && sync.includes("GtoCertifiedFreight.copyIntoPayload(payload, certifiedFreight)")
  && sync.includes('payload.put("destination", visibleDestination)')
  && (service.includes('putString("selectedAcceptedListDestination", selected.acceptedListDestination)')
    || service.includes('putString("selectedAcceptedListDestination", certified.optString("acceptedListDestination"'))
);
check("legacy snapshots recover the list prefix from companyRoute",
  service.includes('saved.optString("companyRoute", "")')
  && sync.includes('snapshot.optString("companyRoute", "")')
  && sync.includes('candidateCompanyRoute')
  && acceptedPolicy.includes("acceptedVisibleDestination")
);
check("summary and durable restore render the accepted-list authority",
  (service.includes("String visibleDestination = acceptedListDestination == null")
    || service.includes("String visibleDestination = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination("))
  && (sync.includes("String visibleDestination = acceptedListDestination.isEmpty() ? destination : acceptedListDestination")
    || sync.includes("String visibleDestination = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination("))
  && restoreSource.includes("acceptedListDestination = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(")
);
check("accepted-list recovery handles route-marker loss using origin boundary",
  acceptedPolicy.includes("String originCompany")
  && acceptedPolicy.includes("noMarkerRecovery")
  && service.includes("option.companyRoute,")
  && service.includes("option.originCompany")
  && sync.includes('snapshot.optString("originCompany", "")')
);
check("Android identity is the current Release baseline", /versionCode\s+(?:20[3-9]|2[1-9]\d|[3-9]\d{2,})/.test(gradle));
check("Release signing keeps v2 and enables v3", gradle.includes("v2SigningEnabled true") && gradle.includes("final Release artifact is explicitly") && gradle.includes("apksigner v2/v3"));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf128-"));
const sources = [
  "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
  "android/app/src/main/java/com/nvu/operacional/GtoAcceptedFreightFieldPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoDestinationTextAuthorityPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightTextGuard.java",
  "android/app/src/main/java/com/nvu/operacional/GtoManualRouteSelectionPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoCargoConsensusPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightFieldEvidencePolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightFieldConflictPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightSelectionPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightSemanticCertificationPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightListTextAuthorityPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoListOriginTextPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoOriginGeometryPolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf128FirstRowDirectPromotionTest.java",
].map(relative => path.join(root, relative));
let result = spawnSync("javac", ["-encoding", "UTF-8", "-d", temp, ...sources], { encoding: "utf8" });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
check("HF128 first-row direct promotion compiles", result.status === 0);
if (result.status === 0) {
  result = spawnSync("java", ["-cp", temp, "com.nvu.operacional.GtoHf128FirstRowDirectPromotionTest"], { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  check("HF128 first-row direct promotion behavior passes", result.status === 0);
}
fs.rmSync(temp, { recursive: true, force: true });

const failed = checks.filter(item => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF128 first-row checks passed.`);
if (failed.length) process.exit(1);
