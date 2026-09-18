import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const layout = read("android/app/src/main/java/com/nvu/operacional/GtoOverlayLayoutPolicy.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const pkg = JSON.parse(read("package.json"));
const checks = [];
const ck = (name, ok) => { checks.push({ name, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };

const currentCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const currentVersion = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
const currentPatch = Number((currentVersion.match(/^1\.0\.(\d+)$/) || [])[1] || 0);
ck("HF56+ Android identity", currentCode >= 108 && currentPatch >= 108);
ck("HF56+ workflow identity", workflow.includes(`EXPECTED_VERSION_CODE: "${currentCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${currentVersion}"`));
ck("HF56 release regression is registered", String(pkg.scripts["verify:release"] || "").includes("test:gto-r3.34-hf56-bubble-position"));
ck("fresh bubble waits for stable landscape geometry", service.includes("BUBBLE_LAYOUT_LANDSCAPE_SETTLE_MS") && service.includes("WAITING_STABLE_GTO_LANDSCAPE") && service.includes("isBubbleLandscapeGeometryStable"));
ck("first pointer rebases stale layout before gesture origin", service.indexOf('rebaseBubbleLayoutForCurrentDisplay(false, "POINTER_DOWN_REBASE")') < service.indexOf("beginBubbleGesture(event, now)"));
ck("fresh install uses the calibrated reference HUD anchor", service.includes("GtoOverlayLayoutPolicy.referenceTopX(") && service.includes("GtoOverlayLayoutPolicy.referenceTopY(") && !layout.includes("0.50f") && !service.includes('prefs.getInt("bubbleY", Math.max(dp(80), metrics.heightPixels / 3))'));
ck("legacy portrait coordinate cannot override startup reference", service.includes("Every attach starts at the visual reference anchor") && service.includes("saved user position is") && service.includes("shouldRestoreSavedPositionAfterStartup") && service.includes('"USER_DRAG_GTO_LANDSCAPE"'));
ck("preferred GTO position is normalized", service.includes("bubbleGtoXNorm") && service.includes("bubbleGtoYNorm") && layout.includes("normalizedPosition") && layout.includes("positionFromNormalized"));
ck("only a landscape GTO drag persists favorite position", service.includes("if (!gtoForeground || metrics.widthPixels <= metrics.heightPixels) return;") && service.includes("wasDragging && !bubbleGestureStartedOutsideGto"));
ck("attached bubble is restored after orientation return", service.includes("reconcileBubbleForStableGtoGeometry(now)") && service.includes('rebaseBubbleLayoutForCurrentDisplay(true, "GTO_LANDSCAPE_RESTORED")'));
ck("HF55 return-result recovery remains present", String(pkg.scripts["verify:release"] || "").includes("test:gto-r3.34-hf55-return-result-recovery") && service.includes("RETURN_RESULT_PROBE_OCR_INTERVAL_MS"));
ck("destructive outside-GTO drag policy remains intact", service.includes("GtoBubbleDismissPolicy.canCommitStop(") && service.includes("Remover e parar NVU"));
ck("1.0.203 short-tap card interaction restored", service.includes("toggleAutomationFromFloatingButton()") && service.includes("if (!longPress) toggleAutomationFromFloatingButton()"));
ck("1.0.203 long-press card opening restored", service.includes("bubbleLongPressRunnable") && service.includes("postDelayed(bubbleLongPressRunnable, 520L)") && service.includes("bubbleLongPressTriggered = true") && service.includes("openMenu()"));
ck("1.0.203 compact translucent bubble visual restored", service.includes("bubbleLabelView = label") && service.includes("makeNvuBubbleBackground(false)") && service.includes("setContentDescription(\"NVU · tocar para abrir ou fechar os cards da operação\")") && service.includes("final int buttonWidth = dp(68)") && service.includes("final int buttonHeight = dp(32)"));
ck("operation view switch and return label restored", service.includes("if (!operationSummaryExpanded)") && service.includes('menuButton(operationSummaryExpanded ? "Voltar ao frete atual" : "Operação atual")') && (service.includes('operationSummary.setText("Operação atual\\n" + operationSummaryValue);') || service.includes('operationTitle.setText("Operação atual")')));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf56-"));
let r = spawnSync("javac", ["-encoding", "UTF-8", "-d", tmp,
  "android/app/src/main/java/com/nvu/operacional/GtoOverlayLayoutPolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf56BubblePositionPolicyTest.java"
], { encoding: "utf8" });
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
ck("HF56 position policy compiles", r.status === 0);
if (r.status === 0) {
  r = spawnSync("java", ["-cp", tmp, "com.nvu.operacional.GtoHf56BubblePositionPolicyTest"], { encoding: "utf8" });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  ck("HF56 position policy scenarios pass", r.status === 0 && String(r.stdout || "").includes("PASS"));
} else {
  ck("HF56 position policy scenarios pass", false);
}
fs.rmSync(tmp, { recursive: true, force: true });

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF56 bubble-position checks passed.`);
if (failed.length) process.exit(1);
