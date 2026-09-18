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

const promptStart = service.indexOf("private void maybeAnnouncePausePrompt");
const promptEnd = service.indexOf("private void clearPauseReadState", promptStart);
const promptBlock = promptStart >= 0 && promptEnd > promptStart ? service.slice(promptStart, promptEnd) : "";
const ocrStart = service.indexOf("private void handlePauseScreenOcr");
const ocrEnd = service.indexOf("private void armPauseManualFallback", ocrStart);
const ocrBlock = ocrStart >= 0 && ocrEnd > ocrStart ? service.slice(ocrStart, ocrEnd) : "";
const restoreStart = service.indexOf("private void restorePausePromptAfterCleanFrame");
const restoreEnd = service.indexOf("private void clearPauseReadState", restoreStart);
const restoreBlock = restoreStart >= 0 && restoreEnd > restoreStart ? service.slice(restoreStart, restoreEnd) : "";

check(
  "pre-validation has one stable prompt constant",
  service.includes("PAUSE_RECOVERY_PROMPT_MESSAGE")
    && service.includes("String pauseMessage = PAUSE_RECOVERY_PROMPT_MESSAGE")
    && restoreBlock.includes("PAUSE_RECOVERY_PROMPT_MESSAGE")
    && !restoreBlock.includes("Pause detectado. Abra a tela de detalhes")
);
check(
  "generic menu does not advance to detected pause or change the prompt",
  ocrBlock.includes("if (!freightFieldAnchor)")
    && ocrBlock.includes("WAITING_FOR_PAUSE_DETAILS")
    && !ocrBlock.includes("PAUSE_FIELDS_NOT_VISIBLE")
    && !ocrBlock.includes("PAUSE_SCREEN_DETECTED")
);
check(
  "only current field anchors establish pause-details evidence",
  ocrBlock.includes("if (pauseScreenDetectedAt <= 0L)")
    && ocrBlock.includes("PAUSE_DETAILS_DETECTED")
    && ocrBlock.includes("FreightOption freight = readPauseFreight(lines, plainLines);")
);
check(
  "normal gameplay invalidates old pause evidence immediately",
  ocrBlock.includes("if (!pauseSurface)")
    && ocrBlock.includes("pauseScreenEvidenceFrames = 0;")
    && ocrBlock.includes("pauseScreenLastFrameAt = 0L;")
    && ocrBlock.includes("pauseScreenDetectedAt = 0L;")
    && ocrBlock.includes("remove(\"pauseScreenDetectedAt\")")
);
check(
  "prompt remains durable and non-periodic",
  promptBlock.includes("PAUSE_ACTION_REQUIRED")
    && promptBlock.includes("0L")
    && promptBlock.includes("if (!pausePromptVisible)")
    && !promptBlock.includes("now - lastPausePromptAt >= PAUSE_PROMPT_REPEAT_MS")
);
check(
  "detail page still uses real field anchors",
  policy.includes("static boolean hasFreightFieldAnchor(List<String> lines)")
    && service.includes("boolean freightFieldAnchor = GtoPauseScreenDetectionPolicy.hasFreightFieldAnchor(plainLines);")
);
check(
  "automatic confirmation still requires complete read and backend-safe lock",
  service.includes("if (freight == null)")
    && service.includes("GtoAutoTripSync.lockSelectedFreight(this, prefs)")
    && service.includes("transitionConfirmedFreightToTripInProgress();")
);
check(
  "completed-trip registration remains ACK-gated",
  service.includes("STATUS_SYNCED")
    && service.includes("tripId")
    && service.includes("beginTrip(false, false)")
);

const failed = checks.filter((ok) => !ok).length;
if (failed) {
  console.error(`\n${failed} HF114 check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} HF114 checks passed.`);
