package com.nvu.operacional;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.FirebaseFirestoreException;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.Source;
import com.google.firebase.firestore.FieldValue;
import com.google.firebase.functions.FirebaseFunctions;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.security.MessageDigest;

/**
 * Native owner for Pro completion after a readable receipt is captured.
 *
 * Each call handles one immutable attempt from the native durable queue.
 * It reports server confirmation only after the transactional write succeeds.
 */
final class SimpleProNativeSubmissionCoordinator {
    interface Listener {
        void onSuccess(String tripId);
        void onFallback(String reason);
    }

    interface CompatibilityListener {
        void onResult(boolean compatible, boolean unavailable);
    }

    private static final String PRO_STATE_SUBMITTING = "SUBMITTING_NATIVE";
    static final String AUTH_REQUIRED_PREFIX = "AUTH_REQUIRED:";
    private static final Pattern AMOUNT_PATTERN = Pattern.compile("(?:R\\$|EUR|BRL|€|\\$)?\\s*([0-9]+(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?)", Pattern.CASE_INSENSITIVE);
    private static final Pattern PERCENT_OFFER = Pattern.compile("BONUS\\s+DE\\s+[0-9]+\\s*%|REMOVER\\s+PENALIDADES|DOBRAR\\s+VALOR");
    private static final Set<String> ZERO_BONUS_LINES = new HashSet<>(Arrays.asList(
        "BONUS VIDEO ADS", "BONUS ADS", "BONUS DE ADS", "BONUS VIDEO", "VIDEO ADS"
    ));

    private SimpleProNativeSubmissionCoordinator() {}

    static void submit(Context context, SharedPreferences prefs, String rawReceipt, Listener listener) {
        if (context == null || prefs == null || listener == null) return;
        Context appContext = context.getApplicationContext();
        if (ProPendingTripStore.isCompletionRecorded(appContext.getSharedPreferences(
            SimpleAutomationService.PREFS_NAME, Context.MODE_PRIVATE), prefs)) return;
        AtomicBoolean callbackDelivered = new AtomicBoolean(false);
        Listener onceListener = new Listener() {
            @Override public void onSuccess(String tripId) {
                if (callbackDelivered.compareAndSet(false, true)) listener.onSuccess(tripId);
            }
            @Override public void onFallback(String reason) {
                if (callbackDelivered.compareAndSet(false, true)) listener.onFallback(reason);
            }
        };
        if (PendingOperationStartStore.blocks(appContext, prefs)) {
            fallback(prefs, "OPERATION_START_PENDING", onceListener);
            return;
        }
        String driverId = clean(prefs.getString("driverId", ""));
        String jobId = clean(prefs.getString("captureJobId", prefs.getString("jobId", "")));
        String companyId = clean(prefs.getString("captureCompanyId", prefs.getString("companyId", "")));
        String contractId = clean(prefs.getString("captureContractId", prefs.getString("contractId", "")));
        String attemptId = clean(prefs.getString("captureAttemptId", ""));
        String contextEpoch = clean(prefs.getString("captureContextEpoch", ""));
        String origin = clean(prefs.getString("captureOrigin", ""));
        String destination = clean(prefs.getString("captureDestination", ""));
        String simulatorKey = clean(prefs.getString("captureSimulatorKey", prefs.getString("simulatorKey", "")));
        String simulatorCode = clean(prefs.getString("captureSimulatorCode", prefs.getString("simulatorCode", "")));
        String packageId = clean(prefs.getString("capturePackageId", prefs.getString("packageId", "")));

        final int submissionGeneration = prefs.getInt("nativeAttemptGeneration", 0);
        prefs.edit()
            .putInt("registrationProtocolVersion", 409)
            .putLong("lastAttemptAt", System.currentTimeMillis())
            .putString("nativeSubmissionState", PRO_STATE_SUBMITTING)
            .putString("captureStage", "NATIVE_SUBMITTING")
            .apply();

        // The saved, validated capture is authoritative on every retry.
        Receipt receipt = ProPendingTripStore.validatedReceipt(prefs);
        String authUid = currentUid();
        AuthCheck authCheck = inspectAuth(prefs, driverId, authUid);
        if (!authCheck.isMatch()) {
            // FirebaseAuth may still be restoring the native provider session
            // when the foreground service starts after an app upgrade/restart.
            // Do not convert that transient state into a user-facing re-login.
            if ("MISSING".equals(authCheck.state)) {
                int hydrationAttempts = prefs.getInt("nativeAuthHydrationAttempts", 0) + 1;
                prefs.edit().putInt("nativeAuthHydrationAttempts", hydrationAttempts).apply();
                if (hydrationAttempts < 8) {
                    fallback(prefs, "RETRY_NATIVE_AUTH_HYDRATION", onceListener);
                    return;
                }
            }
            fallback(prefs, AUTH_REQUIRED_PREFIX + authCheck.state, onceListener);
            return;
        }
        prefs.edit().remove("nativeAuthHydrationAttempts").apply();
        String failure = validateLocalContext(
            driverId, authUid, jobId, companyId, contractId, attemptId, contextEpoch,
            origin, destination, simulatorKey, simulatorCode, packageId, receipt
        );
        if (!failure.isEmpty()) {
            prefs.edit().putString("lastFailureStage", "LOCAL_VALIDATION")
                .putString("lastQueueCallable", "").putString("reasonCode", "LOCAL_CONTEXT_REJECTED")
                .putString("serverReason", "").apply();
            fallback(prefs, failure, onceListener);
            return;
        }
        // GTO Pro is committed by one authenticated server transaction; the
        // Android client never GETs a missing history slot under old Rules.
        if ("global-truck".equals(simulatorKey)) {
            submitGtoReceipt(appContext, prefs, rawReceipt, receipt, driverId, jobId,
                companyId, contractId, attemptId, contextEpoch, origin, destination,
                simulatorKey, simulatorCode, packageId, submissionGeneration, onceListener);
            return;
        }

        submitSimpleTrip(appContext, prefs, rawReceipt, receipt, driverId, jobId, companyId, contractId,
            attemptId, contextEpoch, origin, destination, simulatorKey, simulatorCode,
            submissionGeneration, onceListener);
    }

