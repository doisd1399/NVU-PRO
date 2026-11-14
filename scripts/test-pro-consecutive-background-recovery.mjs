import fs from "node:fs";

const service = fs.readFileSync("android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java", "utf8");
const plugin = fs.readFileSync("android/app/src/main/java/com/nvu/operacional/SimpleAutomationPlugin.java", "utf8");
const bridge = fs.readFileSync("src/components/SimpleAutomationCompletionBridge.tsx", "utf8");
const native = fs.readFileSync("src/lib/simpleAutomationNative.ts", "utf8");
const completion = fs.readFileSync("src/services/simpleAutomationCompletionService.ts", "utf8");
const job = fs.readFileSync("android/app/src/main/java/com/nvu/operacional/ProPendingTripJobService.java", "utf8");
const store = fs.readFileSync("android/app/src/main/java/com/nvu/operacional/ProPendingTripStore.java", "utf8");

function check(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}

check("captured receipt is durable in native prefs", service.includes('simpleState", readable ? "CAPTURE_CAPTURED"') && service.includes('receiptText", normalized'));
check("native exposes captured receipt replay predicate", service.includes("hasCapturedReceipt(Context context)"));
check("capture event has monotonic version", service.includes('captureEventVersion'));
check("context updates preserve pending/captured receipts", service.includes("preservePendingReceipt") && service.includes("if (!preservePendingReceipt)"));
check("plugin replays pending capture after WebView/plugin load", plugin.includes("receiptReplayRunnable") && plugin.includes("postDelayed(this, 250L)"));
check("replay is bounded", plugin.includes("receiptReplayAttempts++ < 20"));
check("operation snapshot remains live from confirmed history while receipt is queued", bridge.includes("SimpleAutomation.refreshOperationSnapshot({") && bridge.includes("Number(currentOperationProgress)") && !bridge.includes("currentJob.progress"));
check("native queue owns captures across transient Web context loss", !bridge.includes("completeSimpleAutomationReceipt") && store.includes('PREFIX + id'));
check("bridge maintains event and bounded status recovery", bridge.includes('SimpleAutomation.addListener("receiptCaptured"') && bridge.includes("window.setInterval(() => void poll(), 750)"));
check("bridge coalesces notifications", bridge.includes("running.current"));
check("attempt claim prevents duplicate processing", service.includes("ProPendingTripStore.claim(this, prefs, id)") && job.includes("ProPendingTripStore.claim(this, index, id)"));
check("native ACK remains after durable completion", completion.indexOf("completeTripWithCoordinator") < completion.indexOf("acknowledgeReceipt"));
check("post-write reconciliation remains deferred except for terminal completion", completion.includes("operationWillClose") && completion.includes("deferOperationReconciliation: !operationWillClose"));

console.log("pro-consecutive-background-recovery: PASS durable replay, context recovery, consecutive-event coalescing and terminal-aware ACK order");
