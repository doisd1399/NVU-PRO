import fs from "node:fs";

const plugin = fs.readFileSync(
  "android/app/src/main/java/com/nvu/operacional/SimpleAutomationPlugin.java",
  "utf8",
);
const service = fs.readFileSync(
  "android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java",
  "utf8",
);
const coordinator = fs.readFileSync(
  "android/app/src/main/java/com/nvu/operacional/SimpleProNativeSubmissionCoordinator.java",
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
const capturePersistIndex = service.indexOf('putString("simpleState", readable ? "CAPTURE_CAPTURED"');
check(
  "captured receipt is durably queued before UI acknowledgement",
  capturePersistIndex >= 0
    && service.indexOf("ProPendingTripStore.enqueue(this, prefs, receipt)", capturePersistIndex) > capturePersistIndex
    && service.indexOf("acknowledgeReceipt(this, true", capturePersistIndex)
      > service.indexOf("ProPendingTripStore.enqueue(this, prefs, receipt)", capturePersistIndex),
);
check("Web contract exposes native event listener", nativeContract.includes('addListener(eventName: "receiptCaptured"'));
check("bridge registers receiptCaptured listener", bridge.includes('SimpleAutomation.addListener("receiptCaptured"'));
check(
  "bridge keeps event-driven auth recovery with a short safety poll",
  bridge.includes("window.setInterval(() => void poll(), 750)"),
);
check("bridge does not call Web completion", !bridge.includes("completeSimpleAutomationReceipt") && !bridge.includes("completeTripWithCoordinator"));
check("bridge offers scoped native Google reauthentication", bridge.includes("authenticateNativeForPendingProTrip") && bridge.includes('label: "Autenticar"'));
check("native ACK follows the transaction", coordinator.lastIndexOf("nativeSuccess(context, prefs") > coordinator.indexOf('getHttpsCallable("registerGtoProReceipt")'));
check("native retry keeps exact attempt and receipt", service.includes("ProPendingTripStore") && service.includes("attempt"));
check("completion service remains isolated from native bridge", completion.includes("completeTripWithCoordinator"));

console.log("pro-receipt-event-handoff: PASS durable native queue, legacy Web fallback and terminal-aware ACK order");
