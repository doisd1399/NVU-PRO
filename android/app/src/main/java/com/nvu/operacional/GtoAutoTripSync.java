package com.nvu.operacional;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.functions.FirebaseFunctions;
import com.google.firebase.functions.FirebaseFunctionsException;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * FIX18 durable/integrity layer for completed GTO trips.
 *
 * Real-time freight detection stays in GtoObserverService. This class only owns
 * the immutable trip snapshot, durable completed-delivery queue and Firebase
 * acknowledgement contract. A detected freight is locked to the session before
 * the trip starts, so later UI/context refreshes cannot silently change the trip
 * that is eventually registered.
 */
final class GtoAutoTripSync {
    static final String STATUS_IN_PROGRESS = "IN_PROGRESS";
    static final String STATUS_SYNCING = "SYNCING";
    static final String STATUS_PENDING = "PENDING";
    static final String STATUS_SYNCED = "SYNCED";
    static final String STATUS_REJECTED = "REJECTED";

    static final int CONTRACT_VERSION = 18;

    private static final String QUEUE_PREFS = "nvu_gto_auto_trip_queue_v1"; // retained for FIX17 queue compatibility
    private static final String RETRY_PREFS = "nvu_gto_auto_trip_retry_v1";
    private static final String SNAPSHOT_PREFS = "nvu_gto_trip_snapshot_v2";
    private static final String OPERATION_CONTEXT_PREFS = "nvu_gto_operation_context_v1";
    private static final String OPERATION_CONTEXT_KEY = "current";
    private static final String QUARANTINE_PREFS = "nvu_gto_auto_trip_quarantine_v2";
    private static final String QUEUE_PREFIX = "trip_";
    private static final String SNAPSHOT_PREFIX = "snapshot_";
    private static final String QUARANTINE_PREFIX = "quarantine_";
    private static final String RETRY_AT_PREFIX = "retry_at_";
    private static final String RETRY_COUNT_PREFIX = "retry_count_";
    private static final String RETRY_BLOCK_CODE_PREFIX = "retry_block_code_";
    private static final String RETRY_BLOCK_AT_PREFIX = "retry_block_at_";
    private static final long BASE_RETRY_MS = 15_000L;
    private static final long MAX_RETRY_MS = 5 * 60_000L;
    private static final long CALL_WATCHDOG_MS = 25_000L;
    private static final long QUEUE_RETRY_SUPERVISOR_MS = 15_000L;
    private static final Set<String> IN_FLIGHT = ConcurrentHashMap.newKeySet();
    // A watchdog can release a session and arm a later retry while the original
    // Firebase Task is still capable of invoking a late success/failure callback.
    // Keep an attempt token so an obsolete callback can never overwrite a newer ACK.
    private static final ConcurrentHashMap<String, String> IN_FLIGHT_ATTEMPTS = new ConcurrentHashMap<>();
    private static final Set<String> RETRY_SUPERVISOR_ARMED = ConcurrentHashMap.newKeySet();
    private static final Set<String> AUTH_RECOVERY_RELEASED = ConcurrentHashMap.newKeySet();
    private static final Object AUTH_RECOVERY_LOCK = new Object();
    private static final Handler MAIN_HANDLER = new Handler(Looper.getMainLooper());
    private static boolean authRecoveryListenerAttached = false;
    private static WeakReference<Context> authRecoveryContext = new WeakReference<>(null);
    private static WeakReference<SharedPreferences> authRecoveryPrefs = new WeakReference<>(null);

    private static final FirebaseAuth.AuthStateListener AUTH_STATE_LISTENER = firebaseAuth -> {
        if (firebaseAuth == null || firebaseAuth.getCurrentUser() == null) return;

        // The service owns the UI listener and the normal completion boundary. When it
        // is alive, ask it to flush so a successful ACK also releases the next GTO trip.
        GtoObserverService.retryAutomaticTripQueueIfRunning();

        // MainActivity can be the only live owner after a process/task transition. In
        // that case flush directly with a null listener; durable prefs remain authoritative
        // and the next service start will reconcile the terminal ACK.
        if (!GtoObserverService.isRunning()) {
            Context context = authRecoveryContext.get();
            SharedPreferences prefs = authRecoveryPrefs.get();
            if (context != null && prefs != null) {
                MAIN_HANDLER.post(() -> {
                    recoverLegacyPendingStateOnAuthenticatedStart(context, prefs);
                    GtoTripSubmissionCoordinator.flushPending(context, prefs, null);
                });
            }
        }
    };

    private static final String[] HASH_FIELDS = new String[] {
        "contractVersion", "sessionId", "driverId", "companyId", "jobId", "contractId",
        "vehicleId", "trailerId", "driverName", "companyName", "contractName", "vehicleName",
        "trailerName", "cargo", "companyRoute", "originCompany", "destinationCompany",
        "origin", "destination", "distanceKm", "offeredValue", "rawText", "selectedRow",
        "freightFingerprint", "freightAuthorityId", "freightAuthorityRevision", "freightSource",
        "sourceLineIndex", "sourceLineFingerprint", "evidenceFingerprint",
        "finalValue", "completionStatus", "completedAtClient"
    };

    interface Listener {
        void onSynced(String sessionId, String tripId);
        void onPending(String sessionId, String message);
    }

    private static final class QueueRecord {
        final JSONObject payload;
        final boolean legacy;

        QueueRecord(JSONObject payload, boolean legacy) {
            this.payload = payload;
            this.legacy = legacy;
        }
    }

    private GtoAutoTripSync() {}

    /**
     * Auth restoration on Android is asynchronous and can lag behind the web session.
     * Attach one process-wide listener so a sealed delivery is sent as soon as the native
     * Firebase user becomes available instead of waiting for a later Activity restart.
     */
    private static void armAuthStateRecovery(Context context, SharedPreferences prefs) {
        if (context == null || prefs == null) return;
        synchronized (AUTH_RECOVERY_LOCK) {
            authRecoveryContext = new WeakReference<>(context.getApplicationContext());
            authRecoveryPrefs = new WeakReference<>(prefs);
            if (authRecoveryListenerAttached) return;
            FirebaseAuth auth = GtoFirebaseRuntime.auth(context);
            if (auth == null) return;
            auth.addAuthStateListener(AUTH_STATE_LISTENER);
            authRecoveryListenerAttached = true;
        }
    }

    static com.google.android.gms.tasks.Task<Void> syncCanonicalState(
        Context context,
        SharedPreferences prefs,
        String expectedState,
        String state,
        String reason
    ) {
        String sessionId = clean(prefs.getString("gtoTripSessionId", ""));
        String driverId = clean(prefs.getString("driverId", ""));
        if (sessionId.isEmpty() || driverId.isEmpty() || state == null || state.trim().isEmpty()) {
            return com.google.android.gms.tasks.Tasks.forException(new IllegalStateException("Sessão/contexto GTO ausente"));
        }
        com.google.firebase.auth.FirebaseUser currentUser = GtoFirebaseRuntime.currentUser(context);
        String authenticatedUid = currentUser == null ? "" : clean(currentUser.getUid());
        if (authenticatedUid.isEmpty() || !driverId.equals(authenticatedUid)) {
            // Local gate: do not spend a callable invocation when native Firebase Auth is
            // not ready or belongs to another profile. The observer keeps the pending
            // canonical state locally and may retry later without touching Google APIs.
            return com.google.android.gms.tasks.Tasks.forException(
                new IllegalStateException("Autenticação NVU ausente para sincronizar estado GTO")
            );
        }
        JSONObject payload = new JSONObject();
        try {
            payload.put("sessionId", sessionId);
            payload.put("driverId", driverId);
            payload.put("companyId", clean(prefs.getString("companyId", "")));
            payload.put("jobId", clean(prefs.getString("jobId", "")));
            payload.put("expectedState", clean(expectedState));
            payload.put("state", clean(state).toUpperCase(Locale.ROOT));
            payload.put("reason", clean(reason));
            payload.put("selectedRow", prefs.getInt("selectedFreightRow", -1));
        } catch (JSONException error) {
            return com.google.android.gms.tasks.Tasks.forException(error);
        }
        FirebaseFunctions firebaseFunctions = GtoFirebaseRuntime.functions(context, "us-central1");
        if (firebaseFunctions == null) {
            return com.google.android.gms.tasks.Tasks.forException(
                new IllegalStateException("Firebase Functions indisponível para sincronizar estado GTO")
            );
        }
        return firebaseFunctions
            .getHttpsCallable("syncGtoTripState")
            .call(new java.util.HashMap<String, Object>() {{ put("sessionId", sessionId); put("driverId", driverId); put("companyId", clean(prefs.getString("companyId", ""))); put("jobId", clean(prefs.getString("jobId", ""))); put("expectedState", clean(expectedState)); put("state", clean(state).toUpperCase(Locale.ROOT)); put("reason", clean(reason)); put("selectedRow", prefs.getInt("selectedFreightRow", -1)); }})
            .continueWithTask(task -> {
                if (!task.isSuccessful()) {
                    throw task.getException() != null
                        ? task.getException()
                        : new IllegalStateException("Falha ao sincronizar estado GTO");
                }
                return com.google.android.gms.tasks.Tasks.forResult(null);
            });
    }

    static String newSessionId() {
        return UUID.randomUUID().toString();
    }

    static boolean hasRecoverableSessionSnapshot(Context context, String sessionId, boolean requireFreightLocked) {
        String cleanSession = clean(sessionId);
        if (context == null || cleanSession.isEmpty()) return false;
        SharedPreferences snapshots = context.getSharedPreferences(SNAPSHOT_PREFS, Context.MODE_PRIVATE);
        JSONObject snapshot = readJson(snapshots.getString(SNAPSHOT_PREFIX + cleanSession, ""));
        if (snapshot == null) return false;
        if (!cleanSession.equals(clean(snapshot.optString("sessionId", "")))) return false;
        if (validateContextSnapshot(snapshot) != null) return false;
        return !requireFreightLocked || snapshot.optBoolean("freightLocked", false);
    }

