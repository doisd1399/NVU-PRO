package com.nvu.operacional;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name = "SimpleAutomation")
public class SimpleAutomationPlugin extends Plugin {
    private static volatile SimpleAutomationPlugin instance;
    private final Handler receiptReplayHandler = new Handler(Looper.getMainLooper());
    private int receiptReplayAttempts;
    private final Runnable receiptReplayRunnable = new Runnable() {
        @Override
        public void run() {
            if (instance != SimpleAutomationPlugin.this) return;
            if (SimpleAutomationService.hasCapturedReceipt(getContext())) {
                emitReceiptCaptured();
                if (receiptReplayAttempts++ < 20) {
                    receiptReplayHandler.postDelayed(this, 250L);
                }
            } else {
                receiptReplayAttempts = 0;
            }
        }
    };

    private static final Set<String> ALLOWED_PACKAGES = new HashSet<>(Arrays.asList(
        "com.dynamicgames.worldtruckdrivingsimulator",
        "com.dynamicgames.worldbusdrivingsimulator",
        "com.WandaSoftware.TruckersofEurope3",
        "com.stargamesapps.gto"
    ));

    @Override
    public void load() {
        super.load();
        instance = this;
        receiptReplayAttempts = 0;
        receiptReplayHandler.post(receiptReplayRunnable);
    }

