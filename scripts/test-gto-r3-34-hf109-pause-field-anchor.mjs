import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const policyPath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoPauseScreenDetectionPolicy.java");
const servicePath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = fs.readFileSync(policyPath, "utf8");
const service = fs.readFileSync(servicePath, "utf8");
const checks = [];
function check(name, condition) {
  const ok = Boolean(condition);
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

check(
  "generic pause detector remains available",
  policy.includes("static boolean isPauseScreen(List<String> lines)")
);
check(
  "freight-field anchor is a separate predicate",
  policy.includes("static boolean hasFreightFieldAnchor(List<String> lines)")
    && policy.includes('startsWithField(value, "carga")')
    && policy.includes('startsWithField(value, "origem")')
    && policy.includes('startsWithField(value, "destino")')
);
check(
  "generic pause without fields cannot be treated as a freight read",
  service.includes("boolean freightFieldAnchor = GtoPauseScreenDetectionPolicy.hasFreightFieldAnchor(plainLines);")
    && service.includes("if (!freightFieldAnchor)")
    && service.includes("WAITING_FOR_PAUSE_DETAILS")
    && !service.includes("PAUSE_FIELDS_NOT_VISIBLE")
);
check(
  "generic pause keeps one prompt while waiting for details",
  service.includes('putString("pauseReadStatus", "WAITING_FOR_PAUSE_DETAILS")')
    && service.includes('putBoolean("pausePromptVisible", true)')
    && !service.includes("PAUSE_FIELDS_NOT_VISIBLE")
);
check(
  "list false positives require hysteresis",
  service.includes("pauseListEvidenceFrames")
    && service.includes("pauseListEvidenceFrames >= PAUSE_SCREEN_CONFIRM_FRAMES")
);
check(
  "prompt is not a timed toast",
  service.includes('"PAUSE_ACTION_REQUIRED",\n                pauseMessage,\n                0L')
);
check(
  "prompt remains stable during clean-frame handoff",
  service.includes("restorePausePromptAfterCleanFrame")
    && service.includes("hidePauseBlockingOverlaysKeepPrompt();")
    && !service.includes("mainHandler.postDelayed(this::restorePausePromptAfterCleanFrame, 180L")
);
const restoreStart = service.indexOf("private void restorePausePromptAfterCleanFrame()");
const restoreEnd = service.indexOf("private void clearPauseReadState", restoreStart);
const restoreBlock = restoreStart >= 0 && restoreEnd > restoreStart ? service.slice(restoreStart, restoreEnd) : "";
check(
  "restoration keeps the same prompt regardless of prior generic detection",
  restoreBlock.includes("PAUSE_RECOVERY_PROMPT_MESSAGE")
    && restoreBlock.includes('"PAUSE_ACTION_REQUIRED"')
    && !restoreBlock.includes("pauseScreenDetectedAt > 0L ?")
);
const promptStart = service.indexOf("private void maybeAnnouncePausePrompt");
const promptEnd = service.indexOf("private void restorePausePromptAfterCleanFrame", promptStart);
const promptBlock = promptStart >= 0 && promptEnd > promptStart ? service.slice(promptStart, promptEnd) : "";
check(
  "prompt is emitted once instead of periodic blinking",
  promptBlock.includes("if (!pausePromptVisible)")
    && !promptBlock.includes("now - lastPausePromptAt >= PAUSE_PROMPT_REPEAT_MS")
);
check(
  "field-labeled route reaches the existing reader",
  service.includes("FreightOption freight = readPauseFreight(lines, plainLines);")
    && service.includes("if (freight == null)")
);

const failed = checks.filter((ok) => !ok).length;
if (failed) {
  console.error(`\n${failed} HF109 check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} HF109 checks passed.`);