    interface AccessRecoveryListener { void onResult(boolean allowed); }
    static void probeCompanyAccess(Context context, String companyId, AccessRecoveryListener listener) {
        FirebaseFunctions functions = GtoFirebaseRuntime.functions(context, "us-central1");
        if (functions == null) { listener.onResult(false); return; }
        Map<String, Object> payload = new HashMap<>(); payload.put("companyId", companyId);
        functions.getHttpsCallable("ensureCompanyAccess").call(payload).addOnCompleteListener(task -> {
            Object data = task.isSuccessful() && task.getResult() != null ? task.getResult().getData() : null;
            listener.onResult(data instanceof Map && Boolean.TRUE.equals(((Map<?, ?>) data).get("active")));
        });
    }

    /** Authenticated, read-only capability probe. It never creates an attempt,
     * reads Firestore, changes progress or returns an ACK for a trip. */
    static void probeGtoBackendCompatibility(Context context, CompatibilityListener listener) {
        if (context == null || listener == null) return;
        FirebaseFunctions functions = GtoFirebaseRuntime.functions(context, "us-central1");
        if (functions == null) { listener.onResult(false, true); return; }
        Map<String, Object> probe = new HashMap<>();
        probe.put("compatibilityProbe", GtoBackendCompatibilityPolicy.VERSION);
        functions.getHttpsCallable("registerGtoProReceipt").call(probe).addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                Exception error = task.getException();
                boolean oldContract = error instanceof com.google.firebase.functions.FirebaseFunctionsException
                    && (((com.google.firebase.functions.FirebaseFunctionsException) error).getCode()
                        == com.google.firebase.functions.FirebaseFunctionsException.Code.INVALID_ARGUMENT
                        || ((com.google.firebase.functions.FirebaseFunctionsException) error).getCode()
                        == com.google.firebase.functions.FirebaseFunctionsException.Code.NOT_FOUND);
                listener.onResult(false, !oldContract);
                return;
            }
            Object data = task.getResult() == null ? null : task.getResult().getData();
            boolean compatible = GtoBackendCompatibilityPolicy.isCompatible(data);
            listener.onResult(compatible, false);
        });
    }

    private static void submitSimpleTrip(Context context, SharedPreferences prefs, String rawReceipt,
        Receipt receipt, String driverId, String jobId, String companyId, String contractId,
        String attemptId, String contextEpoch, String origin, String destination, String simulatorKey,
        String simulatorCode, int generation, Listener listener) {
        com.google.firebase.functions.FirebaseFunctions functions =
            GtoFirebaseRuntime.functions(context, "us-central1");
        if (functions == null) {
            fallback(prefs, "SIMPLE_BACKEND_UNAVAILABLE", listener);
            return;
        }
        String tripId = deterministicTripId(driverId, attemptId);
        Map<String, Object> trip = new HashMap<>();
        trip.put("tripId", tripId);
        trip.put("canonicalTripId", tripId);
        trip.put("empresaId", companyId);
        trip.put("companyId", companyId);
        trip.put("motoristaId", driverId);
        trip.put("driverId", driverId);
        trip.put("contratoId", contractId);
        trip.put("contractId", contractId);
        trip.put("jobId", jobId);
        trip.put("operationId", jobId);
        trip.put("trabalhoId", jobId);
        trip.put("origem", origin);
        trip.put("destino", destination);
        trip.put("valor", receipt.amountCents / 100.0);
        trip.put("valorCents", receipt.amountCents);
        trip.put("source", "simple_auto");
        trip.put("registroAutomatico", true);
        trip.put("automationSource", "simple-native-v1");
        trip.put("simulatorKey", simulatorKey);
        trip.put("simulatorId", simulatorKey);
        trip.put("simulatorCode", simulatorCode);
        trip.put("simpleAutomation", true);
        trip.put("simpleAutomationVersion", "v3-native-callable");
        trip.put("simpleReceiptCurrency", receipt.currency);
        trip.put("simpleReceiptResultScreenConfirmed", true);
        trip.put("simpleReceiptBonusEvidence", receipt.bonusEvidence);
        trip.put("simpleReceiptConfidence", 1.0);
        trip.put("simpleReceiptCapturedAt", prefs.getLong("receiptCapturedAt", 0L));
        trip.put("simpleReceiptCaptureAttemptId", attemptId);
        trip.put("simpleReceiptCaptureContextEpoch", contextEpoch);
        trip.put("idempotencyKey", "simple:" + jobId + ":" + driverId + ":" + attemptId);
        trip.put("simpleDuplicateGuardKey", "simple-value:" + jobId + ":" + driverId + ":" + receipt.amountCents);
        trip.put("deterministicTripId", tripId);
        trip.put("nativeSubmission", true);
        trip.put("nativeSubmissionVersion", 3);
        trip.put("receiptText", rawReceipt);
        trip.put("completedAtClient", prefs.getLong("receiptCapturedAt", System.currentTimeMillis()));
        Map<String, Object> request = new HashMap<>();
        request.put("trip", trip);
        functions.getHttpsCallable("registerCanonicalSimpleTrip").call(request).addOnCompleteListener(task -> {
            if (!isCurrentAttempt(context, prefs, generation)) return;
            if (!task.isSuccessful()) {
                Exception error = task.getException();
                String code = error instanceof com.google.firebase.functions.FirebaseFunctionsException
                    ? ((com.google.firebase.functions.FirebaseFunctionsException) error).getCode().name() : "UNAVAILABLE";
                recordCallableFailure(prefs, "registerCanonicalSimpleTrip", error);
                String reason = "NOT_FOUND".equals(code) ? "SIMPLE_BACKEND_NOT_DEPLOYED"
                    : "UNAUTHENTICATED".equals(code) ? AUTH_REQUIRED_PREFIX + "TOKEN_EXPIRED"
                    : "SIMPLE_REGISTRATION_FAILED:" + code + ":" + serverFailureMessage(error);
                fallback(prefs, reason, listener);
                return;
            }
            Object rawResult = task.getResult() == null ? null : task.getResult().getData();
            if (!(rawResult instanceof Map)) {
                fallback(prefs, "SIMPLE_ACK_INVALID", listener);
                return;
            }
            Map<?, ?> result = (Map<?, ?>) rawResult;
            Object rawTripId = result.get("tripId");
            Object rawCount = result.get("confirmedTripCount");
            Object rawTotal = result.get("total");
            if (!Boolean.TRUE.equals(result.get("registered")) || !(rawTripId instanceof String)
                || (!tripId.equals(rawTripId) && !Boolean.TRUE.equals(result.get("receiptEventDuplicate")))
                || !(rawCount instanceof Number)) {
                fallback(prefs, "SIMPLE_ACK_INVALID", listener);
                return;
            }
            String acknowledgedTripId = (String) rawTripId;
            int confirmedCount = ((Number) rawCount).intValue();
            int total = rawTotal instanceof Number ? ((Number) rawTotal).intValue() : 0;
            Tasks.withTimeout(FirebaseFirestore.getInstance().collection("historico_viagens").document(acknowledgedTripId)
                .get(Source.SERVER), 12L, TimeUnit.SECONDS).addOnCompleteListener(ack -> {
                    if (!isCurrentAttempt(context, prefs, generation)) return;
                    if (!ack.isSuccessful() || ack.getResult() == null || !ack.getResult().exists()
                        || ack.getResult().get("serverValidatedAt") == null
                        || !sameTripEvidence(ack.getResult(), receipt, origin, destination, simulatorKey)
                        || !sameReceiptOwner(ack.getResult(), driverId, companyId, jobId, contractId,
                            attemptId, contextEpoch, prefs.getLong("receiptCapturedAt", 0L))
                        || (!receipt.currency.isEmpty() && !receipt.currency.equals(ack.getResult().getString("simpleReceiptCurrency")))) {
                        fallback(prefs, "SIMPLE_ACK_HISTORY_MISSING", listener);
                        return;
                    }
                    if (!prefs.edit().putString("submissionTripId", acknowledgedTripId)
                        .remove("nativePermissionTokenRefreshAttempted").commit()) {
                        fallback(prefs, "SIMPLE_ACK_STATE_PERSIST_FAILED", listener);
                        return;
                    }
                    String jobStatus = result.get("jobStatus") instanceof String
                        ? (String) result.get("jobStatus") : "active";
                    SimpleAutomationService.recordConfirmedTrip(context, acknowledgedTripId, jobId, companyId,
                        driverId, contractId, simulatorKey, origin, destination, receipt.amountCents,
                        System.currentTimeMillis(), receipt.currency);
                    SimpleAutomationService.refreshOperationSnapshot(context,
                        clean(prefs.getString("companyName", "")), clean(prefs.getString("operationName", "")),
                        clean(prefs.getString("contractName", "")), jobId, contractId, companyId, driverId,
                        confirmedCount, Math.max(confirmedCount, total), jobStatus,
                        "completed".equalsIgnoreCase(jobStatus), clean(prefs.getString("vehicleName", "")),
                        clean(prefs.getString("trailerName", "")));
                    nativeSuccess(context, prefs, acknowledgedTripId, listener);
                });
        });
    }

    private static void submitGtoReceipt(Context context, SharedPreferences prefs, String rawReceipt,
        Receipt receipt, String driverId, String jobId, String companyId, String contractId,
        String attemptId, String epoch, String origin, String destination, String simulatorKey,
        String simulatorCode, String packageId, int generation, Listener listener) {
        String validationFailure = GtoProReceiptValidationPolicy.validate(jobId, companyId, contractId, attemptId,
            epoch, origin, destination, rawReceipt, receipt.amountCents, receipt.bonusEvidence,
            clean(prefs.getString("submissionTripId", "")));
        if (!validationFailure.isEmpty()) {
            prefs.edit().putString("reasonCode", validationFailure).putString("lastFailureStage", "LOCAL_VALIDATION")
                .putString("lastQueueCallable", "").putString("serverReason", "").apply();
            fallback(prefs, validationFailure, listener);
            return;
        }
        FirebaseFunctions functions = GtoFirebaseRuntime.functions(context, "us-central1");
        if (functions == null) {
            fallback(prefs, "GTO_PRO_BACKEND_UNAVAILABLE", listener);
            return;
        }
        Map<String, Object> request = new HashMap<>();
        request.put("driverId", driverId);
        request.put("jobId", jobId);
        request.put("companyId", companyId);
        request.put("contractId", contractId);
        request.put("attemptId", attemptId);
        request.put("contextEpoch", epoch);
        request.put("origin", origin);
        request.put("destination", destination);
        request.put("simulatorKey", simulatorKey);
        request.put("simulatorCode", simulatorCode);
        request.put("packageId", packageId);
        request.put("amountCents", receipt.amountCents);
        request.put("currency", receipt.currency);
        request.put("bonusEvidence", receipt.bonusEvidence);
        request.put("receiptText", rawReceipt);
        request.put("capturedAt", prefs.getLong("receiptCapturedAt", 0L));
        request.put("previousTripId", clean(prefs.getString("submissionTripId", "")));
        request.put("vehicleName", clean(prefs.getString("vehicleName", "")));
        request.put("trailerName", clean(prefs.getString("trailerName", "")));
        functions.getHttpsCallable("registerGtoProReceipt").call(request).addOnCompleteListener(task -> {
            if (!isCurrentAttempt(context, prefs, generation)) return;
            if (!task.isSuccessful()) {
                Exception error = task.getException();
                String code = error instanceof com.google.firebase.functions.FirebaseFunctionsException
                    ? ((com.google.firebase.functions.FirebaseFunctionsException) error).getCode().name()
                    : "UNAVAILABLE";
                if ("UNAUTHENTICATED".equals(code) &&
                    !prefs.getBoolean("nativePermissionTokenRefreshAttempted", false)) {
                    FirebaseUser user = GtoFirebaseRuntime.currentUser(context);
                    if (user != null && driverId.equals(user.getUid())) {
                        prefs.edit().putBoolean("nativePermissionTokenRefreshAttempted", true).apply();
                        user.getIdToken(true).addOnCompleteListener(refreshed -> {
                            if (!isCurrentAttempt(context, prefs, generation)) return;
                            if (!refreshed.isSuccessful()) {
                                fallback(prefs, AUTH_REQUIRED_PREFIX + "TOKEN_REFRESH_FAILED", listener);
                            } else {
                                submitGtoReceipt(context, prefs, rawReceipt, receipt, driverId,
                                    jobId, companyId, contractId, attemptId, epoch, origin, destination,
                                    simulatorKey, simulatorCode, packageId, generation, listener);
                            }
                        });
                        return;
                    }
                }
                String failureReason = "GTO_PRO_REGISTRATION_FAILED:" + code + ":" + serverFailureMessage(error);
                recordCallableFailure(prefs, "registerGtoProReceipt", error);
                if ("INVALID_ARGUMENT".equals(code) && prefs.getString("reasonCode", "").isEmpty()
                    && "Recibo ou contexto GTO inválido.".equals(serverFailureMessage(error))) {
                    prefs.edit().putString("reasonCode", "GTO_SERVER_CONTRACT_MISMATCH").apply();
                }
                if ("FAILED_PRECONDITION".equals(code)
                    && PendingTripFailurePolicy.isReconciliationRequired(failureReason) &&
                    prefs.getInt("nativeOperationReconciliationGeneration", -1) != generation) {
                    // Reconciliation is allowed once per queue claim/generation. A persisted
                    // boolean made every future retry skip reconciliation forever after the
                    // first failure, which could strand an otherwise valid immutable receipt.
                    prefs.edit().putInt("nativeOperationReconciliationGeneration", generation).apply();
                    Map<String, Object> repair = new HashMap<>();
                    repair.put("jobId", jobId);
                    functions.getHttpsCallable("reconcileOperationTrips").call(repair).addOnCompleteListener(reconciled -> {
                        if (!isCurrentAttempt(context, prefs, generation)) return;
                        if (reconciled.isSuccessful()) {
                            submitGtoReceipt(context, prefs, rawReceipt, receipt, driverId, jobId,
                                companyId, contractId, attemptId, epoch, origin, destination,
                                simulatorKey, simulatorCode, packageId, generation, listener);
                        } else {
                            Exception repairError = reconciled.getException();
                            String repairCode = repairError instanceof com.google.firebase.functions.FirebaseFunctionsException
                                ? ((com.google.firebase.functions.FirebaseFunctionsException) repairError).getCode().name() : "UNAVAILABLE";
                            recordCallableFailure(prefs, "reconcileOperationTrips", repairError);
                            fallback(prefs, "GTO_PRO_REGISTRATION_FAILED:" + repairCode + ":" + serverFailureMessage(repairError), listener);
                        }
                    });
                    return;
                }
                String reason = "NOT_FOUND".equals(code) ? "GTO_PRO_BACKEND_NOT_DEPLOYED"
                    : "UNAUTHENTICATED".equals(code) ? AUTH_REQUIRED_PREFIX + "TOKEN_EXPIRED"
                    : failureReason;
                android.util.Log.w("NVU-ProSubmit", reason + " attemptFp=" + fingerprint(attemptId));
                fallback(prefs, reason, listener);
                return;
            }
            Object result = task.getResult() == null ? null : task.getResult().getData();
            if (!(result instanceof Map) || !Boolean.TRUE.equals(((Map<?, ?>) result).get("registered"))
                || !(((Map<?, ?>) result).get("tripId") instanceof String)
                || (!((String) ((Map<?, ?>) result).get("tripId")).startsWith("nvu_") &&
                    !(Boolean.TRUE.equals(((Map<?, ?>) result).get("duplicate")) &&
                      ((String) ((Map<?, ?>) result).get("tripId")).startsWith("simple_")))) {
                fallback(prefs, "GTO_PRO_ACK_INVALID", listener);
                return;
            }
            String tripId = (String) ((Map<?, ?>) result).get("tripId");
            Object serverProgress = ((Map<?, ?>) result).get("progress");
            Object serverTotal = ((Map<?, ?>) result).get("total");
            int progress = serverProgress instanceof Number ? ((Number) serverProgress).intValue() : -1;
            int total = serverTotal instanceof Number ? ((Number) serverTotal).intValue() : 0;
            String jobStatus = ((Map<?, ?>) result).get("jobStatus") instanceof String
                ? (String) ((Map<?, ?>) result).get("jobStatus") : "";
            if (progress < 1 || progress > 10000 ||
                !prefs.edit().putString("submissionTripId", tripId)
                    .remove("nativePermissionTokenRefreshAttempted").commit()) {
                fallback(prefs, "GTO_PRO_ACK_INVALID", listener);
                return;
            }
            SimpleAutomationService.recordConfirmedTrip(context, tripId, jobId, companyId,
                driverId, contractId, simulatorKey, origin, destination, receipt.amountCents,
                System.currentTimeMillis(), receipt.currency);
            SimpleAutomationService.refreshOperationSnapshot(context,
                clean(prefs.getString("companyName", "")), clean(prefs.getString("operationName", "")),
                clean(prefs.getString("contractName", "")), jobId, contractId, companyId, driverId,
                progress, Math.max(progress, total), jobStatus, "completed".equalsIgnoreCase(jobStatus),
                clean(prefs.getString("vehicleName", "")), clean(prefs.getString("trailerName", "")));
            nativeSuccess(context, prefs, tripId, listener);
        });
    }

    private static void refreshNativeOperationSnapshot(
        Context context,
        SharedPreferences prefs,
        Map<String, Object> job,
        Map<String, Object> contract,
        int progress,
        int total
    ) {
        String jobId = clean(prefs.getString("jobId", ""));
        String contractId = clean(prefs.getString("contractId", ""));
        String companyId = clean(prefs.getString("companyId", ""));
        String driverId = clean(prefs.getString("driverId", ""));
        SharedPreferences active = context.getApplicationContext().getSharedPreferences(
            SimpleAutomationService.PREFS_NAME, Context.MODE_PRIVATE);
        if (!jobId.equals(clean(active.getString("jobId", "")))
            || !companyId.equals(clean(active.getString("companyId", "")))
            || !driverId.equals(clean(active.getString("driverId", "")))) return;
        String companyName = firstText(job, "companyName", "empresaNome");
        if (companyName.isEmpty()) companyName = firstText(contract, "companyName", "empresaNome");
        if (companyName.isEmpty()) companyName = clean(prefs.getString("companyName", "Empresa"));
        String operationName = firstText(job, "operationName", "operacaoNome", "operation", "operacao");
        if (operationName.isEmpty()) operationName = firstText(contract, "operationName", "operacaoNome", "operation", "operacao");
        if (operationName.isEmpty()) operationName = clean(prefs.getString("operationName", ""));
        String contractName = firstText(contract, "contractName", "contratoNome", "name", "nome", "numero", "number", "descricao");
        if (contractName.isEmpty()) contractName = clean(prefs.getString("contractName", ""));
        String vehicleName = firstText(job, "vehicleName", "veiculoNome");
        if (vehicleName.isEmpty()) vehicleName = clean(prefs.getString("vehicleName", ""));
        String trailerName = firstText(job, "trailerName", "reboqueNome");
        if (trailerName.isEmpty()) trailerName = firstText(contract, "trailerName", "reboqueNome");
        if (trailerName.isEmpty()) trailerName = clean(prefs.getString("trailerName", ""));
        String status = firstText(job, "status");
        SimpleAutomationService.refreshOperationSnapshot(
            context, companyName, operationName, contractName, jobId, contractId,
            companyId, driverId, progress, total, status, false, vehicleName, trailerName
        );
    }

    /** A matching attempt ID is insufficient when an older OCR result differs. */
    private static boolean sameTripEvidence(DocumentSnapshot snapshot, Receipt receipt,
            String origin, String destination, String simulatorKey) {
        if (snapshot == null || receipt == null) return false;
        Map<String, Object> data = snapshot.getData();
        if (data == null || !(data.get("valorCents") instanceof Number)) return false;
        return ProReceiptEvidencePolicy.matches(receipt.amountCents, origin, destination,
            simulatorKey, ((Number) data.get("valorCents")).longValue(),
            firstText(data, "origem"), firstText(data, "destino"), firstText(data, "simulatorKey"));
    }

    private static boolean sameTripOwner(DocumentSnapshot snapshot, String driverId, String companyId, String jobId, String contractId, String attemptId) {
        Map<String, Object> data = snapshot.getData();
        if (data == null) return false;
        return driverId.equals(firstText(data, "driverId", "motoristaId"))
            && companyId.equals(firstText(data, "companyId", "empresaId"))
            && jobId.equals(firstText(data, "jobId"))
            && contractId.equals(firstText(data, "contractId", "contratoId"))
            && attemptId.equals(firstText(data, "simpleReceiptCaptureAttemptId"));
    }

    private static boolean sameReceiptOwner(DocumentSnapshot snapshot, String driverId, String companyId,
            String jobId, String contractId, String attemptId, String epoch, long capturedAt) {
        Map<String, Object> data = snapshot.getData();
        if (data == null || Boolean.TRUE.equals(data.get("deleted")) || "DELETED".equals(data.get("status"))) return false;
        boolean sameCapture = capturedAt > 0L && data.get("simpleReceiptCapturedAt") instanceof Number
            && capturedAt == ((Number) data.get("simpleReceiptCapturedAt")).longValue()
            && epoch.equals(firstText(data, "simpleReceiptCaptureContextEpoch"))
            && !firstText(data, "receiptEventKey").isEmpty();
        return driverId.equals(firstText(data, "driverId", "motoristaId"))
            && companyId.equals(firstText(data, "companyId", "empresaId"))
            && jobId.equals(firstText(data, "jobId", "operationId"))
            && contractId.equals(firstText(data, "contractId", "contratoId"))
            && (attemptId.equals(firstText(data, "simpleReceiptCaptureAttemptId")) || sameCapture);
    }

    private static String validateLocalContext(String driverId, String authUid, String jobId, String companyId, String contractId,
                                               String attemptId, String epoch, String origin, String destination,
                                               String simulatorKey, String simulatorCode, String packageId, Receipt receipt) {
        if (driverId.isEmpty() || authUid.isEmpty() || !driverId.equals(authUid)) return "Autenticação nativa não corresponde ao motorista";
        if (jobId.isEmpty() || companyId.isEmpty() || contractId.isEmpty() || attemptId.isEmpty() || epoch.isEmpty()) return "Contexto Pro incompleto";
        if (origin.isEmpty() || destination.isEmpty() || origin.equalsIgnoreCase(destination)) return "Rota Pro inválida";
        if (!isCanonicalSimulator(simulatorKey, simulatorCode, packageId)) return "Simulador Pro incompatível";
        if (receipt == null || receipt.amountCents <= 0 || !receipt.earningsAmountConfirmed || !("NONE".equals(receipt.bonusEvidence) || "ZERO_LABEL".equals(receipt.bonusEvidence) || "OFFER_ONLY".equals(receipt.bonusEvidence))) return "Recibo Pro não aprovado";
        return "";
    }

    private static boolean isCanonicalSimulator(String key, String code, String packageId) {
        if ("global-truck".equals(key)) return "GTO".equals(code) && "com.stargamesapps.gto".equals(packageId);
        if ("toe-3".equals(key)) return "TOE3".equals(code) && "com.WandaSoftware.TruckersofEurope3".equals(packageId);
        if ("wtds".equals(key)) return "WTDS".equals(code) && "com.dynamicgames.worldtruckdrivingsimulator".equals(packageId);
        if ("wbds".equals(key)) return "WBDS".equals(code) && "com.dynamicgames.worldbusdrivingsimulator".equals(packageId);
        return false;
    }

    private static boolean supportsTrailer(String key) {
        return !"wbds".equals(key);
    }

    private static String serverFailureMessage(Exception error) {
        String message = error == null || error.getMessage() == null ? "" : error.getMessage();
        return message.substring(0, Math.min(500, message.length()));
    }

    /** Preserve structured rejection metadata; never copy request/OCR/token data. */
    private static void recordCallableFailure(SharedPreferences prefs, String callable, Exception error) {
        String reasonCode = "";
        Boolean retryable = null;
        String action = "";
        if (error instanceof com.google.firebase.functions.FirebaseFunctionsException) {
            Object details = ((com.google.firebase.functions.FirebaseFunctionsException) error).getDetails();
            if (details instanceof Map) {
                Map<?, ?> map = (Map<?, ?>) details;
                Object candidate = map.get("reasonCode");
                if (candidate instanceof String && ((String) candidate).matches("[A-Z][A-Z0-9_]{2,79}")) {
                    reasonCode = (String) candidate;
                }
                if (map.get("retryable") instanceof Boolean) retryable = (Boolean) map.get("retryable");
                if (map.get("action") instanceof String && ((String) map.get("action")).matches("[A-Za-z_]{2,40}"))
                    action = (String) map.get("action");
            }
        }
        if ("registerCanonicalSimpleTrip".equals(callable)
            && serverFailureMessage(error).contains("Evidência Simple não confirmada")) {
            reasonCode = "SIMPLE_EVIDENCE_UNCONFIRMED";
            retryable = false;
            action = "review_evidence";
        }
        SharedPreferences.Editor diagnostic = prefs.edit().putString("reasonCode", reasonCode)
            .putBoolean("serverRetryableExplicit", retryable != null)
            .putBoolean("serverRetryable", retryable == null || retryable)
            .putString("serverRecoveryAction", action);
        diagnostic
            .putString("lastFailureStage", "CALLABLE_REGISTRATION")
            .putString("lastQueueCallable", callable)
            .putString("serverReason", serverFailureMessage(error)).apply();
    }

    static Receipt parseReceipt(String simulatorKey, String rawText) {
        String normalized = normalize(rawText);
        if (normalized.isEmpty()) return null;
        if ("global-truck".equals(simulatorKey)
            && !GtoResultOcrConsensusPolicy.isSemanticallyComplete(simulatorKey, rawText)) return null;
        String[] labels;
        if ("global-truck".equals(simulatorKey)) {
            labels = new String[]{"VALOR A RECEBER"};
        } else if ("toe-3".equals(simulatorKey)) {
            labels = new String[]{"RENDA TOTAL", "GANHOS"};
        } else {
            labels = new String[]{"GANHOS DA VIAGEM", "TOTAL"};
        }
        boolean baseLabel = false;
        List<Integer> amounts = new ArrayList<>();
        for (String label : labels) {
            int index = normalized.indexOf(label);
            while (index >= 0) {
                baseLabel = true;
                String tail = normalized.substring(Math.min(normalized.length(), index + label.length()), Math.min(normalized.length(), index + label.length() + 140));
                Matcher matcher = AMOUNT_PATTERN.matcher(tail);
                if (matcher.find()) {
                    Integer cents = parseAmountCents(matcher.group(1));
                    if (cents != null) amounts.add(cents);
                }
                index = normalized.indexOf(label, index + 1);
            }
        }
        if (!baseLabel || amounts.isEmpty()) return null;
        Set<Integer> distinct = new HashSet<>(amounts);
        if (distinct.size() != 1) return null;
        if (hasPositiveBonus(normalized) || hasExplicitDoubledValue(normalized)) return null;
        String bonusEvidence = normalized.contains("BONUS VIDEO ADS: 0") || normalized.contains("BONUS VIDEO ADS 0") ? "ZERO_LABEL" : "NONE";
        return new Receipt(amounts.get(0), GtoResultOcrConsensusPolicy.extractCurrency(simulatorKey, rawText), true, bonusEvidence);
    }

    private static boolean hasPositiveBonus(String normalized) {
        for (String label : ZERO_BONUS_LINES) {
            int index = normalized.indexOf(label);
            while (index >= 0) {
                String tail = normalized.substring(Math.min(normalized.length(), index + label.length()), Math.min(normalized.length(), index + label.length() + 35));
                Matcher matcher = Pattern.compile("[0-9]+(?:[.,][0-9]{1,2})?").matcher(tail);
                while (matcher.find()) {
                    Integer cents = parseAmountCents(matcher.group());
                    if (cents != null && cents > 0) return true;
                }
                index = normalized.indexOf(label, index + 1);
            }
        }
        return false;
    }

    private static boolean hasExplicitDoubledValue(String normalized) {
        if (!normalized.matches(".*(?:VALOR DOBRADO|VALOR DUPLICADO|DOBRADO|DUPLICAD|2 X|2X|X 2|X2|X×|×2).*")) return false;
        Matcher matcher = Pattern.compile("(?:VALOR DOBRADO|VALOR DUPLICADO|DOBRADO|DUPLICAD|2 X|2X|X 2|X2|X×|×2)[^0-9]{0,20}([0-9]+(?:[.,][0-9]{1,2})?)").matcher(normalized);
        return matcher.find() && parseAmountCents(matcher.group(1)) != null && parseAmountCents(matcher.group(1)) > 0;
    }

    /**
     * Parses only an unambiguous monetary token. Native Pro must not infer
     * cents from a bare OCR integer and must not treat an international dot as
     * a Brazilian thousands separator (or vice versa) without evidence.
     * Web/Print use the same two-decimal contract before persistence.
     */
    private static Integer parseAmountCents(String raw) {
        Long cents = GtoResultOcrConsensusPolicy.parseAmountCents(raw);
        return cents == null || cents > Integer.MAX_VALUE ? null : cents.intValue();
    }

    private static String deterministicTripId(String driverId, String attemptId) {
        String raw = ("simple_" + driverId + "_" + attemptId).replaceAll("[^A-Za-z0-9_-]", "_");
        return raw.length() > 180 ? raw.substring(0, 180) : raw;
    }

    private static boolean isCurrentAttempt(Context context, SharedPreferences prefs, int generation) {
        return generation == prefs.getInt("nativeAttemptGeneration", 0)
            && !ProPendingTripStore.isCompletionRecorded(context.getApplicationContext()
                .getSharedPreferences(SimpleAutomationService.PREFS_NAME, Context.MODE_PRIVATE), prefs);
    }

    private static void nativeSuccess(Context context, SharedPreferences prefs, String tripId, Listener listener) {
        if (ProPendingTripStore.isCompletionRecorded(context.getApplicationContext()
            .getSharedPreferences(SimpleAutomationService.PREFS_NAME, Context.MODE_PRIVATE), prefs)) return;
        // The entire ACK is durably committed before any presentation/cleanup
        // callback. An interrupted cleanup leaves a terminal, non-retryable ACK.
        boolean saved = prefs.edit()
            .putString("queueStatus", "SYNCED")
            .putString(CanonicalTripOutboxSchema.KEY_STATE, CanonicalTripOutboxSchema.STATE_SERVER_CONFIRMED)
            .putLong(CanonicalTripOutboxSchema.KEY_ACK_AT, System.currentTimeMillis())
            .putString("nativeSubmissionState", "SYNCED")
            .putString("nativeTripId", tripId)
            .putString("captureStage", "SUBMITTED")
            .putString("simpleState", SimpleAutomationService.STATE_COMPLETED)
            .putBoolean("captureUiHidden", false)
            .putBoolean("nativeSubmissionStarted", false)
            .remove("nativeSubmissionStartedAt")
            .commit();
        if (!saved) { fallback(prefs, "NATIVE_ACK_STATE_PERSIST_FAILED", listener); return; }
        listener.onSuccess(tripId);
    }

    private static void fallback(SharedPreferences prefs, String reason, Listener listener) {
        // Native Android is the sole owner of the Pro write. A fallback is only a
        // durable queue state, never a handoff to the Web receipt writer. The
        // immutable receipt remains in this attempt's isolated preferences until
        // the native transaction receives its server ACK.
        prefs.edit()
            .putBoolean("nativeSubmissionStarted", false)
            .remove("nativeSubmissionStartedAt")
            .putString("captureStage", "NATIVE_FALLBACK_PENDING")
            .putString("nativeSubmissionError", clean(reason))
            .apply();
        listener.onFallback(clean(reason));
    }

    static boolean isAuthRequiredReason(String reason) {
        String value = clean(reason);
        return value.startsWith(AUTH_REQUIRED_PREFIX) || value.contains("=UNAUTHENTICATED")
            || value.contains(":UNAUTHENTICATED");
    }

    static boolean isPermissionFailureReason(String reason) {
        String value = clean(reason).toLowerCase(Locale.ROOT);
        return value.contains("permission_denied")
            || value.contains("permission-denied")
            || value.contains("missing or insufficient permissions")
            || value.contains("unauthenticated");
    }

    private static void appendPreflightFailure(List<String> failures, String stage, Task<?> task) {
        if (task == null || task.isSuccessful()) return;
        failures.add(stage + "=" + classifyFirestoreException(task.getException()));
    }

    static String classifyFirestoreException(Exception error) {
        if (error == null) return "UNKNOWN";
        Throwable cause = error;
        for (int depth = 0; cause != null && depth < 5; depth++, cause = cause.getCause()) {
            if (cause instanceof FirebaseFirestoreException) {
                FirebaseFirestoreException.Code code = ((FirebaseFirestoreException) cause).getCode();
                return classifyFirestoreCode(code.name());
            }
        }
        String fallback = classifyFirestoreFailure(String.valueOf(error.getMessage()));
        return "FIRESTORE_WRITE_FAILED".equals(fallback) ? "UNKNOWN" : fallback;
    }

    static String classifyFirestoreCode(String sdkCode) {
        String code = clean(sdkCode).toUpperCase(Locale.ROOT);
        switch (code) {
            case "PERMISSION_DENIED": return "PERMISSION_DENIED";
            case "UNAUTHENTICATED": return "UNAUTHENTICATED";
            case "UNAVAILABLE":
            case "DEADLINE_EXCEEDED":
            case "ABORTED":
            case "RESOURCE_EXHAUSTED": return "NETWORK_TRANSIENT";
            case "FAILED_PRECONDITION": return "FAILED_PRECONDITION";
            default: return code.isEmpty() ? "UNKNOWN" : "FIRESTORE_" + code;
        }
    }

    private static String classifyFirestoreFailure(String reason) {
        String value = clean(reason).toLowerCase(Locale.ROOT);
        if (isPermissionFailureReason(value)) return "PERMISSION_DENIED";
        if (value.contains("superseded")) return "NATIVE_SUBMISSION_SUPERSEDED";
        if (value.contains("unavailable") || value.contains("deadline")
            || value.contains("network") || value.contains("offline")) return "NETWORK_TRANSIENT";
        if (value.contains("failed-precondition") || value.contains("failed_precondition")) {
            return "FAILED_PRECONDITION";
        }
        return value.isEmpty() ? "UNKNOWN" : "FIRESTORE_WRITE_FAILED";
    }

    private static AuthCheck inspectAuth(SharedPreferences prefs, String driverId, String authUid) {
        String normalizedDriver = clean(driverId);
        String normalizedAuth = clean(authUid);
        String state = normalizedAuth.isEmpty()
            ? "MISSING"
            : normalizedDriver.equals(normalizedAuth) ? "MATCH" : "DIVERGENT";
        prefs.edit()
            .putString("nativeAuthState", state)
            .putBoolean("nativeAuthRequired", !"MATCH".equals(state))
            .putLong("nativeAuthDiagnosticAt", System.currentTimeMillis())
            .putString("nativeAuthDriverFingerprint", fingerprint(normalizedDriver))
            .putString("nativeAuthUidFingerprint", fingerprint(normalizedAuth))
            .apply();
        android.util.Log.i("NVU-ProAuth", "state=" + state
            + " driverFp=" + fingerprint(normalizedDriver)
            + " nativeFp=" + fingerprint(normalizedAuth));
        return new AuthCheck(state);
    }

    private static String currentUid() {
        try {
            FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
            return user == null ? "" : clean(user.getUid());
        } catch (RuntimeException error) {
            return "";
        }
    }

    private static String fingerprint(String value) {
        String normalized = clean(value);
        if (normalized.isEmpty()) return "";
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(normalized.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(16);
            for (int index = 0; index < Math.min(8, digest.length); index++) {
                result.append(String.format(Locale.ROOT, "%02x", digest[index]));
            }
            return result.toString();
        } catch (Exception error) {
            return "unavailable";
        }
    }

    private static String firstText(Map<String, Object> data, String... keys) {
        if (data == null) return "";
        for (String key : keys) {
            Object value = data.get(key);
            if (value != null && !clean(String.valueOf(value)).isEmpty()) return clean(String.valueOf(value));
        }
        return "";
    }

    private static String normalize(String value) {
        return Normalizer.normalize(clean(value), Normalizer.Form.NFD)
            .replaceAll("\\p{M}+", "")
            .toUpperCase(Locale.ROOT)
            .replaceAll("\\s+", " ")
            .trim();
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }

    static final class Receipt {
        final int amountCents;
        final String currency;
        final boolean earningsAmountConfirmed;
        final String bonusEvidence;

        Receipt(int amountCents, String currency, boolean earningsAmountConfirmed, String bonusEvidence) {
            this.amountCents = amountCents;
            this.currency = currency;
            this.earningsAmountConfirmed = earningsAmountConfirmed;
            this.bonusEvidence = bonusEvidence;
        }
    }

    private static final class AuthCheck {
        final String state;

        AuthCheck(String state) {
            this.state = state;
        }

        boolean isMatch() {
            return "MATCH".equals(state);
        }
    }
}
