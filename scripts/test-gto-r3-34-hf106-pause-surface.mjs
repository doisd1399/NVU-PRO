import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const service = fs.readFileSync(
  path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java"),
  "utf8"
);
const checks = [];
function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

check(
  "pause OCR detects only blocking NVU menu overlays",
  service.includes("boolean hadNvuBlockingOverlay = menuView != null")
    && !service.includes("boolean hadNvuTransientOverlay = menuView != null || statusChipView != null")
);
check(
  "overlay-covered frame is discarded",
  service.includes("if (hadNvuBlockingOverlay)")
    && service.includes("lastPauseOcrAt = now;")
    && service.includes("return;")
);
check(
  "clean frame is converted only after overlay check",
  service.indexOf("boolean hadNvuBlockingOverlay") < service.indexOf("Bitmap source = image == null")
);
check(
  "overlay removal preserves bubble and pause prompt",
  service.includes("hidePauseBlockingOverlaysKeepPrompt();")
    && service.includes("PAUSE_* status chip is the driver's durable instruction")
    && !service.includes("hidePauseBlockingOverlaysKeepPrompt();\n            lastPauseOcrAt = now;\n            // The prompt is a durable driver instruction")
);
check(
  "manual fallback remains after automatic attempts",
  service.includes("pauseOcrAttempts >= PAUSE_OCR_MANUAL_FALLBACK_ATTEMPTS")
    && service.includes("armPauseManualFallback(missing, now)")
);
check(
  "cargo pause reader remains independent",
  service.includes("recordPauseCargoRead(pauseCargoOcr")
    && service.includes("pauseCargoConsensusReads")
);

const failed = checks.filter((ok) => !ok).length;
if (failed) {
  console.error(`\n${failed} HF106 check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} HF106 checks passed.`);