    /**
     * Restores the immutable selected freight of the current session back into the
     * runtime preferences. This is recovery-only: it never rebuilds a snapshot from
     * mutable data and therefore cannot invent or mutate freight identity.
     */
    static boolean restoreLockedFreightToPrefs(Context context, SharedPreferences prefs, String sessionId) {
        String cleanSession = clean(sessionId);
        if (context == null || prefs == null || cleanSession.isEmpty()) return false;
        SharedPreferences snapshots = context.getSharedPreferences(SNAPSHOT_PREFS, Context.MODE_PRIVATE);
        JSONObject snapshot = readJson(snapshots.getString(SNAPSHOT_PREFIX + cleanSession, ""));
        if (snapshot == null || !snapshot.optBoolean("freightLocked", false)) return false;
        if (!cleanSession.equals(clean(snapshot.optString("sessionId", "")))) return false;
        if (validateContextSnapshot(snapshot) != null) return false;
        String durableSelectionSource = clean(snapshot.optString("selectionSource", ""));
        if (!GtoSelectionEvidencePolicy.isHumanBackedSource(durableSelectionSource)) {
            markIntegrityError(prefs, "Snapshot de frete sem evidência humana de seleção; restauração bloqueada.");
            return false;
        }

        JSONObject certified = snapshot.optJSONObject(GtoCertifiedFreight.PREF_KEY);
        if (GtoCertifiedFreight.isValid(certified, cleanSession)) {
            SharedPreferences.Editor restoredEditor = prefs.edit();
            GtoCertifiedFreight.applyToPrefs(restoredEditor, certified);
            restoredEditor
                .putString("selectedFreightSummary", GtoCertifiedFreight.summary(certified))
                .putString("selectionSource", durableSelectionSource)
                .putString("selectionIdentitySource", durableSelectionSource)
                .putString("selectionConfirmationStatus", "CONFIRMED")
                .putString("selectionIdentityStatus", "CONFIRMED")
                .putString("gtoTripIntegrityStatus", "FREIGHT_LOCKED")
                .commit();
            return true;
        }

        String snapshotDestinationCompany = GtoDestinationTextAuthorityPolicy.canonicalizeListCompany(
            snapshot.optString("destinationCompany", "")
        );
        String snapshotAcceptedListOrigin = clean(snapshot.optString("acceptedListOrigin", ""));
        String snapshotCompanyRoute = GtoDestinationTextAuthorityPolicy.canonicalizeRoute(
            snapshot.optString("companyRoute", "")
        );
        boolean pauseMenuEvidence = snapshot.optBoolean("pauseMenuEvidence", false)
            || "pause-menu-open".equals(durableSelectionSource)
            || durableSelectionSource.contains("pause-menu-open");
        boolean pauseCorrectionConfirmed = snapshot.optBoolean("pauseCorrectionConfirmed", false);
        String destination = GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(
            snapshot.optString("destination", "")
        );
        String acceptedListOrigin = snapshotAcceptedListOrigin;
        String acceptedListDestination = GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(
            snapshot.optString("acceptedListDestination", "")
        );
        if (acceptedListDestination.isEmpty()) {
            acceptedListDestination = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
                "", destination, snapshotDestinationCompany, snapshot.optString("rawText", ""),
                snapshotCompanyRoute, snapshot.optString("originCompany", "")
            );
        }
        if (!pauseMenuEvidence) {
            destination = GtoAcceptedFreightFieldPolicy.destination(
                destination,
                snapshotDestinationCompany,
                snapshot.optString("rawText", "")
            );
        }
        acceptedListDestination = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
            acceptedListDestination,
            destination,
            snapshotDestinationCompany,
            snapshot.optString("rawText", ""),
            snapshotCompanyRoute,
            snapshot.optString("originCompany", ""),
            pauseCorrectionConfirmed
        );
        destination = GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(destination);
        acceptedListDestination = GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(acceptedListDestination);
        snapshotDestinationCompany = GtoDestinationTextAuthorityPolicy.canonicalizeListCompany(snapshotDestinationCompany);
        snapshotCompanyRoute = GtoDestinationTextAuthorityPolicy.canonicalizeRoute(snapshotCompanyRoute);

        JSONObject freight = new JSONObject();
        try {
            int selectedRow = snapshot.optInt("selectedRow", -1);
            freight.put("row", selectedRow);
            freight.put("rowIndex", selectedRow);
            freight.put("selectedRow", selectedRow);
            for (String field : new String[] {
                "cargo", "cargoVotes", "companyRoute", "originCompany", "destinationCompany",
                "origin", "acceptedListOrigin", "destination", "acceptedListDestination", "distanceKm", "offeredValue", "rawText",
                "freightFingerprint"
            }) freight.put(field, snapshot.optString(field, ""));
            freight.put("origin", snapshot.optString("origin", ""));
            freight.put("acceptedListOrigin", acceptedListOrigin);
            freight.put("destination", destination);
            freight.put("acceptedListDestination", acceptedListDestination);
            freight.put("pauseMenuEvidence", pauseMenuEvidence);
            freight.put("pauseCorrectionConfirmed", pauseCorrectionConfirmed);
            freight.put("cargoSelectedRowEvidence", snapshot.optBoolean("cargoSelectedRowEvidence", false));
            freight.put("cargoListSameRowAuthority", snapshot.optBoolean("cargoListSameRowAuthority", false));
            freight.put("manualRouteSelectionConfirmed", snapshot.optBoolean("manualRouteSelectionConfirmed", false));
            freight.put("km", snapshot.optString("distanceKm", ""));
        } catch (JSONException error) { return false; }

        String cargo = clean(snapshot.optString("cargo", ""));
        String originCompany = clean(snapshot.optString("originCompany", ""));
        String distance = clean(snapshot.optString("distanceKm", ""));
        String offered = clean(snapshot.optString("offeredValue", ""));
        StringBuilder summary = new StringBuilder();
        String visibleOrigin = GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(
            acceptedListOrigin, snapshot.optString("origin", ""), originCompany,
            pauseMenuEvidence, pauseCorrectionConfirmed
        );
        if (!pauseMenuEvidence && acceptedListOrigin.isEmpty() && !visibleOrigin.isEmpty()) {
            acceptedListOrigin = visibleOrigin;
            try {
                freight.put("acceptedListOrigin", acceptedListOrigin);
            } catch (JSONException ignored) {
                return false;
            }
        }
        String visibleDestination = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
            acceptedListDestination, destination, snapshotDestinationCompany,
            snapshot.optString("rawText", ""), snapshotCompanyRoute,
            snapshot.optString("originCompany", ""), pauseCorrectionConfirmed
        );
        if (!cargo.isEmpty()) summary.append(cargo);
        if (!visibleOrigin.isEmpty()) { if (summary.length() > 0) summary.append(" · "); summary.append(visibleOrigin); }
        if (!visibleDestination.isEmpty()) { if (summary.length() > 0) summary.append(" · "); summary.append(visibleDestination); }
        if (!distance.isEmpty()) { if (summary.length() > 0) summary.append(" · "); summary.append(distance); }
        if (!offered.isEmpty()) { if (summary.length() > 0) summary.append(" · "); summary.append(offered); }

        return prefs.edit()
            .putString("selectedFreight", freight.toString())
            .putString("selectedFreightSummary", summary.toString())
            .putInt("selectedFreightRow", snapshot.optInt("selectedRow", -1))
            .putString("selectedOrigin", visibleOrigin)
            .putString("selectedAcceptedListOrigin", acceptedListOrigin)
            .putString("selectedDestination", destination)
            .putString("selectedAcceptedListDestination", acceptedListDestination)
            .putString("selectedOriginCompany", originCompany)
            .putString("selectedDestinationCompany", snapshotDestinationCompany)
            .putString("selectedCompanyRoute", snapshotCompanyRoute)
            .putString("selectedCargo", cargo)
            .putInt("selectedCargoConsensusReads", snapshot.optInt("cargoVotes", 0))
            .putBoolean("selectedCargoSelectedRowEvidence", snapshot.optBoolean("cargoSelectedRowEvidence", false))
            .putBoolean("selectedCargoListSameRowAuthority", snapshot.optBoolean("cargoListSameRowAuthority", false))
            .putBoolean("manualRouteSelectionConfirmed", snapshot.optBoolean("manualRouteSelectionConfirmed", false))
            .putString("selectedCargoSource", "DURABLE_SNAPSHOT")
            .putString("selectedKm", distance)
            .putString("selectedValue", offered)
            .putString("selectionSource", clean(snapshot.optString("selectionSource", "durable-snapshot")))
            .putString("selectionConfirmationStatus", "CONFIRMED")
            .putString("gtoTripIntegrityStatus", "FREIGHT_LOCKED")
            .remove("selectionFailureReason")
            .remove("selectionFailureAt")
            .commit();
    }

    /** Locks NVU operation context to this trip session before freight detection starts. */
    static boolean beginSessionSnapshot(Context context, SharedPreferences prefs, String sessionId) {
        String cleanSession = clean(sessionId);
        if (context == null || prefs == null || cleanSession.isEmpty()) {
            markIntegrityError(prefs, "Sessão GTO inválida ao criar o snapshot.");
            return false;
        }
        SharedPreferences snapshotPrefs = context.getSharedPreferences(SNAPSHOT_PREFS, Context.MODE_PRIVATE);
        JSONObject existing = readJson(snapshotPrefs.getString(SNAPSHOT_PREFIX + cleanSession, ""));
        if (existing != null) {
            String existingSession = clean(existing.optString("sessionId", ""));
            if (!cleanSession.equals(existingSession)) {
                markIntegrityError(prefs, "Snapshot existente pertence a outra sessão GTO.");
                return false;
            }
            String existingIssue = validateContextSnapshot(existing);
            if (existingIssue != null) {
                markIntegrityError(prefs, existingIssue);
                return false;
            }
            // A session snapshot is write-once. Once a session exists we never rebuild it
            // from mutable SharedPreferences, because those values may belong to a later trip.
            if (existing.optBoolean("freightLocked", false)) {
                prefs.edit().putString("gtoTripIntegrityStatus", "FREIGHT_LOCKED").apply();
            } else {
                prefs.edit().putString("gtoTripIntegrityStatus", "CONTEXT_LOCKED").apply();
            }
            return true;
        }

        JSONObject snapshot = new JSONObject();
        try {
            snapshot.put("contractVersion", CONTRACT_VERSION);
            snapshot.put("sessionId", cleanSession);
            snapshot.put("createdAt", System.currentTimeMillis());
            copyContextFromPrefs(snapshot, prefs);
            snapshot.put("freightLocked", false);
        } catch (JSONException error) {
            markIntegrityError(prefs, "Falha ao criar snapshot da operação GTO.");
            return false;
        }

        String issue = validateContextSnapshot(snapshot);
        if (issue != null) {
            markIntegrityError(prefs, issue);
            return false;
        }

        boolean committed = snapshotPrefs.edit()
            .putString(SNAPSHOT_PREFIX + cleanSession, snapshot.toString())
            .commit();
        if (!committed) {
            markIntegrityError(prefs, "Não foi possível persistir a operação GTO no aparelho.");
            return false;
        }
        prefs.edit()
            .putString("gtoTripIntegrityStatus", "CONTEXT_LOCKED")
            .remove("gtoTripIntegrityError")
            .apply();
        return true;
    }

    /**
     * Returns the operation context sealed for the currently active session.
     *
     * The freight snapshot remains immutable for identity purposes, but the operation
     * presentation metadata (status/progress/total and display names) may be refreshed
     * only when the session job id still matches the live Web context. A different job
     * never falls back to mutable preferences, so the card cannot mix two operations.
     */
    static JSONObject readCurrentOperationSnapshot(Context context, SharedPreferences prefs) {
        if (context == null || prefs == null) return null;
        String sessionId = clean(prefs.getString("gtoTripSessionId", ""));
        String activeJobId = clean(prefs.getString("jobId", ""));
        if (sessionId.isEmpty()) return null;
        SharedPreferences snapshots = context.getSharedPreferences(SNAPSHOT_PREFS, Context.MODE_PRIVATE);
        JSONObject snapshot = readJson(snapshots.getString(SNAPSHOT_PREFIX + sessionId, ""));
        if (snapshot == null) return null;
        String snapshotSessionId = clean(snapshot.optString("sessionId", ""));
        String snapshotJobId = clean(snapshot.optString("jobId", ""));
        String snapshotDriverId = clean(snapshot.optString("driverId", ""));
        String snapshotCompanyId = clean(snapshot.optString("companyId", ""));
        String snapshotContractId = clean(snapshot.optString("contractId", ""));
        if (!sessionId.equals(snapshotSessionId) || snapshotJobId.isEmpty()) return null;
        if (!activeJobId.isEmpty() && !activeJobId.equals(snapshotJobId)) return null;
        String activeDriverId = clean(prefs.getString("driverId", ""));
        String activeCompanyId = clean(prefs.getString("companyId", ""));
        String activeContractId = clean(prefs.getString("contractId", ""));
        if ((!activeDriverId.isEmpty() && !snapshotDriverId.equals(activeDriverId))
            || (!activeCompanyId.isEmpty() && !snapshotCompanyId.equals(activeCompanyId))
            || (!activeContractId.isEmpty() && !snapshotContractId.equals(activeContractId))) return null;
        return snapshot;
    }

    /**
     * Ensures that the current operation has a readable session snapshot. This is safe for
     * rendering because beginSessionSnapshot is write-once: it may create a missing snapshot
     * for the current complete context, but it never replaces an existing snapshot belonging
     * to another identity or a locked freight.
     */
    static JSONObject ensureCurrentOperationSnapshot(Context context, SharedPreferences prefs) {
        JSONObject snapshot = readCurrentOperationSnapshot(context, prefs);
        if (snapshot != null) return snapshot;
        if (context == null || prefs == null) return null;
        String sessionId = clean(prefs.getString("gtoTripSessionId", ""));
        String jobId = clean(prefs.getString("jobId", ""));
        String driverId = clean(prefs.getString("driverId", ""));
        String companyId = clean(prefs.getString("companyId", ""));
        String contractId = clean(prefs.getString("contractId", ""));
        if (sessionId.isEmpty() || jobId.isEmpty() || driverId.isEmpty()
            || companyId.isEmpty() || contractId.isEmpty()) return null;
        if (!beginSessionSnapshot(context, prefs, sessionId)) return null;
        return readCurrentOperationSnapshot(context, prefs);
    }

    /**
     * Operation display context is deliberately independent from the freight/session
     * snapshot. The floating card must show the current Web operation even before a
     * freight is accepted or when a completed freight snapshot is being rotated.
     */
    static boolean persistOperationContextSnapshot(Context context, SharedPreferences prefs) {
        if (context == null || prefs == null) return false;
        JSONObject snapshot = new JSONObject();
        long now = System.currentTimeMillis();
        try {
            snapshot.put("schema", 2);
            snapshot.put("updatedAt", now);
            copyContextFromPrefs(snapshot, prefs);
            boolean committed = context.getSharedPreferences(OPERATION_CONTEXT_PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(OPERATION_CONTEXT_KEY, snapshot.toString())
                .commit();
            prefs.edit()
                .putString("operationContextSnapshotWriteStatus", committed ? "COMMITTED" : "COMMIT_FAILED")
                .putLong("operationContextSnapshotWriteAt", now)
                .putLong("operationContextSnapshotWriteRevision",
                    Math.max(0L, prefs.getLong("gtoOperationContextRevision", 0L)))
                .apply();
            return committed;
        } catch (JSONException error) {
            prefs.edit()
                .putString("operationContextSnapshotWriteStatus", "SERIALIZATION_FAILED")
                .putString("operationContextSnapshotWriteError", error.getClass().getSimpleName())
                .putLong("operationContextSnapshotWriteAt", now)
                .apply();
            return false;
        }
    }

    static boolean clearOperationContextSnapshot(Context context) {
        if (context == null) return false;
        return context.getSharedPreferences(OPERATION_CONTEXT_PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(OPERATION_CONTEXT_KEY)
            .commit();
    }

    static JSONObject readOperationContextSnapshot(Context context, SharedPreferences prefs) {
        if (context == null || prefs == null) return null;
        SharedPreferences contextPrefs = context.getSharedPreferences(
            OPERATION_CONTEXT_PREFS, Context.MODE_PRIVATE
        );
        JSONObject snapshot = readJson(contextPrefs.getString(OPERATION_CONTEXT_KEY, ""));
        if (snapshot == null) return null;
        GtoOperationCardPolicy.ContextSnapshot active = operationContextFromPrefs(prefs);
        GtoOperationCardPolicy.ContextSnapshot dedicated = operationContextFromJson(snapshot);
        if (!GtoOperationCardPolicy.isUsableForActive(dedicated, active)
            || !GtoOperationCardPolicy.revisionMatches(dedicated, active)) return null;
        return snapshot;
    }

    /**
     * Resolves the display authority for the current job. The dedicated snapshot wins only
     * when it belongs to the active identity and was written for the current bridge revision.
     * A failed/stale dedicated commit therefore cannot hide the freshly committed live
     * preferences. The immutable freight/session snapshot remains a last compatible fallback.
     */
    static JSONObject resolveOperationContextSnapshot(Context context, SharedPreferences prefs) {
        if (context == null || prefs == null) return null;
        SharedPreferences contextPrefs = context.getSharedPreferences(
            OPERATION_CONTEXT_PREFS, Context.MODE_PRIVATE
        );
        JSONObject dedicatedJson = readJson(contextPrefs.getString(OPERATION_CONTEXT_KEY, ""));
        JSONObject sessionJson = readCurrentOperationSnapshot(context, prefs);
        GtoOperationCardPolicy.ContextSnapshot active = operationContextFromPrefs(prefs);
        GtoOperationCardPolicy.Resolution resolution = GtoOperationCardPolicy.resolve(
            active,
            operationContextFromJson(dedicatedJson),
            operationContextFromPrefs(prefs),
            operationContextFromJson(sessionJson)
        );
        JSONObject resolved = null;
        if (GtoOperationCardPolicy.AUTH_DEDICATED.equals(resolution.authority)) {
            resolved = dedicatedJson;
        } else if (GtoOperationCardPolicy.AUTH_LIVE.equals(resolution.authority)) {
            resolved = operationContextJsonFromPrefs(prefs);
        } else if (GtoOperationCardPolicy.AUTH_SESSION.equals(resolution.authority)) {
            resolved = sessionJson;
        }
        prefs.edit()
            .putString("operationCardContextAuthority", resolution.authority)
            .putString("operationCardContextJobId",
                resolution.snapshot == null ? "" : resolution.snapshot.jobId)
            .putLong("operationCardContextResolvedAt", System.currentTimeMillis())
            .apply();
        return resolved;
    }

    private static JSONObject operationContextJsonFromPrefs(SharedPreferences prefs) {
        if (prefs == null) return null;
        JSONObject snapshot = new JSONObject();
        try {
            snapshot.put("schema", 2);
            snapshot.put("updatedAt", System.currentTimeMillis());
            copyContextFromPrefs(snapshot, prefs);
            return snapshot;
        } catch (JSONException ignored) {
            return null;
        }
    }

    private static GtoOperationCardPolicy.ContextSnapshot operationContextFromPrefs(
        SharedPreferences prefs
    ) {
        if (prefs == null) return null;
        return new GtoOperationCardPolicy.ContextSnapshot(
            prefs.getString("jobId", ""),
            prefs.getString("driverId", ""),
            prefs.getString("companyId", ""),
            prefs.getString("contractId", ""),
            prefs.getString("operationName", ""),
            prefs.getString("contractName", ""),
            prefs.getString("jobStatus", ""),
            prefs.getInt("jobProgress", 0),
            prefs.getInt("jobTotalDeliveries", 0),
            prefs.getString("vehicleName", ""),
            prefs.getString("trailerName", ""),
            prefs.getLong("gtoOperationContextRevision", 0L)
        );
    }

    private static GtoOperationCardPolicy.ContextSnapshot operationContextFromJson(
        JSONObject snapshot
    ) {
        if (snapshot == null) return null;
        return new GtoOperationCardPolicy.ContextSnapshot(
            snapshot.optString("jobId", ""),
            snapshot.optString("driverId", ""),
            snapshot.optString("companyId", ""),
            snapshot.optString("contractId", ""),
            snapshot.optString("operationName", ""),
            snapshot.optString("contractName", ""),
            snapshot.optString("jobStatus", ""),
            snapshot.optInt("jobProgress", 0),
            snapshot.optInt("jobTotalDeliveries", 0),
            snapshot.optString("vehicleName", ""),
            snapshot.optString("trailerName", ""),
            Math.max(
                snapshot.optLong("operationContextRevision", 0L),
                snapshot.optLong("contextRevision", 0L)
            )
        );
    }

    static String renderOperationSummary(JSONObject snapshot) {
        return GtoOperationCardPolicy.renderSummary(operationContextFromJson(snapshot));
    }

    /**
     * Refreshes only operation-level fields in the current session snapshot. It never
     * changes the selected freight, row, fingerprint, or the immutable session identity.
     */
    static void refreshCurrentOperationSnapshot(Context context, SharedPreferences prefs) {
        JSONObject snapshot = readCurrentOperationSnapshot(context, prefs);
        if (snapshot == null) return;
        String sessionId = clean(prefs.getString("gtoTripSessionId", ""));
        if (sessionId.isEmpty()) return;
        try {
            String existingStatus = clean(snapshot.optString("jobStatus", ""));
            String nextStatus = clean(prefs.getString("jobStatus", ""));
            if (!nextStatus.isEmpty()
                && !(isClosedJobStatus(existingStatus) && !isClosedJobStatus(nextStatus))) {
                snapshot.put("jobStatus", nextStatus);
            }
            int existingProgress = Math.max(0, snapshot.optInt("jobProgress", 0));
            snapshot.put("jobProgress", Math.max(existingProgress, Math.max(0, prefs.getInt("jobProgress", 0))));
            int existingTotal = Math.max(0, snapshot.optInt("jobTotalDeliveries", 0));
            snapshot.put("jobTotalDeliveries", Math.max(existingTotal, Math.max(0, prefs.getInt("jobTotalDeliveries", 0))));
            String nextContractName = clean(prefs.getString("contractName", ""));
            String nextOperationName = clean(prefs.getString("operationName", ""));
            String nextVehicleName = clean(prefs.getString("vehicleName", ""));
            String nextTrailerName = clean(prefs.getString("trailerName", ""));
            if (!nextContractName.isEmpty()) snapshot.put("contractName", nextContractName);
            if (!nextOperationName.isEmpty()) snapshot.put("operationName", nextOperationName);
            if (!nextVehicleName.isEmpty()) snapshot.put("vehicleName", nextVehicleName);
            if (!nextTrailerName.isEmpty()) snapshot.put("trailerName", nextTrailerName);
            String nextRuntimeRevision = clean(prefs.getString("webRuntimeRevision", ""));
            if (!nextRuntimeRevision.isEmpty()) snapshot.put("webRuntimeRevision", nextRuntimeRevision);
            snapshot.put("operationContextRevision", Math.max(0, snapshot.optInt("operationContextRevision", 0)) + 1);
            snapshot.put("operationContextUpdatedAt", System.currentTimeMillis());
            context.getSharedPreferences(SNAPSHOT_PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(SNAPSHOT_PREFIX + sessionId, snapshot.toString())
                .commit();
        } catch (JSONException ignored) {}
    }

    /**
     * Applies a backend operation ACK to the current session snapshot only when the ACK
     * belongs to the same job. This keeps progress/status current without importing an
     * older operation into the active card.
     */
    static void refreshCurrentOperationSnapshotFromAck(
        Context context,
        SharedPreferences prefs,
        String jobId,
        int progress,
        String jobStatus
    ) {
        if (context == null || prefs == null) return;
        String activeJobId = clean(prefs.getString("jobId", ""));
        if (activeJobId.isEmpty() || !activeJobId.equals(clean(jobId))) return;
        JSONObject snapshot = readCurrentOperationSnapshot(context, prefs);
        if (snapshot == null) return;
        String sessionId = clean(prefs.getString("gtoTripSessionId", ""));
        if (sessionId.isEmpty()) return;
        try {
            int existingProgress = Math.max(0, snapshot.optInt("jobProgress", 0));
            snapshot.put("jobProgress", Math.max(existingProgress, Math.max(0, progress)));
            String safeStatus = clean(jobStatus);
            if (!safeStatus.isEmpty()) snapshot.put("jobStatus", safeStatus);
            context.getSharedPreferences(SNAPSHOT_PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(SNAPSHOT_PREFIX + sessionId, snapshot.toString())
                .commit();
        } catch (JSONException ignored) {}
    }

    /** Locks the selected freight into the immutable per-session snapshot. */
    static boolean lockSelectedFreight(Context context, SharedPreferences prefs) {
        String sessionId = clean(prefs.getString("gtoTripSessionId", ""));
        if (sessionId.isEmpty()) {
            markIntegrityError(prefs, "Sessão GTO ausente ao confirmar o frete.");
            return false;
        }
        String selectionEvidenceSource = clean(prefs.getString(
            "selectionIdentitySource",
            prefs.getString("selectionSource", "")
        ));
        if (!GtoSelectionEvidencePolicy.isHumanBackedSource(selectionEvidenceSource)) {
            markIntegrityError(prefs, "Frete sem evidência humana de seleção; bloqueio durável recusado.");
            return false;
        }

        SharedPreferences snapshots = context.getSharedPreferences(SNAPSHOT_PREFS, Context.MODE_PRIVATE);
        JSONObject snapshot = readJson(snapshots.getString(SNAPSHOT_PREFIX + sessionId, ""));
        if (snapshot == null) {
            // Never reconstruct a missing snapshot from mutable preferences. Missing durable
            // state means the identity chain is broken, so the only safe action is to block.
            markIntegrityError(prefs, "Snapshot durável da sessão GTO ausente; viagem bloqueada por segurança.");
            return false;
        }

        JSONObject candidate = readJson(prefs.getString("selectedFreight", ""));
        if (candidate == null) {
            markIntegrityError(prefs, "Snapshot do frete selecionado ausente; nenhuma viagem pode ser iniciada.");
            return false;
        }
        boolean candidateWasCertified = false;
        try {
            // FIX19: the durable lock MUST be built from the complete selected FreightOption.
            // A valid CertifiedFreight is now the only authoritative input. Legacy
            // per-field preferences are used only for pre-authority migration.
            JSONObject storedCertified = GtoCertifiedFreight.read(prefs);
            if (storedCertified != null) candidate = new JSONObject(storedCertified.toString());
            int selectedRow = candidate.has("selectedRow")
                ? candidate.optInt("selectedRow", -1)
                : candidate.has("rowIndex")
                    ? candidate.optInt("rowIndex", -1)
                    : candidate.optInt("row", -1);
            candidate.put("selectedRow", selectedRow);
            candidateWasCertified = GtoCertifiedFreight.isValid(candidate, sessionId);
            if (!candidateWasCertified) {
                // R3.22 compatibility aliases are normalized only before the first seal.
                if (clean(candidate.optString("distanceKm", "")).isEmpty()) {
                    candidate.put("distanceKm", candidate.optString("km", ""));
                }
                boolean candidatePauseEvidence = candidate.optBoolean("pauseMenuEvidence", false);
                boolean candidatePauseCorrectionConfirmed = candidate.optBoolean("pauseCorrectionConfirmed", false);
                String existingOrigin = clean(candidate.optString("origin", ""));
                String canonicalOrigin = existingOrigin.isEmpty()
                    ? GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(
                        candidate.optString("acceptedListOrigin", ""),
                        existingOrigin,
                        candidate.optString("originCompany", ""),
                        candidatePauseEvidence,
                        candidatePauseCorrectionConfirmed
                    )
                    : existingOrigin;
                if (canonicalOrigin.isEmpty()) {
                    markIntegrityError(prefs, "Origem final ausente; o lock aguarda leitura do menu pause.");
                    return false;
                }
                candidate.put("origin", canonicalOrigin);
                if (!candidatePauseEvidence && clean(candidate.optString("acceptedListOrigin", "")).isEmpty()) {
                    candidate.put("acceptedListOrigin", canonicalOrigin);
                }
                String candidateDestinationSource = clean(prefs.getString("selectedDestinationSource", ""));
                String candidateCompanyRoute = clean(candidate.optString("companyRoute", ""));
                String candidateAcceptedListDestination = clean(candidate.optString("acceptedListDestination", ""));
                if (candidateAcceptedListDestination.isEmpty()) {
                    candidateAcceptedListDestination = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
                        "", candidate.optString("destination", ""), candidate.optString("destinationCompany", ""),
                        candidate.optString("rawText", ""), candidateCompanyRoute
                    );
                }
                candidate.put("acceptedListDestination", candidateAcceptedListDestination);
                boolean candidatePauseMenuEvidence = candidate.optBoolean("pauseMenuEvidence", false)
                    || "PAUSE_OCR".equals(candidateDestinationSource)
                    || selectionEvidenceSource.contains("pause-menu-open");
                if (!candidatePauseMenuEvidence
                    && clean(candidate.optString("destination", "")).isEmpty()) {
                    candidate.put("destination", GtoAcceptedFreightFieldPolicy.destination(
                        "",
                        candidate.optString("destinationCompany", ""),
                        candidate.optString("rawText", "")
                    ));
                }
                candidate.put("pauseMenuEvidence", candidatePauseMenuEvidence);
            }
            if (!candidateWasCertified) {
                String originSource = clean(prefs.getString("selectedOriginSource", ""));
                String destinationSource = clean(prefs.getString("selectedDestinationSource", ""));
                boolean pauseMenuEvidence = "PAUSE_OCR".equals(originSource)
                    || "PAUSE_OCR".equals(destinationSource)
                    || selectionEvidenceSource.contains("pause-menu-open");
                boolean manualOrigin = "MANUAL_DRIVER".equals(clean(prefs.getString("reviewOriginSource", "")))
                    || "MANUAL_DRIVER".equals(originSource);
                boolean manualDestination = "MANUAL_DRIVER".equals(clean(prefs.getString("reviewDestinationSource", "")))
                    || "MANUAL_DRIVER".equals(destinationSource);
                boolean manualRoute = candidate.optBoolean("manualRouteSelectionConfirmed", false)
                    || GtoManualRouteSelectionPolicy.SOURCE.equals(clean(originSource))
                    || GtoManualRouteSelectionPolicy.SOURCE.equals(clean(destinationSource));
                boolean directSelectedRowEvidence = candidate.optBoolean("directSelectedRowEvidence", false)
                    && "DIRECT_HUMAN_GEOMETRY".equals(clean(prefs.getString("selectedRowCommitPath", "")))
                    && prefs.getInt("selectedFreightRow", -1) == selectedRow
                    && "CONFIRMED".equals(clean(prefs.getString("selectionIdentityStatus", "")));
                boolean cargoListSameRowAuthority = candidate.optBoolean("cargoListSameRowAuthority", false)
                    && prefs.getInt("selectedFreightRow", -1) == selectedRow
                    && "CONFIRMED".equals(clean(prefs.getString("selectionIdentityStatus", "")))
                    && !pauseMenuEvidence;
                String cargoSource = clean(prefs.getString("selectedCargoSource", ""));
                String reviewCargoSource = clean(prefs.getString("reviewCargoSource", ""));
                boolean cargoSourceBoundEvidence = candidate.optBoolean("cargoSelectedRowEvidence", false)
                    && ("LIST".equals(cargoSource) || "LIST_SAME_ROW".equals(cargoSource)
                        || "LIST_SAME_ROW".equals(reviewCargoSource)
                        || "LIST_CARGO_SAME_ROW".equals(reviewCargoSource))
                    && prefs.getInt("selectedFreightRow", -1) == selectedRow
                    && "CONFIRMED".equals(clean(prefs.getString("selectionIdentityStatus", "")));
                int originReads = candidate.optInt("originVotes", 0);
                int destinationReads = candidate.optInt("destinationVotes", 0);
                if (!pauseMenuEvidence && !manualOrigin && !manualRoute && !directSelectedRowEvidence && originReads < 2) {
                    markIntegrityError(prefs, "Origem sem duas leituras concordantes; lock aguardando releitura.");
                    return false;
                }
                if (!pauseMenuEvidence && !manualDestination && !manualRoute && !directSelectedRowEvidence && destinationReads < 2) {
                    markIntegrityError(prefs, "Destino sem duas leituras concordantes; lock aguardando releitura.");
                    return false;
                }
                int cargoReads = Math.max(
                    candidate.optInt("cargoVotes", 0),
                    prefs.getInt("selectedCargoConsensusReads", 0)
                );
                boolean manualCargo = "MANUAL_DRIVER".equals(cargoSource)
                    || "MANUAL_DRIVER".equals(clean(prefs.getString("reviewCargoSource", "")));
                if (!manualRoute && !manualCargo && !directSelectedRowEvidence && !cargoListSameRowAuthority
                    && !cargoSourceBoundEvidence && !GtoCargoConsensusPolicy.confirmed(cargoReads)) {
                    markIntegrityError(prefs, "Carga sem duas leituras concordantes; lock aguardando releitura.");
                    return false;
                }
                candidate.put("cargoVotes", cargoReads);
                candidate.put("cargoListSameRowAuthority", cargoListSameRowAuthority);
                candidate.put("freightFingerprint", freightFingerprint(candidate));
            } else if (GtoCertifiedFreight.validationIssue(candidate, sessionId) != null) {
                markIntegrityError(prefs, "Autoridade certificada inválida; lock bloqueado por segurança.");
                return false;
            }
        } catch (JSONException error) {
            markIntegrityError(prefs, "Falha ao preparar o snapshot integral do frete selecionado.");
            return false;
        }

        String freightIssue = validateFreight(candidate, clean(prefs.getString("contractMode", "")));
        if (freightIssue != null) {
            markIntegrityError(prefs, freightIssue);
            return false;
        }

        if (snapshot.optBoolean("freightLocked", false)) {
            if (!sameFreight(snapshot, candidate)) {
                boolean pauseCorrection = candidate.optBoolean("pauseCorrectionConfirmed", false)
                    && candidate.optBoolean("pauseMenuEvidence", false);
                boolean sameAnchors = pauseCorrection && GtoPauseCorrectionPolicy.sameSelectedFreightAnchors(
                    snapshot.optInt("selectedRow", -1),
                    candidate.optInt("selectedRow", -1),
                    snapshot.optString("cargo", ""),
                    candidate.optString("cargo", ""),
                    snapshot.optString("distanceKm", ""),
                    candidate.optString("distanceKm", ""),
                    snapshot.optString("offeredValue", ""),
                    candidate.optString("offeredValue", "")
                );
                if (!sameAnchors) {
                    markIntegrityError(prefs, "O frete desta sessão já estava bloqueado com dados diferentes.");
                    return false;
                }
                try {
                    for (String field : new String[] {
                        "cargo", "companyRoute", "originCompany", "destinationCompany", "origin",
                        "acceptedListOrigin", "destination", "acceptedListDestination", "distanceKm", "offeredValue", "rawText", "freightFingerprint"
                    }) {
                        snapshot.put(field, candidate.optString(field, ""));
                    }
                    snapshot.put("selectedRow", candidate.optInt("selectedRow", -1));
                    snapshot.put("cargoVotes", candidate.optInt("cargoVotes", 0));
                    snapshot.put("cargoSelectedRowEvidence", candidate.optBoolean("cargoSelectedRowEvidence", false));
                    snapshot.put("cargoListSameRowAuthority", candidate.optBoolean("cargoListSameRowAuthority", false));
                    snapshot.put("pauseMenuEvidence", true);
                    snapshot.put("pauseCorrectionConfirmed", true);
                    snapshot.put("manualRouteSelectionConfirmed", candidate.optBoolean("manualRouteSelectionConfirmed", false));
                } catch (JSONException error) {
                    markIntegrityError(prefs, "Falha ao reconciliar a leitura validada do menu pause.");
                    return false;
                }
                if (!snapshots.edit()
                    .putString(SNAPSHOT_PREFIX + sessionId, snapshot.toString())
                    .commit()) {
                    markIntegrityError(prefs, "Não foi possível persistir a correção validada do menu pause.");
                    return false;
                }
            }
            return true;
        }

        try {
            if (candidateWasCertified) {
                GtoCertifiedFreight.copyIntoSnapshot(snapshot, candidate);
            }
            for (String field : new String[] {
                "cargo", "companyRoute", "originCompany", "destinationCompany", "origin",
                "acceptedListOrigin", "destination", "acceptedListDestination", "distanceKm", "offeredValue", "rawText", "freightFingerprint"
            }) {
                snapshot.put(field, candidate.optString(field, ""));
            }
            snapshot.put("selectedRow", candidate.optInt("selectedRow", -1));
            snapshot.put("cargoVotes", candidate.optInt("cargoVotes", 0));
            snapshot.put("cargoSelectedRowEvidence", candidate.optBoolean("cargoSelectedRowEvidence", false));
            snapshot.put("cargoListSameRowAuthority", candidate.optBoolean("cargoListSameRowAuthority", false));
            snapshot.put("pauseMenuEvidence", candidate.optBoolean("pauseMenuEvidence", false));
            snapshot.put("pauseCorrectionConfirmed", candidate.optBoolean("pauseCorrectionConfirmed", false));
            snapshot.put("manualRouteSelectionConfirmed", candidate.optBoolean("manualRouteSelectionConfirmed", false));
            snapshot.put("selectionSource", selectionEvidenceSource);
            snapshot.put("freightLocked", true);
            snapshot.put("freightLockedAt", System.currentTimeMillis());
        } catch (JSONException error) {
            markIntegrityError(prefs, "Falha ao bloquear os dados do frete selecionado.");
            return false;
        }

        boolean committed = snapshots.edit()
            .putString(SNAPSHOT_PREFIX + sessionId, snapshot.toString())
            .commit();
        if (!committed) {
            markIntegrityError(prefs, "Não foi possível persistir o frete selecionado no aparelho.");
            return false;
        }
        prefs.edit()
            .putString("gtoTripIntegrityStatus", "FREIGHT_LOCKED")
            .remove("gtoTripIntegrityError")
            .apply();
        return true;
    }

    /**
     * HF64 terminal recovery helper. Reads only the immutable freight snapshot that was
     * already validated and locked before TRIP_IN_PROGRESS. It never falls back to live
     * mutable preferences, so it can safely recover the agreed freight payout after the
     * Concluído screen has disappeared or the observer process has been recreated.
     */
    static String lockedOfferedValue(Context context, String sessionId) {
        String cleanSession = clean(sessionId);
        if (context == null || cleanSession.isEmpty()) return "";
        SharedPreferences snapshots = context.getSharedPreferences(SNAPSHOT_PREFS, Context.MODE_PRIVATE);
        JSONObject snapshot = readJson(snapshots.getString(SNAPSHOT_PREFIX + cleanSession, ""));
        if (snapshot == null || !snapshot.optBoolean("freightLocked", false)) return "";
        if (!cleanSession.equals(clean(snapshot.optString("sessionId", "")))) return "";
        if (validateContextSnapshot(snapshot) != null) return "";
        if (validateFreight(snapshot, clean(snapshot.optString("contractMode", ""))) != null) return "";
        return GtoMoneyValue.canonical(clean(snapshot.optString("offeredValue", "")));
    }

    static boolean hasPendingSession(Context context, String sessionId) {
        String cleanSession = clean(sessionId);
        if (cleanSession.isEmpty()) return false;
        SharedPreferences queue = context.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE);
        String sealed = queue.getString(QUEUE_PREFIX + cleanSession, "");
        return sealed != null && !sealed.trim().isEmpty();
    }

    static boolean hasQueued(Context context) {
        SharedPreferences queue = context.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE);
        for (Map.Entry<String, ?> entry : queue.getAll().entrySet()) {
            String key = entry.getKey();
            if (!key.startsWith(QUEUE_PREFIX)) continue;
            Object value = entry.getValue();
            if (value instanceof String && !((String) value).trim().isEmpty()) return true;
        }
        return false;
    }

    static boolean hasQueuedOtherThan(Context context, String excludedSessionId) {
        String excluded = clean(excludedSessionId);
        SharedPreferences queue = context.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE);
        for (Map.Entry<String, ?> entry : queue.getAll().entrySet()) {
            String key = entry.getKey();
            if (!key.startsWith(QUEUE_PREFIX)) continue;
            String sessionId = clean(key.substring(QUEUE_PREFIX.length()));
            Object value = entry.getValue();
            if (sessionId.isEmpty() || sessionId.equals(excluded)) continue;
            if (value instanceof String && !((String) value).trim().isEmpty()) return true;
        }
        return false;
    }

    static int queuedCount(Context context) {
        SharedPreferences queue = context.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE);
        int count = 0;
        for (Map.Entry<String, ?> entry : queue.getAll().entrySet()) {
            if (!entry.getKey().startsWith(QUEUE_PREFIX)) continue;
            Object value = entry.getValue();
            if (value instanceof String && !((String) value).trim().isEmpty()) count++;
        }
        return count;
    }

    static boolean hasPending(Context context) {
        SharedPreferences queue = context.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE);
        SharedPreferences retry = context.getSharedPreferences(RETRY_PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        for (String key : queue.getAll().keySet()) {
            if (!key.startsWith(QUEUE_PREFIX)) continue;
            String sessionId = key.substring(QUEUE_PREFIX.length());
            long retryAt = retry.getLong(RETRY_AT_PREFIX + sessionId, 0L);
            if (retryAt <= now) return true;
            if (retryAt == Long.MAX_VALUE) {
                String blocked = clean(retry.getString(RETRY_BLOCK_CODE_PREFIX + sessionId, ""));
                if ("NO_NATIVE_AUTH".equals(blocked)
                    || "UNAUTHENTICATED".equals(blocked)
                    || "DRIVER_UID_MISMATCH".equals(blocked)) return true;
            }
        }
        return false;
    }

    /**
     * HF52 self-healing diagnostics: legacy background-sync preference markers are
     * never authoritative. The sealed durable queue is the source of truth. This also
     * cleans sticky HF51 markers after upgrade when their queue entry already ACKed or
     * was quarantined while no service listener was attached.
     */
    static void reconcileBackgroundSyncMarkers(Context context, SharedPreferences mainPrefs) {
        String markedSession = clean(mainPrefs.getString("backgroundSyncPendingSessionId", ""));
        String previousSession = clean(mainPrefs.getString("gtoPreviousQueuedSessionId", ""));
        SharedPreferences.Editor editor = null;
        if (!markedSession.isEmpty() && !hasPendingSession(context, markedSession)) {
            editor = mainPrefs.edit()
                .remove("backgroundSyncPendingSessionId")
                .remove("backgroundSyncPendingDetail")
                .remove("backgroundSyncPendingAt");
        }
        if (!previousSession.isEmpty() && !hasPendingSession(context, previousSession)) {
            if (editor == null) editor = mainPrefs.edit();
            editor.remove("gtoPreviousQueuedSessionId");
        }
        if (editor != null) editor.apply();
    }

    /**
     * HF54 upgrade recovery. A beta device may arrive here with a real FIX18 queue
     * created by HF51 while the old backend still rejected a valid trip, or with
     * sticky HF51 background markers that no longer represent the authenticated
     * driver's queue. Never delete a sealed trip. Instead, reconcile markers,
     * reset only this driver's retry backoff once, and persist field diagnostics
     * before the normal idempotent flush is attempted.
     */
    static void recoverLegacyPendingStateOnAuthenticatedStart(Context context, SharedPreferences mainPrefs) {
        reconcileBackgroundSyncMarkers(context, mainPrefs);

        com.google.firebase.auth.FirebaseUser currentUser = GtoFirebaseRuntime.currentUser(context);
        String currentUid = currentUser == null ? "" : clean(currentUser.getUid());
        String currentSession = clean(mainPrefs.getString("gtoTripSessionId", ""));
        String previousMarker = clean(mainPrefs.getString("gtoPreviousQueuedSessionId", ""));
        String backgroundMarker = clean(mainPrefs.getString("backgroundSyncPendingSessionId", ""));
        String lastError = clean(mainPrefs.getString("gtoTripSyncLastErrorCode", ""));
        long now = System.currentTimeMillis();

        if (currentUid.isEmpty() && hasQueued(context)) {
            armAuthStateRecovery(context, mainPrefs);
        }

        SharedPreferences queue = context.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE);
        SharedPreferences retry = context.getSharedPreferences(RETRY_PREFS, Context.MODE_PRIVATE);
        int total = 0;
        int owned = 0;
        int foreign = 0;
        int invalid = 0;
        boolean currentQueued = false;
        boolean previousOwned = false;
        boolean backgroundOwned = false;
        String recoveredUid = clean(mainPrefs.getString("gtoQueueRecoverySchemaUid", ""));
        boolean forceRetry = !currentUid.isEmpty()
            && (mainPrefs.getInt("gtoQueueRecoverySchema", 0) < 2 || !currentUid.equals(recoveredUid));

        SharedPreferences.Editor retryEditor = forceRetry ? retry.edit() : null;
        for (Map.Entry<String, ?> entry : queue.getAll().entrySet()) {
            String key = entry.getKey();
            if (!key.startsWith(QUEUE_PREFIX)) continue;
            Object value = entry.getValue();
            if (!(value instanceof String) || ((String) value).trim().isEmpty()) continue;
            total++;
            String sessionId = clean(key.substring(QUEUE_PREFIX.length()));
            if (sessionId.equals(currentSession)) currentQueued = true;

            QueueRecord record = readQueueRecord((String) value);
            if (record == null) {
                invalid++;
                continue;
            }
            String payloadDriverId = clean(record.payload.optString("driverId", ""));
            boolean belongsToCurrentDriver = !currentUid.isEmpty() && currentUid.equals(payloadDriverId);
            if (belongsToCurrentDriver) {
                owned++;
                if (sessionId.equals(previousMarker)) previousOwned = true;
                if (sessionId.equals(backgroundMarker)) backgroundOwned = true;
                String blockedCode = clean(retry.getString(RETRY_BLOCK_CODE_PREFIX + sessionId, ""));
                boolean authRecovered = ("NO_NATIVE_AUTH".equals(blockedCode) || "UNAUTHENTICATED".equals(blockedCode))
                    && AUTH_RECOVERY_RELEASED.add(sessionId + ":" + blockedCode);
                if (forceRetry || authRecovered) {
                    // HF59 retries an older preserved queue once after the recovery-schema
                    // upgrade, and releases an auth-paused queue once per process when a
                    // matching native Firebase user becomes available. It never loops.
                    if (retryEditor == null) retryEditor = retry.edit();
                    retryEditor.remove(RETRY_AT_PREFIX + sessionId)
                        .remove(RETRY_COUNT_PREFIX + sessionId)
                        .remove(RETRY_BLOCK_CODE_PREFIX + sessionId)
                        .remove(RETRY_BLOCK_AT_PREFIX + sessionId);
                    if (sessionId.equals(currentSession)) {
                        mainPrefs.edit().putBoolean("gtoTripSyncRetryPaused", false).apply();
                    }
                }
            } else {
                foreign++;
            }
        }
        if (retryEditor != null) retryEditor.commit();

        SharedPreferences.Editor diagnostics = mainPrefs.edit()
            .putLong("gtoQueueRecoveryLastAt", now)
            .putInt("gtoQueueRecoveryQueueCount", total)
            .putInt("gtoQueueRecoveryOwnedCount", owned)
            .putInt("gtoQueueRecoveryForeignCount", foreign)
            .putInt("gtoQueueRecoveryInvalidCount", invalid)
            .putBoolean("gtoQueueRecoveryCurrentSessionQueued", currentQueued)
            .putString("gtoQueueRecoveryAuthUid", currentUid)
            .putString("gtoQueueRecoveryPreviousMarker", previousMarker)
            .putString("gtoQueueRecoveryBackgroundMarker", backgroundMarker)
            .putString("gtoQueueRecoveryLastErrorCode", lastError)
            .putString("gtoQueueRecoverySummary",
                "queue=" + total
                    + " owned=" + owned
                    + " foreign=" + foreign
                    + " invalid=" + invalid
                    + " currentQueued=" + currentQueued
                    + " forced=" + forceRetry);

        if (!currentUid.isEmpty()) {
            if (forceRetry) diagnostics
                .putInt("gtoQueueRecoverySchema", 2)
                .putString("gtoQueueRecoverySchemaUid", currentUid);
            // A marker owned by another login must never make the current driver look
            // permanently blocked. The sealed foreign queue itself is preserved intact.
            if (!previousMarker.isEmpty() && !previousOwned) {
                diagnostics.remove("gtoPreviousQueuedSessionId");
            }
            if (!backgroundMarker.isEmpty() && !backgroundOwned) {
                diagnostics
                    .remove("backgroundSyncPendingSessionId")
                    .remove("backgroundSyncPendingDetail")
                    .remove("backgroundSyncPendingAt");
            }
        }
        diagnostics.commit();
        reconcileBackgroundSyncMarkers(context, mainPrefs);
    }

    /** True only when another sealed queue entry belongs to the authenticated driver. */
    static boolean hasQueuedOtherThanForDriver(Context context, String excludedSessionId, String driverUid) {
        String excluded = clean(excludedSessionId);
        String uid = clean(driverUid);
        if (uid.isEmpty()) return false;
        SharedPreferences queue = context.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE);
        for (Map.Entry<String, ?> entry : queue.getAll().entrySet()) {
            String key = entry.getKey();
            if (!key.startsWith(QUEUE_PREFIX)) continue;
            String sessionId = clean(key.substring(QUEUE_PREFIX.length()));
            Object value = entry.getValue();
            if (sessionId.isEmpty() || sessionId.equals(excluded) || !(value instanceof String)) continue;
            QueueRecord record = readQueueRecord((String) value);
            if (record == null) continue;
            if (uid.equals(clean(record.payload.optString("driverId", "")))) return true;
        }
        return false;
    }

    /** Persists a sealed completed payload before the network call is attempted. */
    static boolean enqueueConfirmedTrip(Context context, SharedPreferences mainPrefs, Listener listener) {
        String sessionId = clean(mainPrefs.getString("gtoTripSessionId", ""));
        if (sessionId.isEmpty()) {
            markPending(mainPrefs, "Sessão GTO ausente; a viagem não foi enviada ainda.");
            if (listener != null) listener.onPending("", "Sessão GTO ausente");
            return false;
        }
        // The durable queue is the final submission boundary. Keep the terminal rule
        // here as well as in the coordinator so no future caller can enqueue an active
        // trip merely because a snapshot or completion flag from another path exists.
        boolean terminalState = GtoTripSubmissionPolicy.maySubmit(
            mainPrefs.getString("tripState", ""),
            mainPrefs.getString("completionStatus", ""),
            mainPrefs.getBoolean("resultCertifiedLatched", false),
            sessionId
        );
        if (!terminalState) {
            markPending(mainPrefs, "Viagem ainda em andamento; envio bloqueado até a confirmação final Concluído.");
            if (listener != null) listener.onPending(
                sessionId, "Envio bloqueado: a viagem ainda não foi confirmada como Concluído."
            );
            return false;
        }

        JSONObject payload = buildPayload(context, mainPrefs, sessionId);
        String validationIssue = payload == null ? "Dados da viagem incompletos" : validateCompletedPayload(payload);
        if (payload == null || validationIssue != null) {
            String issue = validationIssue == null ? "Dados da viagem incompletos" : validationIssue;
            markPending(mainPrefs, issue + "; registro preservado para correção/retry.");
            if (listener != null) listener.onPending(sessionId, issue);
            return false;
        }

        SharedPreferences queue = context.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE);
        SharedPreferences retry = context.getSharedPreferences(RETRY_PREFS, Context.MODE_PRIVATE);
        String sealed = sealPayload(payload);
        if (sealed.isEmpty() || !queue.edit().putString(QUEUE_PREFIX + sessionId, sealed).commit()) {
            markPending(mainPrefs, "Falha ao persistir a entrega concluída; o registro não foi descartado.");
            if (listener != null) listener.onPending(sessionId, "Falha de persistência local");
            return false;
        }

        retry.edit()
            .remove(RETRY_AT_PREFIX + sessionId)
            .remove(RETRY_COUNT_PREFIX + sessionId)
            .remove(RETRY_BLOCK_CODE_PREFIX + sessionId)
            .remove(RETRY_BLOCK_AT_PREFIX + sessionId)
            .commit();
        mainPrefs.edit()
            .putString("gtoTripSyncStatus", STATUS_PENDING)
            .putString("gtoTripIntegrityStatus", "PAYLOAD_SEALED")
            .putBoolean("gtoTripSyncRetryPaused", false)
            .remove("gtoRegisteredTripId")
            .remove("gtoTripSyncError")
            .remove("gtoTripIntegrityError")
            .commit();

        flushPending(context, mainPrefs, listener);
        return true;
    }

    private static boolean releaseInFlightAttempt(String sessionId, String attemptToken) {
        if (sessionId == null || attemptToken == null) return false;
        if (!attemptToken.equals(IN_FLIGHT_ATTEMPTS.get(sessionId))) return false;
        if (!IN_FLIGHT.remove(sessionId)) return false;
        IN_FLIGHT_ATTEMPTS.remove(sessionId, attemptToken);
        return true;
    }

    static void flushPending(Context context, SharedPreferences mainPrefs, Listener listener) {
        SharedPreferences queue = context.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE);
        SharedPreferences retry = context.getSharedPreferences(RETRY_PREFS, Context.MODE_PRIVATE);
        Map<String, ?> all = queue.getAll();
        if (all.isEmpty()) return;

        List<String> keys = new ArrayList<>();
        for (String key : all.keySet()) {
            if (key.startsWith(QUEUE_PREFIX)) keys.add(key);
        }
        if (keys.isEmpty()) return;

        // HF116: a durable queue entry must own its own retry supervisor. Previously a
        // failed callable only wrote retry_at_* and relied on Activity onStart or auth
        // restoration to call flushPending again, leaving an active GTO session stuck
        // on the temporary-failure message.
        armPendingRetrySupervisor(context, mainPrefs, listener);

        long now = System.currentTimeMillis();
        String currentSessionId = clean(mainPrefs.getString("gtoTripSessionId", ""));
        com.google.firebase.auth.FirebaseUser currentUser = GtoFirebaseRuntime.currentUser(context);
        if (currentUser == null) {
            armAuthStateRecovery(context, mainPrefs);
            // HF66: native FirebaseAuth can be restored after the observer has already
            // started. A permanent Long.MAX_VALUE pause made the first completed trip
            // look like a blocking predecessor until process restart. No callable is
            // attempted without auth; the sealed queue instead receives a bounded local
            // retry and is re-evaluated automatically when auth becomes available.
            String message = "Sessão NVU indisponível; o envio para o sistema será retomado automaticamente após a autenticação.";
            boolean currentSessionQueued = false;
            boolean anyRetryScheduled = false;
            for (String key : keys) {
                String queuedSessionId = key.substring(QUEUE_PREFIX.length());
                if (queuedSessionId.equals(currentSessionId)) currentSessionQueued = true;
                long retryAt = retry.getLong(RETRY_AT_PREFIX + queuedSessionId, 0L);
                if (retryAt <= now) {
                    boolean pauseChanged = pauseRetryForReason(retry, queuedSessionId, "NO_NATIVE_AUTH");
                    anyRetryScheduled = pauseChanged || anyRetryScheduled;
                    if (listener != null && pauseChanged) listener.onPending(queuedSessionId, message);
                }
            }
            if (!anyRetryScheduled && !currentSessionQueued) return;
            SharedPreferences.Editor editor = mainPrefs.edit()
                .putLong("backgroundSyncPendingAt", now)
                .putString("backgroundSyncPendingDetail", message)
                .putString("backgroundSyncLastErrorCode", "NO_NATIVE_AUTH");
            if (currentSessionQueued) {
                editor
                    .putLong("gtoTripSyncLastAttemptAt", now)
                    .putString("gtoTripSyncLastErrorCode", "NO_NATIVE_AUTH")
                    .putBoolean("gtoTripSyncRetryPaused", false)
                    .apply();
                markPending(mainPrefs, message);
            } else {
                // A queued PREVIOUS delivery remains orthogonal to the fresh/current
                // freight session and never changes its state to PENDING.
                editor.apply();
            }
            return;
        }
        String currentUid = clean(currentUser.getUid());

        for (String key : keys) {
            String raw = queue.getString(key, "");
            String sessionId = key.substring(QUEUE_PREFIX.length());
            if (raw == null || raw.trim().isEmpty()) {
                quarantine(context, queue, key, sessionId, raw == null ? "" : raw, "Entrada de fila vazia");
                notifyIntegrityProblem(mainPrefs, listener, sessionId, "Fila local inválida preservada para diagnóstico.");
                continue;
            }

            String blockedCode = clean(retry.getString(RETRY_BLOCK_CODE_PREFIX + sessionId, ""));
            boolean authRelatedPause = "NO_NATIVE_AUTH".equals(blockedCode)
                || "UNAUTHENTICATED".equals(blockedCode)
                || "DRIVER_UID_MISMATCH".equals(blockedCode);
            if (authRelatedPause) {
                // HF59 in-process auth recovery: if the matching Firebase user becomes
                // available after a temporary auth/profile interruption, release this
                // local pause once for this exact reason. Parsing the sealed local record
                // is cheap and no callable is issued unless ownership now matches.
                QueueRecord recoveryRecord = readQueueRecord(raw);
                String recoveryDriverId = recoveryRecord == null
                    ? ""
                    : clean(recoveryRecord.payload.optString("driverId", ""));
                String recoveryKey = sessionId + ":" + blockedCode;
                if (!recoveryDriverId.isEmpty()
                    && currentUid.equals(recoveryDriverId)
                    && AUTH_RECOVERY_RELEASED.add(recoveryKey)) {
                    retry.edit()
                        .remove(RETRY_AT_PREFIX + sessionId)
                        .remove(RETRY_COUNT_PREFIX + sessionId)
                        .remove(RETRY_BLOCK_CODE_PREFIX + sessionId)
                        .remove(RETRY_BLOCK_AT_PREFIX + sessionId)
                        .commit();
                    if (sessionId.equals(currentSessionId)) {
                        mainPrefs.edit().putBoolean("gtoTripSyncRetryPaused", false).apply();
                    }
                }
            }

            long retryAt = retry.getLong(RETRY_AT_PREFIX + sessionId, 0L);
            if (retryAt > now) continue;
            if (!IN_FLIGHT.add(sessionId)) continue;
            String attemptToken = UUID.randomUUID().toString();
            IN_FLIGHT_ATTEMPTS.put(sessionId, attemptToken);

            QueueRecord record = readQueueRecord(raw);
            if (record == null) {
                quarantine(context, queue, key, sessionId, raw, "JSON/checksum da fila inválido");
                releaseInFlightAttempt(sessionId, attemptToken);
                notifyIntegrityProblem(mainPrefs, listener, sessionId, "Integridade da fila local falhou; cópia preservada para diagnóstico.");
                continue;
            }
            JSONObject payload = record.payload;
            String validationIssue = validateCompletedPayload(payload);
            if (validationIssue != null) {
                quarantine(context, queue, key, sessionId, raw, validationIssue);
                releaseInFlightAttempt(sessionId, attemptToken);
                notifyIntegrityProblem(mainPrefs, listener, sessionId, validationIssue);
                continue;
            }

            if (record.legacy) {
                // Upgrade a still-pending FIX17 raw payload in place without losing it.
                String upgraded = sealPayload(payload);
                if (!upgraded.isEmpty()) queue.edit().putString(key, upgraded).commit();
            }

            String payloadDriverId = clean(payload.optString("driverId", ""));
            if (!payloadDriverId.equals(currentUid)) {
                // Keep another driver's durable queue intact on shared devices, but never
                // leave the current trip looking like an endless network sync. This also
                // surfaces stale profile/native-auth mismatches that previously failed
                // silently on only some devices.
                releaseInFlightAttempt(sessionId, attemptToken);
                pauseRetryForReason(retry, sessionId, "DRIVER_UID_MISMATCH");
                if (sessionId.equals(mainPrefs.getString("gtoTripSessionId", ""))) {
                    mainPrefs.edit()
                        .putLong("gtoTripSyncLastAttemptAt", System.currentTimeMillis())
                        .putString("gtoTripSyncLastErrorCode", "DRIVER_UID_MISMATCH")
                        .putBoolean("gtoTripSyncRetryPaused", true)
                        .apply();
                    String message = "A sessão autenticada não corresponde ao motorista desta entrega. Reabra a NVU com o perfil correto; a viagem permanece preservada.";
                    markPending(mainPrefs, message);
                    if (listener != null) listener.onPending(sessionId, message);
                }
                continue;
            }

            if (sessionId.equals(mainPrefs.getString("gtoTripSessionId", ""))) {
                mainPrefs.edit()
                    .putLong("gtoTripSyncLastAttemptAt", System.currentTimeMillis())
                    .remove("gtoTripSyncLastErrorCode")
                    .apply();
            }

            if (sessionId.equals(mainPrefs.getString("gtoTripSessionId", ""))) {
                mainPrefs.edit()
                    .putString("gtoTripSyncStatus", STATUS_SYNCING)
                    .putBoolean("gtoTripSyncRetryPaused", false)
                    .remove("gtoTripSyncError")
                    .apply();
            }

            MAIN_HANDLER.postDelayed(() -> {
                if (!releaseInFlightAttempt(sessionId, attemptToken)) return;
                if (!queue.contains(key)) return;
                scheduleRetry(retry, sessionId, null);
                String message = "O servidor não confirmou a viagem dentro do prazo. Registro preservado; nova tentativa automática.";
                if (sessionId.equals(mainPrefs.getString("gtoTripSessionId", ""))) {
                    mainPrefs.edit()
                        .putString("gtoTripSyncLastErrorCode", "CALL_TIMEOUT")
                        .putLong("gtoTripSyncLastAttemptAt", System.currentTimeMillis())
                        .apply();
                    markPending(mainPrefs, message);
                }
                if (listener != null) listener.onPending(sessionId, message);
            }, CALL_WATCHDOG_MS);

            FirebaseFunctions firebaseFunctions = GtoFirebaseRuntime.functions(context, "us-central1");
            if (firebaseFunctions == null) {
                releaseInFlightAttempt(sessionId, attemptToken);
                pauseRetryForReason(retry, sessionId, "FIREBASE_UNAVAILABLE");
                String message = "Firebase indisponível; a viagem foi preservada e será reenviada quando a configuração estiver disponível.";
                if (sessionId.equals(mainPrefs.getString("gtoTripSessionId", ""))) {
                    mainPrefs.edit()
                        .putString("gtoTripSyncLastErrorCode", "FIREBASE_UNAVAILABLE")
                        .putLong("gtoTripSyncLastAttemptAt", System.currentTimeMillis())
                        .apply();
                    markPending(mainPrefs, message);
                }
                if (listener != null) listener.onPending(sessionId, message);
                continue;
            }
            firebaseFunctions
                .getHttpsCallable("registerGtoTrip")
                .call(toMap(payload))
                .addOnSuccessListener(result -> {
                    Object data = result.getData();
                    Map<?, ?> response = data instanceof Map<?, ?> ? (Map<?, ?>) data : null;
                    String tripId = response == null ? "" : clean(String.valueOf(response.get("tripId") == null ? "" : response.get("tripId")));
                    String responseSession = response == null ? "" : clean(String.valueOf(response.get("sessionId") == null ? "" : response.get("sessionId")));
                    int responseContract = response == null ? 0 : safeInt(response.get("contractVersion"));
                    boolean success = response != null && Boolean.TRUE.equals(response.get("success"));

                    // The watchdog may have released this session and a newer retry may
                    // already be in flight. A late callback from the obsolete attempt is
                    // ignored so it cannot overwrite a newer ACK or pending state.
                    if (!releaseInFlightAttempt(sessionId, attemptToken)) return;

                    // Do not acknowledge/remove a local delivery unless the FIX18 backend
                    // proves it accepted this exact session under the current contract.
                    if (!success || tripId.isEmpty() || !sessionId.equals(responseSession) || responseContract < CONTRACT_VERSION) {
                        pauseRetryForReason(retry, sessionId, "BACKEND_CONTRACT_MISMATCH");
                        String message = "O sistema recusou a entrega por incompatibilidade de contrato; envio pausado para correção, sem apagar a viagem.";
                        if (sessionId.equals(mainPrefs.getString("gtoTripSessionId", ""))) {
                            mainPrefs.edit()
                                .putString("gtoTripSyncLastErrorCode", "BACKEND_CONTRACT_MISMATCH")
                                .putBoolean("gtoTripSyncRetryPaused", true)
                                .apply();
                            markPending(mainPrefs, message);
                        }
                        if (listener != null) listener.onPending(sessionId, message);
                        return;
                    }

                    boolean currentSession = sessionId.equals(mainPrefs.getString("gtoTripSessionId", ""));
                    int responseProgress = response == null ? 0 : safeInt(response.get("progress"));
                    String responseJobStatus = response == null ? "" : clean(String.valueOf(
                        response.get("jobStatus") == null ? "" : response.get("jobStatus")
                    ));
                    String payloadJobId = clean(payload.optString("jobId", ""));
                    boolean backendJobClosed = isClosedJobStatus(responseJobStatus);
                    String activeJobId = clean(mainPrefs.getString("jobId", ""));
                    boolean sameOperation = !payloadJobId.isEmpty() && payloadJobId.equals(activeJobId);

                    // R3.32: a sealed older delivery may finish syncing while the driver
                    // is already selecting the next freight. Persist operation-level ACK
                    // progress/status even when that older session is no longer the active
                    // trip, without touching the new trip's sync/integrity fields.
                    if (!currentSession && sameOperation) {
                        mainPrefs.edit()
                            .putInt("gtoJobProgress", responseProgress)
                            .putString("gtoJobStatus", responseJobStatus)
                            .putString("gtoBackendJobId", payloadJobId)
                            .putBoolean("gtoBackendJobClosed", backendJobClosed)
                            .putLong("gtoBackendJobStatusAt", System.currentTimeMillis())
                            .apply();
                    }
                    // The ACK is operation metadata, not freight identity. Refresh the
                    // sealed current-session context only when its job id matches this ACK.
                    refreshCurrentOperationSnapshotFromAck(
                        context, mainPrefs, payloadJobId, responseProgress, responseJobStatus
                    );

                    // R3.11 durability rule: for the active trip, persist the exact backend
                    // ACK before deleting the only durable queue/snapshot copies. If local
                    // ACK persistence fails (disk pressure/OEM I/O failure), keep both
                    // copies and retry the idempotent callable instead of risking a trip
                    // that exists on the server but looks permanently pending locally.
                    if (currentSession) {
                        boolean ackPersisted = mainPrefs.edit()
                            .putString("gtoTripSyncStatus", STATUS_SYNCED)
                            .putString("gtoTripIntegrityStatus", "ACKNOWLEDGED")
                            .putBoolean("gtoTripSyncRetryPaused", false)
                            .remove("gtoTripSyncLastErrorCode")
                            .putString("gtoRegisteredTripId", tripId)
                            .putInt("gtoJobProgress", responseProgress)
                            .putString("gtoJobStatus", responseJobStatus)
                            .putString("gtoBackendJobId", payloadJobId)
                            .putBoolean("gtoBackendJobClosed", backendJobClosed)
                            .putLong("gtoBackendJobStatusAt", System.currentTimeMillis())
                            .remove("gtoTripSyncError")
                            .remove("gtoTripIntegrityError")
                            .remove("gtoTripQueueCleanupPending")
                            .putString("lastEvent", backendJobClosed
                                ? "Viagem registrada · operação concluída no NVU"
                                : "Viagem registrada automaticamente no NVU")
                            .commit();
                        if (!ackPersisted) {
                            scheduleRetry(retry, sessionId, null);
                            String message = "Backend confirmou, mas o ACK local não pôde ser persistido; fila e snapshot foram preservados para retry idempotente.";
                            markPending(mainPrefs, message);
                            if (listener != null) listener.onPending(sessionId, message);
                            return;
                        }
                    }

                    if (!queue.edit().remove(key).commit()) {
                        scheduleRetry(retry, sessionId, null);
                        String message = "Backend e ACK local confirmados, mas a limpeza da fila ficou pendente; retry idempotente preservado.";
                        if (currentSession) {
                            mainPrefs.edit()
                                .putBoolean("gtoTripQueueCleanupPending", true)
                                .putString("gtoTripSyncLastErrorCode", "LOCAL_QUEUE_CLEANUP")
                                .apply();
                            // The trip is already durably ACKed and may safely release the
                            // driver for the next trip. The old queue entry is idempotent.
                            if (listener != null) {
                                listener.onSynced(sessionId, tripId);
                            } else if (currentSession) {
                                GtoObserverService.reconcileAcknowledgedTripIfRunning();
                            }
                        } else if (listener != null) {
                            listener.onPending(sessionId, message);
                        }
                        return;
                    }
                    retry.edit()
                        .remove(RETRY_AT_PREFIX + sessionId)
                        .remove(RETRY_COUNT_PREFIX + sessionId)
                        .remove(RETRY_BLOCK_CODE_PREFIX + sessionId)
                        .remove(RETRY_BLOCK_AT_PREFIX + sessionId)
                        .commit();
                    removeSnapshot(context, sessionId);
                    if (currentSession) {
                        mainPrefs.edit()
                            .remove("gtoTripQueueCleanupPending")
                            .remove("gtoTripSyncLastErrorCode")
                            .apply();
                    } else {
                        // HF52: background ACK bookkeeping must not depend on a UI/service
                        // listener. MainActivity can flush with listener=null, and HF51 then
                        // A delivery from an older session is independent bookkeeping. It
                        // must never recreate a blocking "previous trip" marker in current
                        // runtime preferences.
                        SharedPreferences.Editor independentAck = mainPrefs.edit()
                            .putString("lastIndependentDeliveryAckSessionId", sessionId)
                            .putString("lastIndependentDeliveryAckTripId", tripId)
                            .putLong("lastIndependentDeliveryAckAt", System.currentTimeMillis())
                            .remove("backgroundSyncPendingSessionId")
                            .remove("backgroundSyncPendingDetail")
                            .remove("backgroundSyncPendingAt")
                            .remove("gtoPreviousQueuedSessionId");
                        independentAck.apply();
                    }
                    reconcileBackgroundSyncMarkers(context, mainPrefs);
                    if (listener != null) {
                        listener.onSynced(sessionId, tripId);
                    } else if (currentSession) {
                        GtoObserverService.reconcileAcknowledgedTripIfRunning();
                    }
                })
                .addOnFailureListener(error -> {
                    // Do not let a late failure from an attempt already superseded by
                    // the watchdog/retry path resurrect PENDING after a real ACK.
                    if (!releaseInFlightAttempt(sessionId, attemptToken)) return;
                    if (!queue.contains(key)) return;
                    FirebaseFunctionsException.Code code = null;
                    if (error instanceof FirebaseFunctionsException) {
                        code = ((FirebaseFunctionsException) error).getCode();
                    }
                    boolean retryPaused = shouldPauseAutomaticRetry(code);
                    scheduleRetry(retry, sessionId, code);

                    String message = clean(error.getMessage());
                    if (message.isEmpty()) message = "Sem conexão com o servidor";
                    String codeLabel = code == null ? "" : " [" + code.name() + "]";
                    String retryMessage = retryPaused
                        ? message + codeLabel + ". Envio pausado para evitar chamadas inválidas; a viagem continua protegida para correção/reprocessamento."
                        : message + codeLabel + ". Falha temporária; nova tentativa automática será feita.";
                    if (sessionId.equals(mainPrefs.getString("gtoTripSessionId", ""))) {
                        mainPrefs.edit()
                            .putString("gtoTripSyncLastErrorCode", code == null ? "CALL_FAILED" : code.name())
                            .putBoolean("gtoTripSyncRetryPaused", retryPaused)
                            .putLong("gtoTripSyncLastAttemptAt", System.currentTimeMillis())
                            .apply();
                        markPending(mainPrefs, retryMessage);
                    }
                    if (listener != null) listener.onPending(sessionId, retryMessage);
                });
        }
    }

    private static JSONObject buildPayload(Context context, SharedPreferences prefs, String sessionId) {
        SharedPreferences snapshots = context.getSharedPreferences(SNAPSHOT_PREFS, Context.MODE_PRIVATE);
        JSONObject snapshot = readJson(snapshots.getString(SNAPSHOT_PREFIX + sessionId, ""));

        // FIX19: a completed trip may only be transmitted from its already-locked
        // session snapshot. Reconstructing from live preferences is forbidden because
        // those preferences may have been replaced by another GTO page/session.
        if (snapshot == null || !snapshot.optBoolean("freightLocked", false)) return null;
        if (!sessionId.equals(clean(snapshot.optString("sessionId", "")))) return null;
        JSONObject certifiedFreight = snapshot.optJSONObject(GtoCertifiedFreight.PREF_KEY);
        boolean hasCertifiedFreight = GtoCertifiedFreight.isValid(certifiedFreight, sessionId);

        String completionStatus = clean(prefs.getString("completionStatus", ""));
        String finalGain = clean(prefs.getString("finalGain", prefs.getString("resultValue", "")));
        long completedAt = prefs.getLong("completionDetectedAt", 0L);

        try {
            JSONObject payload = new JSONObject();
            payload.put("contractVersion", CONTRACT_VERSION);
            for (String field : new String[] {
                "sessionId", "driverId", "companyId", "jobId", "contractId", "contractMode",
                "vehicleId", "trailerId", "driverName", "companyName", "contractName",
                "vehicleName", "trailerName"
            }) {
                payload.put(field, clean(snapshot.optString(field, "")));
            }
            if (hasCertifiedFreight) {
                // The sealed object is the only freight authority after certification.
                GtoCertifiedFreight.copyIntoPayload(payload, certifiedFreight);
                payload.put("freightFingerprint", certifiedFreight.optString("freightFingerprint", ""));
            } else {
                // Legacy queue compatibility: old snapshots are accepted only while
                // they are being migrated; new sessions always take the branch above.
                for (String field : new String[] {
                    "sessionId", "driverId", "companyId", "jobId", "contractId", "contractMode", "vehicleId", "trailerId",
                    "driverName", "companyName", "contractName", "vehicleName", "trailerName", "cargo",
                    "companyRoute", "originCompany", "destinationCompany", "origin", "acceptedListOrigin", "destination",
                    "distanceKm", "offeredValue", "rawText", "selectedRow", "freightFingerprint"
                }) {
                    if ("selectedRow".equals(field)) payload.put(field, snapshot.optInt(field, -1));
                    else payload.put(field, clean(snapshot.optString(field, "")));
                }
            }
            if (!hasCertifiedFreight) {
                // The accepted-list value is authoritative only for legacy snapshots.
                boolean pauseCorrectionConfirmed = snapshot.optBoolean("pauseCorrectionConfirmed", false);
                String acceptedListDestination = clean(snapshot.optString("acceptedListDestination", ""));
                String visibleDestination = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
                    acceptedListDestination,
                    payload.optString("destination", ""),
                    payload.optString("destinationCompany", ""),
                    payload.optString("rawText", ""),
                    payload.optString("companyRoute", ""),
                    payload.optString("originCompany", ""),
                    pauseCorrectionConfirmed
                );
                payload.put("acceptedListDestination", visibleDestination);
                payload.put("destination", visibleDestination);

                String canonicalOrigin = GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(
                    payload.optString("acceptedListOrigin", ""),
                    payload.optString("origin", ""),
                    payload.optString("originCompany", ""),
                    snapshot.optBoolean("pauseMenuEvidence", false)
                        || "pause-menu-open".equals(snapshot.optString("selectionSource", "")),
                    pauseCorrectionConfirmed
                );
                if (canonicalOrigin.isEmpty()) return null;
                payload.put("origin", canonicalOrigin);
                if (!pauseCorrectionConfirmed
                    && (!snapshot.optBoolean("pauseMenuEvidence", false)
                        || !payload.optString("acceptedListOrigin", "").trim().isEmpty())) {
                    payload.put("acceptedListOrigin", canonicalOrigin);
                }
            }
            payload.put("finalValue", finalGain);
            payload.put("completionStatus", completionStatus);
            payload.put("completedAtClient", completedAt > 0L ? completedAt : System.currentTimeMillis());

            // Compatibility aliases are additive only. `origem` mirrors the final
            // location and `origemEmpresa` carries the optional source company.
            payload.put("origem", payload.optString("origin", ""));
            payload.put("origemEmpresa", payload.optString("originCompany", ""));
            payload.put("destino", payload.optString("destination", ""));
            payload.put("destinoEmpresa", payload.optString("destinationCompany", ""));
            payload.put("km", payload.optString("distanceKm", ""));
            payload.put("ganhos", finalGain);
            payload.put("finalGain", finalGain);
            payload.put("earnings", finalGain);
            payload.put("valor", finalGain);
            return payload;
        } catch (JSONException error) {
            return null;
        }
    }

    private static void copyContextFromPrefs(JSONObject target, SharedPreferences prefs) throws JSONException {
        for (String field : new String[] {
            "driverId", "companyId", "jobId", "contractId", "contractMode", "vehicleId", "trailerId",
            "driverName", "companyName", "contractName", "operationName", "vehicleName", "trailerName", "jobStatus", "webRuntimeRevision"
        }) {
            target.put(field, clean(prefs.getString(field, "")));
        }
        target.put("jobProgress", Math.max(0, prefs.getInt("jobProgress", 0)));
        target.put("jobTotalDeliveries", Math.max(0, prefs.getInt("jobTotalDeliveries", 0)));
        target.put("operationContextRevision", Math.max(0, prefs.getLong("gtoOperationContextRevision", 0L)));
        target.put("operationContextUpdatedAt", Math.max(0, prefs.getLong("gtoOperationContextUpdatedAt", 0L)));
    }

    private static String validateContextSnapshot(JSONObject snapshot) {
        if (!isSessionId(snapshot.optString("sessionId", ""))) return "Sessão GTO inválida.";
        for (String field : new String[] {"driverId", "companyId", "jobId", "contractId"}) {
            String value = clean(snapshot.optString(field, ""));
            if (value.isEmpty()) return "Contexto da operação incompleto: " + field + ".";
            if (value.length() > 220 || value.contains("/")) return "Identificador inválido no contexto GTO: " + field + ".";
        }
        int progress = snapshot.optInt("jobProgress", 0);
        int total = snapshot.optInt("jobTotalDeliveries", 0);
        if (progress < 0 || total < 0 || progress > 1_000_000 || total > 1_000_000) {
            return "Progresso da operação inválido no contexto GTO.";
        }
        String operationName = clean(snapshot.optString("operationName", ""));
        String contractName = clean(snapshot.optString("contractName", ""));
        if (operationName.isEmpty() && contractName.isEmpty()) {
            return "Contexto da operação incompleto: operationName/contractName.";
        }
        return null;
    }

    private static String validateFreight(JSONObject payload, String contractMode) {
        for (String field : new String[] {"origin", "destination"}) {
            String value = clean(payload.optString(field, ""));
            if (value.length() < 2 || value.length() > 220) return "Dado de frete inválido: " + field + ".";
        }
        if (payload.optBoolean("manualRouteSelectionConfirmed", false)
            && (!GtoManualRouteSelectionPolicy.isValidLocation(clean(payload.optString("origin", "")))
                || !GtoManualRouteSelectionPolicy.isValidLocation(clean(payload.optString("destination", ""))))) {
            return "Rota manual inválida: origem/destino fora da lista autorizada.";
        }
        // Cargo is intentionally optional: the new GTO flow does not read or ask for it.
        String originCompany = clean(payload.optString("originCompany", ""));
        if (!originCompany.isEmpty() && (originCompany.length() < 2 || originCompany.length() > 220)) {
            return "Dado de frete inválido: originCompany.";
        }
        String destinationCompany = clean(payload.optString("destinationCompany", ""));
        if (!destinationCompany.isEmpty() && (destinationCompany.length() < 2 || destinationCompany.length() > 220)) {
            return "Dado de frete inválido: destinationCompany.";
        }
        String origin = clean(payload.optString("origin", ""));
        if (origin.length() < 2 || origin.length() > 220) {
            return "Dado de frete inválido: origin deve conter o local final.";
        }
        if (payload.optInt("selectedRow", -1) < 0) return "Linha selecionada do frete inválida.";
        if (clean(payload.optString("freightFingerprint", "")).length() != 64) return "Fingerprint do frete ausente ou inválido.";
        Double km = parsePositiveNumber(payload.optString("distanceKm", ""));
        if (km == null || km <= 0 || km > 50_000d) return "Distância do frete inválida.";
        String offered = clean(payload.optString("offeredValue", ""));
        if (offered.isEmpty()) return "Valor ofertado do frete ausente.";
        Double offeredNumber = GtoMoneyValue.parseReais(offered);
        if (offeredNumber == null || offeredNumber <= 0 || offeredNumber > 1_000_000_000d) return "Valor ofertado do frete inválido.";
        return null;
    }

    private static String validateCompletedPayload(JSONObject payload) {
        if (safeInt(payload.opt("contractVersion")) < CONTRACT_VERSION) {
            // Legacy FIX17 queue entries are upgraded in-memory before validation.
            try { payload.put("contractVersion", CONTRACT_VERSION); } catch (JSONException ignored) {}
        }
        String contextIssue = validateContextSnapshot(payload);
        if (contextIssue != null) return contextIssue;
        String freightIssue = validateFreight(payload, clean(payload.optString("contractMode", "")));
        if (freightIssue != null) return freightIssue;
        if (!"CONFIRMED_NORMAL".equals(clean(payload.optString("completionStatus", "")))) {
            return "Conclusão GTO não confirmada como normal.";
        }
        String finalValueRaw = clean(payload.optString("finalValue", ""));
        Double finalValue = GtoMoneyValue.parseReais(finalValueRaw);
        if (finalValue == null || finalValue <= 0 || finalValue > 1_000_000_000d) return "Valor final da entrega inválido.";
        String compatibilityIssue = GtoMoneyValue.finalValueCompatibilityIssue(
            clean(payload.optString("offeredValue", "")),
            finalValueRaw
        );
        if (compatibilityIssue != null) return compatibilityIssue;
        long completedAt = payload.optLong("completedAtClient", 0L);
        long now = System.currentTimeMillis();
        if (completedAt <= 0L || completedAt > now + 24L * 60L * 60L * 1000L) return "Timestamp de conclusão inválido.";
        return null;
    }

    private static boolean sameFreight(JSONObject locked, JSONObject candidate) {
        String lockedFingerprint = clean(locked.optString("freightFingerprint", ""));
        String candidateFingerprint = clean(candidate.optString("freightFingerprint", ""));
        if (!lockedFingerprint.isEmpty() && !candidateFingerprint.isEmpty()) {
            return lockedFingerprint.equals(candidateFingerprint);
        }
        for (String field : new String[] {
            "cargo", "companyRoute", "originCompany", "destinationCompany", "origin",
            "destination", "distanceKm", "offeredValue", "rawText"
        }) {
            if (!clean(locked.optString(field, "")).equals(clean(candidate.optString(field, "")))) return false;
        }
        return locked.optInt("selectedRow", -1) == candidate.optInt("selectedRow", -1);
    }

    private static String freightFingerprint(JSONObject freight) {
        if (freight == null) return "";
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            StringBuilder canonical = new StringBuilder();
            for (String field : new String[] {
                "cargo", "companyRoute", "originCompany", "destinationCompany", "origin",
                "destination", "distanceKm", "offeredValue", "rawText", "selectedRow"
            }) {
                String value = "selectedRow".equals(field)
                    ? String.valueOf(freight.optInt(field, -1))
                    : clean(freight.optString(field, ""));
                canonical.append(field).append('=').append(value.length()).append(':').append(value).append('|');
            }
            byte[] hash = digest.digest(canonical.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(hash.length * 2);
            for (byte b : hash) out.append(String.format(java.util.Locale.US, "%02x", b & 0xff));
            return out.toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    private static String sealPayload(JSONObject payload) {
        try {
            JSONObject envelope = new JSONObject();
            envelope.put("format", "NVU_GTO_QUEUE_V2");
            envelope.put("contractVersion", CONTRACT_VERSION);
            envelope.put("persistedAt", System.currentTimeMillis());
            envelope.put("checksum", checksum(payload));
            envelope.put("payload", payload);
            return envelope.toString();
        } catch (JSONException error) {
            return "";
        }
    }

    private static QueueRecord readQueueRecord(String raw) {
        JSONObject object = readJson(raw);
        if (object == null) return null;
        JSONObject nested = object.optJSONObject("payload");
        if (nested == null) {
            // Raw FIX17 payload.
            return new QueueRecord(object, true);
        }
        String expected = clean(object.optString("checksum", ""));
        if (expected.isEmpty() || !expected.equals(checksum(nested))) return null;
        return new QueueRecord(nested, false);
    }

    private static String checksum(JSONObject payload) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = canonicalHashInput(payload).getBytes(StandardCharsets.UTF_8);
            byte[] hash = digest.digest(bytes);
            StringBuilder out = new StringBuilder(hash.length * 2);
            for (byte b : hash) out.append(String.format(java.util.Locale.US, "%02x", b & 0xff));
            return out.toString();
        } catch (Exception error) {
            return "";
        }
    }

    private static String canonicalHashInput(JSONObject payload) {
        StringBuilder out = new StringBuilder();
        for (String field : HASH_FIELDS) {
            String value;
            if ("completedAtClient".equals(field) || "contractVersion".equals(field)) {
                value = String.valueOf(payload.optLong(field, 0L));
            } else {
                value = clean(payload.optString(field, ""));
            }
            out.append(field.length()).append(':').append(field)
                .append('=').append(value.length()).append(':').append(value).append('|');
        }
        return out.toString();
    }

    private static void quarantine(Context context, SharedPreferences queue, String queueKey, String sessionId, String raw, String reason) {
        SharedPreferences quarantine = context.getSharedPreferences(QUARANTINE_PREFS, Context.MODE_PRIVATE);
        JSONObject record = new JSONObject();
        try {
            record.put("sessionId", sessionId);
            record.put("reason", reason);
            record.put("raw", raw == null ? "" : raw);
            record.put("quarantinedAt", System.currentTimeMillis());
        } catch (JSONException ignored) {}
        boolean saved = quarantine.edit()
            .putString(QUARANTINE_PREFIX + sessionId + "_" + System.currentTimeMillis(), record.toString())
            .commit();
        if (saved) queue.edit().remove(queueKey).commit();
    }

    private static void notifyIntegrityProblem(SharedPreferences prefs, Listener listener, String sessionId, String message) {
        if (sessionId.equals(prefs.getString("gtoTripSessionId", ""))) {
            markPending(prefs, message);
            markIntegrityError(prefs, message);
        }
        if (listener != null) listener.onPending(sessionId, message);
    }

    static void discardSessionSnapshot(Context context, String sessionId) {
        removeSnapshot(context, clean(sessionId));
    }

    private static void removeSnapshot(Context context, String sessionId) {
        if (sessionId == null || sessionId.isEmpty()) return;
        context.getSharedPreferences(SNAPSHOT_PREFS, Context.MODE_PRIVATE)
            .edit().remove(SNAPSHOT_PREFIX + sessionId).commit();
    }

    private static void armPendingRetrySupervisor(
        Context context,
        SharedPreferences prefs,
        Listener listener
    ) {
        if (context == null || prefs == null || !hasQueued(context)) return;
        String key = context.getPackageName();
        if (!RETRY_SUPERVISOR_ARMED.add(key)) return;
        MAIN_HANDLER.postDelayed(() -> {
            RETRY_SUPERVISOR_ARMED.remove(key);
            if (!hasQueued(context)) return;
            flushPending(context, prefs, listener);
        }, QUEUE_RETRY_SUPERVISOR_MS);
    }

    private static boolean shouldPauseAutomaticRetry(FirebaseFunctionsException.Code code) {
        return code == FirebaseFunctionsException.Code.INVALID_ARGUMENT
            || code == FirebaseFunctionsException.Code.FAILED_PRECONDITION
            || code == FirebaseFunctionsException.Code.PERMISSION_DENIED
            || code == FirebaseFunctionsException.Code.UNAUTHENTICATED
            || code == FirebaseFunctionsException.Code.ALREADY_EXISTS
            || code == FirebaseFunctionsException.Code.OUT_OF_RANGE;
    }

    static boolean isRetryPaused(Context context, String sessionId) {
        String cleanSession = clean(sessionId);
        if (context == null || cleanSession.isEmpty()) return false;
        SharedPreferences retry = context.getSharedPreferences(RETRY_PREFS, Context.MODE_PRIVATE);
        return !clean(retry.getString(RETRY_BLOCK_CODE_PREFIX + cleanSession, "")).isEmpty();
    }

    private static boolean pauseRetryForReason(SharedPreferences retry, String sessionId, String reason) {
        String blockReason = clean(reason).isEmpty() ? "PAUSED" : clean(reason);
        if ("NO_NATIVE_AUTH".equals(blockReason)) {
            // Authentication can recover inside the already-running observer. Keep the
            // HF59 local gate and diagnostic code, but never turn this recoverable cause
            // into an infinite pause that survives until process restart.
            return scheduleRetryWhileAuthUnavailable(retry, sessionId);
        }
        String existingReason = clean(retry.getString(RETRY_BLOCK_CODE_PREFIX + sessionId, ""));
        long existingRetryAt = retry.getLong(RETRY_AT_PREFIX + sessionId, 0L);
        if (blockReason.equals(existingReason) && existingRetryAt == Long.MAX_VALUE) {
            return false;
        }
        int attempt = retry.getInt(RETRY_COUNT_PREFIX + sessionId, 0) + 1;
        boolean committed = retry.edit()
            .putInt(RETRY_COUNT_PREFIX + sessionId, attempt)
            .putLong(RETRY_AT_PREFIX + sessionId, Long.MAX_VALUE)
            .putString(RETRY_BLOCK_CODE_PREFIX + sessionId, blockReason)
            .putLong(RETRY_BLOCK_AT_PREFIX + sessionId, System.currentTimeMillis())
            .commit();
        return committed;
    }

    private static boolean scheduleRetryWhileAuthUnavailable(SharedPreferences retry, String sessionId) {
        int attempt = retry.getInt(RETRY_COUNT_PREFIX + sessionId, 0) + 1;
        long delayMs = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * (1L << Math.min(attempt - 1, 4)));
        return retry.edit()
            .putInt(RETRY_COUNT_PREFIX + sessionId, attempt)
            .putLong(RETRY_AT_PREFIX + sessionId, System.currentTimeMillis() + delayMs)
            .remove(RETRY_BLOCK_CODE_PREFIX + sessionId)
            .remove(RETRY_BLOCK_AT_PREFIX + sessionId)
            .commit();
    }

    private static void scheduleRetry(SharedPreferences retry, String sessionId, FirebaseFunctionsException.Code code) {
        int attempt = retry.getInt(RETRY_COUNT_PREFIX + sessionId, 0) + 1;
        if (shouldPauseAutomaticRetry(code)) {
            // HF59 Sync Safe: immutable payload/context validation and auth/ownership errors
            // do not become healthy merely by hammering the same callable. Keep the sealed
            // trip intact but pause timed retries. Installing a newer recovery schema (or a
            // genuinely new authenticated recovery event) may release it once, idempotently.
            pauseRetryForReason(retry, sessionId, code == null ? "PERMANENT" : code.name());
            return;
        }
        SharedPreferences.Editor editor = retry.edit()
            .putInt(RETRY_COUNT_PREFIX + sessionId, attempt);
        long delayMs = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * (1L << Math.min(attempt - 1, 4)));
        editor
            .putLong(RETRY_AT_PREFIX + sessionId, System.currentTimeMillis() + delayMs)
            .remove(RETRY_BLOCK_CODE_PREFIX + sessionId)
            .remove(RETRY_BLOCK_AT_PREFIX + sessionId)
            .commit();
    }

    private static boolean isClosedJobStatus(String value) {
        String normalized = clean(value).toLowerCase(java.util.Locale.ROOT);
        return "awaiting_completion".equals(normalized)
            || "completed".equals(normalized)
            || "cancelled".equals(normalized)
            || "canceled".equals(normalized);
    }

    private static void markPending(SharedPreferences prefs, String message) {
        prefs.edit()
            .putString("gtoTripSyncStatus", STATUS_PENDING)
            .putString("gtoTripSyncError", message)
            .apply();
    }

    private static void markIntegrityError(SharedPreferences prefs, String message) {
        prefs.edit()
            .putString("gtoTripIntegrityStatus", "ERROR")
            .putString("gtoTripIntegrityError", message)
            .apply();
    }

    private static Map<String, Object> toMap(JSONObject object) {
        Map<String, Object> map = new HashMap<>();
        for (java.util.Iterator<String> iterator = object.keys(); iterator.hasNext();) {
            String key = iterator.next();
            Object value = object.opt(key);
            if (value == JSONObject.NULL) value = null;
            map.put(key, value);
        }
        return map;
    }

    private static JSONObject readJson(String raw) {
        if (raw == null || raw.trim().isEmpty()) return null;
        try {
            return new JSONObject(raw);
        } catch (JSONException error) {
            return null;
        }
    }

    private static int safeInt(Object value) {
        if (value instanceof Number) return ((Number) value).intValue();
        try { return Integer.parseInt(clean(value == null ? "" : String.valueOf(value))); }
        catch (Exception ignored) { return 0; }
    }

    private static boolean isSessionId(String value) {
        String sessionId = clean(value);
        return sessionId.length() >= 8 && sessionId.length() <= 160 && sessionId.matches("[A-Za-z0-9_-]+");
    }

    private static Double parsePositiveNumber(String value) {
        String token = clean(value).replaceAll("\\s+", "");
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("-?\\d[\\d.,]*").matcher(token);
        if (!matcher.find()) return null;
        token = matcher.group();
        int comma = token.lastIndexOf(',');
        int dot = token.lastIndexOf('.');
        if (comma >= 0 && dot >= 0) {
            if (comma > dot) token = token.replace(".", "").replace(',', '.');
            else token = token.replace(",", "");
        } else if (comma >= 0) {
            int decimals = token.length() - comma - 1;
            token = decimals > 0 && decimals <= 2 ? token.replace(".", "").replace(',', '.') : token.replace(",", "");
        } else if (dot >= 0 && token.length() - dot - 1 == 3) {
            token = token.replace(".", "");
        }
        try {
            double parsed = Double.parseDouble(token);
            return Double.isFinite(parsed) ? parsed : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
