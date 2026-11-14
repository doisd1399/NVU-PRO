import fs from "node:fs";

const coordinator = fs.readFileSync(
  "android/app/src/main/java/com/nvu/operacional/SimpleProNativeSubmissionCoordinator.java",
  "utf8",
);
const service = fs.readFileSync(
  "android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java",
  "utf8",
);
const plugin = fs.readFileSync(
  "android/app/src/main/java/com/nvu/operacional/SimpleAutomationPlugin.java",
  "utf8",
);
const bridge = fs.readFileSync("src/components/SimpleAutomationCompletionBridge.tsx", "utf8");
const nativeContract = fs.readFileSync("src/lib/simpleAutomationNative.ts", "utf8");
const googleAuth = fs.readFileSync("src/services/googleAuthService.ts", "utf8");
const job = fs.readFileSync("android/app/src/main/java/com/nvu/operacional/ProPendingTripJobService.java", "utf8");
const activity = fs.readFileSync("android/app/src/main/java/com/nvu/operacional/MainActivity.java", "utf8");

const check = (label, condition) => {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log("PASS", label);
};

check("auth states are explicit", coordinator.includes('"MISSING"') && coordinator.includes('"DIVERGENT"') && coordinator.includes('"MATCH"'));
check("diagnostic stores fingerprints only", coordinator.includes("MessageDigest") && coordinator.includes("nativeAuthDriverFingerprint") && coordinator.includes("nativeAuthUidFingerprint"));
check(
  "diagnostic never logs token material",
  coordinator.includes("getIdToken(true)")
    && !coordinator.includes("Log.*idToken")
    && !coordinator.includes("nativeAuthIdToken"),
);
check("receipt remains attempt-scoped on auth failure", service.includes('"AUTH_REQUIRED"') && service.includes("lastQueueError") && service.includes("attempt"));
check("native retry command exists", plugin.includes("retryPending") && nativeContract.includes("retryPending"));
check("Web checks the expected driver before Google auth", bridge.includes("currentUser?.id") && bridge.includes("expectedDriverId"));
check("native provider result is checked without replacing Web identity", googleAuth.includes("nativeSession.user?.uid !== expected") && googleAuth.includes("auth.currentUser?.uid !== expected") && bridge.includes("authenticateNativeForPendingProTrip(expectedDriverId,"));
check("Web resumes the same pending attempt", bridge.includes("SimpleAutomation.retryPending()"));
check("app boot and auth changes reschedule the pending queue", activity.includes("ProPendingTripJobService.scheduleImmediate(this)") && activity.includes("addAuthStateListener(proQueueAuthListener)"));
check("old auth failures migrate without losing the receipt", job.includes("Autenticação nativa não corresponde") && job.includes('putString("queueStatus", "AUTH_REQUIRED")'));
check("active service releases legacy/auth-required entries from their own driver snapshot", service.includes('String entryDriverId = safe(entry.getString("driverId", ""))') && service.includes("legacyAuthFailure") && service.includes("nativeUid.equals(entryDriverId)"));
check("retry action does not depend on stale global driver snapshot", plugin.includes("matchingAttempt") && plugin.includes('entry.getString("driverId", "")') && !plugin.includes('driverId.isEmpty() || !driverId.equals(nativeUser.getUid())'));
check("status exposes no UID/token", plugin.includes("nativeAuthState") && plugin.includes("nativeAuthDiagnosticAt") && !plugin.includes("nativeAuthUidFingerprint"));
check("manual retry renews the token and delegates the guarded reset", plugin.includes("getIdToken(true)") && plugin.includes('ProPendingTripStore.requestRetry'));
check("permission failures pause instead of becoming a network retry storm", service.includes("isPermissionFailureReason(reason)") && job.includes("isPermissionFailureReason(reason)") && job.includes('"MATCH".equals(entry.getString("nativeAuthState", "UNKNOWN"))'));
check("callable permission failures preserve their code and pause after matched native identity", coordinator.includes("GTO_PRO_REGISTRATION_FAILED:") && service.includes('putString("lastQueueErrorCode", safe(reason))') && job.includes('putString("lastQueueErrorCode", reason == null ? "" : reason)') && service.includes("PERMISSION_PAUSED") && job.includes("PERMISSION_PAUSED") && job.includes('"MATCH".equals(entry.getString("nativeAuthState", "UNKNOWN"))') && plugin.includes('ProPendingTripStore.requestRetry'));
check("permission-matched sessions do not trigger repeated auth prompts", bridge.includes("identityRequired") && bridge.includes("server permission rejection"));

console.log("pro-auth-recovery: PASS silent native restore, explicit fallback action, durable native resume");
