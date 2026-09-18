import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const detector = read("android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java");
const gradle = read("android/app/build.gradle");
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

check("HF16+ Android identity remains at or above 1.0.68 / 68",
  Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0) >= 68
    && Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/) || [])[1] || 0) >= 68);
check("result no longer depends on dark/color visual gate",
  service.includes("Concluído + monetary value")
    && service.includes("boolean tripCandidateOcrDue = false")
    && !service.includes("tripResultCandidate = resultVisualGate.looksLikeResultDialog"));
check("simple result semantic pair is authoritative",
  service.includes("GtoSimpleScreenDetectionPolicy.isCompletedResult")
    && service.includes("completionWord, !GtoMoneyValue.canonical(result.value).isEmpty()"));
const resultFallbackMs = Number((service.match(/ACTIVE_TRIP_RESULT_FALLBACK_OCR_MS = (\d+)L/) || [])[1] || 0);
check("active trip OCR remains latest-frame oriented with bounded semantic fallback",
  resultFallbackMs >= 250 && resultFallbackMs <= 1800
    && service.includes("acquireLatestImage")
    && !service.includes("tripResultCandidate = resultVisualGate.looksLikeResultDialog"));
check("freight list uses one strong Accept+info row",
  detector.includes("acceptAndInfoAnchorRows")
    && detector.includes("isPlausibleSimpleList"));
check("driver list message waits for semantic freight OCR",
  service.includes("freightSemanticConfirmedAt")
    && service.includes("raw button geometry updates the internal screen state immediately"));
check("reopened visual list during trip cannot mutate an unarmed active trip",
  service.includes("FREIGHT_LIST_INFORMATIONAL_DURING_TRIP")
    && service.includes("only an explicitly armed")
    && service.includes("return false;"));
const promotionStart = service.indexOf("private boolean promoteReplacementFreightCandidateToWaiting(\n        boolean fromTouch,");
const promotionEnd = service.indexOf("private void clearReplacementFreightCandidate", promotionStart);
const promotion = promotionStart >= 0 && promotionEnd > promotionStart ? service.slice(promotionStart, promotionEnd) : "";
check("new Accept discards old snapshot only inside validated promotion",
  promotion.includes("mayReplaceCancelledTripOnNewAccept")
    && promotion.includes("GtoAutoTripSync.discardSessionSnapshot(this, cancelledSessionId)"));
check("selection identity protections remain",
  service.includes("GtoSelectionIdentityPolicy.resolveRow")
    && service.includes("exactConsistentRowForTouch"));
check("automatic sync/ACK remain present",
  service.includes("GtoAutoTripSync.enqueueConfirmedTrip")
    && service.includes("automaticTripSyncListener"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf16-"));
try {
  const run = spawnSync("java", [
    "scripts/java-tests/JavaTestRunner.java", tmp,
    "com.nvu.operacional.GtoR334Hf16SimpleFlowPolicyTest",
    "android/app/src/main/java/com/nvu/operacional/GtoSimpleScreenDetectionPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoR334Hf16SimpleFlowPolicyTest.java",
  ], { encoding: "utf8" });
  const out = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
  check("HF16 policy fixtures compile", !out.includes("Java compilation failed"), out);
  check("HF16 cancellation/result scenarios pass", run.status === 0 && String(run.stdout || "").includes("PASS"), out);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF16 checks passed.`);
if (failed.length) process.exit(1);
