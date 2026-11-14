package com.nvu.operacional;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;

import java.util.ArrayList;
import java.util.List;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.security.MessageDigest;

/** Durable, attempt-scoped receipts. Never overwrite an older receipt with a new route. */
final class ProPendingTripStore {
    private static final String INDEX = "pendingProTripAttemptIds";
    private static final String INDEX_BACKUP = "pendingProTripAttemptIdsBackup";
    private static final String JOURNAL_PREFIX = "pendingProTripJournal:";
    private static final String PREFIX = "nvu_pro_pending_";
    private static final long CLAIM_STALE_MS = 45_000L;
    static final String DISCARDED_OPERATION_COMPLETED = "DISCARDED_OPERATION_COMPLETED";
    private static final String[] SNAPSHOT_FIELDS = {
        "captureJobId", "captureCompanyId", "captureContractId", "captureAttemptId",
        "captureContextEpoch", "captureOrigin", "captureDestination", "captureSimulatorKey",
        "captureSimulatorCode", "capturePackageId", "companyName", "contractName",
        "operationName", "vehicleName", "trailerName"
    };

    private ProPendingTripStore() {}

    static synchronized String enqueue(Context context, SharedPreferences source, String receipt) {
        String id = source.getString("captureAttemptId", "");
        if (id == null || !id.matches("[A-Za-z0-9_-]{8,180}") || receipt == null || receipt.trim().isEmpty()) {
            return "";
        }
        if (isCompletionRecorded(source, source)) return "";
        if (ids(source).contains(id) && !entry(context, id).getString("receiptText", "").isEmpty()) return id;
        SimpleProNativeSubmissionCoordinator.Receipt validated =
            SimpleProNativeSubmissionCoordinator.parseReceipt(source.getString("captureSimulatorKey", ""), receipt);
        if (validated == null || validated.amountCents <= 0) return "";
        // Persist discovery before the isolated receipt. If the process dies
        // between commits, startup can recover the original attempt ID.
        if (!source.edit().putBoolean(JOURNAL_PREFIX + id, true).commit()) return "";
        SharedPreferences isolated = entry(context, id);
        SharedPreferences.Editor editor = isolated.edit().clear();
        for (String key : SNAPSHOT_FIELDS) editor.putString(key, source.getString(key, ""));
        editor.putString("driverId", source.getString("captureDriverId", source.getString("driverId", "")));
        editor.putString("jobId", source.getString("captureJobId", ""));
        editor.putString("companyId", source.getString("captureCompanyId", ""));
        editor.putString("contractId", source.getString("captureContractId", ""));
        editor.putString("receiptText", receipt);
        // Freeze the validated monetary result. A retry never reinterprets OCR.
        editor.putInt("receiptSnapshotVersion", 1);
        editor.putInt("receiptAmountCents", validated.amountCents);
        editor.putString("receiptCurrency", validated.currency);
        editor.putString("receiptBonusEvidence", validated.bonusEvidence);
        editor.putLong("receiptCapturedAt", source.getLong("receiptCapturedAt", System.currentTimeMillis()));
        editor.putInt("jobProgress", source.getInt("jobProgress", 0));
        editor.putInt("jobTotalDeliveries", source.getInt("jobTotalDeliveries", 0));
        editor.putInt(CanonicalTripOutboxSchema.KEY_SCHEMA_VERSION, CanonicalTripOutboxSchema.VERSION);
        editor.putString(CanonicalTripOutboxSchema.KEY_STATE, CanonicalTripOutboxSchema.STATE_PENDING_SYNC);
        editor.putInt(CanonicalTripOutboxSchema.KEY_ATTEMPTS, 0);
        editor.putString("nativeSubmissionState", "QUEUED");
        editor.putLong("queuedAt", System.currentTimeMillis());
        // Persist the complete immutable receipt before exposing it in the index.
        if (!editor.commit()) return "";
        List<String> pending = ids(source);
        if (!pending.contains(id)) pending.add(id);
        if (!writeIndex(source, pending)) return "";
        return id;
    }

