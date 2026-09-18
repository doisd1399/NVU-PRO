import fs from "node:fs";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const service = fs.readFileSync(`${root}/android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java`, "utf8");
const plugin = fs.readFileSync(`${root}/android/app/src/main/java/com/nvu/operacional/SimpleAutomationPlugin.java`, "utf8");
const coordinator = fs.readFileSync(`${root}/android/app/src/main/java/com/nvu/operacional/SimpleProNativeSubmissionCoordinator.java`, "utf8");
const nativeContract = fs.readFileSync(`${root}/src/lib/simpleAutomationNative.ts`, "utf8");
const completion = fs.readFileSync(`${root}/src/services/simpleAutomationCompletionService.ts`, "utf8");
const bridge = fs.readFileSync(`${root}/src/components/SimpleAutomationCompletionBridge.tsx`, "utf8");
const driverLayout = fs.readFileSync(`${root}/src/layouts/DriverLayout.tsx`, "utf8");

assert.match(service, /public static void refreshOperationSnapshot\(/);
for (const field of ["operationName", "jobProgress", "jobTotalDeliveries", "vehicleName", "trailerName", "operationClosed"]) {
  assert.match(service, new RegExp(`put(?:String|Int|Boolean)\\(\\"${field}\\"`), `native snapshot must persist ${field}`);
}
assert.match(plugin, /public void refreshOperationSnapshot\(PluginCall call\)/);
assert.match(nativeContract, /refreshOperationSnapshot\(input:/);
assert.match(completion, /SimpleAutomation\.refreshOperationSnapshot\(\{/);
assert.match(bridge, /currentOperationProgress\?: number/);
assert.match(bridge, /Number\(currentOperationProgress \?\? currentJob\.progress \?\? 0\)/);
assert.match(driverLayout, /deriveCurrentOperationProgress\(driverOperation, driverTripState\.trips/);
assert.match(coordinator, /refreshNativeOperationSnapshot\(context, prefs, job, contract, progress \+ 1, total\)/);
assert.match(coordinator, /SimpleAutomationService\.refreshOperationSnapshot\(/);
const durableSection = completion.slice(completion.indexOf("trace.addTripMs"));
assert.match(durableSection, /SimpleAutomation\.refreshOperationSnapshot\(\{/);
assert.doesNotMatch(durableSection, /SimpleAutomation\.refreshOperationState\(\{\s*jobProgress:/, "post-addDoc refresh must use the full snapshot API");
console.log("[PASS] Pro operation snapshot refresh: native and Web paths update operation/progress/vehicle/trailer through the full snapshot API.");
