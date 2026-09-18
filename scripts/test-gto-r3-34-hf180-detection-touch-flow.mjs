import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = (file) => fs.readFileSync(file, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const detector = read("android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoFreshVisualProofPolicy.java");
const actionPolicy = read("android/app/src/main/java/com/nvu/operacional/GtoVisualActionContextPolicy.java");
const selectionPolicy = read("android/app/src/main/java/com/nvu/operacional/GtoSelectionInteractionPolicy.java");
const test = "scripts/java-tests/com/nvu/operacional/GtoFreshVisualProofPolicyTest.java";
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const pkg = JSON.parse(read("package.json"));
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const version = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
check("HF180 Android identity", code >= 258 && version === `1.0.${code}`);
check("HF180 workflow identity", workflow.includes(`EXPECTED_VERSION_CODE: "${code}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${version}"`));
check("fresh visual proof is delegated to one pure policy", service.includes("GtoFreshVisualProofPolicy.isUsable(") && policy.includes("knownExternalPackage"));
check("visual action context is delegated to one pure policy", service.includes("GtoVisualActionContextPolicy.allows(") && actionPolicy.includes("analysisPausedOutsideGto"));
check("known external package cannot keep visual proof fresh", policy.includes("if (knownExternalPackage) return false;") && policy.includes("!current.equals(gto)"));
check("NVU and transient surfaces cannot keep visual proof fresh", policy.includes("transientSurfaceActive || nvuMainActivityForeground") && service.includes("transientForegroundSurfaceActive"));
check("paused/external visual action context is blocked", actionPolicy.includes("if (analysisPausedOutsideGto || transientSurfaceActive || nvuMainActivityForeground) return false;") && actionPolicy.includes("return current.equals(gto) || current.equals(nvu);"));
check("fresh visual proof remains time bounded", policy.includes("now - proofAt <= freshnessWindowMs"));
check("selection freshness has one shared 1.100ms constant", selectionPolicy.includes("MAX_FRESH_LIST_AGE_MS = 1_100L") && selectionPolicy.includes("> MAX_FRESH_LIST_AGE_MS"));
const sharedWindowUses = service.split("GtoSelectionInteractionPolicy.MAX_FRESH_LIST_AGE_MS").length - 1;
check("all selection entrypoints use the shared freshness window", sharedWindowUses >= 3, `uses=${sharedWindowUses}`);
check("marginal pressed frame keeps human-backed panel proof", detector.includes("Do not require aggregate current.hasFreightList() here") && detector.includes("signatureDistance(baseline.panelSignature, current.panelSignature) > 0.026f"));
check("release gate includes HF180 detection touch flow", String(pkg.scripts?.["verify:release"] || "").includes("test:gto-r3.34-hf180-detection-touch-flow"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf180-"));
try {
  const result = spawnSync(
    "java",
    [
      "scripts/java-tests/JavaTestRunner.java",
      tmp,
      "com.nvu.operacional.GtoFreshVisualProofPolicyTest",
      "android/app/src/main/java/com/nvu/operacional/GtoFreshVisualProofPolicy.java",
      "android/app/src/main/java/com/nvu/operacional/GtoVisualActionContextPolicy.java",
      test,
    ],
    { encoding: "utf8" },
  );
  const output = `${result.stderr || ""}\n${result.stdout || ""}`.trim();
  check("fresh visual proof policy compiles", !output.includes("Java compilation failed"), output);
  check("fresh visual proof policy scenarios pass", result.status === 0 && output.includes("GtoFreshVisualProofPolicyTest: PASS 14/14"), output);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF180 detection/touch checks passed.`);
if (failed.length) process.exit(1);