    static synchronized SimpleProNativeSubmissionCoordinator.Receipt validatedReceipt(SharedPreferences entry) {
        int version = entry.getInt("receiptSnapshotVersion", 0);
        if (version != 0) {
            if (version != 1) return null;
            int cents = entry.getInt("receiptAmountCents", 0);
            String currency = entry.getString("receiptCurrency", "");
            String bonus = entry.getString("receiptBonusEvidence", "");
            if (cents <= 0
                || currency == null
                || !("NONE".equals(bonus) || "ZERO_LABEL".equals(bonus) || "OFFER_ONLY".equals(bonus))) return null;
            return new SimpleProNativeSubmissionCoordinator.Receipt(cents, currency, true, bonus);
        }
        // Migrate old on-device receipts once, preserving the attempt and route.
        SimpleProNativeSubmissionCoordinator.Receipt parsed =
            SimpleProNativeSubmissionCoordinator.parseReceipt(
                entry.getString("captureSimulatorKey", ""), entry.getString("receiptText", ""));
        if (parsed == null || parsed.amountCents <= 0 || parsed.currency == null) return null;
        if (!entry.edit().putInt("receiptSnapshotVersion", 1)
            .putInt("receiptAmountCents", parsed.amountCents)
            .putString("receiptCurrency", parsed.currency)
            .putString("receiptBonusEvidence", parsed.bonusEvidence).commit()) return null;
        return parsed;
    }

    static synchronized List<String> ids(SharedPreferences indexPrefs) {
        List<String> ids = new ArrayList<>();
        readIndexedIds(indexPrefs.getString(INDEX, "[]"), ids);
        readIndexedIds(indexPrefs.getString(INDEX_BACKUP, "[]"), ids);
        for (String key : indexPrefs.getAll().keySet()) {
            if (!key.startsWith(JOURNAL_PREFIX)) continue;
            String id = key.substring(JOURNAL_PREFIX.length());
            if (id.matches("[A-Za-z0-9_-]{8,180}") && indexPrefs.getBoolean(key, false)
                && !ids.contains(id)) ids.add(id);
        }
        return ids;
    }

    private static void readIndexedIds(String raw, List<String> ids) {
        try {
            JSONArray array = new JSONArray(raw);
            for (int i = 0; i < array.length(); i++) {
                String id = array.optString(i, "");
                if (id.matches("[A-Za-z0-9_-]{8,180}") && !ids.contains(id)) ids.add(id);
            }
        } catch (JSONException ignored) { /* Backup and journal remain readable. */ }
    }

    static SharedPreferences entry(Context context, String id) {
        return context.getApplicationContext().getSharedPreferences(PREFIX + id, Context.MODE_PRIVATE);
    }

