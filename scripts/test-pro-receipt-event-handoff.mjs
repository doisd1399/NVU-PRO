import fs from "node:fs";

const plugin = fs.readFileSync(
  "android/app/src/main/java/com/nvu/operacional/SimpleAutomationPlugin.java",
  "utf8",
);
const service = fs.readFileSync(
  "android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java",
  "utf8",
);
const nativeContract = fs.readFileSync("src/lib/simpleAutomationNative.ts", "utf8");
const bridge = fs.readFileSync("src/components/SimpleAutomationCompletionBridge.tsx", "utf8");
const completion = fs.readFileSync("src/services/simpleAutomationCompletionService.ts", "utf8");

function check(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}

check("native plugin exposes receiptCaptured event", plugin.includes('notifyListeners("receiptCaptured"') && plugin.includes("emitReceiptCaptured"));
check("service emits only after CAPTURE_CAPTURED is persisted", service.indexOf('putString("simpleState", readable ? "CAPTURE_CAPTURED"') < service.indexOf("SimpleAutomationPlugin.emitReceiptCaptured()"));
check("Web contract exposes native event listener", nativeContract.includes('addListener(eventName: "receiptCaptured"'));
check("bridge registers receiptCaptured listener", bridge.includes('SimpleAutomation.addListener("receiptCaptured"'));
check("bridge keeps polling fallback", bridge.includes("window.setInterval(requestPoll, 200)"));
check("bridge coalesces event while a poll is running", bridge.includes("pendingPoll.current") && bridge.includes("running.current"));
check("duplicate receipt remains guarded", bridge.includes("handledReceiptKey.current === receiptKey") && bridge.includes("handledReceiptKey.current = receiptKey"));
const addDocIndex = completion.indexOf("completeTripWithCoordinator");
const ackIndex = completion.indexOf("acknowledgeReceipt");
check("durability still precedes ACK", addDocIndex >= 0 && ackIndex > addDocIndex);
check("reconciliation remains deferred except for terminal completion", completion.includes("operationWillClose") && completion.includes("deferOperationReconciliation: !operationWillClose"));

console.log("pro-receipt-event-handoff: PASS immediate event, polling fallback, coalesced recovery, terminal-aware durable ACK order");
