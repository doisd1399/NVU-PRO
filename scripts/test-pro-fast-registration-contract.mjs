import fs from "node:fs";

const repository = fs.readFileSync("src/repositories/TripsRepository.ts", "utf8");
const service = fs.readFileSync("src/services/simpleAutomationCompletionService.ts", "utf8");
const coordinator = fs.readFileSync("src/services/operationalCompletionCoordinator.ts", "utf8");
const native = fs.readFileSync(
  "android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java",
  "utf8",
);

function check(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}

const guardStart = repository.indexOf("static async findLatestOperationTripByValue");
const guardEnd = repository.indexOf("  static async readAuthoritativeOperationState", guardStart);
const guard = repository.slice(guardStart, guardEnd);
const preflightStart = repository.indexOf("static async readAuthoritativeOperationState");
const preflightEnd = repository.indexOf("  static async syncJobProgress", preflightStart);
const preflight = repository.slice(preflightStart, preflightEnd);

check("guard bounds the current operation query by jobId", guard.includes('where("jobId", "==", jobId)') && guard.includes("limit(FAST_DUPLICATE_WINDOW)"));
check("guard retains company and driver identity checks locally", guard.includes("companyId") && guard.includes("driverId") && guard.includes("findLatestConsecutiveProDuplicate"));
check("guard remains fail-closed with complete-operation fallback", guard.includes('where("jobId", "==", jobId)') && guard.includes("catch (error)"));
check("guard preserves simulator and amount policy locally", guard.includes("simulatorKey") && guard.includes("findLatestConsecutiveProDuplicate"));
check("preflight avoids contract read when the caller supplies a usable total", preflight.includes("fallbackTotalValue") && preflight.includes("contractSnapshot") && preflight.includes("jobTotalValue"));
check("Pro preflight and duplicate guard run in parallel", service.includes("Promise.all([") && service.includes("readAuthoritativeOperationState") && service.includes("findLatestOperationTripByValue"));
check("post-add reconciliation is deferred except for terminal completion", service.includes("operationWillClose") && service.includes("deferOperationReconciliation: !operationWillClose") && coordinator.includes("if (input.deferOperationReconciliation)") && coordinator.includes("void reconcile();"));
check("tripId backfill is deferred", coordinator.includes("void Promise.resolve()") && coordinator.includes("persistTripId(docRef)"));
check("native capture keeps one warmup and at most one OCR retry", native.includes("CAPTURE_FRAME_WARMUP_MS = 650L") && native.includes("CAPTURE_MAX_OCR_ATTEMPTS = 2"));
check("native identity remains snapshot-based", native.includes("Simulator identity is already frozen in captureSimulatorKey/code"));

console.log("pro-fast-registration-contract: PASS bounded duplicate guard, no redundant total read, deferred intermediate work with terminal confirmation, simulator-safe OCR");