    static boolean isSpecificGtoContractMismatchCandidate(SharedPreferences pending) {
        boolean exactFailure = PendingTripFailurePolicy.isSpecificGtoContractMismatch(
            pending.getString("queueStatus", ""),
            pending.getString(CanonicalTripOutboxSchema.KEY_STATE, ""),
            pending.getString("reasonCode", ""), pending.getString("lastQueueErrorCode", ""),
            pending.getString("lastQueueError", ""), pending.getString("lastQueueCallable", ""),
            pending.getString("lastFailureStage", ""));
        boolean authorizedFlow = pending.getBoolean("contractMismatchRecoveryAuthorized", false)
            && (CanonicalTripOutboxSchema.STATE_PENDING_SYNC.equals(pending.getString(CanonicalTripOutboxSchema.KEY_STATE, ""))
                || CanonicalTripOutboxSchema.STATE_SYNCING.equals(pending.getString(CanonicalTripOutboxSchema.KEY_STATE, "")))
            && ("WAITING".equals(pending.getString("queueStatus", ""))
                || "SENDING".equals(pending.getString("queueStatus", "")));
        if (!exactFailure && !authorizedFlow) return false;
        if (pending.getBoolean("operationClosed", false)) return false;
        String status = pending.getString("jobStatus", "active");
        if ("completed".equalsIgnoreCase(status) || "cancelled".equalsIgnoreCase(status)
            || "closed".equalsIgnoreCase(status)) return false;
        String driver = pending.getString("driverId", "");
        String job = pending.getString("jobId", pending.getString("captureJobId", ""));
        String company = pending.getString("companyId", pending.getString("captureCompanyId", ""));
        String contract = pending.getString("contractId", pending.getString("captureContractId", ""));
        String attempt = pending.getString("captureAttemptId", "");
        String epoch = pending.getString("captureContextEpoch", "");
        String origin = pending.getString("captureOrigin", "");
        String destination = pending.getString("captureDestination", "");
        String key = pending.getString("captureSimulatorKey", "");
        String code = pending.getString("captureSimulatorCode", "");
        String packageId = pending.getString("capturePackageId", "");
        if (driver.isEmpty() || job.isEmpty() || company.isEmpty() || contract.isEmpty() || attempt.isEmpty()
            || epoch.isEmpty() || origin.isEmpty() || destination.isEmpty()
            || !"global-truck".equals(key) || !"GTO".equals(code) || !"com.stargamesapps.gto".equals(packageId)) return false;
        // Eligibility/diagnostic reads must not trigger a legacy OCR migration.
        if (pending.getInt("receiptSnapshotVersion", 0) != 1) return false;
        SimpleProNativeSubmissionCoordinator.Receipt receipt = validatedReceipt(pending);
        if (receipt == null || receipt.currency == null || !receipt.currency.isEmpty()) return false;
        for (String[] binding : new String[][]{
            {"jobId", "captureJobId"}, {"companyId", "captureCompanyId"}, {"contractId", "captureContractId"}
        }) {
            if (!pending.getString(binding[0], "").equals(pending.getString(binding[1], ""))) return false;
        }
        if (pending.contains("captureDriverId")
            && !driver.equals(pending.getString("captureDriverId", ""))) return false;
        if (authorizedFlow && !hasContractRecoveryPermit(pending)) return false;
        String failure = pending.getString("reasonCode", "") + ":" + pending.getString("lastQueueErrorCode", "")
            + " " + pending.getString("lastQueueError", "");
        boolean legacyMetadata = PendingTripFailurePolicy.isSpecificGtoContractMismatch(
            "FAILED", "FAILED", pending.getString("reasonCode", ""), pending.getString("lastQueueErrorCode", ""),
            pending.getString("lastQueueError", ""), pending.getString("lastQueueCallable", ""),
            pending.getString("lastFailureStage", ""));
        if (PendingTripFailurePolicy.isPermanentRejection(failure) && !legacyMetadata) return false;
        return GtoProReceiptValidationPolicy.validate(job, company, contract, attempt, epoch, origin, destination,
            pending.getString("receiptText", ""), receipt.amountCents, receipt.bonusEvidence,
            pending.getString("submissionTripId", "")).isEmpty();
    }

    static boolean isRetryAllowed(SharedPreferences pending) {
        if (pending.getBoolean("serverRetryableExplicit", false)
            && !pending.getBoolean("serverRetryable", true)) return false;
        if (DISCARDED_OPERATION_COMPLETED.equals(pending.getString("queueStatus", ""))
            || "SYNCED".equals(pending.getString("queueStatus", ""))
            || CanonicalTripOutboxSchema.STATE_SERVER_CONFIRMED.equals(pending.getString(CanonicalTripOutboxSchema.KEY_STATE, ""))) return false;
        if (isSpecificGtoContractMismatchCandidate(pending)) {
            return hasContractRecoveryPermit(pending)
                && (!pending.getBoolean("contractMismatchRecoveryConsumed", false)
                    || pending.getBoolean("contractMismatchRecoveryRequested", false));
        }
        return PendingTripFailurePolicy.canRetry(pending.getString("queueStatus", "WAITING"),
            pending.getString(CanonicalTripOutboxSchema.KEY_STATE, ""),
            pending.getString("reasonCode", "") + ":" + pending.getString("lastQueueErrorCode", "")
                + " " + pending.getString("lastQueueError", ""));
    }

    /** The UI may offer a compatibility check without authorizing a send. */
    static boolean canRequestContractRecovery(SharedPreferences pending) {
        return "FAILED".equals(pending.getString("queueStatus", ""))
            && CanonicalTripOutboxSchema.STATE_FAILED.equals(pending.getString(CanonicalTripOutboxSchema.KEY_STATE, ""))
            && isSpecificGtoContractMismatchCandidate(pending);
    }

