import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, Math.max(0, from + start.length));
  return from >= 0 && to > from ? source.slice(from, to) : "";
};

const policy = read("android/app/src/main/java/com/nvu/operacional/GtoListOriginTextPolicy.java");
const geometry = read("android/app/src/main/java/com/nvu/operacional/GtoOriginGeometryPolicy.java");
const conflict = read("android/app/src/main/java/com/nvu/operacional/GtoFreightFieldConflictPolicy.java");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const certified = read("android/app/src/main/java/com/nvu/operacional/GtoCertifiedFreight.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const pause = read("android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const runtime = read("src/lib/gtoRuntimeRevision.ts");
const pkg = JSON.parse(read("package.json"));

const checks = [];
const check = (name, condition) => {
  checks.push({ name, condition: Boolean(condition) });
  console.log(`${condition ? "PASS" : "FAIL"} ${name}`);
};

const parser = section(service, "private List<FreightOption> parseFreightOptions", "private int freightOcrLeftForCurrentLayout");
const refine = section(service, "private void refinePreciseRowFields", "private FreightOption mergeVerifiedPreciseWithStable");
const merge = section(service, "private FreightOption mergeVerifiedPreciseWithStable", "private void scheduleFocusedFreightConflictRetry");
const retry = section(service, "private FreightOption buildFocusedRetryFreight", "private FreightOption resolveFreightConflictsAfterRetry");
const resolve = section(service, "private void resolveFreightFieldAfterRetry", "private boolean isTwoSourceAgreement");
const vote = section(service, "private VoteResult voteText", "private float voteEvidence");
const originBarrier = section(service, "private void canonicalizeListOriginOcrAlias", "private void canonicalizeAcceptedListDestination");
const destinationBarrier = section(service, "private void canonicalizeAcceptedListDestination", "private void synchronizeDirectListAuthorities");
const directBarrier = section(service, "private void synchronizeDirectListAuthorities", "private JSONObject freightOptionToJson");

check("origin policy is exact and closed", policy.includes('"metalurgioa".equals(normalized)') && policy.includes('return "Metalurgica";'));
check("origin policy has no fuzzy or distance matching", !/levenshtein|editDistance|similarity|nearest|uniqueOfficialCanonicalCandidate/i.test(policy));
check("first geometric origin result is canonicalized", geometry.includes("this.value = GtoListOriginTextPolicy.canonicalizeOcrLiteral(value);"));
check("initial List parser canonicalizes separator origin", parser.includes("option.originCompany = GtoListOriginTextPolicy.canonicalizeOcrLiteral("));
check("initial List parser canonicalizes geometry-split origin", parser.includes("String origin = GtoListOriginTextPolicy.canonicalizeOcrLiteral("));
check("selected-row refinement canonicalizes origin before authority", refine.includes("String origin = GtoListOriginTextPolicy.canonicalizeOcrLiteral("));
check("stable/exact merge canonicalizes both origin candidates", merge.includes("canonicalizeListOriginOcrAlias(canonical);") && merge.includes("canonicalizeListOriginOcrAlias(stable);"));
check("origin vote consolidation canonicalizes before counting", vote.includes('"origin".equals(field) || "originCompany".equals(field)') && vote.includes("GtoListOriginTextPolicy.canonicalizeOcrLiteral(value)"));
check("focused retry reads the canonical geometric result", retry.includes("inferOriginCompanyFromSelectedRowLines") && retry.includes("retry.origin = origin.value;"));
check("retry resolution canonicalizes origin before persistence", resolve.includes("value = GtoListOriginTextPolicy.canonicalizeOcrLiteral(value);") && resolve.includes("target.acceptedListOrigin = value;"));
check("generic conflict policy canonicalizes only origin fields", conflict.includes("GtoFreightReviewPolicy.ORIGIN.equals(field)") && conflict.includes("GtoFreightReviewPolicy.ORIGIN_COMPANY.equals(field)") && conflict.includes("GtoListOriginTextPolicy.canonicalizeOcrLiteral"));
check("final List origin barriers canonicalize all origin aliases", originBarrier.includes("option.origin = GtoListOriginTextPolicy.canonicalizeOcrLiteral") && originBarrier.includes("option.originCompany = GtoListOriginTextPolicy.canonicalizeOcrLiteral") && originBarrier.includes("option.acceptedListOrigin = GtoListOriginTextPolicy.canonicalizeOcrLiteral") && directBarrier.includes("canonicalizeListOriginOcrAlias(option);"));
check("CertifiedFreight seals corrected List origin", certified.includes('if ("LIST".equals(safeSource))') && certified.includes("origin = GtoListOriginTextPolicy.canonicalizeOcrLiteral(origin);") && certified.includes("acceptedOrigin = GtoListOriginTextPolicy.canonicalizeOcrLiteral(acceptedOrigin);"));
check("corrected sealed origin reaches snapshot and payload unchanged", certified.includes("copyIntoSnapshot") && certified.includes("copyIntoPayload") && sync.includes("GtoCertifiedFreight.copyIntoSnapshot") && sync.includes("GtoCertifiedFreight.copyIntoPayload"));
check("destination path does not call origin policy", !destinationBarrier.includes("GtoListOriginTextPolicy"));
check("Pause parser does not call origin policy", !pause.includes("GtoListOriginTextPolicy"));
check("origin fix does not add destination spelling rules", !policy.includes("Itapetuna") && !policy.includes("Matecom") && !policy.includes("Motecom"));
const activeRevision = String(pkg.gtoWebRuntimeRevision || "");
const activeVersionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const activeVersionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
check("HF159 runtime identity", /^R3\.34-PC-HF\d+$/.test(activeRevision) && runtime.includes(activeRevision));
check("Android HF159 identity", activeVersionCode >= 240 && /^1\.0\.\d+$/.test(activeVersionName));
check("workflow identity follows HF159", workflow.includes(`EXPECTED_VERSION_CODE: "${activeVersionCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${activeVersionName}"`));
check("HF159 gate is mandatory", String(pkg.scripts["verify:release"] || "").includes("test:gto-r3.34-hf159-list-origin-text"));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf159-origin-"));
try {
  const sources = [
    "android/app/src/main/java/com/nvu/operacional/GtoListOriginTextPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoOriginGeometryPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightTextGuard.java",
    "android/app/src/main/java/com/nvu/operacional/GtoManualRouteSelectionPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightFieldConflictPolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoHf159ListOriginTextPolicyTest.java",
  ].map(relative => path.join(root, relative));
  let result = spawnSync("javac", ["-encoding", "UTF-8", "-d", temp, ...sources], { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  check("HF159 origin policies compile", result.status === 0);
  if (result.status === 0) {
    result = spawnSync("java", ["-cp", temp, "com.nvu.operacional.GtoHf159ListOriginTextPolicyTest"], { encoding: "utf8" });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    check("HF159 first-read and propagation scenarios pass", result.status === 0 && String(result.stdout || "").includes("PASS"));
  } else {
    check("HF159 first-read and propagation scenarios pass", false);
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

const failed = checks.filter(item => !item.condition);
console.log(`\n${checks.length - failed.length}/${checks.length} HF159 List-origin checks passed.`);
if (failed.length) process.exit(1);
