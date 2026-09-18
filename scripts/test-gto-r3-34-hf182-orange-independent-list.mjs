import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const semantic = read("android/app/src/main/java/com/nvu/operacional/GtoFreightSemanticCertificationPolicy.java");
const selection = read("android/app/src/main/java/com/nvu/operacional/GtoSelectionInteractionPolicy.java");
const test = "scripts/java-tests/com/nvu/operacional/GtoFreightTextOnlyCertificationPolicyTest.java";
const gradle = read("android/app/build.gradle");
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
check("HF182 source identity is prepared for a later release", code >= 259);
check("OCR callback accepts current WAITING_FREIGHT state", service.includes("if (STATE_WAITING_FREIGHT.equals(state))")
  && service.includes("handleOcrResult(text, analysisScale, offsetX, offsetY, fullFrameForGeometry, scheduledOcrAt)"));
check("OCR callback rejects stale closed-list work", service.includes("scheduledAt >= freightListCycleClosedAt")
  && service.includes("lastFreightTextAcceptedAt"));
check("text-only certification is bounded and repeated", semantic.includes("isCertifiedTextOnlyPage")
  && semantic.includes("parsedRowCount < 1 || parsedRowCount > 6")
  && semantic.includes("Math.min(2, parsedRowCount)"));
check("visual orange is not required for text-only certification", service.includes("boolean textOnlyFallback = visualButtons == null || visualButtons.isEmpty()")
  && service.includes("isCertifiedTextOnlyPage(\n                    parsedOptions.size(), textOnlyAnchors"));
check("OCR fallback publishes row geometry only after certification", service.includes("publishOcrFreightListGeometry(stableOptions, fullFrame, ocrNow)")
  && service.includes("putString(\"freightDetectionSource\", textOnlyFallback ? \"OCR_TEXT_GEOMETRY\" : \"VISUAL_GEOMETRY\")"));
check("OCR-derived targets remain bounded by exact human touch", service.includes("exact-outside-touch+ocr-row")
  && service.includes("exactConsistentRowFromOutsideTouch(ocrButtons)"));
check("list disappearance still requires a stable close edge", service.includes("now - lastFreightListSeenAt >= 72L")
  && service.includes("confirmPreciseTouchCandidateOnListExit(now, true)"));
check("fast path is not weakened into visual-only selection", service.includes("if (!fastTouchPulseActive && !fastPendingFromTouchPulse)")
  && service.includes("SELECTION_BLOCKED_NO_HUMAN_ACTION"));
check("existing freshness gate accepts OCR row geometry as current candidate", service.includes("OCR_TEXT_GEOMETRY")
  && selection.includes("MAX_FRESH_LIST_AGE_MS = 1_100L"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf182-"));
try {
  const run = spawnSync("java", [
    "scripts/java-tests/JavaTestRunner.java", tmp,
    "com.nvu.operacional.GtoFreightTextOnlyCertificationPolicyTest",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoManualRouteSelectionPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightSemanticCertificationPolicy.java",
    test,
  ], { cwd: root, encoding: "utf8" });
  const detail = `${run.stderr || ""}\n${run.stdout || ""}`.trim();
  check("text-only certification policy compiles", run.status === 0, detail);
  check("text-only certification scenarios pass", run.status === 0
    && detail.includes("GtoFreightTextOnlyCertificationPolicyTest: PASS"), detail);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF182 orange-independent-list checks passed.`);
if (failed.length) process.exit(1);
