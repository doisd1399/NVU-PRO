package com.nvu.operacional;

import android.content.Context;
import android.content.SharedPreferences;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.Source;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/** Read-only server verification followed by owner-scoped local cancellation.
 * Never writes Firestore, registers a trip, or accepts a Web completion flag. */
final class CompletedProOperationQueueCleaner {
    interface Callback { void done(boolean verified, int discardedCount, String reason); }
    private static final Set<String> IN_FLIGHT = ConcurrentHashMap.newKeySet();
    private CompletedProOperationQueueCleaner() {}

    static void verifyAndDiscard(Context context, String requestedJobId, Callback callback) {
        Context app = context.getApplicationContext();
        FirebaseUser user = GtoFirebaseRuntime.currentUser(app);
        String uid = user == null ? "" : clean(user.getUid());
        String jobId = clean(requestedJobId);
        if (uid.isEmpty() || !jobId.matches("[A-Za-z0-9_-]{1,180}")) {
            callback.done(false, 0, "OPERATION_CLEANUP_AUTH_REQUIRED"); return;
        }
        String key = uid + ":" + jobId;
        if (!IN_FLIGHT.add(key)) { callback.done(false, 0, "OPERATION_CLEANUP_IN_PROGRESS"); return; }
        try {
            FirebaseFirestore.getInstance().collection("trabalhos").document(jobId).get(Source.SERVER)
                .addOnCompleteListener(task -> {
                    IN_FLIGHT.remove(key);
                    FirebaseUser current = GtoFirebaseRuntime.currentUser(app);
                    if (current == null || !uid.equals(current.getUid()) || !task.isSuccessful()
                        || task.getResult() == null || !task.getResult().exists()) {
                        callback.done(false, 0, "OPERATION_CLEANUP_UNVERIFIED"); return;
                    }
                    try {
                        DocumentSnapshot job = task.getResult();
                        CompletedOperationScope scope = CompletedOperationScope.verified(uid, jobId,
                            field(job, "driverId", "motoristaId", "userId"),
                            field(job, "companyId", "empresaId"), field(job, "contractId", "contratoId"),
                            field(job, "status"));
                        if (scope == null) { callback.done(false, 0, "OPERATION_NOT_COMPLETED_OR_FOREIGN"); return; }
                        discard(app, scope, callback);
                    } catch (RuntimeException error) {
                        callback.done(false, 0, "OPERATION_CLEANUP_STORAGE_FAILED");
                    }
                });
        } catch (RuntimeException error) {
            IN_FLIGHT.remove(key);
            callback.done(false, 0, "OPERATION_CLEANUP_UNAVAILABLE");
        }
    }

    static void reconcile(Context context, Callback callback) {
        Context app = context.getApplicationContext();
        FirebaseUser user = GtoFirebaseRuntime.currentUser(app);
        String uid = user == null ? "" : clean(user.getUid());
        if (uid.isEmpty()) { callback.done(false, 0, "OPERATION_CLEANUP_AUTH_REQUIRED"); return; }
        SharedPreferences index = app.getSharedPreferences(SimpleAutomationService.PREFS_NAME, Context.MODE_PRIVATE);
        Set<String> jobs = new LinkedHashSet<>();
        for (String id : ProPendingTripStore.ids(index)) {
            SharedPreferences entry = ProPendingTripStore.entry(app, id);
            if (!uid.equals(clean(entry.getString("driverId", "")))) continue;
            CompletedOperationScope scope = CompletedOperationScope.verified(uid, entry.getString("jobId", ""), uid,
                entry.getString("companyId", ""), entry.getString("contractId", ""), "completed");
            // A durable proof from a previous verified read remains valid after
            // reboot/offline: completed is terminal and the job id is immutable.
            if (scope != null && ProPendingTripStore.isCompletionRecorded(index, entry)) {
                discard(app, scope, (verified, count, reason) -> {});
            } else {
                String job = clean(entry.getString("jobId", ""));
                if (job.matches("[A-Za-z0-9_-]{1,180}")) jobs.add(job);
            }
        }
        if (jobs.isEmpty()) { callback.done(true, 0, ""); return; }
        AtomicInteger remaining = new AtomicInteger(jobs.size());
        AtomicInteger discarded = new AtomicInteger();
        for (String jobId : jobs) verifyAndDiscard(app, jobId, (verified, count, reason) -> {
            discarded.addAndGet(count);
            if (remaining.decrementAndGet() == 0) callback.done(true, discarded.get(), "");
        });
    }

    private static void discard(Context app, CompletedOperationScope scope, Callback callback) {
        FirebaseUser user = GtoFirebaseRuntime.currentUser(app);
        if (user == null || !scope.driverId.equals(user.getUid())) {
            callback.done(false, 0, "OPERATION_CLEANUP_AUTH_REQUIRED"); return;
        }
        SharedPreferences index = app.getSharedPreferences(SimpleAutomationService.PREFS_NAME, Context.MODE_PRIVATE);
        ProPendingTripStore.CompletedDiscard result = ProPendingTripStore.discardCompletedOperation(app, index, scope);
        if (result.markerRecorded) {
            SimpleAutomationService.onCompletedOperationQueueDiscarded(scope, result.cancelledAttemptIds);
            ProPendingTripJobService.onCompletedOperationQueueDiscarded(result.cancelledAttemptIds);
        }
        callback.done(result.markerRecorded, result.discardedCount,
            result.markerRecorded ? "" : "OPERATION_CLEANUP_STORAGE_FAILED");
    }
    private static String field(DocumentSnapshot row, String... keys) {
        for (String key : keys) { Object value = row.get(key); if (value instanceof String && !clean((String)value).isEmpty()) return clean((String)value); }
        return "";
    }
    private static String clean(String value) { return value == null ? "" : value.trim(); }
}
