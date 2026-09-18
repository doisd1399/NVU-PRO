import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const service = fs.readFileSync(path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java"), "utf8");
const certified = fs.readFileSync(path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoCertifiedFreight.java"), "utf8");
const resolver = fs.readFileSync(path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const buildGradle = fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8");
const runtime = fs.readFileSync(path.join(root, "src/lib/gtoRuntimeRevision.ts"), "utf8");

let passed = 0;
const checks = [];
function check(name, ok) {
  checks.push({ name, ok: Boolean(ok) });
  if (ok) passed += 1;
}

const selectedRowJson = service.indexOf('json.put("destinationSelectedRowEvidence", option.destinationSelectedRowEvidence);');
const sealList = certified.slice(certified.indexOf('if ("LIST".equals(safeSource))'), certified.indexOf('if (cargo.length() < 2'));
check("service_serializes_destination_row_evidence", selectedRowJson >= 0);
check("service_serializes_origin_row_evidence", service.includes('json.put("originSelectedRowEvidence", option.originSelectedRowEvidence);'));
check("seal_reads_destination_row_evidence", sealList.includes('sealed.optBoolean("destinationSelectedRowEvidence", false)'));
check("seal_has_row_authority_branch", sealList.includes("if (!destinationRowAuthority)") && sealList.includes("canonicalizeSelectedRowDestination"));
check("seal_row_branch_does_not_call_legacy_destination", !sealList.slice(sealList.indexOf("} else {"), sealList.indexOf("acceptedOrigin = origin")).includes("acceptedVisibleDestination("));
const officialResolver = resolver.slice(resolver.indexOf("static String uniqueOfficialCanonicalCandidate"));
check("resolver_prefers_official_before_trusted", officialResolver.indexOf("for (String candidate : PREFERRED_DESTINATIONS)") < officialResolver.indexOf("if (trustedCities != null)"));
check("resolver_has_suffix_only_canonicalization", resolver.includes("canonicalizeVisibleDestinationSuffix"));
check("refresh_resets_window_height", service.includes("menuParams.height = WindowManager.LayoutParams.WRAP_CONTENT;"));
check("refresh_requests_content_layout", service.includes("menuContentView.requestLayout();"));
  check("operation_summary_forces_visibility", service.includes("operationSummary.setVisibility(View.VISIBLE);") && service.includes("operationSummary.setMinHeight(dp(150));"));
check("operation_summary_nonempty_fallback", service.includes("operationSummaryValue = operationSummaryFallbackText();"));
  const activeRevision = String(packageJson.gtoWebRuntimeRevision ?? "");
  const revisionNumber = Number((activeRevision.match(/HF(\d+)/) || ["", "0"])[1]);
  const versionCode = Number((buildGradle.match(/versionCode\s+(\d+)/) || ["", "0"])[1]);
  check("runtime_revision_is_current", /^R3\.34-PC-HF\d+$/.test(activeRevision) && revisionNumber >= 156 && runtime.includes(activeRevision));
  check("package_revision_is_current", runtime.includes(activeRevision));
  check("android_version_above_1_0_233", versionCode >= 234 && /versionName\s+\"1\.0\.(23[4-9]|2[4-9]\d|[3-9]\d\d)\"/.test(buildGradle));
  check("android_version_code_above_233", versionCode >= 234);

const fixtureDir = path.join(root, "scripts/java-tests/com/nvu/operacional");
const javacDir = "/tmp/gto-hf156-java";
fs.rmSync(javacDir, { recursive: true, force: true });
fs.mkdirSync(javacDir, { recursive: true });
try {
  execFileSync("javac", ["-d", javacDir,
    path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java"),
    path.join(fixtureDir, "GtoDestinationOperationFinalContractTest.java")
  ], { stdio: "pipe" });
  const output = execFileSync("java", ["-cp", javacDir, "com.nvu.operacional.GtoDestinationOperationFinalContractTest"], { encoding: "utf8" });
  check("official_itapetuna_fixture", output.includes("ITAPETUNA_OK"));
  check("duplicate_destination_fixture", output.includes("DUPLICATE_OK"));
} catch (error) {
  check("official_itapetuna_fixture", false);
  check("duplicate_destination_fixture", false);
}

for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
console.log(`HF156 ${passed}/${checks.length}`);
if (passed !== checks.length) process.exit(1);