    @Override
    protected void handleOnDestroy() {
        receiptReplayHandler.removeCallbacks(receiptReplayRunnable);
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    public static void emitReceiptCaptured() {
        SimpleAutomationPlugin current = instance;
        if (current == null) return;
        JSObject payload = new JSObject();
        payload.put("stage", "CAPTURE_CAPTURED");
        payload.put("eventVersion", SimpleAutomationService.getCapturedReceiptEventVersion(current.getContext()));
        current.notifyListeners("receiptCaptured", payload);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void markOperationStartPending(PluginCall call) {
        String driver = safe(call.getString("driverId"));
        String company = safe(call.getString("companyId"));
        String job = safe(call.getString("jobId"));
        if (driver.isEmpty() || company.isEmpty() || job.isEmpty()) { call.reject("OPERATION_SCOPE_REQUIRED"); return; }
        boolean pending = Boolean.TRUE.equals(call.getBoolean("pending", true));
        boolean wasPending = PendingOperationStartStore.blocks(getContext(), driver, company, job);
        boolean saved = PendingOperationStartStore.set(getContext(), driver, company, job, pending);
        if (!saved) { call.reject("OPERATION_START_BARRIER_NOT_DURABLE"); return; }
        JSObject result = new JSObject(); result.put("saved", true); call.resolve(result);
        if (!pending && wasPending) {
            // Start ACK is an event: existing receipts need not wait for a
            // periodic background retry to discover their dependency cleared.
            ProPendingTripJobService.scheduleImmediate(getContext());
            GtoObserverService.retryAutomaticTripQueueIfRunning();
            if (!GtoObserverService.isRunning()) GtoAutoTripSync.flushPending(getContext(),
                getContext().getSharedPreferences(GtoObserverService.PREFS_NAME, Context.MODE_PRIVATE), null);
        }
    }

    @PluginMethod
    public void discardCompletedOperationQueue(PluginCall call) {
        CompletedProOperationQueueCleaner.verifyAndDiscard(getContext(), safe(call.getString("jobId")),
            (verified, count, reason) -> resolveCompletedQueueCleanup(call, verified, count, reason));
    }

    @PluginMethod
    public void markOperationCapturePaused(PluginCall call) {
        String driver = safe(call.getString("driverId")), company = safe(call.getString("companyId")), job = safe(call.getString("jobId"));
        if (driver.isEmpty() || company.isEmpty() || job.isEmpty()) { call.reject("OPERATION_SCOPE_REQUIRED"); return; }
        if (!PendingOperationStartStore.setCapturePaused(getContext(), driver, company, job,
                Boolean.TRUE.equals(call.getBoolean("paused", true)))) { call.reject("OPERATION_CAPTURE_PAUSE_NOT_DURABLE"); return; }
        JSObject result = new JSObject(); result.put("saved", true); call.resolve(result);
    }

    @PluginMethod
    public void reconcileCompletedOperationQueues(PluginCall call) {
        CompletedProOperationQueueCleaner.reconcile(getContext(),
            (verified, count, reason) -> resolveCompletedQueueCleanup(call, verified, count, reason));
    }

    private void resolveCompletedQueueCleanup(PluginCall call, boolean verified, int count, String reason) {
        if (!verified && !"OPERATION_CLEANUP_IN_PROGRESS".equals(reason)) { call.reject(reason); return; }
        JSObject result = new JSObject();
        result.put("verified", verified);
        result.put("discardedCount", count);
        call.resolve(result);
    }

    /** Read-only, owner-authenticated view for the local Pro diagnostics UI.
     * This method intentionally never calls buildStatus(), validatedReceipt(),
     * a retry path, a Function, Firestore, or a SharedPreferences editor.
     */
    @PluginMethod
    public void getReadOnlyProQueueDiagnostics(PluginCall call) {
        JSObject result = new JSObject();
        JSONArray pendingTrips = new JSONArray();
        com.google.firebase.auth.FirebaseUser user = GtoFirebaseRuntime.currentUser(getContext());
        String authenticatedUid = user == null ? "" : safe(user.getUid());
        String requestedAuthenticatedUid = safe(call.getString("authenticatedUserId"));
        if (requestedAuthenticatedUid.isEmpty()) requestedAuthenticatedUid = safe(call.getString("driverId"));
        boolean ownerAuthenticated = !authenticatedUid.isEmpty()
            && authenticatedUid.equals(requestedAuthenticatedUid);
        boolean ownerMismatch = false;
        if (ownerAuthenticated) {
            String requestedCompanyId = safe(call.getString("companyId"));
            String requestedJobId = safe(call.getString("jobId"));
            Set<String> ownerIds = new HashSet<>();
            ownerIds.add(authenticatedUid);
            JSONArray authorizedDriverIds = call.getArray("authorizedDriverIds");
            if (authorizedDriverIds != null) {
                for (int i = 0; i < Math.min(64, authorizedDriverIds.length()); i++) {
                    String authorizedId = safe(authorizedDriverIds.optString(i, ""));
                    if (!authorizedId.isEmpty() && authorizedId.length() <= 180) ownerIds.add(authorizedId);
                }
            }
            android.content.SharedPreferences index = getContext().getSharedPreferences(
                SimpleAutomationService.PREFS_NAME, Context.MODE_PRIVATE);
            for (String attemptId : ProPendingTripStore.ids(index)) {
                android.content.SharedPreferences entry = ProPendingTripStore.entry(getContext(), attemptId);
                if (ProPendingTripStore.isCompletionRecorded(index, entry)) continue;
                String ownerId = safe(entry.getString("driverId", ""));
                String companyId = safe(entry.getString("companyId", ""));
                String jobId = safe(entry.getString("jobId", ""));
                if ((!requestedCompanyId.isEmpty() && !requestedCompanyId.equals(companyId))
                    || (!requestedJobId.isEmpty() && !requestedJobId.equals(jobId))) continue;
                if (!ownerIds.contains(ownerId)) {
                    ownerMismatch = true;
                    continue;
                }

                JSObject row = new JSObject();
                row.put("attemptId", attemptId);
                row.put("jobId", jobId);
                row.put("companyId", companyId);
                row.put("driverId", ownerId);
                row.put("origin", safe(entry.getString("captureOrigin", "")));
                row.put("destination", safe(entry.getString("captureDestination", "")));
                row.put("amountCents", Math.max(0, entry.getInt("receiptAmountCents", 0)));
                row.put("currency", safe(entry.getString("receiptCurrency", "")));
                row.put("queuedAt", Math.max(0L, entry.getLong("queuedAt", 0L)));
                row.put("queueClaimedAt", Math.max(0L, entry.getLong("queueClaimedAt", 0L)));
                row.put("queueStatus", safe(entry.getString("queueStatus", "WAITING")));
                row.put("retryAllowed", ProPendingTripStore.isRetryAllowed(entry));
                row.put("contractRecoveryAvailable", authenticatedUid.equals(ownerId)
                    && ProPendingTripStore.canRequestContractRecovery(entry));
                row.put("lastQueueError", safe(entry.getString("lastQueueError", "")));
                row.put("lastQueueErrorCode", safe(entry.getString("lastQueueErrorCode", "")));
                row.put("attemptCount", Math.max(0, entry.getInt(CanonicalTripOutboxSchema.KEY_ATTEMPTS, 0)));
                row.put("reasonCode", entry.contains("reasonCode") ? safe(entry.getString("reasonCode", "")) : "");
                row.put("stage", entry.contains("lastFailureStage") ? safe(entry.getString("lastFailureStage", "")) : "");
                row.put("callable", entry.contains("lastQueueCallable") ? safe(entry.getString("lastQueueCallable", "")) : "");
                row.put("serverReason", entry.contains("serverReason") ? safe(entry.getString("serverReason", "")) : "");
                row.put("canonicalTripId", entry.contains("canonicalTripId") ? safe(entry.getString("canonicalTripId", "")) : "");
                row.put("tripId", entry.contains("tripId") ? safe(entry.getString("tripId", "")) : "");
                row.put("operationId", entry.contains("operationId") ? safe(entry.getString("operationId", "")) : "");
                row.put("lastAttemptAt", entry.contains("lastAttemptAt") ? Math.max(0L, entry.getLong("lastAttemptAt", 0L)) : 0L);
                pendingTrips.put(row);
            }
        }
        result.put("ownerAuthenticated", ownerAuthenticated);
        result.put("ownerMismatch", ownerMismatch);
        result.put("pendingProTrips", pendingTrips);
        JSONArray pendingGtoTripIds = new JSONArray();
        if (ownerAuthenticated) {
            for (String id : GtoAutoTripSync.pendingOperationSessionIds(getContext(), authenticatedUid,
                    safe(call.getString("companyId")), safe(call.getString("jobId")))) pendingGtoTripIds.put(id);
        }
        result.put("pendingGtoTripIds", pendingGtoTripIds);
        call.resolve(result);
    }

    @PluginMethod
    public void recordProTiming(PluginCall call) {
        String stage = safe(call.getString("stage"));
        if (stage.isEmpty() || stage.length() > 80 || !stage.matches("[A-Za-z0-9_\\-]+")) {
            call.reject("Marco de timing inválido.");
            return;
        }
        long elapsedMs = Math.max(-1L, call.getLong("elapsedMs", -1L));
        android.util.Log.i("NVU-ProTiming", "stage=" + stage + " elapsedMs=" + elapsedMs);
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void recordConfirmedTrip(PluginCall call) {
        SimpleAutomationService.recordConfirmedTrip(
            getContext(),
            safe(call.getString("tripId")),
            safe(call.getString("jobId")),
            safe(call.getString("companyId")),
            safe(call.getString("driverId")),
            safe(call.getString("contractId")),
            safe(call.getString("simulatorKey")),
            safe(call.getString("origin")),
            safe(call.getString("destination")),
            Math.max(0L, call.getLong("amountCents", 0L)),
            Math.max(0L, call.getLong("completedAt", System.currentTimeMillis()))
        );
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void updateOperationHistory(PluginCall call) {
        JSONArray trips = call.getArray("trips");
        int confirmedTripCount = Math.max(0, call.getInt("confirmedTripCount", call.getInt("jobProgress", 0)));
        getContext().getSharedPreferences(SimpleAutomationService.PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putInt("confirmedTripCount", confirmedTripCount).apply();
        if (!SimpleAutomationService.updateOperationHistory(
            getContext(), safe(call.getString("jobId")), safe(call.getString("companyId")),
            safe(call.getString("driverId")), confirmedTripCount, trips)) {
            call.reject("Histórico da operação não corresponde ao contexto atual.");
            return;
        }
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        try {
            ProModeController.openOverlaySettings(getContext());
            call.resolve(buildStatus());
        } catch (Exception error) {
            call.reject("Não foi possível abrir a permissão de sobreposição.", error);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        ProModeController.StartResult result = ProModeController.start(
            getContext(), ProModeController.Mode.SIMPLE_AUTOMATION
        );
        if (result != ProModeController.StartResult.STARTED) {
            JSObject status = buildStatus();
            status.put("status", result == ProModeController.StartResult.OVERLAY_PERMISSION
                ? "overlay-permission" : "start-failed");
            call.resolve(status);
            return;
        }
        // Dispatch alone is not a startup ACK. Confirm the service before the
        // launcher switches apps and exposes success to the driver.
        android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
        long deadline = android.os.SystemClock.elapsedRealtime() + 2500L;
        handler.post(new Runnable() {
            @Override public void run() {
                if (SimpleAutomationService.isServiceAlive()) {
                    JSObject status = buildStatus();
                    status.put("status", "started");
                    call.resolve(status);
                } else if (android.os.SystemClock.elapsedRealtime() >= deadline) {
                    JSObject status = buildStatus();
                    status.put("status", "start-failed");
                    call.resolve(status);
                } else handler.postDelayed(this, 50L);
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            getContext().startService(new Intent(getContext(), SimpleAutomationService.class)
                .setAction(SimpleAutomationService.ACTION_STOP));
        } catch (Exception ignored) {}
        JSObject status = buildStatus();
        status.put("status", "stopped");
        call.resolve(status);
    }

    @PluginMethod
    public void setContext(PluginCall call) {
        String simulatorKey = safe(call.getString("simulatorKey"));
        String simulatorCode = safe(call.getString("simulatorCode"));
        String simulatorLabel = safe(call.getString("simulatorLabel"));
        String contextEpoch = safe(call.getString("contextEpoch"));
        String companyName = safe(call.getString("companyName"));
        String operationName = safe(call.getString("operationName"));
        String contractName = safe(call.getString("contractName"));
        String jobId = safe(call.getString("jobId"));
        String contractId = safe(call.getString("contractId"));
        String companyId = safe(call.getString("companyId"));
        String driverId = safe(call.getString("driverId"));
        int jobProgress = call.getInt("jobProgress", 0);
        int confirmedTripCount = Math.max(0, call.getInt("confirmedTripCount", jobProgress));
        jobProgress = confirmedTripCount;
        getContext().getSharedPreferences(SimpleAutomationService.PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putInt("confirmedTripCount", confirmedTripCount).apply();
        int jobTotalDeliveries = call.getInt("jobTotalDeliveries", 0);
        String jobStatus = safe(call.getString("jobStatus"));
        boolean operationClosed = Boolean.TRUE.equals(call.getBoolean("operationClosed", false));
        String vehicleName = safe(call.getString("vehicleName"));
        String trailerName = safe(call.getString("trailerName"));
        String packageId = safe(call.getString("packageId"));
        simulatorKey = normalizeSimulatorKey(simulatorKey, simulatorCode, packageId);
        if (simulatorKey.isEmpty() || simulatorCode.isEmpty() || simulatorLabel.isEmpty() || contextEpoch.isEmpty()
            || !isCanonicalSimulatorPackage(simulatorKey, packageId)
            || !isCanonicalSimulatorCode(simulatorKey, simulatorCode)) {
            call.reject("Contexto do Modo Pro inválido.");
            return;
        }
        JSONArray cities = call.getArray("cities");
        android.content.SharedPreferences previous = SimpleAutomationService.getPreferences(getContext());
        String citiesJson = cities != null ? cities.toString()
            : simulatorKey.equals(previous.getString("simulatorKey", ""))
                ? previous.getString("citiesJson", "[]") : "[]";
        SimpleAutomationService.updateContext(
            getContext(), simulatorKey, simulatorCode, simulatorLabel, contextEpoch, companyName,
            operationName, contractName, jobId, contractId, companyId, driverId,
            jobProgress, jobTotalDeliveries, jobStatus, operationClosed, vehicleName, trailerName,
            packageId, citiesJson
        );
        JSObject status = buildStatus();
        status.put("status", "context-updated");
        call.resolve(status);
    }

    @PluginMethod
    public void updateCities(PluginCall call) {
        String expectedEpoch = safe(call.getString("contextEpoch"));
        String activeEpoch = SimpleAutomationService.getPreferences(getContext()).getString("contextEpoch", "");
        if (expectedEpoch.isEmpty() || !expectedEpoch.equals(activeEpoch)) {
            call.reject("O contexto do Modo Pro mudou antes de atualizar as cidades.");
            return;
        }
        JSONArray cities = call.getArray("cities");
        SimpleAutomationService.updateCities(getContext(), cities == null ? "[]" : cities.toString());
        JSObject status = buildStatus();
        status.put("status", "cities-updated");
        call.resolve(status);
    }

    @PluginMethod
    public void openSimulator(PluginCall call) {
        String packageId = safe(call.getString("packageId"));
        if (!ALLOWED_PACKAGES.contains(packageId)) {
            call.reject("Simulador não permitido pelo Modo Pro.");
            return;
        }
        try {
            PackageManager manager = getContext().getPackageManager();
            Intent launch = manager.getLaunchIntentForPackage(packageId);
            if (launch == null) {
                JSObject missing = buildStatus();
                missing.put("status", "not-installed");
                missing.put("packageId", packageId);
                call.resolve(missing);
                return;
            }
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            SimpleAutomationService.markSimulatorLaunchRequested(getContext(), packageId);
            getContext().startActivity(launch);
            SimpleAutomationService.requestBubbleRecovery();
            JSObject opened = buildStatus();
            opened.put("status", "opened");
            opened.put("packageId", packageId);
            call.resolve(opened);
        } catch (Exception error) {
            call.reject("Não foi possível abrir o simulador.", error);
        }
    }

    @PluginMethod
    public void setRoute(PluginCall call) {
        String origin = safe(call.getString("origin"));
        String destination = safe(call.getString("destination"));
        if (origin.isEmpty() || destination.isEmpty() || origin.equalsIgnoreCase(destination)) {
            call.reject("Origem e destino devem ser diferentes.");
            return;
        }
        SimpleAutomationService.setRoute(getContext(), origin, destination);
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void finishTrip(PluginCall call) {
        SimpleAutomationService.requestReceiptCapture(getContext());
        JSObject status = buildStatus();
        String simpleState = status.optString("simpleState", SimpleAutomationService.STATE_IDLE);
        boolean capturePending = SimpleAutomationService.STATE_CAPTURE_PENDING.equals(simpleState);
        status.put("status", capturePending ? "capture-pending" : "capture-blocked");
        status.put("captureStarted", capturePending);
        status.put("captureRequiresNativeImplementation", true);
        status.put("captureAcceptedByGate", capturePending);
        call.resolve(status);
    }

    @PluginMethod
    public void retryPending(PluginCall call) {
        android.content.SharedPreferences prefs = SimpleAutomationService.getPreferences(getContext());
        com.google.firebase.auth.FirebaseUser nativeUser = GtoFirebaseRuntime.currentUser(getContext());
        String nativeUid = nativeUser == null ? "" : safe(nativeUser.getUid());
        String requestedAttempt = safe(call.getString("attemptId"));
        // Recovery is deliberately attempt-scoped; an empty id must never
        // authorize or fan out retries across the durable queue.
        if (requestedAttempt.isEmpty()) {
            JSObject status = new JSObject();
            status.put("status", "retry-blocked");
            call.resolve(status);
            return;
        }
        boolean matchingAttempt = false;
        boolean retryableAttempt = false;
        boolean specificContractMismatchAttempt = false;
        boolean requestedAttemptExists = ProPendingTripStore.contains(prefs, requestedAttempt);
        if (!nativeUid.isEmpty()) {
            for (String id : ProPendingTripStore.ids(prefs)) {
                android.content.SharedPreferences entry = ProPendingTripStore.entry(getContext(), id);
                if (ProPendingTripStore.isCompletionRecorded(prefs, entry)) continue;
                if ((requestedAttempt.isEmpty() || requestedAttempt.equals(id))
                    && nativeUid.equals(safe(entry.getString("driverId", "")))) {
                    matchingAttempt = true;
                    specificContractMismatchAttempt |= ProPendingTripStore.isSpecificGtoContractMismatchCandidate(entry);
                    retryableAttempt |= ProPendingTripStore.isRetryAllowed(entry);
                    // Do not release the receipt before token refresh succeeds.
                }
            }
        }
        if (!matchingAttempt) {
            JSObject status = buildStatus();
            status.put("status", requestedAttemptExists ? "auth-required" : "pending-not-found");
            call.resolve(status);
            return;
        }
        final boolean specificContractMismatchForRetry = specificContractMismatchAttempt;
        if (!retryableAttempt && !specificContractMismatchForRetry) {
            JSObject status = new JSObject();
            status.put("status", "retry-blocked");
            call.resolve(status);
            return;
        }
        try {
            nativeUser.getIdToken(true).addOnCompleteListener(tokenRefresh -> {
                if (!tokenRefresh.isSuccessful()) {
                    Exception tokenError = tokenRefresh.getException();
                    boolean networkError = tokenError instanceof com.google.firebase.FirebaseNetworkException
                        || (tokenError instanceof com.google.firebase.auth.FirebaseAuthException
                            && "ERROR_NETWORK_REQUEST_FAILED".equals(
                                ((com.google.firebase.auth.FirebaseAuthException) tokenError).getErrorCode()));
                    if (networkError) {
                        ProPendingTripJobService.schedule(getContext());
                        JSObject status = buildStatus();
                        status.put("status", "retry-unavailable");
                        call.resolve(status);
                        return;
                    }
                    prefs.edit()
                        .putString("nativeAuthState", "MATCH")
                        .putBoolean("nativeAuthRequired", true)
                        .putLong("nativeAuthDiagnosticAt", System.currentTimeMillis())
                        .putString("lastEvent", "A sessão Google precisa de nova autenticação para retomar a viagem.")
                        .apply();
                    for (String id : ProPendingTripStore.ids(prefs)) {
                        android.content.SharedPreferences entry = ProPendingTripStore.entry(getContext(), id);
                        if (ProPendingTripStore.isCompletionRecorded(prefs, entry)) continue;
                        if ((requestedAttempt.isEmpty() || requestedAttempt.equals(id))
                            && nativeUid.equals(safe(entry.getString("driverId", "")))
                            && ProPendingTripStore.isRetryAllowed(entry)) {
                            entry.edit()
                                .putString("queueStatus", "AUTH_REQUIRED")
                                .putString("nativeSubmissionState", "AUTH_REQUIRED")
                                .putString("nativeAuthState", "MATCH")
                                .putString("lastQueueError", "A sessão Google precisa de nova autenticação para retomar o envio desta viagem.")
                                .apply();
                        }
                    }
                    JSObject status = buildStatus();
                    status.put("status", "auth-required");
                    call.resolve(status);
                    return;
                }
                boolean persisted = true;
                boolean released = false;
                boolean blocked = false;
                boolean alreadySending = false;
                com.google.firebase.auth.FirebaseUser refreshedUser = GtoFirebaseRuntime.currentUser(getContext());
                if (refreshedUser == null || !nativeUid.equals(refreshedUser.getUid())) {
                    JSObject status = new JSObject();
                    status.put("status", "auth-required");
                    call.resolve(status);
                    return;
                }
                prefs.edit()
                    .putString("nativeAuthState", "MATCH")
                    .putBoolean("nativeAuthRequired", false)
                    .putLong("nativeAuthDiagnosticAt", System.currentTimeMillis())
                    .apply();
                if (specificContractMismatchForRetry) {
                    authorizeSpecificContractMismatchRetry(call, prefs, nativeUid, requestedAttempt);
                    return;
                }
                for (String id : ProPendingTripStore.ids(prefs)) {
                    android.content.SharedPreferences entry = ProPendingTripStore.entry(getContext(), id);
                    if (ProPendingTripStore.isCompletionRecorded(prefs, entry)) continue;
                    if ((!requestedAttempt.isEmpty() && !requestedAttempt.equals(id))
                        || !nativeUid.equals(safe(entry.getString("driverId", "")))) continue;
                    String outcome = ProPendingTripStore.requestRetry(getContext(), prefs, id, nativeUid);
                    persisted &= !"retry-unavailable".equals(outcome);
                    released |= "pending-retry-requested".equals(outcome);
                    blocked |= "retry-blocked".equals(outcome);
                    alreadySending |= "pending-already-sending".equals(outcome);
                }
                if (!persisted) {
                    JSObject status = buildStatus();
                    status.put("status", "retry-unavailable");
                    call.resolve(status);
                    return;
                }
                if (released) SimpleAutomationService.triggerPendingProcessing(getContext());
                JSObject status = buildStatus();
                status.put("status", released ? "pending-retry-requested" : blocked ? "retry-blocked"
                    : alreadySending ? "pending-already-sending" : "pending-not-found");
                call.resolve(status);
            });
        } catch (RuntimeException error) {
            JSObject status = buildStatus();
            status.put("status", "auth-required");
            call.resolve(status);
        }
    }

    private void authorizeSpecificContractMismatchRetry(PluginCall call, android.content.SharedPreferences prefs,
                                                        String nativeUid, String attemptId) {
        String expectedSnapshot = ProPendingTripStore.contractRecoveryFingerprint(
            ProPendingTripStore.entry(getContext(), attemptId));
        SimpleProNativeSubmissionCoordinator.probeGtoBackendCompatibility(getContext(), (compatible, unavailable) -> {
            com.google.firebase.auth.FirebaseUser current = GtoFirebaseRuntime.currentUser(getContext());
            if (current == null || !nativeUid.equals(current.getUid())) {
                JSObject status = new JSObject();
                status.put("status", "auth-required");
                call.resolve(status);
                return;
            }
            if (!compatible) {
                JSObject status = new JSObject();
                status.put("status", unavailable ? "retry-unavailable" : "retry-backend-update-required");
                call.resolve(status);
                return;
            }
            boolean authorized = ProPendingTripStore.authorizeSpecificGtoContractMismatch(
                getContext(), prefs, attemptId, nativeUid, GtoBackendCompatibilityPolicy.VERSION, expectedSnapshot);
            String outcome = authorized
                ? ProPendingTripStore.requestSpecificGtoContractMismatch(getContext(), prefs, attemptId, nativeUid)
                : "retry-blocked";
            if ("pending-retry-requested".equals(outcome)) {
                SimpleAutomationService.triggerPendingProcessing(getContext());
            }
            JSObject status = new JSObject();
            status.put("status", outcome);
            call.resolve(status);
        });
    }

    @PluginMethod
    public void showStatusMessage(PluginCall call) {
        String message = safe(call.getString("message"));
        long durationMs = Math.max(5000L, Math.min(9000L, call.getLong("durationMs", 5200L)));
        if (message.isEmpty()) {
            call.reject("Mensagem visual vazia.");
            return;
        }
        SimpleAutomationService.showStatusMessage(getContext(), message, durationMs);
        JSObject status = buildStatus();
        status.put("status", "status-message-shown");
        call.resolve(status);
    }

    @PluginMethod
    public void refreshOperationSnapshot(PluginCall call) {
        String companyName = safe(call.getString("companyName"));
        String operationName = safe(call.getString("operationName"));
        String contractName = safe(call.getString("contractName"));
        String jobId = safe(call.getString("jobId"));
        String contractId = safe(call.getString("contractId"));
        String companyId = safe(call.getString("companyId"));
        String driverId = safe(call.getString("driverId"));
        int jobProgress = Math.max(0, call.getInt("jobProgress", 0));
        int confirmedTripCount = Math.max(0, call.getInt("confirmedTripCount", jobProgress));
        jobProgress = confirmedTripCount;
        getContext().getSharedPreferences(SimpleAutomationService.PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putInt("confirmedTripCount", confirmedTripCount).apply();
        int jobTotalDeliveries = Math.max(0, call.getInt("jobTotalDeliveries", 0));
        String jobStatus = safe(call.getString("jobStatus"));
        boolean operationClosed = Boolean.TRUE.equals(call.getBoolean("operationClosed", false));
        String vehicleName = safe(call.getString("vehicleName"));
        String trailerName = safe(call.getString("trailerName"));
        long operationContextRevision = Math.max(0L, call.getLong("operationContextRevision", 0L));
        if (jobTotalDeliveries > 0 && jobProgress > jobTotalDeliveries) {
            call.reject("Progresso da operação inválido.");
            return;
        }
        SimpleAutomationService.refreshOperationSnapshot(
            getContext(), companyName, operationName, contractName, jobId, contractId,
            companyId, driverId, jobProgress, jobTotalDeliveries, jobStatus,
            operationClosed, vehicleName, trailerName, operationContextRevision
        );
        JSObject status = buildStatus();
        status.put("status", "operation-snapshot-refreshed");
        call.resolve(status);
    }

    @PluginMethod
    public void refreshOperationState(PluginCall call) {
        int jobProgress = Math.max(0, call.getInt("jobProgress", 0));
        int confirmedTripCount = Math.max(0, call.getInt("confirmedTripCount", jobProgress));
        jobProgress = confirmedTripCount;
        getContext().getSharedPreferences(SimpleAutomationService.PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putInt("confirmedTripCount", confirmedTripCount).apply();
        int jobTotalDeliveries = Math.max(0, call.getInt("jobTotalDeliveries", 0));
        String jobStatus = safe(call.getString("jobStatus"));
        boolean operationClosed = Boolean.TRUE.equals(call.getBoolean("operationClosed", false));
        if (jobTotalDeliveries > 0 && jobProgress > jobTotalDeliveries) {
            call.reject("Progresso da operação inválido.");
            return;
        }
        SimpleAutomationService.refreshOperationState(
            getContext(), jobProgress, jobTotalDeliveries, jobStatus, operationClosed
        );
        JSObject status = buildStatus();
        status.put("status", "operation-state-refreshed");
        call.resolve(status);
    }

    @PluginMethod
    public void acknowledgeReceipt(PluginCall call) {
        boolean accepted = Boolean.TRUE.equals(call.getBoolean("accepted", false));
        String reason = safe(call.getString("reason"));
        String attempt = safe(call.getString("captureAttemptId"));
        if (!attempt.isEmpty() && !attempt.equals(getContext().getSharedPreferences(
            SimpleAutomationService.PREFS_NAME, android.content.Context.MODE_PRIVATE).getString("captureAttemptId", ""))) {
            JSObject ignored = buildStatus(); ignored.put("status", "stale-receipt-ack-ignored"); call.resolve(ignored); return;
        }
        Boolean pendingSync = call.getBoolean("pendingSync");
        if (pendingSync == null) SimpleAutomationService.acknowledgeReceipt(getContext(), accepted, reason);
        else SimpleAutomationService.acknowledgeReceipt(getContext(), accepted, reason, pendingSync);
        JSObject status = buildStatus();
        String resultingState = status.optString("simpleState", SimpleAutomationService.STATE_IDLE);
        status.put("status", accepted
            ? (Boolean.TRUE.equals(pendingSync) ? "pending-validation" : "completed")
            : (SimpleAutomationService.STATE_TRIP_ACTIVE.equals(resultingState) ? "rejected-retryable" : "rejected"));
        call.resolve(status);
    }

    @PluginMethod
    public void cancelTrip(PluginCall call) {
        SimpleAutomationService.cancelTrip(getContext());
        JSObject status = buildStatus();
        status.put("status", "cancelled");
        call.resolve(status);
    }

    private JSObject buildStatus() {
        // Recover an interrupted post-write UI transition. Firestore durability
        // is already represented by SYNCED; only the presentation acknowledgement
        // may have been interrupted by an Activity/service lifecycle event.
        SimpleAutomationService.reconcileSyncedUi(getContext());
        android.content.SharedPreferences prefs = SimpleAutomationService.getPreferences(getContext());
        JSObject status = new JSObject();
        status.put("running", SimpleAutomationService.isServiceAlive());
        status.put("overlayPermission", ProModeController.hasOverlay(getContext()));
        status.put("persistentOverlayPermission", android.provider.Settings.canDrawOverlays(getContext())
            && !ProOverlayProbeService.isActive());
        status.put("overlayValidationAt", ProModeController.getLastOverlayValidationAt());
        status.put("overlayValidationReason", ProModeController.getLastOverlayValidationReason());
        status.put("overlayVisible", prefs.getBoolean("overlayVisible", false));
        status.put("overlayType", android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O
            ? "TYPE_APPLICATION_OVERLAY" : "TYPE_PHONE");
        status.put("bubbleVisible", SimpleAutomationService.isBubbleAttached());
        status.put("captureUiHidden", prefs.getBoolean("captureUiHidden", false));
        status.put("overlayLastAction", prefs.getString("overlayLastAction", ""));
        status.put("overlayLastError", prefs.getString("overlayLastError", ""));
        status.put("overlayLastErrorAt", prefs.getLong("overlayLastErrorAt", 0L));
        status.put("projectionPermissionState", prefs.getString("captureStage", "IDLE"));
        status.put("simulatorKey", prefs.getString("simulatorKey", ""));
        status.put("simulatorCode", prefs.getString("simulatorCode", ""));
        status.put("simulatorLabel", prefs.getString("simulatorLabel", ""));
        status.put("contextEpoch", prefs.getString("contextEpoch", ""));
        status.put("simulatorVisibility", prefs.getString("simulatorVisibility", "UNKNOWN"));
        status.put("proLastStage", prefs.getString("proLastStage", ""));
        status.put("proLastDecision", prefs.getString("proLastDecision", ""));
        status.put("proLastFailureCode", prefs.getString("proLastFailureCode", ""));
        status.put("proLastExpectedPackage", prefs.getString("proLastExpectedPackage", ""));
        status.put("proLastObservedPackage", prefs.getString("proLastObservedPackage", ""));
        status.put("proLastDiagnosticAt", prefs.getLong("proLastDiagnosticAt", 0L));
        status.put("captureStage", prefs.getString("captureStage", "IDLE"));
        status.put("captureReentryRequired", false);
        status.put("captureAcceptedByGate", "CAPTURE_PENDING".equals(prefs.getString("simpleState", "IDLE")));
        status.put("companyName", prefs.getString("companyName", "Empresa"));
        status.put("operationName", prefs.getString("operationName", ""));
        status.put("contractName", prefs.getString("contractName", ""));
        status.put("jobId", prefs.getString("jobId", ""));
        status.put("contractId", prefs.getString("contractId", ""));
        status.put("companyId", prefs.getString("companyId", ""));
        status.put("driverId", prefs.getString("driverId", ""));
        status.put("nativeSubmissionState", prefs.getString("nativeSubmissionState", "IDLE"));
        status.put("nativeRetryPending", prefs.getBoolean("nativeRetryPending", false));
        status.put("nativeTripId", prefs.getString("nativeTripId", ""));
        status.put("nativeSubmissionError", prefs.getString("nativeSubmissionError", ""));
        String nativeAuthState = prefs.getString("nativeAuthState", "UNKNOWN");
        boolean nativeAuthRequired = prefs.getBoolean("nativeAuthRequired", false);
        long nativeAuthDiagnosticAt = prefs.getLong("nativeAuthDiagnosticAt", 0L);
        status.put("jobProgress", prefs.getInt("jobProgress", 0));
        JSONArray pendingTrips = new JSONArray();
        for (String id : ProPendingTripStore.ids(prefs)) {
            android.content.SharedPreferences entry = ProPendingTripStore.entry(getContext(), id);
            if (ProPendingTripStore.isCompletionRecorded(prefs, entry)) continue;
            if (!entry.getString("driverId", "").equals(prefs.getString("driverId", ""))) continue;
            String queueStatus = entry.getString("queueStatus", "WAITING");
            if ("AUTH_REQUIRED".equals(queueStatus)) {
                nativeAuthRequired = true;
                nativeAuthState = entry.getString("nativeAuthState", nativeAuthState);
                nativeAuthDiagnosticAt = Math.max(nativeAuthDiagnosticAt, entry.getLong("nativeAuthDiagnosticAt", 0L));
            }
            JSObject pending = new JSObject();
            pending.put("attemptId", id);
            pending.put("jobId", entry.getString("jobId", ""));
            pending.put("companyId", entry.getString("companyId", ""));
            pending.put("driverId", entry.getString("driverId", ""));
            pending.put("origin", entry.getString("captureOrigin", ""));
            pending.put("destination", entry.getString("captureDestination", ""));
            pending.put("queuedAt", entry.getLong("queuedAt", 0L));
            pending.put("queueClaimedAt", entry.getLong("queueClaimedAt", 0L));
            pending.put("queueStatus", queueStatus);
            pending.put("lastQueueError", entry.getString("lastQueueError", ""));
            SimpleProNativeSubmissionCoordinator.Receipt receipt =
                ProPendingTripStore.validatedReceipt(entry);
            pending.put("amountCents", receipt == null ? 0 : receipt.amountCents);
            pending.put("currency", receipt == null ? "BRL" : receipt.currency);
            pendingTrips.put(pending);
        }
        status.put("pendingProTrips", pendingTrips);
        status.put("nativeAuthState", nativeAuthState);
        status.put("nativeAuthRequired", nativeAuthRequired);
        status.put("nativeAuthDiagnosticAt", nativeAuthDiagnosticAt);
        status.put("jobTotalDeliveries", prefs.getInt("jobTotalDeliveries", 0));
        status.put("jobStatus", prefs.getString("jobStatus", ""));
        status.put("operationClosed", prefs.getBoolean("operationClosed", false));
        status.put("vehicleName", prefs.getString("vehicleName", ""));
        status.put("trailerName", prefs.getString("trailerName", ""));
        status.put("packageId", prefs.getString("packageId", ""));
        status.put("simpleState", prefs.getString("simpleState", SimpleAutomationService.STATE_IDLE));
        status.put("origin", prefs.getString("origin", ""));
        status.put("destination", prefs.getString("destination", ""));
        status.put("lastEvent", prefs.getString("lastEvent", ""));
        status.put("captureRequestedAt", prefs.getLong("captureRequestedAt", 0L));
        status.put("receiptText", prefs.getString("receiptText", ""));
        status.put("receiptCapturedAt", prefs.getLong("receiptCapturedAt", 0L));
        status.put("captureAttemptId", prefs.getString("captureAttemptId", ""));
        status.put("captureContextEpoch", prefs.getString("captureContextEpoch", ""));
        status.put("captureSimulatorKey", prefs.getString("captureSimulatorKey", ""));
        status.put("captureSimulatorCode", prefs.getString("captureSimulatorCode", ""));
        status.put("captureOrigin", prefs.getString("captureOrigin", ""));
        status.put("captureDestination", prefs.getString("captureDestination", ""));
        status.put("captureCompanyId", prefs.getString("captureCompanyId", ""));
        status.put("captureDriverId", prefs.getString("captureDriverId", ""));
        status.put("captureJobId", prefs.getString("captureJobId", ""));
        status.put("captureContractId", prefs.getString("captureContractId", ""));
        status.put("capturePackageId", prefs.getString("capturePackageId", ""));
        return status;
    }

    private static String normalizeSimulatorKey(String simulatorKey, String simulatorCode, String packageId) {
        String key = safe(simulatorKey).toLowerCase(java.util.Locale.ROOT);
        String code = safe(simulatorCode).toUpperCase(java.util.Locale.ROOT);
        if ("wtds".equals(key) || "WTDS".equals(code)) return "wtds";
        if ("wbds".equals(key) || "WBDS".equals(code)) return "wbds";
        if ("toe-3".equals(key) || "toe3".equals(key) || "TOE3".equals(code)) return "toe-3";
        if ("global-truck".equals(key) || "gto".equals(key) || "GTO".equals(code)) return "global-truck";
        if ("com.dynamicgames.worldtruckdrivingsimulator".equals(packageId)) return "wtds";
        if ("com.dynamicgames.worldbusdrivingsimulator".equals(packageId)) return "wbds";
        if ("com.WandaSoftware.TruckersofEurope3".equals(packageId)) return "toe-3";
        if ("com.stargamesapps.gto".equals(packageId)) return "global-truck";
        return "";
    }

    private static boolean isCanonicalSimulatorCode(String simulatorKey, String simulatorCode) {
        if (simulatorKey == null || simulatorCode == null) return false;
        switch (simulatorKey.trim().toLowerCase(java.util.Locale.ROOT)) {
            case "wtds": return "WTDS".equals(simulatorCode.trim());
            case "wbds": return "WBDS".equals(simulatorCode.trim());
            case "toe-3": return "TOE3".equals(simulatorCode.trim());
            case "global-truck": return "GTO".equals(simulatorCode.trim());
            default: return false;
        }
    }

    private static boolean isCanonicalSimulatorPackage(String simulatorKey, String packageId) {
        if (simulatorKey == null || packageId == null) return false;
        switch (normalizeSimulatorKey(simulatorKey, "", packageId)) {
            case "wtds": return "com.dynamicgames.worldtruckdrivingsimulator".equals(packageId);
            case "wbds": return "com.dynamicgames.worldbusdrivingsimulator".equals(packageId);
            case "toe-3": return "com.WandaSoftware.TruckersofEurope3".equals(packageId);
            case "global-truck": return "com.stargamesapps.gto".equals(packageId);
            default: return false;
        }
    }

    private static String safe(String value) {
        return value == null ? "" : value.trim();
    }
}
