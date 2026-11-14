package com.nvu.operacional;

import java.util.*;
import android.content.SharedPreferences;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.firestore.*;
import com.google.firebase.functions.FirebaseFunctions;
import com.nvu.operacional.ProRejectionHarness.Ctx;
import com.nvu.operacional.ProRejectionHarness.Prefs;

public final class OperationCompletionQueueHarness {
    static final String UID = "driver123456", JOB = "job12345678", COMPANY = "company123456", CONTRACT = "contract123456";
    static int cases;
    static final class Response {
        boolean called, verified; int count; String reason;
        void set(boolean ok, int removed, String why) { called = true; verified = ok; count = removed; reason = why; }
    }
    static void equal(Object a, Object b, String why) { ProRejectionHarness.equal(a, b, why); }
    static void test(String name, Runnable run) {
        FirebaseFirestore.reset(); GtoFirebaseRuntime.user = new FirebaseUser(UID);
        FirebaseAuth.user = GtoFirebaseRuntime.user; FirebaseFunctions.pending.clear();
        SimpleAutomationService.cancellationNotifications = 0; ProPendingTripJobService.cancellationNotifications = 0;
        run.run(); cases++; System.out.println("PASS " + name);
    }
    static Prefs index(Ctx ctx) { return (Prefs)ctx.getSharedPreferences(SimpleAutomationService.PREFS_NAME, 0); }
    static CompletedOperationScope scope() { return CompletedOperationScope.verified(UID, JOB, UID, COMPANY, CONTRACT, "completed"); }
    static Map<String,Object> job(String status) {
        Map<String,Object> data = new HashMap<>();
        data.put("driverId", UID); data.put("companyId", COMPANY); data.put("contractId", CONTRACT); data.put("status", status);
        data.put("progress", 12); data.put("totalDeliveries", 12); return data;
    }
    static Prefs seed(Ctx ctx, String id, String state) {
        Prefs p = (Prefs)ProPendingTripStore.entry(ctx, id);
        p.data.put("driverId", UID); p.data.put("jobId", JOB); p.data.put("companyId", COMPANY); p.data.put("contractId", CONTRACT);
        for (String key : new String[]{"Driver", "Job", "Company", "Contract"}) p.data.put("capture" + key + "Id", p.data.get(key.substring(0,1).toLowerCase() + key.substring(1) + "Id"));
        p.data.put("captureAttemptId", id); p.data.put("queueStatus", state); p.data.put("outboxState", state);
        p.data.put("nativeAttemptGeneration", 5); p.data.put("receiptText", "VALOR A RECEBER 2.563,00");
        List<String> ids = ProPendingTripStore.ids(index(ctx)); ids.add(id);
        org.json.JSONArray array = new org.json.JSONArray(); for (String value : ids) array.put(value);
        index(ctx).data.put("pendingProTripAttemptIds", array.toString()); return p;
    }
    static Response clean(Ctx ctx) {
        Response result = new Response(); CompletedProOperationQueueCleaner.verifyAndDiscard(ctx, JOB, result::set); return result;
    }
    static final class SubmissionResult implements SimpleProNativeSubmissionCoordinator.Listener {
        int successes, failures;
        public void onSuccess(String trip) { successes++; }
        public void onFallback(String reason) { failures++; }
    }
    static void nativeAck(Ctx ctx, Prefs prefs, SubmissionResult listener) {
        try {
            java.lang.reflect.Method method = SimpleProNativeSubmissionCoordinator.class.getDeclaredMethod("nativeSuccess",
                android.content.Context.class, SharedPreferences.class, String.class, SimpleProNativeSubmissionCoordinator.Listener.class);
            method.setAccessible(true); method.invoke(null, ctx, prefs, "nvu_confirmed_trip", listener);
        } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
    }
    public static void main(String[] args) {
        test("every local state discarded after server completion; exact scope only", () -> {
            Ctx ctx = new Ctx(); Map<String,Object> server = job("completed"); FirebaseFirestore.documents.put(JOB, server);
            Map<String,Object> before = new HashMap<>(server);
            String[] states = {"WAITING", "SENDING", "AUTH_REQUIRED", "PERMISSION_PAUSED", "FAILED", "CONFLICT", "QUEUED", "SYNCED"};
            List<Prefs> old = new ArrayList<>();
            for (int i=0;i<states.length;i++) old.add(seed(ctx, "pro-scope-state-" + i, states[i]));
            Prefs foreign = seed(ctx, "pro-foreign-user", "FAILED"); foreign.data.put("driverId", "other-user");
            Prefs otherJob = seed(ctx, "pro-other-operation", "WAITING"); otherJob.data.put("jobId", "other-job");
            Prefs otherCompany = seed(ctx, "pro-other-company", "SENDING"); otherCompany.data.put("companyId", "other-company");
            Prefs otherContract = seed(ctx, "pro-other-contract", "WAITING"); otherContract.data.put("contractId", "other-contract");
            Prefs badCapture = seed(ctx, "pro-foreign-capture", "WAITING"); badCapture.data.put("captureJobId", "foreign-job");
            Response result = clean(ctx); equal(result.verified, true, "server proof"); equal(result.count, states.length, "removed count");
            equal(ProPendingTripStore.ids(index(ctx)).size(), 5, "unrelated entries preserved"); equal(server, before, "server history/projection untouched");
            for (Prefs p : old) { equal(p.getInt("nativeAttemptGeneration", 0), 6, "obsolete callback fenced"); equal(ProPendingTripStore.isCompletionRecorded(index(ctx), p), true, "terminal marker"); }
            equal(SimpleAutomationService.cancellationNotifications, 1, "overlay notified"); equal(ProPendingTripJobService.cancellationNotifications, 1, "background job notified");
        });
        for (String status : new String[]{"active", "awaiting_completion", "cancelled"}) test("cached 12/12 cannot clean " + status, () -> {
            Ctx ctx = new Ctx(); Prefs p = seed(ctx, "pro-active-operation", "FAILED"); Map<String,Object> before = new HashMap<>(p.data);
            index(ctx).data.put("jobStatus", "completed"); FirebaseFirestore.documents.put(JOB, job(status));
            Response result = clean(ctx); equal(result.verified, false, "nonterminal server status"); equal(p.data, before, "receipt preserved"); equal(index(ctx).edits, 0, "no writes before proof");
        });
        test("foreign server owner cannot cancel a receipt", () -> {
            Ctx ctx = new Ctx(); Prefs p = seed(ctx, "pro-foreign-server", "WAITING"); Map<String,Object> server = job("completed"); server.put("driverId", "other-user"); FirebaseFirestore.documents.put(JOB, server);
            equal(clean(ctx).verified, false, "foreign owner"); equal(p.edits, 0, "no entry write"); equal(index(ctx).edits, 0, "no marker");
        });
        test("offline or missing server document preserves the queue", () -> {
            Ctx ctx = new Ctx(); Prefs p = seed(ctx, "pro-offline-proof", "FAILED"); FirebaseFirestore.offline = true;
            equal(clean(ctx).verified, false, "offline"); FirebaseFirestore.offline = false; equal(clean(ctx).verified, false, "missing document"); equal(p.edits, 0, "read-only failures");
        });
        test("native authentication required; job path validated", () -> {
            Ctx ctx = new Ctx(); seed(ctx, "pro-auth-proof", "WAITING"); GtoFirebaseRuntime.user = null;
            equal(clean(ctx).verified, false, "auth required"); GtoFirebaseRuntime.user = new FirebaseUser(UID);
            Response result = new Response(); CompletedProOperationQueueCleaner.verifyAndDiscard(ctx, "../foreign", result::set);
            equal(result.verified, false, "path rejected"); equal(FirebaseFirestore.reads, 0, "no server call"); equal(index(ctx).edits, 0, "queue untouched");
        });
        test("switching account before server reply cancels cleanup", () -> {
            Ctx ctx = new Ctx(); Prefs p = seed(ctx, "pro-account-switch", "SENDING"); FirebaseFirestore.defer = true;
            Response result = clean(ctx); equal(result.called, false, "awaits proof"); GtoFirebaseRuntime.user = new FirebaseUser("other-user");
            FirebaseFirestore.deferredTasks.get(0).finish(new DocumentSnapshot(job("completed")), true);
            equal(result.verified, false, "account changed"); equal(p.edits, 0, "receipt unchanged"); equal(index(ctx).edits, 0, "no terminal marker");
        });
        test("concurrent cleanup shares one server verification", () -> {
            Ctx ctx = new Ctx(); seed(ctx, "pro-deduped-read", "WAITING"); FirebaseFirestore.defer = true;
            Response first = clean(ctx), second = clean(ctx); equal(second.reason, "OPERATION_CLEANUP_IN_PROGRESS", "dedupe"); equal(FirebaseFirestore.reads, 1, "one server read");
            FirebaseFirestore.deferredTasks.get(0).finish(new DocumentSnapshot(job("completed")), true); equal(first.count, 1, "original finishes");
        });
        test("marker write failure preserves evidence and retries", () -> {
            Ctx ctx = new Ctx(); Prefs p = seed(ctx, "pro-marker-failure", "WAITING"); index(ctx).fail = true; FirebaseFirestore.documents.put(JOB, job("completed"));
            Response result = clean(ctx); equal(result.verified, false, "failed durable proof"); equal(p.edits, 0, "entry never modified"); equal(ProPendingTripStore.ids(index(ctx)).size(), 1, "index retained");
        });
        test("index failure cannot resurrect receipt; offline restart finishes cleanup", () -> {
            Ctx ctx = new Ctx(); Prefs p = seed(ctx, "pro-index-failure", "SENDING"); index(ctx).failCommitNumber = 2; FirebaseFirestore.documents.put(JOB, job("completed"));
            Response result = clean(ctx); equal(result.verified, true, "terminal proof committed first"); equal(result.count, 0, "index write deferred");
            equal(ProPendingTripStore.claim(ctx, index(ctx), "pro-index-failure"), -1, "claim fenced"); equal(ProPendingTripStore.requestRetry(ctx, index(ctx), "pro-index-failure", UID), "pending-operation-completed", "manual retry fenced");
            equal(ProPendingTripStore.isCompletionRecorded(index(ctx), p), true, "late callback fenced");
            FirebaseFirestore.offline = true; FirebaseFirestore.reads = 0; Response resumed = new Response(); CompletedProOperationQueueCleaner.reconcile(ctx, resumed::set);
            equal(ProPendingTripStore.ids(index(ctx)).size(), 0, "restart removes cancelled receipt"); equal(FirebaseFirestore.reads, 0, "durable terminal proof survives offline");
        });
        test("entry/delete failure still fences obsolete callbacks and new capture", () -> {
            Ctx ctx = new Ctx(); Prefs p = seed(ctx, "pro-entry-failure", "SENDING"); p.fail = true; ctx.failDelete = true; FirebaseFirestore.documents.put(JOB, job("completed"));
            equal(clean(ctx).verified, true, "marker survives entry failure"); equal(p.getInt("nativeAttemptGeneration", 0), 5, "failed entry commit");
            equal(ProPendingTripStore.isCompletionRecorded(index(ctx), p), true, "marker fences same generation"); equal(ProPendingTripStore.ids(index(ctx)).size(), 0, "not indexed");
            for (String key : new String[]{"captureDriverId", "captureJobId", "captureCompanyId", "captureContractId"}) index(ctx).data.put(key, p.data.get(key));
            index(ctx).data.put("captureAttemptId", "pro-new-stale-capture"); equal(ProPendingTripStore.enqueue(ctx, index(ctx), "VALOR A RECEBER 2.563,00"), "", "closed capture not enqueued");
        });
        test("legacy empty capture bindings use the immutable operation ids", () -> {
            Ctx ctx = new Ctx(); Prefs p = seed(ctx, "pro-empty-bindings", "WAITING");
            for (String key : new String[]{"captureDriverId", "captureJobId", "captureCompanyId", "captureContractId"}) p.data.put(key, "");
            p.fail = true; index(ctx).failCommitNumber = 2; FirebaseFirestore.documents.put(JOB, job("completed")); clean(ctx);
            equal(ProPendingTripStore.isCompletionRecorded(index(ctx), p), true, "empty binding fallback"); equal(ProPendingTripStore.claim(ctx, index(ctx), "pro-empty-bindings"), -1, "legacy attempt fenced");
        });
        test("completion markers isolate user, job, company and contract", () -> {
            Set<String> keys = new HashSet<>(); keys.add(scope().markerKey());
            keys.add(CompletedOperationScope.verified("other-user", JOB, "other-user", COMPANY, CONTRACT, "completed").markerKey());
            keys.add(CompletedOperationScope.verified(UID, "other-job", UID, COMPANY, CONTRACT, "completed").markerKey());
            keys.add(CompletedOperationScope.verified(UID, JOB, UID, "other-company", CONTRACT, "completed").markerKey());
            keys.add(CompletedOperationScope.verified(UID, JOB, UID, COMPANY, "other-contract", "completed").markerKey()); equal(keys.size(), 5, "independent scopes");
        });
        test("ACK pruning only removes current owner with persisted server confirmation", () -> {
            Ctx ctx = new Ctx(); Prefs valid = seed(ctx, "pro-confirmed-ack", "SYNCED"); valid.data.put("outboxState", "SERVER_CONFIRMED"); valid.data.put("submissionTripId", "trip-id");
            Prefs foreign = seed(ctx, "pro-foreign-ack", "SYNCED"); foreign.data.put("driverId", "other-user"); foreign.data.put("outboxState", "SERVER_CONFIRMED"); foreign.data.put("submissionTripId", "foreign-trip");
            Prefs missingId = seed(ctx, "pro-missing-ack-id", "SYNCED"); missingId.data.put("outboxState", "SERVER_CONFIRMED");
            Prefs incomplete = seed(ctx, "pro-pending-ack", "WAITING"); incomplete.data.put("submissionTripId", "trip-id");
            ProPendingTripStore.pruneAcknowledgedEntries(ctx, index(ctx), UID); equal(ProPendingTripStore.ids(index(ctx)).size(), 3, "only full ACK pruned");
        });
        test("already completed cleanup is idempotent", () -> {
            Ctx ctx = new Ctx(); seed(ctx, "pro-repeat-cleanup", "FAILED"); FirebaseFirestore.documents.put(JOB, job("completed"));
            equal(clean(ctx).count, 1, "first cleanup"); Response second = clean(ctx); equal(second.verified, true, "same terminal proof"); equal(second.count, 0, "no repeated mutation");
        });
        test("startup recovery clears old completed operation and keeps active/foreign attempts", () -> {
            Ctx ctx = new Ctx(); seed(ctx, "pro-startup-closed", "FAILED"); Prefs active = seed(ctx, "pro-startup-active", "WAITING"); active.data.put("jobId", "active-job"); active.data.put("captureJobId", "active-job");
            Prefs foreign = seed(ctx, "pro-startup-foreign", "WAITING"); foreign.data.put("driverId", "other-user");
            FirebaseFirestore.documents.put(JOB, job("completed")); FirebaseFirestore.documents.put("active-job", job("active"));
            Response result = new Response(); CompletedProOperationQueueCleaner.reconcile(ctx, result::set);
            equal(result.count, 1, "completed operation recovered"); equal(ProPendingTripStore.ids(index(ctx)).size(), 2, "active/foreign untouched"); equal(active.edits, 0, "active evidence frozen"); equal(foreign.edits, 0, "foreign evidence frozen");
        });
        test("production native ACK commits terminal outbox before callback", () -> {
            Ctx ctx = new Ctx(); Prefs p = seed(ctx, "pro-durable-native-ack", "SENDING"); p.data.put("submissionTripId", "nvu_confirmed_trip");
            SubmissionResult result = new SubmissionResult(); nativeAck(ctx, p, result);
            equal(result.successes, 1, "one ACK callback"); equal(p.getString("queueStatus", ""), "SYNCED", "terminal queue state");
            equal(p.getString("outboxState", ""), "SERVER_CONFIRMED", "durable server ACK"); equal(ProPendingTripStore.claim(ctx, index(ctx), "pro-durable-native-ack"), -1, "no automatic replay");
            ProPendingTripStore.pruneAcknowledgedEntries(ctx, index(ctx), UID); equal(ProPendingTripStore.ids(index(ctx)).size(), 0, "restart can prune ACK");
        });
        test("failed ACK persistence never emits a success callback", () -> {
            Ctx ctx = new Ctx(); Prefs p = seed(ctx, "pro-ack-write-failure", "SENDING"); p.fail = true;
            SubmissionResult result = new SubmissionResult(); nativeAck(ctx, p, result); equal(result.successes, 0, "no false persisted ACK"); equal(result.failures, 1, "queue retains recoverable attempt");
        });
        test("production submission owner never sends a discarded capture", () -> {
            Ctx ctx = new Ctx(); Prefs p = seed(ctx, "pro-discarded-submit", "SENDING"); FirebaseFirestore.documents.put(JOB, job("completed")); clean(ctx);
            int edits = p.edits; SubmissionResult result = new SubmissionResult();
            SimpleProNativeSubmissionCoordinator.submit(ctx, p, "VALOR A RECEBER 2.563,00", result);
            nativeAck(ctx, p, result); equal(p.edits, edits, "obsolete attempt never modified"); equal(FirebaseFunctions.pending.size(), 0, "no registration callable"); equal(result.successes + result.failures, 0, "no stale callback");
        });
        test("late production registration reply cannot resurrect the discarded receipt", () -> {
            Ctx ctx = new Ctx(); Prefs p = seed(ctx, "pro-late-registration", "SENDING");
            p.data.put("captureContextEpoch", "global-truck:12345678"); p.data.put("captureOrigin", "Cruz do Oeste"); p.data.put("captureDestination", "Registro");
            p.data.put("captureSimulatorKey", "global-truck"); p.data.put("captureSimulatorCode", "GTO"); p.data.put("capturePackageId", "com.stargamesapps.gto");
            p.data.put("receiptSnapshotVersion", 1); p.data.put("receiptAmountCents", 256300); p.data.put("receiptCurrency", ""); p.data.put("receiptBonusEvidence", "NONE");
            SubmissionResult result = new SubmissionResult(); SimpleProNativeSubmissionCoordinator.submit(ctx, p, p.getString("receiptText", ""), result);
            equal(FirebaseFunctions.pending.size(), 1, "registered one immutable attempt before completion");
            FirebaseFirestore.documents.put(JOB, job("completed")); clean(ctx); int edits = p.edits;
            Map<String,Object> reply = new HashMap<>(); reply.put("registered", true); reply.put("tripId", "nvu_late_reply"); reply.put("confirmedTripCount", 12); reply.put("total", 12);
            FirebaseFunctions.pending.get(0).finish(new FirebaseFunctions.Result(reply), true);
            equal(p.edits, edits, "late reply cannot write"); equal(ProPendingTripStore.ids(index(ctx)).size(), 0, "queue remains empty"); equal(result.successes + result.failures, 0, "late response suppressed");
        });
        test("operation start barrier survives reload and isolates exact scope", () -> {
            Ctx ctx = new Ctx(); Prefs receipt = seed(ctx, "pro-offline-start", "WAITING");
            equal(PendingOperationStartStore.set(ctx, UID, COMPANY, JOB, true), true, "durable start");
            equal(PendingOperationStartStore.blocks(ctx, receipt), true, "receipt held");
            for (String name : new String[]{"Driver", "Company", "Job"}) receipt.data.put("capture" + name + "Id", "");
            equal(PendingOperationStartStore.blocks(ctx, receipt), true, "empty legacy bindings fall back");
            Prefs other = seed(ctx, "pro-unrelated-offline-start", "WAITING");
            other.data.put("captureJobId", "different-job"); equal(PendingOperationStartStore.blocks(ctx, other), false, "other operation unaffected");
            Map<String,Object> before = new HashMap<>(receipt.data); SubmissionResult result = new SubmissionResult();
            SimpleProNativeSubmissionCoordinator.submit(ctx, receipt, receipt.getString("receiptText", ""), result);
            equal(FirebaseFunctions.pending.size(), 0, "no remote registration before start ACK");
            for (Map.Entry<String,Object> field : before.entrySet()) equal(receipt.data.get(field.getKey()), field.getValue(), "immutable receipt retained: " + field.getKey());
            equal(PendingOperationStartStore.set(ctx, UID, COMPANY, JOB, false), true, "ACK release persisted");
            equal(PendingOperationStartStore.blocks(ctx, receipt), false, "receipt released");
        });
        test("capture pause never blocks upload or discards existing receipts", () -> {
            Ctx ctx = new Ctx(); Prefs receipt = seed(ctx, "pro-local-finish", "WAITING");
            Map<String,Object> before = new HashMap<>(receipt.data);
            equal(PendingOperationStartStore.setCapturePaused(ctx, UID, COMPANY, JOB, true), true, "local finish saved");
            equal(PendingOperationStartStore.capturePaused(ctx, receipt), true, "new capture paused");
            equal(PendingOperationStartStore.blocks(ctx, receipt), false, "existing receipt upload remains eligible");
            equal(receipt.data, before, "receipt is untouched");
            equal(PendingOperationStartStore.capturePaused(ctx, seed(ctx, "pro-other-finish", "WAITING")), true, "same operation shares pause");
            equal(PendingOperationStartStore.setCapturePaused(ctx, UID, COMPANY, "other-job", true), true, "separate job");
            equal(PendingOperationStartStore.setCapturePaused(ctx, UID, COMPANY, JOB, false), true, "rejection/retry can resume capture");
            equal(PendingOperationStartStore.capturePaused(ctx, receipt), false, "current scope resumed");
        });
        test("failed native barrier commit never claims local success", () -> {
            Ctx ctx = new Ctx(); ((Prefs)ctx.getSharedPreferences("nvu_operation_start_barriers_v1", 0)).fail = true;
            equal(PendingOperationStartStore.set(ctx, UID, COMPANY, JOB, true), false, "start fails closed");
            equal(PendingOperationStartStore.setCapturePaused(ctx, UID, COMPANY, JOB, true), false, "finish pause fails closed");
            equal(PendingOperationStartStore.blocks(ctx, UID, COMPANY, JOB), false, "failed value not invented");
        });
        System.out.println("PASS " + cases + " JVM operation cleanup/barrier cases (real scope, store, cleaner and submission coordinator; SDK/storage doubles)");
    }
}
