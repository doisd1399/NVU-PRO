import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const servicePath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policyPath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java");
const syncPath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const parserPath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java");
const gradlePath = path.join(root, "android/app/build.gradle");
const service = fs.readFileSync(servicePath, "utf8");
const policy = fs.readFileSync(policyPath, "utf8");
const sync = fs.readFileSync(syncPath, "utf8");
const parser = fs.readFileSync(parserPath, "utf8");
const gradle = fs.readFileSync(gradlePath, "utf8");
const checks = [];
function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

check("current Android Release identity is present", /versionCode\s+(?:20[8-9]|2[1-9]\d|[3-9]\d{2,})/.test(gradle) && /versionName\s+"1\.0\.(?:20[8-9]|2[1-9]\d|[3-9]\d{2,})"/.test(gradle));
check("review policy validates final origin", policy.includes("String origin,") && policy.includes("if (!isOperationalTextUsable(origin)) return ORIGIN_COMPANY") && policy.includes("sameVisibleText(origin, destination)"));
check("pause stores location in origin", service.includes("freight.origin = pauseLocationTextField(lines, \"origem\", \"empresa de origem\")") && !service.includes("freight.origin = freight.originCompany"));
check("review draft has independent origin key", service.includes('putString("reviewOrigin", draft.origin)') && service.includes('prefs.getString("reviewOrigin", "")'));
check("selected trip UI renders selectedOrigin", service.includes('prefs.getString("selectedOrigin", "")') && service.includes('details.append("Origem: ").append(origin.isEmpty() ? "—" : origin)'));
check("list parser cannot use route/rule fragments as cargo", service.includes("isSafeListCargoCandidate") && service.includes("candidateCargo") && service.includes('"origem", "destino", "distancia", "valor", "aceitar"'));
check("pause parser rejects foreign labels", service.includes("hasForeignPauseFieldLabel") && service.includes("hasDistinctPauseLocationsButSameResult"));
check("no service path mirrors origin from originCompany", !/origin\s*=\s*[^;\n]*originCompany/.test(service));
check("sync never manufactures origin from originCompany", sync.includes("if (canonicalOrigin.isEmpty()) return null;") && !sync.includes("canonicalOrigin = clean(candidate.optString(\"originCompany\", \"\"))"));
check("location parser requires a separator", parser.includes("if (separator <= 0 || separator >= value.length() - 1) return \"\";"));

const tmp = fs.mkdtempSync("/tmp/nvu-hf102-");
try {
  const run = spawnSync("java", [
    "scripts/java-tests/JavaTestRunner.java", tmp,
    "com.nvu.operacional.GtoHf102FreightFieldMappingTest",
    "android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java",
    "android/app/src/main/java/com/nvu/operacional/GtoManualRouteSelectionPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
    "scripts/java-tests/com/nvu/operacional/GtoHf102FreightFieldMappingTest.java",
  ], { cwd: root, encoding: "utf8" });
  const output = `${run.stdout || ""}\n${run.stderr || ""}`.trim();
  check("HF103 mapping examples compile and pass", run.status === 0 && output.includes("PASS"), output);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = checks.filter((item) => !item.ok);
if (failed.length) {
  console.error(`\n${failed.length} HF102 check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} HF102 checks passed.`);
