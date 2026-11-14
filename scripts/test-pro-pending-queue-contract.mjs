import fs from "node:fs";
import assert from "node:assert/strict";

const read = (path) => fs.readFileSync(path, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java");
const receipt = read("android/app/src/main/java/com/nvu/operacional/NativeTripReceipt.java");
const receiptCard = read("android/app/src/main/java/com/nvu/operacional/NativeTripReceiptCardView.java");
const store = read("android/app/src/main/java/com/nvu/operacional/ProPendingTripStore.java");
const job = read("android/app/src/main/java/com/nvu/operacional/ProPendingTripJobService.java");
const coordinator = read("android/app/src/main/java/com/nvu/operacional/SimpleProNativeSubmissionCoordinator.java");
const bridge = read("src/components/SimpleAutomationCompletionBridge.tsx");
const manifest = read("android/app/src/main/AndroidManifest.xml");

const checks = [
  ["receipt and frozen route persist before queue index", store.indexOf("if (!editor.commit()) return") < store.indexOf("pending.add(id)")],
  ["queued receipt is acknowledged without claiming a server write", service.includes('queuedReceipt ? "QUEUED" : (accepted ? "SYNCED" : "IDLE")')],
  ["native service never emits a false Web handoff", !service.includes("SimpleAutomationPlugin.emitReceiptCaptured()")],
  ["Web bridge never owns the Firestore write", !bridge.includes("completeSimpleAutomationReceipt") && bridge.includes("Native Pro is the only owner")],
  ["auth-required attempts wait for the matching native identity", service.includes('"AUTH_REQUIRED".equals(queueStatus)') && job.includes('nativeUid.equals(entry.getString("driverId", ""))')],
  ["overlay and headless worker share one durable claim", service.includes("ProPendingTripStore.claim(this, prefs, id)") && job.includes("ProPendingTripStore.claim(this, index, id)") && store.includes("CLAIM_STALE_MS")],
  ["background recovery requires network", job.includes("setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)")],
  ["background job survives reboot", job.includes("setPersisted(true)") && manifest.includes("RECEIVE_BOOT_COMPLETED")],
  ["one attempt stays bound to its snapshot and completion marker", store.includes('PREFIX + id')
    && coordinator.includes('generation == prefs.getInt("nativeAttemptGeneration", 0)')
    && coordinator.includes('if (!isCurrentAttempt(context, prefs, generation)) return;')
    && coordinator.includes('ProPendingTripStore.isCompletionRecorded')],
  ["lost acknowledgement recovers by exact attempt", coordinator.includes('request.put("attemptId", attemptId)')
    && coordinator.includes('request.put("previousTripId"') && coordinator.includes('idempotencyKey')],
  ["confirmed history is not left as pending", service.includes('item.put("pendingSync", false)') && service.includes('tripId.startsWith("local-")')],
  ["pending card and confirmed card have distinct status", service.includes("NativeTripReceipt.State.PENDING") && service.includes("NativeTripReceipt.State.CONFIRMED")
    && receipt.includes("State { CONFIRMED, PENDING, ACTION_REQUIRED }")
    && receiptCard.includes("receipt.state == NativeTripReceipt.State.CONFIRMED")],
  ["capture cleanup does not replace queue status", service.includes('if (readable && "CAPTURE_CAPTURED".equals(prefs.getString("simpleState", DEFAULT_STATE)))')],
  ["queue supports consecutive captures", store.includes("pending.add(id)") && service.includes("processPendingProTrips()")],
  ["driver-scoped duplicate guard is server callable", coordinator.includes('registerCanonicalSimpleTrip') && coordinator.includes('request.put("trip", trip)') && !coordinator.includes("db.runTransaction(transaction")],
  ["confirmed history owns count and no client slot/progress", coordinator.includes('confirmedTripCount')
    && !coordinator.includes("int operationSlot = confirmedCount + 1")
    && !coordinator.includes('progressUpdate.put("progress", operationSlot)')
    && !coordinator.includes('put("expectedProgress"')],
];
for (const [name, ok] of checks) {
  assert.ok(ok, name);
  console.log("PASS", name);
}

const failurePolicy = read("android/app/src/main/java/com/nvu/operacional/PendingTripFailurePolicy.java");
const policyChecks = [
  ["foreground and background share one failure policy", service.includes("PendingTripFailurePolicy.isPermanentRejection(reason)") && job.includes("PendingTripFailurePolicy.isPermanentRejection(reason)")],
  ["reconciliation-required is explicitly recoverable", failurePolicy.includes("if (isReconciliationRequired(value)) return false")],
  ["firebase FAILED_PRECONDITION is not itself a permanent verdict", !failurePolicy.includes('contains("FAILED_PRECONDITION")')],
  ["scope and GTO identity/binding mismatches remain terminal", failurePolicy.includes('value.contains("SCOPE_MISMATCH")')
    && failurePolicy.includes('value.contains("Recibo ou contexto GTO inválido")')
    && failurePolicy.includes('value.contains("Os vínculos da operação não pertencem ao motorista")')],
  ["evidence conflict remains terminal", failurePolicy.includes('value.contains("NATIVE_RECEIPT_EVIDENCE_CONFLICT")')],
  ["duplicate-value domain rejection is consistent across owners", failurePolicy.includes('value.contains("mesmo valor já foi registrado consecutivamente")')],
  ["reconciliation is scoped to queue generation", coordinator.includes('nativeOperationReconciliationGeneration') && coordinator.includes('!= generation')],
  ["legacy frozen receipts keep immutable identity while requeued", store.includes('failurePolicyRecoveryVersion') && store.includes('.putString("queueStatus", "WAITING")') && !store.includes('.remove("attemptId")')],
];
for (const [name, ok] of policyChecks) {
  assert.ok(ok, name);
  console.log("PASS", name);
}
