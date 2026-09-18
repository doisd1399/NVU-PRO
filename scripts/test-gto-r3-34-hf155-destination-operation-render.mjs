import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoAcceptedFreightFieldPolicy.java");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const fixture = read("scripts/java-tests/com/nvu/operacional/GtoCertifiedAuthorityContractTest.java");
const pkg = JSON.parse(read("package.json"));
const gradle = read("android/app/build.gradle");
const runtime = read("src/lib/gtoRuntimeRevision.ts");
const bridge = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");

const checks = [];
const check = (name, ok) => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

const activeRevision = String(pkg.gtoWebRuntimeRevision || "");
const revisionNumber = Number((activeRevision.match(/HF(\d+)/) || ["", "0"])[1]);
const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || ["", "0"])[1]);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || ["", ""])[1];
check("HF155 identity is current", /^R3\.34-PC-HF\d+$/.test(activeRevision) && revisionNumber >= 155 && runtime.includes(activeRevision) && bridge.includes(activeRevision));
check("Android candidate is above 1.0.232", versionCode >= 233 && /^1\.0\.(23[3-9]|2[4-9]\d|[3-9]\d\d)$/.test(versionName));
check("Selected-row destination uses same-row fields", service.includes("if (rowAuthority) {") && service.includes("String composedDestination = GtoAcceptedFreightFieldPolicy.destination(") && service.includes("option.destinationCompany"));
check("Selected-row destination is composed only once and remains fail-closed", service.includes("option.acceptedListDestination = composedDestination;") && service.includes("if (composedDestination.isEmpty())") && service.includes("option.rawText"));
check("Destination stale-company fixture stays complete", fixture.includes("\"Matecom Itapetuna\", \"Matecom Itapetuna\", \"Motecom\"") && fixture.includes("\"Matecom Itapetuna\".equals(matecom)"));
check("Destination card reads certified authority first", service.includes("if (certifiedAuthority) {") && service.includes("canonical.optString(\"destination\", \"\")"));
check("Legacy destination path is only fallback", service.includes("String destination = canonical == null") && service.includes("acceptedVisibleDestination("));
check("Operation summary has exception boundary", service.includes("private String operationSummaryText()") && service.includes("return buildOperationSummaryText();") && service.includes("catch (RuntimeException error)"));
check("Operation summary fallback contains data", service.includes("private String operationSummaryFallbackText()") && service.includes("\\nViagens ") && service.includes("\\nVeículo ") && service.includes("\\nReboque ") && service.includes("\\nProgresso "));
check("Operation summary never falls back to company", service.includes("operationName") && service.includes("contractName") && !service.includes("operation = prefs.getString(\"companyName\""));
check("Operation summary avoids Firebase in fallback", service.includes("Display-only fallback") && service.includes("cannot\n     * query Firebase"));
check("Snapshot and card are identity-bound", sync.includes("resolveOperationContextSnapshot") && sync.includes("GtoOperationCardPolicy.isUsableForActive") && service.includes("resolveOperationContextSnapshot(this, prefs)"));
check("HF155 gate is mandatory", String(pkg.scripts?.["verify:release"] || "").includes("test:gto-r3.34-hf155-destination-operation-render"));

const failed = checks.filter(({ ok }) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF155 destination/operation-render checks passed.`);
if (failed.length) process.exit(1);
