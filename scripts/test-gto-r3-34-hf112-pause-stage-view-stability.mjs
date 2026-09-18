import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const servicePath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policyPath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoPauseScreenDetectionPolicy.java");
const service = fs.readFileSync(servicePath, "utf8");
const policy = fs.readFileSync(policyPath, "utf8");
const checks = [];
function check(name, condition) {
  const ok = Boolean(condition);
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

const guardStart = service.indexOf("boolean pauseStageVisible = pauseStage");
const guardEnd = service.indexOf("private void acknowledgeDriverStageShown", guardStart);
const guard = guardStart >= 0 && guardEnd > guardStart ? service.slice(guardStart, guardEnd) : "";

check(
  "visible PAUSE stages share one stable chip",
  guard.includes("boolean pauseStageVisible = pauseStage")
    && guard.includes("statusChipIsDriverStage")
    && guard.includes("statusChipView != null")
    && guard.includes("statusChipTextView != null")
    && guard.includes("statusChipTextView.setText(message")
);
check(
  "PAUSE stage updates happen in place without WindowManager recreation",
  guard.includes("if (pauseStageVisible)")
    && guard.includes("statusChipDriverStageKey = key")
    && guard.includes("return;")
);
check(
  "absent PAUSE view can still be recreated for recovery",
  guard.includes("if (statusChipView == null || !statusChipIsDriverStage)")
    && guard.includes("showDriverStageChip(message, durationMs, key")
);
check(
  "prompt clearing remains tied to explicit ineligibility/list evidence",
  service.includes("if (!isPauseRecoveryEligible())")
    && service.includes("pauseListEvidenceFrames >= PAUSE_SCREEN_CONFIRM_FRAMES")
    && service.includes("clearPauseReadState(true)")
);
check(
  "HF111 detailed freight surface remains active",
  service.includes("boolean pauseSurface = pause || freightFieldAnchor;")
    && service.includes("FreightOption freight = readPauseFreight(lines, plainLines);")
    && policy.includes("static boolean hasFreightFieldAnchor(List<String> lines)")
);
check(
  "HF110 no periodic prompt repeat remains active",
  service.includes("if (!pausePromptVisible)")
    && !service.includes("now - lastPausePromptAt >= PAUSE_PROMPT_REPEAT_MS")
);

const failed = checks.filter((ok) => !ok).length;
if (failed) {
  console.error(`\n${failed} HF112 check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} HF112 checks passed.`);