    /** Exact immutable capture binding across asynchronous token/probe callbacks. */
    static String contractRecoveryFingerprint(SharedPreferences pending) {
        if (pending == null) return "";
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            DataOutputStream out = new DataOutputStream(bytes);
            for (String key : new String[]{"driverId", "captureDriverId", "jobId", "captureJobId",
                "companyId", "captureCompanyId", "contractId", "captureContractId", "captureAttemptId",
                "captureContextEpoch", "captureOrigin", "captureDestination", "captureSimulatorKey",
                "captureSimulatorCode", "capturePackageId", "receiptText", "receiptCurrency",
                "receiptBonusEvidence", "vehicleName", "trailerName"})
                out.writeUTF(pending.getString(key, ""));
            // submissionTripId is a derived server ACK, not captured evidence.
            // It can be durably saved just before a crash/queue cleanup; the
            // replay still uses the same attempt and server validates that ID.
            out.writeInt(pending.getInt("receiptSnapshotVersion", 0));
            out.writeInt(pending.getInt("receiptAmountCents", 0));
            out.writeLong(pending.getLong("receiptCapturedAt", 0L));
            out.flush();
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes.toByteArray());
            StringBuilder result = new StringBuilder();
            for (byte value : digest) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
            return result.toString();
        } catch (Exception ignored) { return ""; }
    }

    private static boolean hasContractRecoveryPermit(SharedPreferences pending) {
        String expected = pending.getString("contractMismatchRecoveryFingerprint", "");
        return pending.getBoolean("contractMismatchRecoveryAuthorized", false)
            && GtoBackendCompatibilityPolicy.VERSION.equals(pending.getString("contractMismatchRecoveryVersion", ""))
            && !expected.isEmpty() && expected.equals(contractRecoveryFingerprint(pending));
    }

    static synchronized boolean authorizeSpecificGtoContractMismatch(Context context, SharedPreferences index,
                                                                       String id, String uid, String version,
                                                                       String expectedFingerprint) {
        if (context == null || index == null || id == null || id.isEmpty()
            || uid == null || uid.isEmpty() || !GtoBackendCompatibilityPolicy.VERSION.equals(version)
            || expectedFingerprint == null || expectedFingerprint.isEmpty() || !contains(index, id)) return false;
        SharedPreferences pending = entry(context, id);
        if (isCompletionRecorded(index, pending)) return false;
        if (!id.equals(pending.getString("captureAttemptId", "")) || !uid.equals(pending.getString("driverId", ""))
            || !expectedFingerprint.equals(contractRecoveryFingerprint(pending))
            || !isSpecificGtoContractMismatchCandidate(pending)) return false;
        // Today's route/active operation must never overwrite or invalidate a
        // saved receipt from yesterday. The server checks its frozen job scope.
        if (hasContractRecoveryPermit(pending)) return true;
        int nextGeneration = pending.getInt("nativeAttemptGeneration", 0) + 1;
        return pending.edit().putBoolean("contractMismatchRecoveryAuthorized", true)
            .putBoolean("contractMismatchRecoveryConsumed", false)
            .putBoolean("contractMismatchRecoveryRequested", false)
            .putString("contractMismatchRecoveryVersion", version)
            .putString("contractMismatchRecoveryFingerprint", expectedFingerprint)
            .putLong("contractMismatchRecoveryAt", System.currentTimeMillis())
            .putInt("contractMismatchRecoveryGeneration", nextGeneration)
            .commit();
    }

    static synchronized String requestSpecificGtoContractMismatch(Context context, SharedPreferences index, String id, String uid) {
        if (!contains(index, id)) return "pending-not-found";
        SharedPreferences pending = entry(context, id);
        if (isCompletionRecorded(index, pending)) return "pending-operation-completed";
        if (uid == null || uid.isEmpty() || !uid.equals(pending.getString("driverId", ""))) return "auth-required";
        if (!isSpecificGtoContractMismatchCandidate(pending)
            || !hasContractRecoveryPermit(pending)) return "retry-blocked";
        boolean sending = "SENDING".equals(pending.getString("queueStatus", ""))
            || CanonicalTripOutboxSchema.STATE_SYNCING.equals(pending.getString(CanonicalTripOutboxSchema.KEY_STATE, ""));
        long claimedAt = pending.getLong("queueClaimedAt", 0L);
        if (sending && claimedAt > 0L && System.currentTimeMillis() - claimedAt < CLAIM_STALE_MS)
            return "pending-already-sending";
        boolean ok = pending.edit()
            .putBoolean("contractMismatchRecoveryRequested", true)
            .putString(CanonicalTripOutboxSchema.KEY_STATE, CanonicalTripOutboxSchema.STATE_PENDING_SYNC)
            .putString("queueStatus", "WAITING")
            .putString("nativeSubmissionState", "QUEUED")
            .putLong("retryAt", 0L)
            .commit();
        return ok ? "pending-retry-requested" : "retry-unavailable";
    }

    /** Re-check owner and domain policy under the same lock as claim/remove.
     * Keep the previous failure until the next result replaces it, and never
     * rewrite receipt, route, currency, attempt or physical job identity. */
    static synchronized String requestRetry(Context context, SharedPreferences index, String id, String uid) {
        if (!contains(index, id)) return "pending-not-found";
        SharedPreferences pending = entry(context, id);
        if (uid == null || uid.isEmpty() || !uid.equals(pending.getString("driverId", ""))) return "auth-required";
        if (isCompletionRecorded(index, pending)) return "pending-operation-completed";
        if (!isRetryAllowed(pending)) return "retry-blocked";
        long claimedAt = pending.getLong("queueClaimedAt", 0L);
        boolean sending = "SENDING".equals(pending.getString("queueStatus", ""))
            || CanonicalTripOutboxSchema.STATE_SYNCING.equals(pending.getString(CanonicalTripOutboxSchema.KEY_STATE, ""));
        if (sending && claimedAt > 0L && System.currentTimeMillis() - claimedAt < CLAIM_STALE_MS) return "pending-already-sending";
        SharedPreferences.Editor reset = pending.edit()
            .putString(CanonicalTripOutboxSchema.KEY_STATE, CanonicalTripOutboxSchema.STATE_PENDING_SYNC)
            .putString("queueStatus", "WAITING")
            .putString("nativeSubmissionState", "QUEUED")
            .putLong("retryAt", 0L)
            .remove("nativePermissionTokenRefreshAttempted");
        if ("PERMISSION_PAUSED".equals(pending.getString("queueStatus", "")) ||
            SimpleProNativeSubmissionCoordinator.isPermissionFailureReason(pending.getString("lastQueueErrorCode", ""))) {
            reset.putString("previousQueueErrorCode505", pending.getString("lastQueueErrorCode", ""))
                .remove("lastQueueErrorCode").remove("lastQueueError");
        }
        if (sending) reset.putInt("nativeAttemptGeneration", pending.getInt("nativeAttemptGeneration", 0) + 1);
        return reset.commit() ? "pending-retry-requested" : "retry-unavailable";
    }

    /** One owner per attempt across the overlay service and background job. */
    static synchronized int claim(Context context, SharedPreferences indexPrefs, String id) {
        if (!contains(indexPrefs, id)) return -1;
        SharedPreferences pending = entry(context, id);
        if (isCompletionRecorded(indexPrefs, pending)) return -1;
        // An interrupted journal commit may exist without its immutable
        // receipt entry. Never send such an incomplete attempt.
        if (!id.equals(pending.getString("captureAttemptId", ""))
            || pending.getString("receiptText", "").trim().isEmpty()
            || pending.getString("driverId", "").trim().isEmpty()
            || validatedReceipt(pending) == null) return -1;
        String status = pending.getString(CanonicalTripOutboxSchema.KEY_STATE, CanonicalTripOutboxSchema.STATE_PENDING_SYNC);
        String legacyStatus = pending.getString("queueStatus", "WAITING");
        boolean permissionPaused = "PERMISSION_PAUSED".equals(legacyStatus)
            || ("MATCH".equals(pending.getString("nativeAuthState", "UNKNOWN"))
                && SimpleProNativeSubmissionCoordinator.isPermissionFailureReason(
                    pending.getString("lastQueueErrorCode", "")));
        boolean specific = isSpecificGtoContractMismatchCandidate(pending);
        if (!isRetryAllowed(pending) || (specific && !pending.getBoolean("contractMismatchRecoveryRequested", false))
            || CanonicalTripOutboxSchema.STATE_FAILED.equals(status) || "FAILED".equals(legacyStatus)
            || "AUTH_REQUIRED".equals(legacyStatus) || permissionPaused) return -1;
        long now = System.currentTimeMillis();
        long claimedAt = pending.getLong("queueClaimedAt", 0L);
        if (CanonicalTripOutboxSchema.STATE_SYNCING.equals(status) && claimedAt > 0L
            && now - claimedAt < CLAIM_STALE_MS) return -1;
        if (pending.getLong("retryAt", 0L) > now) return -1;
        int generation = pending.getInt("nativeAttemptGeneration", 0) + 1;
        SharedPreferences.Editor claim = pending.edit().putInt("nativeAttemptGeneration", generation);
        if (specific) claim.putBoolean("contractMismatchRecoveryConsumed", true)
            .putInt("contractMismatchRecoveryGeneration", generation);
        if (!claim.putLong("queueClaimedAt", now)
            .putInt(CanonicalTripOutboxSchema.KEY_ATTEMPTS, pending.getInt(CanonicalTripOutboxSchema.KEY_ATTEMPTS, 0) + 1)
            .putString(CanonicalTripOutboxSchema.KEY_STATE, CanonicalTripOutboxSchema.STATE_SYNCING)
            .putString("queueStatus", "SENDING").commit()) return -1;
        return generation;
    }

    /** Persisted backoff; manual retry clears retryAt without changing the receipt. */
    static long retryDelay(SharedPreferences entry, String reason) {
        int failures = Math.min(8, Math.max(0, entry.getInt("queueFailureCount", 0)) + 1);
        entry.edit().putInt("queueFailureCount", failures).apply();
        if (reason != null && (reason.contains("GTO_PRO_BACKEND_NOT_DEPLOYED") || reason.contains("SIMPLE_BACKEND_NOT_DEPLOYED"))) return 300_000L;
        if (reason != null && SimpleProNativeSubmissionCoordinator.isPermissionFailureReason(reason)) return 120_000L;
        return Math.min(120_000L, 5_000L * (1L << Math.min(5, failures - 1)));
    }

    /** One time upgrade of a prior, repair-only rejection. The new atomic
     * callable can resolve it without throwing away the original attempt. */
    static boolean isRecoverablePermissionPause(SharedPreferences pending) {
        return "PERMISSION_PAUSED".equals(pending.getString("queueStatus", ""))
            && !(pending.getBoolean("serverRetryableExplicit", false) && !pending.getBoolean("serverRetryable", true))
            && !PendingTripFailurePolicy.isPermanentRejection(pending.getString("reasonCode", "") + ":" + pending.getString("lastQueueErrorCode", ""));
    }

    /** Only a matching owner plus recognized recoverable error can be released.
     * Exact old GTO contract failures additionally require a live capability ACK. */
    static synchronized void recoverAutomatically(Context context, SharedPreferences index) {
        com.google.firebase.auth.FirebaseUser user = GtoFirebaseRuntime.currentUser(context);
        if (user == null) return;
        String uid = user.getUid();
        for (String id : ids(index)) {
            SharedPreferences pending = entry(context, id);
            if (!uid.equals(pending.getString("driverId", "")) || isCompletionRecorded(index, pending)) continue;
            if (isRecoverablePermissionPause(pending) && validatedReceipt(pending) != null) {
                ProPendingTripJobService.schedulePermissionRecovery(context);
                if (pending.getLong("autoAccessProbeAt505", 0L) + 300_000L <= System.currentTimeMillis()) {
                    String fingerprint = contractRecoveryFingerprint(pending);
                    if (!fingerprint.isEmpty() && pending.edit().putLong("autoAccessProbeAt505", System.currentTimeMillis()).commit())
                        SimpleProNativeSubmissionCoordinator.probeCompanyAccess(context, pending.getString("companyId", ""), allowed -> {
                            com.google.firebase.auth.FirebaseUser current = GtoFirebaseRuntime.currentUser(context);
                            if (!allowed || current == null || !uid.equals(current.getUid()) || !fingerprint.equals(contractRecoveryFingerprint(pending))
                                || !isRecoverablePermissionPause(pending)) return;
                            if ("pending-retry-requested".equals(requestRetry(context, index, id, uid))) {
                                ProPendingTripJobService.scheduleImmediate(context);
                                SimpleAutomationService.triggerPendingProcessing(context);
                            }
                        });
                }
            }
            String reason = pending.getString("reasonCode", "") + ":" + pending.getString("lastQueueErrorCode", "") + " " + pending.getString("lastQueueError", "");
            if ("FAILED".equals(pending.getString("queueStatus", "")) && isRetryAllowed(pending)
                && PendingTripFailurePolicy.isAutomaticRecoveryAllowed(reason) && validatedReceipt(pending) != null) {
                pending.edit().putString("queueStatus", "WAITING")
                    .putString("nativeSubmissionState", "QUEUED")
                    .putString(CanonicalTripOutboxSchema.KEY_STATE, CanonicalTripOutboxSchema.STATE_PENDING_SYNC)
                    .putLong("retryAt", System.currentTimeMillis() + retryDelay(pending, reason)).commit();
            }
            if (pending.getBoolean("serverRetryableExplicit", false) && !pending.getBoolean("serverRetryable", true)) continue;
            if (canRequestContractRecovery(pending)) ProPendingTripJobService.schedulePermissionRecovery(context);
            if (!canRequestContractRecovery(pending) || pending.getLong("autoCompatibilityProbeAt505", 0L) + 300_000L > System.currentTimeMillis()) continue;
            String fingerprint = contractRecoveryFingerprint(pending);
            if (fingerprint.isEmpty() || !pending.edit().putLong("autoCompatibilityProbeAt505", System.currentTimeMillis()).commit()) continue;
            SimpleProNativeSubmissionCoordinator.probeGtoBackendCompatibility(context, (compatible, unavailable) -> {
                com.google.firebase.auth.FirebaseUser current = GtoFirebaseRuntime.currentUser(context);
                if (!compatible || current == null || !uid.equals(current.getUid())) return;
                if (authorizeSpecificGtoContractMismatch(context, index, id, uid, GtoBackendCompatibilityPolicy.VERSION, fingerprint)
                    && "pending-retry-requested".equals(requestSpecificGtoContractMismatch(context, index, id, uid))) {
                    ProPendingTripJobService.scheduleImmediate(context);
                    SimpleAutomationService.triggerPendingProcessing(context);
                }
            });
        }
    }

    static synchronized void recoverLegacyGtoRejection(Context context, SharedPreferences index) {
        recoverAutomatically(context, index);
        for (String id : ids(index)) {
            SharedPreferences entry = entry(context, id);
            if (isCompletionRecorded(index, entry)) continue;
            String error = entry.getString("lastQueueErrorCode", "");
            String message = entry.getString("lastQueueError", "");
            boolean terminalOperationRejection = PendingTripFailurePolicy.isTerminalOperationRejection(
                (error == null ? "" : error) + " " + (message == null ? "" : message));
            if (!"FAILED".equals(entry.getString("queueStatus", ""))
                || terminalOperationRejection
                || !isRetryAllowed(entry)
                || entry.getInt("failurePolicyRecoveryVersion", 0) >= 416
                || !(error.startsWith("LOW_VALUE_REPAIR_FAILED:FAILED_PRECONDITION")
                    || error.startsWith("LOW_VALUE_REPAIR_NOT_CONFIRMED")
                    || error.startsWith("GTO_PRO_REGISTRATION_FAILED:FAILED_PRECONDITION")
                    || error.startsWith("SIMPLE_REGISTRATION_FAILED:FAILED_PRECONDITION"))
                || validatedReceipt(entry) == null) continue;
            // One-time recovery for receipts frozen by the old policy that treated
            // every FAILED_PRECONDITION as permanent. The immutable receipt and
            // attempt identity are preserved; the server remains authoritative.
            entry.edit().putInt("failurePolicyRecoveryVersion", 416)
                .putInt("registrationProtocolVersion", Math.max(416, entry.getInt("registrationProtocolVersion", 0)))
                .putInt(CanonicalTripOutboxSchema.KEY_SCHEMA_VERSION, CanonicalTripOutboxSchema.VERSION)
                .putString(CanonicalTripOutboxSchema.KEY_STATE, CanonicalTripOutboxSchema.STATE_PENDING_SYNC)
                .putString("queueStatus", "WAITING")
                .putString("nativeSubmissionState", "QUEUED")
                .putLong("retryAt", 0L)
                .remove("nativeOperationReconciliationAttempted")
                .remove("nativeOperationReconciliationGeneration")
                .putString("lastQueueError", "Reavaliando a viagem salva com a política de falhas atualizada.")
                .commit();
        }
    }

    static synchronized void remove(Context context, SharedPreferences indexPrefs, String id) {
        List<String> pending = ids(indexPrefs);
        pending.remove(id);
        if (writeIndex(indexPrefs, pending)) {
            // Do not resurrect an ACK from the discovery journal on restart.
            if (indexPrefs.edit().remove(JOURNAL_PREFIX + id).commit())
                context.getApplicationContext().deleteSharedPreferences(PREFIX + id);
        }
    }

    static synchronized boolean contains(SharedPreferences indexPrefs, String id) {
        return ids(indexPrefs).contains(id);
    }

    static boolean isCompletionRecorded(SharedPreferences index, SharedPreferences entry) {
        String driver = capturedOrDirect(entry, "captureDriverId", "driverId");
        String job = capturedOrDirect(entry, "captureJobId", "jobId");
        String company = capturedOrDirect(entry, "captureCompanyId", "companyId");
        String contract = capturedOrDirect(entry, "captureContractId", "contractId");
        CompletedOperationScope scope = CompletedOperationScope.verified(driver, job, driver, company, contract, "completed");
        return scope != null && index.getLong(scope.markerKey(), 0L) > 0L;
    }

    private static String capturedOrDirect(SharedPreferences entry, String capturedKey, String directKey) {
        String captured = entry.getString(capturedKey, "");
        return captured == null || captured.trim().isEmpty() ? entry.getString(directKey, "") : captured;
    }

    static final class CompletedDiscard {
        final boolean markerRecorded;
        final int discardedCount;
        final List<String> cancelledAttemptIds;
        CompletedDiscard(boolean recorded, int count, List<String> ids) {
            markerRecorded = recorded; discardedCount = count; cancelledAttemptIds = ids;
        }
    }

    /** Terminal barrier is committed before cancellation/removal. It fences
     * retries and late callbacks even if a per-entry or index cleanup fails. */
    static synchronized CompletedDiscard discardCompletedOperation(Context context, SharedPreferences index,
                                                                    CompletedOperationScope scope) {
        if (scope == null) return new CompletedDiscard(false, 0, new ArrayList<>());
        if (index.getLong(scope.markerKey(), 0L) <= 0L
            && !index.edit().putLong(scope.markerKey(), System.currentTimeMillis()).commit())
            return new CompletedDiscard(false, 0, new ArrayList<>());
        List<String> keep = new ArrayList<>();
        List<String> cancel = new ArrayList<>();
        for (String id : ids(index)) {
            SharedPreferences pending = entry(context, id);
            if (!scope.matches(pending)) { keep.add(id); continue; }
            cancel.add(id);
            pending.edit().putInt("nativeAttemptGeneration", pending.getInt("nativeAttemptGeneration", 0) + 1)
                .putString("queueStatus", DISCARDED_OPERATION_COMPLETED)
                .putString(CanonicalTripOutboxSchema.KEY_STATE, DISCARDED_OPERATION_COMPLETED)
                .putString("nativeSubmissionState", DISCARDED_OPERATION_COMPLETED)
                .putString("reasonCode", "OPERATION_COMPLETED")
                .putLong("discardedAt", System.currentTimeMillis()).commit();
        }
        if (cancel.isEmpty()) return new CompletedDiscard(true, 0, cancel);
        if (!writeIndex(index, keep)) return new CompletedDiscard(true, 0, cancel);
        for (String id : cancel) {
            // The terminal marker fences callbacks even if journal cleanup fails.
            if (index.edit().remove(JOURNAL_PREFIX + id).commit())
                context.getApplicationContext().deleteSharedPreferences(PREFIX + id);
        }
        return new CompletedDiscard(true, cancel.size(), cancel);
    }

    static synchronized void pruneAcknowledgedEntries(Context context, SharedPreferences index, String uid) {
        if (uid == null || uid.isEmpty()) return;
        for (String id : ids(index)) {
            SharedPreferences pending = entry(context, id);
            if (uid.equals(pending.getString("driverId", ""))
                && "SYNCED".equals(pending.getString("queueStatus", ""))
                && CanonicalTripOutboxSchema.STATE_SERVER_CONFIRMED.equals(pending.getString(CanonicalTripOutboxSchema.KEY_STATE, ""))
                && !pending.getString("submissionTripId", "").isEmpty()) remove(context, index, id);
        }
    }

    private static boolean writeIndex(SharedPreferences prefs, List<String> ids) {
        JSONArray array = new JSONArray();
        for (String id : ids) array.put(id);
        // One durable commit updates both copies; journal markers are held
        // until removal so an interrupted/corrupt index can be reconstructed.
        return prefs.edit().putString(INDEX, array.toString())
            .putString(INDEX_BACKUP, array.toString()).commit();
    }
}
