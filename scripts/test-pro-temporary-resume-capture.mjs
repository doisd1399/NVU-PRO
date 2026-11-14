import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(path, "utf8");
const dialog = read("src/components/GtoWorkModeDialog.tsx");
const launcher = read("src/services/simpleAutomationLauncher.ts");
const probePlugin = read("android/app/src/main/java/com/nvu/operacional/ProOverlayProbePlugin.java");
const probeService = read("android/app/src/main/java/com/nvu/operacional/ProOverlayProbeService.java");
const probeActivity = read("android/app/src/main/java/com/nvu/operacional/ProOverlayProbeActivity.java");
const service = read("android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java");
const submission = read("android/app/src/main/java/com/nvu/operacional/SimpleProNativeSubmissionCoordinator.java");

assert.match(dialog, /if \(existing\.active\)\s*\{\s*await onSelect\("simple"\);/);
assert.match(dialog, /if \(pro\.persistentOverlayPermission\)\s*\{\s*await onSelect\("simple"\);/);
assert.match(dialog, /result\.stage === "ALREADY_GRANTED"/);
assert.match(dialog, /if \(startedHere\) await ProOverlayProbe\.stop/);
assert.match(launcher, /const sameOperation = pendingStatus\.simulatorKey === simulator\.key/);
assert.match(launcher, /if \(pendingStatus\.persistentOverlayPermission \|\| temporaryProjection\?\.active\)/);
assert.match(launcher, /const resumed = await SimpleAutomation\.openSimulator/);
assert.match(probePlugin, /if \(ProOverlayProbeService\.isActive\(\)\)\s*\{\s*call\.resolve\(status\(\)\)/);
assert.match(probePlugin, /result\.put\("active", active\)/);
assert.match(probeActivity, /if \(ProOverlayProbeService\.isActive\(\)\)/);
assert.match(probeService, /active\.ready && !active\.finished/);
assert.match(probeService, /"Encerrar Modo Pro"/);
assert.match(probeService, /SimpleAutomationService\.ACTION_STOP/);
assert.match(service, /attachTemporaryReceiptCapture\(2\)/);
assert.match(service, /CAPTURE_WATCHDOG_MS = 30000L/);
assert.match(service, /CAPTURE_OCR_HARD_LIMIT_MS = 45000L/);
assert.doesNotMatch(service, /failCapture\("Tempo limite da captura excedido"\)/);
assert.match(service, /if \(amountReady && semanticReady\)/);
assert.match(submission, /GtoResultOcrConsensusPolicy\.isSemanticallyComplete\(simulatorKey, rawText\)/);

console.log("PASS: retomada da sessão Pro, encerramento pela notificação, captura limitada e validação do resultado");
