package com.nvu.operacional;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import java.util.List;

/** Network-constrained recovery when the overlay service is no longer running. */
public final class ProPendingTripJobService extends JobService {
    private static volatile ProPendingTripJobService instance;
    private static final int JOB_ID = 47632;
    private static final int PERMISSION_RECOVERY_JOB_ID = 47634;
    private static final int IMMEDIATE_JOB_ID = 47633;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String activeId = "";
    private int activeJobId = -1;
    private int activeGeneration;
    private boolean stopped;
    private JobParameters activeParameters;

    @Override public void onCreate() { super.onCreate(); instance = this; }
    @Override public void onDestroy() { if (instance == this) instance = null; super.onDestroy(); }

    static void onCompletedOperationQueueDiscarded(java.util.List<String> attempts) {
        ProPendingTripJobService active = instance;
        if (active == null) return;
        active.handler.post(() -> {
            if (!attempts.contains(active.activeId)) return;
            JobParameters params = active.activeParameters;
            active.activeId = "";
            active.activeJobId = -1;
            active.activeParameters = null;
            if (params != null) active.jobFinished(params, active.hasRetryable(active.getSharedPreferences(
                SimpleAutomationService.PREFS_NAME, MODE_PRIVATE)));
        });
    }

    static void schedule(Context context) {
        if (context == null) return;
        SharedPreferences prefs = context.getApplicationContext().getSharedPreferences(
            SimpleAutomationService.PREFS_NAME, Context.MODE_PRIVATE);
        if (ProPendingTripStore.ids(prefs).isEmpty()) return;
        JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;
        JobInfo job = new JobInfo.Builder(JOB_ID,
            new ComponentName(context.getApplicationContext(), ProPendingTripJobService.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setBackoffCriteria(15000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
            .setPersisted(true)
            .build();
        try {
            scheduler.schedule(job);
        } catch (RuntimeException error) {
            android.util.Log.w("NVU-ProQueue", "Agendamento indisponível", error);
        }
    }

    /** Infrequent server authorization checks for nonterminal permission pauses. */
    static void schedulePermissionRecovery(Context context) {
        if (context == null) return;
        JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null || scheduler.getPendingJob(PERMISSION_RECOVERY_JOB_ID) != null) return;
        try {
            scheduler.schedule(new JobInfo.Builder(PERMISSION_RECOVERY_JOB_ID,
                new ComponentName(context.getApplicationContext(), ProPendingTripJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15 * 60_000L).setPersisted(true).build());
        } catch (RuntimeException error) { android.util.Log.w("NVU-ProQueue", "Recuperação de permissão será retomada ao abrir o app", error); }
    }

    /** Foreground recovery gets an expedited start; the persisted job remains
     * the fallback for offline, quota exhaustion and device reboot. */
    static void scheduleImmediate(Context context) {
        schedule(context);
        if (context == null || android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.S) return;
        SharedPreferences prefs = context.getApplicationContext().getSharedPreferences(
            SimpleAutomationService.PREFS_NAME, Context.MODE_PRIVATE);
        if (ProPendingTripStore.ids(prefs).isEmpty()) return;
        JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;
        JobInfo job = new JobInfo.Builder(IMMEDIATE_JOB_ID,
            new ComponentName(context.getApplicationContext(), ProPendingTripJobService.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setExpedited(true)
            .build();
        try {
            scheduler.schedule(job);
        } catch (RuntimeException error) {
            android.util.Log.w("NVU-ProQueue", "Agendamento imediato indisponível; fila durável preservada", error);
        }
    }

    @Override public boolean onStartJob(JobParameters params) {
        if (!activeId.isEmpty()) return false;
        stopped = false;
        if (SimpleAutomationService.isRunning()) {
            SimpleAutomationService.triggerPendingProcessing();
            return false;
        }
        SharedPreferences index = getSharedPreferences(SimpleAutomationService.PREFS_NAME, MODE_PRIVATE);
        CompletedProOperationQueueCleaner.reconcile(this, (verified, count, reason) -> {});
        ProPendingTripStore.recoverLegacyGtoRejection(this, index);
        com.google.firebase.auth.FirebaseUser nativeUser = GtoFirebaseRuntime.currentUser(this);
        String nativeUid = nativeUser == null ? "" : nativeUser.getUid();
        ProPendingTripStore.pruneAcknowledgedEntries(this, index, nativeUid);
        SimpleAutomationService.recoverAuthenticatedPending(this);
        List<String> ids = ProPendingTripStore.ids(index);
        boolean permissionCandidate = false;
        for (String id : ids) {
            SharedPreferences pending = ProPendingTripStore.entry(this, id);
            permissionCandidate |= ProPendingTripStore.isRecoverablePermissionPause(pending) ||
                ProPendingTripStore.canRequestContractRecovery(pending) &&
                !(pending.getBoolean("serverRetryableExplicit", false) && !pending.getBoolean("serverRetryable", true));
        }
        if (!permissionCandidate) {
            JobScheduler scheduler = (JobScheduler) getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (scheduler != null) scheduler.cancel(PERMISSION_RECOVERY_JOB_ID);
        }
        boolean retryLater = false;
        for (String id : ids) {
            SharedPreferences entry = ProPendingTripStore.entry(this, id);
            if (PendingOperationStartStore.blocks(this, entry)) { retryLater = true; continue; }
            if (ProPendingTripStore.isCompletionRecorded(index, entry)) continue;
            String queueStatus = entry.getString("queueStatus", "");
            if ("FAILED".equals(queueStatus)) continue;
            // Upgrade the receipt left WAITING by the 396 build. It is the
            // same immutable attempt; never ask the simulator to repeat it.
            String legacyError = entry.getString("lastQueueError", "");
            if ("WAITING".equals(queueStatus)
                && legacyError != null && legacyError.contains("Autenticação nativa não corresponde")) {
                if (nativeUid.isEmpty() || !nativeUid.equals(entry.getString("driverId", ""))) {
                    entry.edit().putString("queueStatus", "AUTH_REQUIRED")
                        .putString("nativeSubmissionState", "AUTH_REQUIRED")
                        .putString("nativeAuthState", nativeUid.isEmpty() ? "MISSING" : "DIVERGENT")
                        .putLong("nativeAuthDiagnosticAt", System.currentTimeMillis())
                        .putString("lastQueueError", "Autenticação Google necessária para retomar o envio desta viagem.")
                        .apply();
                    continue;
                }
                entry.edit().putLong("retryAt", 0L).remove("lastQueueError").apply();
            }
            if ("AUTH_REQUIRED".equals(queueStatus)) {
                // Async auth recovery schedules a fresh job after token refresh.
                continue;
            }
            if ("PERMISSION_PAUSED".equals(queueStatus)) continue;
            boolean permissionPaused = "MATCH".equals(entry.getString("nativeAuthState", "UNKNOWN"))
                && SimpleProNativeSubmissionCoordinator.isPermissionFailureReason(
                    entry.getString("lastQueueErrorCode", ""));
            if (permissionPaused) continue;
            int generation = ProPendingTripStore.claim(this, index, id);
            if (generation < 0) {
                retryLater = true;
                continue;
            }
            activeId = id;
            activeJobId = params.getJobId();
            activeGeneration = generation;
            activeParameters = params;
            SimpleProNativeSubmissionCoordinator.submit(this, entry,
                entry.getString("receiptText", ""), new SimpleProNativeSubmissionCoordinator.Listener() {
                    @Override public void onSuccess(String tripId) {
                        handler.post(() -> {
                            if (ProPendingTripStore.isCompletionRecorded(index, entry)) return;
                            if (stopped || activeJobId != params.getJobId()
                                || activeGeneration != generation
                                || generation != entry.getInt("nativeAttemptGeneration", 0)) return;
                            if (ProPendingTripStore.contains(index, id)) {
                                ProPendingTripStore.remove(ProPendingTripJobService.this, index, id);
                                if (id.equals(index.getString("lastPendingProAttemptId", ""))) {
                                    index.edit().putString("nativeSubmissionState", "SYNCED")
                                        .putString("nativeTripId", tripId)
                                        .putString("lastEvent", "Viagem registrada no servidor").apply();
                                }
                            }
                            activeId = "";
                            activeJobId = -1;
                            activeParameters = null;
                            // Drain consecutive saved receipts while network and
                            // native authentication are already available.
                            jobFinished(params, hasRetryable(index));
                        });
                    }
                    @Override public void onFallback(String reason) {
                        handler.post(() -> {
                            if (ProPendingTripStore.isCompletionRecorded(index, entry)) return;
                            if (stopped || activeJobId != params.getJobId()
                                || activeGeneration != generation) return;
                            if (activeGeneration != entry.getInt("nativeAttemptGeneration", 0)) {
                                activeId = "";
                                activeJobId = -1;
                                activeParameters = null;
                                jobFinished(params, false);
                                return;
                            }
                            boolean rejected = isPermanentRejection(entry.getString("reasonCode", "") + ":" + reason);
                            boolean permissionFailure = SimpleProNativeSubmissionCoordinator.isPermissionFailureReason(reason);
                            boolean authRequired = SimpleProNativeSubmissionCoordinator.isAuthRequiredReason(reason);
                            boolean permissionPaused = permissionFailure
                                && "MATCH".equals(entry.getString("nativeAuthState", "UNKNOWN"));
                            String safeReason = authRequired
                                ? "Autenticação Google necessária para retomar o envio desta viagem."
                                : permissionPaused
                                    ? "Envio pausado por permissão do servidor. O recibo segue salvo e será retomado quando o servidor confirmar o acesso."
                                : reason != null && reason.contains("GTO_PRO_BACKEND_NOT_DEPLOYED")
                                    ? "Atualização do registro GTO no servidor pendente. A viagem segue salva e será reenviada automaticamente."
                                : isReconciliationRequired(reason)
                                    ? "Estado da operação em reconciliação. A mesma viagem permanece salva e será reenviada automaticamente."
                                : reason != null && (reason.contains("GTO_PRO_REGISTRATION_FAILED:FAILED_PRECONDITION")
                                    || reason.contains("GTO_PRO_REGISTRATION_FAILED:PERMISSION_DENIED")
                                    || reason.contains("GTO_PRO_REGISTRATION_FAILED:INVALID_ARGUMENT"))
                                    ? (rejected
                                        ? "Registro rejeitado por uma condição permanente. A viagem foi preservada para revisão."
                                        : "O servidor ainda não confirmou a viagem. O mesmo recibo será reenviado automaticamente.")
                                : reason != null && reason.contains("NATIVE_RECEIPT_EVIDENCE_CONFLICT")
                                    ? "Conflito entre o comprovante salvo e a viagem no servidor (valor, rota ou simulador). Revisão necessária."
                                : permissionFailure
                                    ? "Envio bloqueado por permissão; a etapa exata precisa de diagnóstico. A viagem permanece salva."
                                    : (reason == null ? "" : reason);
                            entry.edit().putString(CanonicalTripOutboxSchema.KEY_STATE, rejected
                                    ? CanonicalTripOutboxSchema.STATE_FAILED : CanonicalTripOutboxSchema.STATE_PENDING_SYNC)
                                .putString("nativeSubmissionState", authRequired ? "AUTH_REQUIRED" : (rejected ? "FAILED" : (permissionPaused ? "PERMISSION_PAUSED" : "QUEUED")))
                                .putString("queueStatus", authRequired ? "AUTH_REQUIRED" : (rejected ? "FAILED" : (permissionPaused ? "PERMISSION_PAUSED" : "WAITING")))
                                .putString("lastQueueError", safeReason)
                                .putString("lastQueueErrorCode", reason == null ? "" : reason)
                                .putBoolean("contractMismatchRecoveryAuthorized", !rejected
                                    && entry.getBoolean("contractMismatchRecoveryAuthorized", false))
                                .putBoolean("contractMismatchRecoveryRequested", !rejected
                                    && entry.getBoolean("contractMismatchRecoveryRequested", false))
                                .putLong("retryAt", permissionPaused ? 0L : System.currentTimeMillis()
                                    + ProPendingTripStore.retryDelay(entry, reason))
                                .apply();
                            if (permissionPaused && ProPendingTripStore.isRecoverablePermissionPause(entry)) schedulePermissionRecovery(ProPendingTripJobService.this);
                            activeId = "";
                            activeJobId = -1;
                            activeParameters = null;
                            jobFinished(params, hasRetryable(index));
                        });
                    }
                });
            return true;
        }
        if (retryLater) {
            handler.post(() -> { if (!stopped) jobFinished(params, true); });
            return true;
        }
        return false;
    }

    private boolean hasRetryable(SharedPreferences index) {
        for (String id : ProPendingTripStore.ids(index)) {
            SharedPreferences entry = ProPendingTripStore.entry(this, id);
            if (ProPendingTripStore.isCompletionRecorded(index, entry) || !ProPendingTripStore.isRetryAllowed(entry)) continue;
            String status = entry.getString("queueStatus", "");
            boolean permissionPaused = "MATCH".equals(entry.getString("nativeAuthState", "UNKNOWN"))
                && SimpleProNativeSubmissionCoordinator.isPermissionFailureReason(
                    entry.getString("lastQueueErrorCode", ""));
            // Auth, permanent rejection and matched-session permission failures
            // wait for explicit recovery; they must not spin in JobScheduler.
            if (!"FAILED".equals(status) && !"AUTH_REQUIRED".equals(status)
                && !"PERMISSION_PAUSED".equals(status) && !permissionPaused) return true;
        }
        return false;
    }

    private static boolean isReconciliationRequired(String reason) {
        return PendingTripFailurePolicy.isReconciliationRequired(reason);
    }

    private static boolean isPermanentRejection(String reason) {
        return PendingTripFailurePolicy.isPermanentRejection(reason);
    }

    @Override public boolean onStopJob(JobParameters params) {
        if (params.getJobId() != activeJobId) return false;
        stopped = true;
        if (!activeId.isEmpty()) {
            SharedPreferences entry = ProPendingTripStore.entry(this, activeId);
            if (!ProPendingTripStore.isCompletionRecorded(getSharedPreferences(SimpleAutomationService.PREFS_NAME, MODE_PRIVATE), entry)
                && ProPendingTripStore.isRetryAllowed(entry)
                && entry.getInt("nativeAttemptGeneration", 0) == activeGeneration) {
                entry.edit().putInt("nativeAttemptGeneration", activeGeneration + 1)
                    .putString("nativeSubmissionState", "QUEUED")
                    .putString("queueStatus", "WAITING").apply();
            }
            activeId = "";
            activeJobId = -1;
            activeParameters = null;
        }
        return true;
    }
}
