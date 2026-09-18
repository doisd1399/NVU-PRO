import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoBubbleDismissPolicy.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");
const pkg = JSON.parse(read("package.json"));
const checks = [];
const check = (name, ok) => { checks.push({name, ok: !!ok}); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };

const currentCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const currentPatch = Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/) || [])[1] || 0);
check("HF31 Android identity preserved or advanced", currentCode >= 83 && currentPatch >= 83);
check("HF31 workflow identity preserved or advanced", workflow.includes(`EXPECTED_VERSION_CODE: "${currentCode}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "1.0.${currentPatch}"`));
check("HF31 release gate registered", String(pkg.scripts?.["verify:release"] || "").includes("test:gto-r3.34-hf31-bubble-lifecycle"));
check("gesture lifecycle is service-scoped", service.includes("bubbleActiveGestureGeneration") && service.includes("bubbleGesturePointerId") && service.includes("bubbleGestureExpiryRunnable"));
check("orphan gestures have a bounded lease", service.includes("BUBBLE_GESTURE_IDLE_TIMEOUT_MS") && service.includes("expireBubbleGestureIfStale(now)") && policy.includes("shouldExpireGesture"));
check("detached overlay invalidates destructive gesture", service.includes('cancelBubbleGesture("BUBBLE_DETACHED", true)'));
check("task removal invalidates destructive gesture", service.includes('cancelBubbleGesture("TASK_REMOVED", true)'));
check("ACTION_CANCEL and multipointer are fail-safe", service.includes('cancelBubbleGesture("ACTION_CANCEL", false)') && service.includes('cancelBubbleGesture("MULTI_POINTER", true)'));
check("gesture lifecycle remains bounded across GTO context changes",
  service.includes("bubbleGestureStartedOutsideGto = !isCurrentBubbleGtoContext(now)")
    && service.includes('disarmBubbleStopForCurrentGesture("GTO_FOREGROUND")')
    && service.includes("showBubbleRemoveTarget(bubbleActiveGestureGeneration)"));

check("remove target is bound to gesture generation", service.includes("bubbleRemoveTargetGestureGeneration = gestureGeneration") && service.includes("bubbleRemoveTargetGestureGeneration == releaseGeneration"));
check("stop requires pointer generation highlight geometry and freshness", service.includes("GtoBubbleDismissPolicy.canCommitStop(") && policy.includes("pointerMatches") && policy.includes("generationMatches") && policy.includes("targetHighlighted") && policy.includes("geometryInside") && policy.includes("releaseFreshnessMs"));
check("gesture invalidates before stop dispatch", service.indexOf('cancelBubbleGesture("ACTION_UP", false)') < service.indexOf("stopObserverFromFloatingBubble(releaseGeneration)"));
const stopCalls = [...service.matchAll(/stopObserverFromFloatingBubble\(/g)].length;
check("floating stop has a single authorized call site", stopCalls === 2);
check("HF30 projection supervisor remains present", service.includes("GtoProjectionContinuityPolicy") && service.includes("maybeRecoverProjectionFrameDelivery(now)"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf31-"));
let r = spawnSync("javac", ["-encoding", "UTF-8", "-d", tmp,
  "android/app/src/main/java/com/nvu/operacional/GtoBubbleDismissPolicy.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf31BubbleLifecyclePolicyTest.java"
], {encoding:"utf8"});
if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
check("HF31 bubble lifecycle policy compiles", r.status === 0);
if (r.status === 0) {
  r = spawnSync("java", ["-cp", tmp, "com.nvu.operacional.GtoHf31BubbleLifecyclePolicyTest"], {encoding:"utf8"});
  if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
  check("HF31 bubble lifecycle scenarios pass", r.status === 0 && String(r.stdout || "").includes("PASS"));
} else {
  check("HF31 bubble lifecycle scenarios pass", false);
}
fs.rmSync(tmp, {recursive:true, force:true});

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF31 bubble-lifecycle checks passed.`);
if (failed.length) process.exit(1);
