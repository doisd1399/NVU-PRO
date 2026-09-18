import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const detector = read("android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java");
const evidence = read("android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java");
const semantic = read("android/app/src/main/java/com/nvu/operacional/GtoFreightSemanticCertificationPolicy.java");
const simple = read("android/app/src/main/java/com/nvu/operacional/GtoSimpleScreenDetectionPolicy.java");
const checks = [];
const ck = (name, ok, detail = "") => {
  checks.push([name, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

ck("multi-row visual list requires repeated strong card anchors",
  evidence.includes("requiredAnchors") && evidence.includes("Math.min(2, rowCount)")
  && detector.includes("dark >= 0.68f") && detector.includes("green >= 0.0050f")
  && detector.includes("GtoFreightListEvidencePolicy.isPlausibleList"));
ck("multi-row semantic page rejects a single accidental anchor",
  semantic.includes("int requiredAnchors = visualRowCount == 1 ? 1 : Math.min(2, visualRowCount)"));
ck("destructive lifecycle has an explicit complete semantic authority gate",
  semantic.includes("isCertifiedLifecycleBoundaryPage") && semantic.includes("sameRowCompleteAnchors >= 1"));
ck("active-trip visual candidate is non-destructive",
  service.includes('"FREIGHT_LIST_VISUAL_CANDIDATE"')
  && service.includes("scheduleReplacementFreightSemanticCertification(now)")
  && service.includes("if (!semanticBoundary || (!stableReturnedList && !fastHumanBoundary)) return false;"));
ck("promotion cannot execute without fresh semantic certification",
  service.includes("if (!isReplacementFreightSemanticFresh(promotionNow)) return false;"));
ck("semantic certification is taken from the frozen right-panel snapshot",
  service.includes("replacementFreightPanelFrame.copy")
  && service.includes("parseFreightOptions(lines, buttonCopy)")
  && service.includes("semanticFreightCompleteAnchorRows(parsed)"));
ck("false visual page is quarantined instead of controlling the touch sensor",
  service.includes("replacementFreightSemanticRejectedAt <= 0L")
  && service.includes("ACTIVE_TRIP_FREIGHT_SEMANTIC_REJECT_BACKOFF_MS"));
ck("screen policy explicitly requires visual plus semantic agreement",
  simple.includes("isCertifiedFreightListReturn") && simple.includes("return semanticListCertified && isStableFreightListReturn"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf35-"));
try {
  const run = spawnSync("java", [
    "scripts/java-tests/JavaTestRunner.java", tmp,
    "com.nvu.operacional.GtoHf35FreightListAuthorityPolicyTest",
    "scripts/java-tests/android/graphics/Rect.java",
    "scripts/java-tests/android/media/Image.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
    "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
    "android/app/src/main/java/com/nvu/operacional/GtoManualRouteSelectionPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightSemanticCertificationPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoSimpleScreenDetectionPolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoHf35FreightListAuthorityPolicyTest.java"
  ], { cwd: root, encoding: "utf8" });
  const detail = `${run.stderr || ""} ${run.stdout || ""}`.trim();
  ck("HF35 authority policies compile", run.status === 0, detail);
  ck("HF35 HUB/list authority scenarios pass", run.status === 0 && String(run.stdout || "").includes("PASS"), detail);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF35 freight-list authority checks passed.`);
if (failed.length) process.exit(1);
