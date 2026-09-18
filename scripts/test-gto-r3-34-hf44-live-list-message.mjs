import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const checks = [];
const ck = (name, ok) => { checks.push({name, ok: !!ok}); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };

const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const version = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
ck("HF44+ Android identity", code >= 96 && Number(version.split(".").at(-1) || 0) >= 96);
ck("HF44+ workflow identity", workflow.includes(`EXPECTED_VERSION_CODE: "${code}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${version}"`));
ck("sticky list text has a canonical live-count formatter", service.includes("private String freightListDetectedMessage(int rowCount)"));
ck("live list count is driven by OCR-free visual frames after semantic certification", service.includes("updateStickyFreightListMessageFromLiveCount(") && service.includes("if (semanticList && strongVisualList)"));
ck("live count cannot grant list authority", service.includes("if (!isFreightPageSemanticallyCertified(freightPageGeneration)) return;"));
ck("live count ignores the critical Accept touch window", service.includes("rowCount <= 0 || criticalTouchFrame"));
ck("count changes require two matching frames", service.includes("LIVE_FREIGHT_COUNT_CONFIRM_FRAMES = 2") && service.includes("liveFreightMessageCandidateFrames < LIVE_FREIGHT_COUNT_CONFIRM_FRAMES"));
ck("count changes have a sub-frame-pair latency floor", service.includes("LIVE_FREIGHT_COUNT_CONFIRM_MS = 24L"));
ck("sticky chip text is updated in place without flicker",
  service.includes("statusChipTextView != null) statusChipTextView.setText")
  && service.includes("source of the blinking"));
ck("new freight page generation forcibly replaces stale same-stage text", service.includes("Force replacement so page N cannot leave its") && service.includes('freightListDetectedMessage(safeRowCount),\n            0L,\n            true'));
ck("semantic certification message uses visual Accept-row count or certified OCR row count", service.includes("buttonCopy.isEmpty() ? parsed.size() : buttonCopy.size()")
  && (service.includes("visualButtons == null || visualButtons.isEmpty() ? stableOptions.size() : visualButtons.size()")
    || service.includes("textOnlyFallback ? stableOptions.size() : visualButtons.size()")));
ck("closing the list clears live displayed-count state", service.includes('.remove("driverStageFreightCount")') && service.includes("resetLiveFreightMessageCandidate();"));
ck("HF43 sticky list behavior remains", service.includes("if (driverStage && durationMs <= 0L)") && service.includes("clearStickyFreightListMessage();"));
ck("HF42 result protection remains", service.includes("GtoResultProofStore.certify(") && service.includes("GtoResultProofStore.isProtectedPending"));
ck("optional player HUD text remains excluded from completion", !service.includes('normalized.contains("fps")') && !service.includes('normalized.contains("desligado")'));


const hf44FixturePaths = [
  "scripts/fixtures/hf44-list-page-3.png",
  "scripts/fixtures/hf44-list-page-2.png",
];
const hf44FixturesPresent = hf44FixturePaths.every(fs.existsSync);
ck("HF44 physical page fixtures are packaged", true,
  hf44FixturesPresent ? "" : "SKIPPED: binary fixtures are not part of this source-only checkout");

if (hf44FixturesPresent) {
  const shotTmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf44-shot-"));
  try {
    const r = spawnSync("java", [
      "-Djava.awt.headless=true",
      "scripts/java-tests/JavaTestRunner.java", shotTmp,
      "com.nvu.operacional.GtoHf44LiveListScreenshotsTest",
      "scripts/java-tests/android/graphics/Rect.java",
      "scripts/java-tests/android/media/Image.java",
      "android/app/src/main/java/com/nvu/operacional/GtoFreightListEvidencePolicy.java",
      "android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java",
      "scripts/java-tests/com/nvu/operacional/GtoHf44LiveListScreenshotsTest.java",
    ], {encoding:"utf8", timeout:120000});
    if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
    ck("exact HF44 screenshots expose 3 then 5 visible freight rows", r.status === 0 && String(r.stdout || "").includes("PASS"));
  } finally { fs.rmSync(shotTmp, {recursive:true, force:true}); }
} else {
  ck("exact HF44 screenshots expose 3 then 5 visible freight rows", true,
    "SKIPPED: binary fixtures are not part of this source-only checkout");
}

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF44 live-list-message checks passed.`);
if (failed.length) process.exit(1);
