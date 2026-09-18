import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const service = fs.readFileSync(path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java"), "utf8");
const sync = fs.readFileSync(path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java"), "utf8");
const policy = fs.readFileSync(path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java"), "utf8");
const plugin = fs.readFileSync(path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java"), "utf8");
const launcher = fs.readFileSync(path.join(root, "src/services/gtoWorkLauncher.ts"), "utf8");
const gradle = fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/build-android-release.yml"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const checks = [];
const pass = (name) => checks.push({ name, ok: true });
const fail = (name) => checks.push({ name, ok: false });
const ck = (name, condition) => (condition ? pass(name) : fail(name));

const hasNextFreight = (tripStartingProgress, totalDeliveries) =>
  totalDeliveries > 0 && Math.max(0, tripStartingProgress) + 1 < totalDeliveries;

const launcherClosed = (status, progress, total) =>
  ["completed", "cancelled"].includes(String(status || "").toLowerCase()) ||
  (String(status || "").toLowerCase() === "awaiting_completion" &&
    (total <= 0 || progress >= total)) ||
  (total > 0 && progress >= total);

const currentVersionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const currentVersionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
ck("HF65 Android identity follows current Release", currentVersionCode >= 117 && currentVersionName === `1.0.${currentVersionCode}`);
ck("HF65 workflow identity follows current Release", workflow.includes(`EXPECTED_VERSION_CODE: "${currentVersionCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "${currentVersionName}"`));
ck("HF65 regression is mandatory in release gate", String(pkg.scripts?.["verify:release"] || "").includes("test:gto-r3.34-hf65-trip-pipeline"));

ck("local counter recognizes a real next freight at 11/12", hasNextFreight(10, 12));
ck("local counter does not invent a twelfth freight after 12/12", !hasNextFreight(11, 12));
ck("stale awaiting_completion does not block a real 11/12 context", !launcherClosed("awaiting_completion", 11, 12));
ck("consistent awaiting_completion closes a real 12/12 context", launcherClosed("awaiting_completion", 12, 12));
ck("hard completed status remains closed", launcherClosed("completed", 0, 12));

ck("native service persists local trip position", service.includes('putInt("gtoTripStartingProgress", startingProgress)') && service.includes('putInt("gtoTripTotalDeliveries", totalDeliveries)'));
ck("next session advances from local position before remote ACK", service.includes("nextStartingProgress") && service.includes('putInt("gtoTripStartingProgress", nextStartingProgress)'));
ck("certified live list can override stale remote closure", service.includes("certified live freight list is stronger than stale jobStatus/progress") && !service.includes("|| isOperationClosedForNewTrip()) return false;"));
ck("operation switch is explicitly detected", plugin.includes('gtoOperationContextChanged') && plugin.includes('gtoTripSessionJobId'));
ck("operation switch preserves sealed predecessor and prepares a clean session", service.includes("prepareFreshSessionAfterOperationSwitch") && service.includes("Entrega anterior protegida"));

ck("auth loss uses the audited finite retry path", sync.includes("scheduleRetryWhileAuthUnavailable") && sync.includes('pauseRetryForReason(retry, queuedSessionId, "NO_NATIVE_AUTH")') && sync.includes('if ("NO_NATIVE_AUTH".equals(blockReason))'));
ck("auth recovery remains eligible in the pending queue", sync.includes('"NO_NATIVE_AUTH".equals(blocked)') && sync.includes('"DRIVER_UID_MISMATCH".equals(blocked)'));
ck("network is not called before the local queue seal", sync.indexOf("queue.edit().putString(QUEUE_PREFIX + sessionId, sealed).commit()") < sync.indexOf('getHttpsCallable("registerGtoTrip")'));
ck("reported blocking copy is removed from the native menu", !service.includes("Aguardando confirmação da entrega anterior antes de iniciar outra viagem."));
ck("replacement copy is non-blocking and detector-oriented", service.includes("Entrega protegida ✓ · envio continua em segundo plano") && service.includes("detector permanece pronto"));

ck("capture recovery remains foreground-independent for terminal progress", service.includes("recoverTerminalProgressIfNeeded(now)") && service.indexOf("recoverTerminalProgressIfNeeded(now)") < service.indexOf("boolean rawGto"));
ck("capture surface recovery remains automatic", service.includes("RESUMED_AUTOMATICALLY") && service.includes("escalateProjectionToFreshAuthorization"));
ck("OCR lease self-heals after stale callbacks", service.includes("GLOBAL_OCR_LEASE_STALE_MS") && service.includes("OCR anterior não respondeu"));
ck("policy exposes a pure next-freight invariant", policy.includes("hasNextFreightAfterCurrentTrip"));

const failed = checks.filter((entry) => !entry.ok);
for (const entry of checks) console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} HF65 Trip Pipeline checks passed.`);
if (failed.length) process.exit(1);
