package com.nvu.operacional;

import android.app.AppOpsManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import java.io.File;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "GtoObserver")
public class GtoObserverPlugin extends Plugin {
    private static final String EXPECTED_WEB_RUNTIME_REVISION = "R3.34-PC-WEB-AUTH-ARCHITECTURE-MODULAR";

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        try {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(buildStatus());
        } catch (Exception ex) {
            call.reject("Não foi possível abrir a permissão de sobreposição.", ex);
        }
    }

    @PluginMethod
    public void openUsageAccessSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(buildStatus());
        } catch (Exception ex) {
            call.reject("Não foi possível abrir a permissão de acesso de uso.", ex);
        }
    }

    @PluginMethod
    public void openPreciseTouchSettings(PluginCall call) {
        // FIX9 no longer uses AccessibilityService. Kept for remote-web backwards compatibility.
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void startObserver(PluginCall call) {
        JSObject status = buildStatus();
        if (!Boolean.TRUE.equals(status.getBool("overlayPermission"))) {
            status.put("started", false);
            status.put("missingPermission", "overlay");
            call.resolve(status);
            return;
        }
        if (!Boolean.TRUE.equals(status.getBool("usageAccess"))) {
            status.put("started", false);
            status.put("missingPermission", "usage");
            call.resolve(status);
            return;
        }
        try {
            getContext().getSharedPreferences(GtoObserverService.PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .remove("startError")
                .apply();
            Intent intent = new Intent(getContext(), GtoObserverService.class)
                .setAction(GtoObserverService.ACTION_START);
            ContextCompat.startForegroundService(getContext(), intent);
            // Older/slower devices can take well over 320 ms to create a foreground
            // service after a cold start. Poll for up to ~2.2 s instead of reporting a
            // false failure while the service is actually starting.
            resolveObserverStart(call, 0);
        } catch (Exception ex) {
            String detail = GtoObserverService.describeError(ex);
            getContext().getSharedPreferences(GtoObserverService.PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString("startError", detail)
                .apply();
            JSObject failed = buildStatus();
            failed.put("started", false);
            failed.put("startError", detail);
            call.resolve(failed);
        }
    }


    @PluginMethod
    public void recoverObserver(PluginCall call) {
        boolean requested = GtoObserverService.recoverIfEnabled(getContext());
        if (!requested && !GtoObserverService.isRunning()) {
            call.resolve(buildStatus());
            return;
        }
        resolveObserverRecovery(call, 0);
    }

    @PluginMethod
    public void stopObserver(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), GtoObserverService.class)
                .setAction(GtoObserverService.ACTION_STOP);
            getContext().startService(intent);
            JSObject status = buildStatus();
            status.put("stopping", true);
            call.resolve(status);
        } catch (Exception ex) {
            call.reject("Não foi possível parar o observador GTO.", ex);
        }
    }

    @PluginMethod
    public void requestScreenCapture(PluginCall call) {
        // HF6 invariant: the Web/NVU activity is never allowed to own or display the
        // MediaProjection consent screen. Legacy callers can only arm the native request;
        // GtoObserverService will display it later, and only after the real GTO package is
        // confirmed foreground in stable landscape.
        JSObject current = buildStatus();
        if (Boolean.TRUE.equals(current.getBool("projectionActive"))) {
            call.resolve(current);
            return;
        }
        if (!GtoObserverService.isRunning()) {
            current.put("projectionStatus", "OBSERVER_NOT_RUNNING");
            current.put("projectionError", "O Observador GTO precisa estar ativo antes da leitura da tela.");
            call.resolve(current);
            return;
        }

        GtoObserverService.requestProjectionPermissionIfRunning();
        current = buildStatus();
        current.put("projectionStatus", "WAITING_GTO_FOR_PERMISSION");
        current.put("projectionPermissionDeferredToGto", true);
        call.resolve(current);
    }

    @PluginMethod
    public void setContext(PluginCall call) {
        Context context = getContext();
        android.content.SharedPreferences prefs = context.getSharedPreferences(
            GtoObserverService.PREFS_NAME,
            Context.MODE_PRIVATE
        );
        boolean hasDriverId = hasField(call, "driverId");
        boolean hasCompanyId = hasField(call, "companyId");
        boolean hasJobId = hasField(call, "jobId");
        boolean hasContractId = hasField(call, "contractId");
        boolean firstContext = safe(prefs.getString("driverId", "")).isEmpty()
            && safe(prefs.getString("companyId", "")).isEmpty()
            && safe(prefs.getString("jobId", "")).isEmpty()
            && safe(prefs.getString("contractId", "")).isEmpty();
        if (firstContext && (!hasDriverId || !hasCompanyId || !hasJobId || !hasContractId)) {
            call.reject("Contexto GTO incompleto: motorista, empresa, job e contrato são obrigatórios.");
            return;
        }

        String previousJobId = safe(prefs.getString("jobId", ""));
        String previousCompanyId = safe(prefs.getString("companyId", ""));
        String previousContractId = safe(prefs.getString("contractId", ""));
        String nextJobId = hasJobId ? safe(call.getString("jobId")) : previousJobId;
        String nextCompanyId = hasCompanyId ? safe(call.getString("companyId")) : previousCompanyId;
        String nextContractId = hasContractId ? safe(call.getString("contractId")) : previousContractId;
        if (nextJobId.isEmpty() || nextCompanyId.isEmpty() || nextContractId.isEmpty()) {
            call.reject("Contexto GTO inválido: job, empresa e contrato não podem ser vazios.");
            return;
        }
        boolean operationContextChanged = !nextJobId.equals(previousJobId)
            || !nextCompanyId.equals(previousCompanyId)
            || !nextContractId.equals(previousContractId);

        android.content.SharedPreferences.Editor editor = prefs.edit();
        putStringIfPresent(editor, call, "driverId", "driverId", prefs.getString("driverId", ""));
        putStringIfPresent(editor, call, "driverName", "driverName", prefs.getString("driverName", ""));
        putStringIfPresent(editor, call, "companyId", "companyId", nextCompanyId);
        putStringIfPresent(editor, call, "companyName", "companyName", prefs.getString("companyName", ""));
        putStringIfPresent(editor, call, "jobId", "jobId", nextJobId);
        putStringIfPresent(editor, call, "jobStatus", "jobStatus", prefs.getString("jobStatus", ""));
        putIntIfPresent(editor, call, "jobProgress", "jobProgress", prefs.getInt("jobProgress", 0));
        putIntIfPresent(editor, call, "jobTotalDeliveries", "jobTotalDeliveries", prefs.getInt("jobTotalDeliveries", 0));
        putStringIfPresent(editor, call, "contractId", "contractId", nextContractId);
        putStringIfPresent(editor, call, "contractName", "contractName", prefs.getString("contractName", ""));
        putStringIfPresent(editor, call, "operationName", "operationName", prefs.getString("operationName", ""));
        putStringIfPresent(editor, call, "contractMode", "contractMode", prefs.getString("contractMode", ""));
        putStringIfPresent(editor, call, "vehicleId", "vehicleId", prefs.getString("vehicleId", ""));
        putStringIfPresent(editor, call, "vehicleName", "vehicleName", prefs.getString("vehicleName", ""));
        putStringIfPresent(editor, call, "trailerId", "trailerId", prefs.getString("trailerId", ""));
        putStringIfPresent(editor, call, "trailerName", "trailerName", prefs.getString("trailerName", ""));
        putStringIfPresent(editor, call, "trustedGtoCitiesJson", "trustedGtoCitiesJson", prefs.getString("trustedGtoCitiesJson", "[]"));
        putStringIfPresent(editor, call, "webRuntimeRevision", "webRuntimeRevision", prefs.getString("webRuntimeRevision", ""));
        putStringIfPresent(editor, call, "expectedGtoOrigin", "expectedGtoOrigin", prefs.getString("expectedGtoOrigin", ""));
        putStringIfPresent(editor, call, "expectedGtoDestination", "expectedGtoDestination", prefs.getString("expectedGtoDestination", ""));

        // Context updates are versioned. An absent field is not an instruction to erase
        // a valid value; an explicit empty optional field is allowed to clear that field.
        editor.putLong("gtoOperationContextRevision",
            prefs.getLong("gtoOperationContextRevision", 0L) + 1L)
            .putLong("gtoOperationContextUpdatedAt", System.currentTimeMillis())
            .putString("gtoContextWriteContract", "SINGLE_FULL_OR_EXPLICIT_PARTIAL_V1");
        editor.remove("currentGtoCity").remove("currentGtoCitySource");

        // A backend completion lock belongs to one job only. Switching operation must
        // never leak the previous job's closed state into the new one.
        if (operationContextChanged) {
            editor
                .remove("gtoJobProgress")
                .remove("gtoJobStatus")
                .remove("gtoBackendJobId")
                .remove("gtoBackendJobClosed")
                .remove("gtoBackendJobStatusAt");
            String activeSessionJobId = prefs.getString("gtoTripSessionJobId", "");
            if (!nextJobId.isEmpty() && !activeSessionJobId.isEmpty()) {
                editor
                    .putBoolean("gtoOperationContextChanged", true)
                    .putString("gtoOperationContextChangedFrom", activeSessionJobId)
                    .putString("gtoOperationContextChangedTo", nextJobId)
                    .putLong("gtoOperationContextChangedAt", System.currentTimeMillis());
            }
        }
        if (!editor.commit()) {
            call.reject("Não foi possível persistir o contexto da operação no aparelho.");
            return;
        }
        // Persist a dedicated display snapshot before touching the freight/session snapshot.
        // The Operation card must not depend on a freight being accepted or on Firebase.
        if (!GtoAutoTripSync.persistOperationContextSnapshot(context, prefs)) {
            call.reject("Não foi possível confirmar o contexto local da operação atual.");
            return;
        }
        // The freight/session snapshot is a compatibility fallback only. The dedicated
        // operation context above is the authoritative display contract.
        GtoAutoTripSync.ensureCurrentOperationSnapshot(context, prefs);
        GtoAutoTripSync.refreshCurrentOperationSnapshot(context, prefs);
        GtoObserverService.refreshOperationCardIfRunning();
        call.resolve(buildStatus());
    }

    private static boolean hasField(PluginCall call, String key) {
        return call != null && call.getData() != null && call.getData().has(key);
    }

    private static void putStringIfPresent(
        android.content.SharedPreferences.Editor editor,
        PluginCall call,
        String inputKey,
        String prefKey,
        String previous
    ) {
        if (hasField(call, inputKey)) editor.putString(prefKey, safe(call.getString(inputKey)));
        else if (previous != null) editor.putString(prefKey, previous);
    }

    private static void putIntIfPresent(
        android.content.SharedPreferences.Editor editor,
        PluginCall call,
        String inputKey,
        String prefKey,
        int previous
    ) {
        if (hasField(call, inputKey)) {
            Integer value = call.getInt(inputKey);
            editor.putInt(prefKey, value == null ? previous : Math.max(0, value));
        } else {
            editor.putInt(prefKey, Math.max(0, previous));
        }
    }

    @PluginMethod
    public void logoutCleanup(PluginCall call) {
        Context context = getContext();
        android.content.SharedPreferences prefs = context.getSharedPreferences(
            GtoObserverService.PREFS_NAME,
            Context.MODE_PRIVATE
        );
        String sessionId = prefs.getString("gtoTripSessionId", "");
        String state = prefs.getString("tripState", GtoObserverService.STATE_IDLE);
        String completion = prefs.getString("completionStatus", "");
        String syncStatus = prefs.getString("gtoTripSyncStatus", "");
        String resultSnapshotPath = prefs.getString("resultSnapshotPath", "");
        String logoutCleanupError = "";

        // Result frames are strictly local runtime artifacts. They must never survive a
        // logout/account switch, even if Android kills the process immediately afterwards.
        if (!resultSnapshotPath.isEmpty()) {
            try {
                File snapshot = new File(resultSnapshotPath);
                if (snapshot.exists() && !snapshot.delete()) {
                    logoutCleanupError = "Não foi possível remover o quadro local temporário do resultado.";
                }
            } catch (Exception ex) {
                logoutCleanupError = "Falha ao remover quadro local temporário: " + GtoObserverService.describeError(ex);
            }
        }

        // Completed deliveries remain in the durable queue across logout. An unfinished
        // trip must not be allowed to continue under the next account on a shared device.
        if (GtoObserverService.STATE_RESULT_CONFIRMED.equals(state)
            && "CONFIRMED_NORMAL".equals(completion)
            && !GtoAutoTripSync.STATUS_SYNCED.equals(syncStatus)) {
            GtoTripSubmissionCoordinator.submitCompletedTrip(context, prefs, null);
        } else {
            GtoAutoTripSync.discardSessionSnapshot(context, sessionId);
        }

        boolean cleanupCommit = prefs.edit()
            .putBoolean("enabled", false)
            .putBoolean("gtoForeground", false)
            .putBoolean("overlayVisible", false)
            .putString("tripState", GtoObserverService.STATE_IDLE)
            .putString("lastEvent", "Sessão GTO encerrada no logout")
            .remove("driverId")
            .remove("driverName")
            .remove("companyId")
            .remove("companyName")
            .remove("jobId")
            .remove("jobStatus")
            .remove("jobProgress")
            .remove("jobTotalDeliveries")
            .remove("contractId")
            .remove("contractName")
            .remove("operationName")
            .remove("vehicleId")
            .remove("vehicleName")
            .remove("trailerId")
            .remove("trailerName")
            .remove("currentGtoCity")
            .remove("currentGtoCitySource")
            .remove("expectedGtoOrigin")
            .remove("expectedGtoDestination")
            .remove("trustedGtoCitiesJson")
            .remove("webRuntimeRevision")
            .remove("selectedFreight")
            .remove("selectedFreightSummary")
            .remove("selectedFreightRow")
            .remove("selectedOrigin")
            .remove("selectedDestination")
            .remove("selectedOriginCompany")
            .remove("selectedDestinationCompany")
            .remove("selectedCargo")
            .remove("selectedKm")
            .remove("selectedValue")
            .remove("resultValue")
            .remove("resultValueEvidence")
            .remove("resultValueConsensusStable")
            .remove("resultValueEvidenceConflict")
            .remove("resultValueEvidenceCount")
            .remove("resultValueConflictNoticeShown")
            .remove("finalGain")
            .remove("completionStatus")
            .remove("completionDetectedAt")
            .remove("gtoTripSessionId")
            .remove("gtoTripSessionStartedAt")
            .remove("gtoTripSyncStatus")
            .remove("gtoRegisteredTripId")
            .remove("gtoTripSyncError")
            .remove("gtoTripIntegrityStatus")
            .remove("gtoTripIntegrityError")
            .remove("gtoJobProgress")
            .remove("gtoJobStatus")
            .remove("gtoBackendJobId")
            .remove("gtoBackendJobClosed")
            .remove("gtoBackendJobStatusAt")
            .remove("driverStageCode")
            .remove("driverStageMessage")
            .remove("driverStageAt")
            .remove("driverStageShownKey")
            .remove("resultAction")
            .remove("resultActionTouchAt")
            .remove("resultReceiveLatched")
            .remove("resultActionSource")
            .remove("resultTouchFallbackRequired")
            .remove("resultTouchFallbackReady")
            .remove("resultTouchFallbackContinuityBroken")
            .remove("resultTouchFallbackReason")
            .remove("resultSnapshotPath")
            .remove("resultSnapshotAt")
            .remove("resultSnapshotError")
            .remove("resultSnapshotErrorAt")
            .remove("selectionConfirmationStatus")
            .remove("selectionFailureReason")
            .remove("selectionFailureAt")
            .remove("freightPanelLeftScreen")
            .remove("freightPanelScreenAt")
            .remove("projectionPermissionInFlight")
            .remove("logoutCleanupError")
            .commit();

        boolean operationContextCleared = GtoAutoTripSync.clearOperationContextSnapshot(context);
        boolean cleanupPersisted = cleanupCommit
            && operationContextCleared
            && !prefs.getBoolean("enabled", true)
            && prefs.getString("driverId", "").isEmpty()
            && prefs.getString("gtoTripSessionId", "").isEmpty();
        if (!cleanupPersisted) {
            logoutCleanupError = "O Android não confirmou a limpeza persistente da sessão GTO.";
        }

        // Do not start a stopped foreground service just to stop it again during logout.
        // If it is alive, terminate it immediately; if it is not, enabled=false above is
        // sufficient to prevent MainActivity from recovering it for the next account.
        if (GtoObserverService.isRunning()) {
            try {
                Intent intent = new Intent(context, GtoObserverService.class)
                    .setAction(GtoObserverService.ACTION_STOP);
                context.startService(intent);
            } catch (Exception ex) {
                try {
                    context.stopService(new Intent(context, GtoObserverService.class));
                } catch (Exception fallbackEx) {
                    logoutCleanupError = "Falha ao encerrar serviço GTO no logout: "
                        + GtoObserverService.describeError(fallbackEx);
                }
            }
        }

        if (!logoutCleanupError.isEmpty()) {
            prefs.edit().putString("logoutCleanupError", logoutCleanupError).commit();
        }

        JSObject status = buildStatus();
        status.put("logoutCleaned", cleanupPersisted && logoutCleanupError.isEmpty());
        call.resolve(status);
    }

    @PluginMethod
    public void prepareFloatingButton(PluginCall call) {
        boolean prepared = GtoObserverService.prepareFloatingButtonForNextGtoLaunch();
        JSObject status = buildStatus();
        status.put("floatingButtonPrepared", prepared);
        if (!prepared && status.optString("overlayError", "").isEmpty()) {
            status.put("overlayError", "O serviço GTO não conseguiu rearmar o botão flutuante.");
        }
        call.resolve(status);
    }

    @PluginMethod
    public void openGto(PluginCall call) {
        Context context = getContext();
        android.content.SharedPreferences prefs = context.getSharedPreferences(
            GtoObserverService.PREFS_NAME,
            Context.MODE_PRIVATE
        );
        try {
            Intent launchIntent = context.getPackageManager()
                .getLaunchIntentForPackage(GtoObserverService.GTO_PACKAGE);
            if (launchIntent == null) {
                JSObject result = new JSObject();
                result.put("opened", false);
                result.put("installed", false);
                call.resolve(result);
                return;
            }
            // prepareFloatingButton() is explicitly called by the Web launcher before
            // openGto(). Do not tear down that fresh token a second time. Direct/native
            // callers still rearm here only when no bubble is attached or already armed.
            boolean floatingPrepared = GtoObserverService.ensureFloatingButtonPreparedForNextGtoLaunch();
            if (!floatingPrepared) {
                JSObject result = new JSObject();
                result.put("opened", false);
                result.put("installed", true);
                result.put("prepared", false);
                result.put("tripState", prefs.getString("tripState", GtoObserverService.STATE_IDLE));
                result.put("error", prefs.getString("overlayError", "O botão flutuante NVU não pôde ser preparado."));
                call.resolve(result);
                return;
            }

            // Prepare the native journey state before the first GTO frame. This closes
            // the IDLE -> foreground-proof circular dependency on OEMs with stale
            // UsageStats and also guarantees that reopening GTO preserves active state.
            boolean prepared = GtoObserverService.prepareWorkLaunchIfRunning();
            if (!prepared) {
                JSObject result = new JSObject();
                result.put("opened", false);
                result.put("installed", true);
                result.put("prepared", false);
                result.put("tripState", prefs.getString("tripState", GtoObserverService.STATE_IDLE));
                result.put("error", prefs.getString("lastEvent", "O fluxo GTO não pôde ser preparado."));
                call.resolve(result);
                return;
            }

            // The final launch boundary is the last safe point to guarantee that the
            // current operation snapshot exists before the floating card can be opened.
            if (!GtoAutoTripSync.persistOperationContextSnapshot(context, prefs)) {
                JSObject result = new JSObject();
                result.put("opened", false);
                result.put("installed", true);
                result.put("prepared", false);
                result.put("error", "O contexto local da operação atual não foi confirmado.");
                call.resolve(result);
                return;
            }
            GtoAutoTripSync.ensureCurrentOperationSnapshot(context, prefs);
            GtoObserverService.refreshOperationCardIfRunning();
            GtoObserverService.markGtoLaunchRequestedIfRunning();
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            context.startActivity(launchIntent);
            JSObject result = new JSObject();
            result.put("opened", true);
            result.put("installed", true);
            result.put("prepared", true);
            result.put("tripState", prefs.getString("tripState", GtoObserverService.STATE_IDLE));
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Não foi possível abrir o Global Truck Online.", ex);
        }
    }

    private void resolveObserverStart(PluginCall call, int attempt) {
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            JSObject confirmed = buildStatus();
            boolean started = GtoObserverService.isRunning()
                && confirmed.optLong("serviceHeartbeatAt", 0L) > 0L
                && System.currentTimeMillis() - confirmed.optLong("serviceHeartbeatAt", 0L) < 5000L;
            if (started || attempt >= 24) {
                confirmed.put("started", started);
                if (!started && confirmed.optString("startError", "").isEmpty()) {
                    confirmed.put("startError", "O Android não confirmou a inicialização do serviço GTO.");
                }
                call.resolve(confirmed);
                return;
            }
            resolveObserverStart(call, attempt + 1);
        }, attempt == 0 ? 180L : 200L);
    }

    private void resolveObserverRecovery(PluginCall call, int attempt) {
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            JSObject status = buildStatus();
            if (Boolean.TRUE.equals(status.getBool("observerHealthy")) || attempt >= 20) {
                call.resolve(status);
                return;
            }
            resolveObserverRecovery(call, attempt + 1);
        }, attempt == 0 ? 160L : 200L);
    }

    private JSObject buildStatus() {
        Context context = getContext();
        android.content.SharedPreferences prefs = context.getSharedPreferences(
            GtoObserverService.PREFS_NAME,
            Context.MODE_PRIVATE
        );

        JSObject status = new JSObject();
        status.put("overlayPermission", Settings.canDrawOverlays(context));
        status.put("usageAccess", hasUsageStatsAccess(context));
        status.put("preciseTouchPermission", true);
        status.put("preciseTouchActive", false);
        status.put("running", GtoObserverService.isRunning());
        status.put("enabled", prefs.getBoolean("enabled", false));
        long heartbeatAt = prefs.getLong("serviceHeartbeatAt", 0L);
        boolean healthy = GtoObserverService.isRunning()
            && heartbeatAt > 0L
            && System.currentTimeMillis() - heartbeatAt < 5000L;
        status.put("observerHealthy", healthy);
        status.put("serviceStartedAt", prefs.getLong("serviceStartedAt", 0L));
        status.put("serviceHeartbeatAt", heartbeatAt);
        status.put("overlayVisible", prefs.getBoolean("overlayVisible", false));
        status.put("overlayError", prefs.getString("overlayError", ""));
        status.put("overlayErrorAt", prefs.getLong("overlayErrorAt", 0L));
        status.put("overlayFailureCount", prefs.getInt("overlayFailureCount", 0));
        status.put("menuOverlayError", prefs.getString("menuOverlayError", ""));
        status.put("menuOverlayErrorAt", prefs.getLong("menuOverlayErrorAt", 0L));
        status.put("statusOverlayError", prefs.getString("statusOverlayError", ""));
        status.put("statusOverlayErrorAt", prefs.getLong("statusOverlayErrorAt", 0L));
        status.put("notificationError", prefs.getString("notificationError", ""));
        status.put("notificationErrorAt", prefs.getLong("notificationErrorAt", 0L));
        status.put("touchPulseSensorVisible", prefs.getBoolean("touchPulseSensorVisible", false));
        status.put("touchPulseSensorError", prefs.getString("touchPulseSensorError", ""));
        status.put("touchPulseSensorErrorAt", prefs.getLong("touchPulseSensorErrorAt", 0L));
        status.put("touchPulseSensorLifecycle", prefs.getString("touchPulseSensorLifecycle", "DETACHED"));
        status.put("touchPulseSensorAttachedAt", prefs.getLong("touchPulseSensorAttachedAt", 0L));
        status.put("touchPulseSensorDetachedAt", prefs.getLong("touchPulseSensorDetachedAt", 0L));
        status.put("touchDiagnosticMode", prefs.getBoolean("touchDiagnosticMode", true));
        status.put("physicalTouchAttemptId", prefs.getString("physicalTouchAttemptId", ""));
        status.put("physicalTouchAttemptAt", prefs.getLong("physicalTouchAttemptAt", 0L));
        status.put("physicalTouchExpectedAt", prefs.getLong("physicalTouchExpectedAt", 0L));
        status.put("physicalTouchStage", prefs.getString("physicalTouchStage", "IDLE"));
        status.put("physicalTouchEventReceived", prefs.getBoolean("physicalTouchEventReceived", false));
        status.put("physicalActionOutsideReceived", prefs.getBoolean("physicalActionOutsideReceived", false));
        status.put("physicalActionOutsideAt", prefs.getLong("physicalActionOutsideAt", 0L));
        status.put("physicalTouchRawX", prefs.getFloat("physicalTouchRawX", -1f));
        status.put("physicalTouchRawY", prefs.getFloat("physicalTouchRawY", -1f));
        status.put("physicalTouchLocalX", prefs.getFloat("physicalTouchLocalX", -1f));
        status.put("physicalTouchLocalY", prefs.getFloat("physicalTouchLocalY", -1f));
        status.put("physicalTouchDisplayWidth", prefs.getInt("physicalTouchDisplayWidth", 0));
        status.put("physicalTouchDisplayHeight", prefs.getInt("physicalTouchDisplayHeight", 0));
        status.put("physicalTouchCaptureWidth", prefs.getInt("physicalTouchCaptureWidth", 0));
        status.put("physicalTouchCaptureHeight", prefs.getInt("physicalTouchCaptureHeight", 0));
        status.put("physicalTouchCoordinateSpace", prefs.getString("physicalTouchCoordinateSpace", "UNRESOLVED"));
        status.put("physicalTouchListGeneration", prefs.getLong("physicalTouchListGeneration", -1L));
        status.put("physicalTouchFreightPageGeneration", prefs.getLong("physicalTouchFreightPageGeneration", -1L));
        status.put("physicalTouchRowCount", prefs.getInt("physicalTouchRowCount", 0));
        status.put("physicalTouchAcceptRectCount", prefs.getInt("physicalTouchAcceptRectCount", 0));
        status.put("physicalTouchResolvedRow", prefs.getInt("physicalTouchResolvedRow", -1));
        status.put("physicalTouchResolutionReason", prefs.getString("physicalTouchResolutionReason", "WAITING_TOUCH"));
        status.put("physicalTouchTargetLocked", prefs.getBoolean("physicalTouchTargetLocked", false));
        status.put("physicalTouchValidationResult", prefs.getString("physicalTouchValidationResult", "WAITING"));
        status.put("physicalTouchCommitResult", prefs.getString("physicalTouchCommitResult", "WAITING"));
        status.put("touchDiagnosticOverlayError", prefs.getString("touchDiagnosticOverlayError", ""));
        status.put("captureWidth", prefs.getInt("captureWidth", 0));
        status.put("captureHeight", prefs.getInt("captureHeight", 0));
        status.put("captureExpectedWidth", prefs.getInt("captureExpectedWidth", 0));
        status.put("captureExpectedHeight", prefs.getInt("captureExpectedHeight", 0));
        status.put("captureStableFrames", prefs.getInt("captureStableFrames", 0));
        status.put("captureReadiness", prefs.getString("captureReadiness", GtoCaptureStabilityGate.INACTIVE));
        status.put("captureReadyForAnalysis", prefs.getBoolean("captureReadyForAnalysis", false));
        status.put("captureSurfaceReady", prefs.getBoolean("captureSurfaceReady", false));
        status.put("captureHealth", prefs.getString("captureHealth", "NOT_HEALTHY"));
        status.put("captureHealthChangedAt", prefs.getLong("captureHealthChangedAt", 0L));
        status.put("captureLastFrameAt", prefs.getLong("captureLastFrameAt", 0L));
        status.put("captureLastAnalyzedFrameAt", prefs.getLong("captureLastAnalyzedFrameAt", 0L));
        status.put("captureStabilityGeneration", prefs.getLong("captureStabilityGeneration", 0L));
        status.put("captureStabilityStartedAt", prefs.getLong("captureStabilityStartedAt", 0L));
        status.put("captureSnapshotGeneration", prefs.getLong("captureSnapshotGeneration", 0L));
        status.put("captureSnapshotReaderIdentity", prefs.getString("captureSnapshotReaderIdentity", ""));
        status.put("captureRecoveryState", prefs.getString("captureRecoveryState", "IDLE"));
        status.put("captureRecoveryGeneration", prefs.getLong("captureRecoveryGeneration", 0L));
        status.put("captureRecoveryStartedAt", prefs.getLong("captureRecoveryStartedAt", 0L));
        status.put("transportState", prefs.getString("transportState", "STOPPED"));
        status.put("transportHealthy", prefs.getBoolean("transportHealthy", false));
        status.put("transportGeneration", prefs.getLong("transportGeneration", 0L));
        status.put("transportChangedAt", prefs.getLong("transportChangedAt", 0L));
        status.put("geometryState", prefs.getString("geometryState", "UNKNOWN"));
        status.put("geometryValid", prefs.getBoolean("geometryValid", false));
        status.put("geometryGeneration", prefs.getLong("geometryGeneration", 0L));
        status.put("actionState", prefs.getString("actionState", "DISARMED"));
        status.put("actionsArmed", prefs.getBoolean("actionsArmed", false));
        status.put("actionBlockedReason", prefs.getString("actionBlockedReason", ""));
        status.put("actionGeneration", prefs.getLong("actionGeneration", 0L));
        status.put("captureIndicatorUnhealthySince", prefs.getLong("captureIndicatorUnhealthySince", 0L));
        status.put("captureIndicatorHealthyFrameStreak", prefs.getInt("captureIndicatorHealthyFrameStreak", 0));
        status.put("visualContextGeneration", prefs.getLong("visualContextGeneration", 0L));
        status.put("visualContextState", prefs.getString("visualContextState", "UNKNOWN"));
        status.put("visualContextSignature", prefs.getString("visualContextSignature", ""));
        status.put("visualContextConsecutiveFrames", prefs.getInt("visualContextConsecutiveFrames", 0));
        status.put("visualContextChangedAt", prefs.getLong("visualContextChangedAt", 0L));
        status.put("visualContextActionsArmed", prefs.getBoolean("visualContextActionsArmed", false));
        status.put("visualContextLastBlockedReason", prefs.getString("visualContextLastBlockedReason", ""));
        status.put("captureDensityDpi", prefs.getInt("captureDensityDpi", 0));
        status.put("captureAndroidApi", prefs.getInt("captureAndroidApi", Build.VERSION.SDK_INT));
        status.put("freightButtonBandLeft", prefs.getInt("freightButtonBandLeft", 0));
        status.put("freightButtonBandRight", prefs.getInt("freightButtonBandRight", 0));
        status.put("freightDetectedButtonCount", prefs.getInt("freightDetectedButtonCount", 0));
        status.put("lastFreightConflict", prefs.getString("lastFreightConflict", ""));
        status.put("lastFreightConflictAt", prefs.getLong("lastFreightConflictAt", 0L));
        status.put("selectionConfirmationStatus", prefs.getString("selectionConfirmationStatus", ""));
        status.put("freightConfirmationStartedAt", prefs.getLong("freightConfirmationStartedAt", 0L));
        status.put("selectionConfirmationLastRetryAt", prefs.getLong("selectionConfirmationLastRetryAt", 0L));
        status.put("selectionConfirmationStuckForMs", prefs.getLong("selectionConfirmationStuckForMs", 0L));
        status.put("selectionConfirmationTimeoutAt", prefs.getLong("selectionConfirmationTimeoutAt", 0L));
        status.put("selectionCommitContextEligible", GtoObserverService.isSelectionCommitContextEligibleNow());
        status.put("selectionFailureReason", prefs.getString("selectionFailureReason", ""));
        status.put("selectionFailureAt", prefs.getLong("selectionFailureAt", 0L));
        status.put("overlayOcclusionPreventedAt", prefs.getLong("overlayOcclusionPreventedAt", 0L));
        status.put("foregroundPackage", prefs.getString("foregroundPackage", ""));
        status.put("capturedContentVisible", prefs.getBoolean("capturedContentVisible", true));
        status.put("capturedContentVisibilityChangedAt", prefs.getLong("capturedContentVisibilityChangedAt", 0L));
        status.put("capturedContentVisibilityStatus", prefs.getString("capturedContentVisibilityStatus", ""));
        status.put("capturedContentReturnEpoch", prefs.getLong("capturedContentReturnEpoch", 0L));
        status.put("returnSurfaceRefreshPending", prefs.getBoolean("returnSurfaceRefreshPending", false));
        status.put("returnSurfaceRefreshStatus", prefs.getString("returnSurfaceRefreshStatus", ""));
        status.put("returnSurfaceRefreshPauseAt", prefs.getLong("returnSurfaceRefreshPauseAt", 0L));
        status.put("lastVisualGtoForegroundEvidenceAt", prefs.getLong("lastVisualGtoForegroundEvidenceAt", 0L));
        status.put("lastVisualGtoFreightCount", prefs.getInt("lastVisualGtoFreightCount", 0));
        status.put("lastVisualGtoEvidenceSource", prefs.getString("lastVisualGtoEvidenceSource", ""));
        status.put("gtoWorkLaunchPrepared", prefs.getBoolean("gtoWorkLaunchPrepared", false));
        status.put("gtoWorkLaunchPreparedState", prefs.getString("gtoWorkLaunchPreparedState", ""));
        status.put("gtoWorkLaunchPreparedAt", prefs.getLong("gtoWorkLaunchPreparedAt", 0L));
        status.put("startError", prefs.getString("startError", ""));
        status.put("projectionActive", prefs.getBoolean("projectionActive", false));
        status.put("projectionSessionBound", prefs.getBoolean("projectionSessionBound", false));
        status.put("projectionSurfacePending", prefs.getBoolean("projectionSurfacePending", false));
        status.put("projectionGrantValidated", prefs.getBoolean("projectionGrantValidated", false));
        status.put("projectionGrantValidatedAt", prefs.getLong("projectionGrantValidatedAt", 0L));
        status.put("projectionSessionBoundAt", prefs.getLong("projectionSessionBoundAt", 0L));
        status.put("projectionStatus", prefs.getString("projectionStatus", "INACTIVE"));
        status.put("projectionError", prefs.getString("projectionError", ""));
        status.put("projectionReauthRequired", prefs.getBoolean("projectionReauthRequired", false));
        status.put("projectionPermissionInFlight", prefs.getBoolean("projectionPermissionInFlight", false));
        status.put("observerOperationalReady", prefs.getBoolean("observerOperationalReady", false));
        status.put("observerOperationalStatus", prefs.getString("observerOperationalStatus", ""));
        status.put("observerOperationalChangedAt", prefs.getLong("observerOperationalChangedAt", 0L));
        status.put("observerLifecycleActive", prefs.getBoolean("observerLifecycleActive", false));
        status.put("observerLifecycleStatus", prefs.getString("observerLifecycleStatus", ""));
        status.put("observerLifecycleChangedAt", prefs.getLong("observerLifecycleChangedAt", 0L));
        status.put("gtoCaptureReady", prefs.getBoolean("gtoCaptureReady", false));
        long detectorHeartbeatAt = prefs.getLong("captureLastAnalyzedFrameAt", 0L);
        long detectorProbeHeartbeatAt = prefs.getLong("screenRecognitionHeartbeatAt", 0L);
        boolean detectorActive = GtoObserverService.isDetectorOperationalNow();
        status.put("detectorActive", detectorActive);
        status.put("detectorHeartbeatAt", detectorHeartbeatAt);
        status.put("detectorProbeHeartbeatAt", detectorProbeHeartbeatAt);
        status.put("resultCertifiedLatched", prefs.getBoolean("resultCertifiedLatched", false));
        status.put("resultCertifiedAt", prefs.getLong("resultCertifiedAt", 0L));
        status.put("resultWatchedAdEvidence", prefs.getBoolean("resultWatchedAdEvidence", false));
        status.put("resultTouchFallbackRequired", prefs.getBoolean("resultTouchFallbackRequired", false));
        status.put("resultTouchFallbackReady", prefs.getBoolean("resultTouchFallbackReady", false));
        status.put("resultTouchFallbackContinuityBroken", prefs.getBoolean("resultTouchFallbackContinuityBroken", false));
        status.put("resultSnapshotError", prefs.getString("resultSnapshotError", ""));
        status.put("resultSnapshotErrorAt", prefs.getLong("resultSnapshotErrorAt", 0L));
        status.put("logoutCleanupError", prefs.getString("logoutCleanupError", ""));
        status.put("runtimePermissionError", prefs.getString("runtimePermissionError", ""));
        status.put("runtimePermissionErrorCode", prefs.getString("runtimePermissionErrorCode", ""));
        status.put("gtoForeground", prefs.getBoolean("gtoForeground", false));
        status.put("screenAnalysisPaused", prefs.getBoolean("screenAnalysisPaused", false));
        status.put("screenAnalysisPauseReason", prefs.getString("screenAnalysisPauseReason", ""));
        status.put("tripStateWhenAnalysisPaused", prefs.getString("tripStateWhenAnalysisPaused", ""));
        status.put("gtoBackgroundClassification", prefs.getString("gtoBackgroundClassification", ""));
        status.put("captureContinuityStatus", prefs.getString("captureContinuityStatus", ""));
        status.put("gtoDurableStateRepairAt", prefs.getLong("gtoDurableStateRepairAt", 0L));
        status.put("resultOverlayClearedAt", prefs.getLong("resultOverlayClearedAt", 0L));
        status.put("activeTripFreightListVisible", prefs.getBoolean("activeTripFreightListVisible", false));
        status.put("frameProcessingErrorArea", prefs.getString("frameProcessingErrorArea", ""));
        status.put("frameProcessingError", prefs.getString("frameProcessingError", ""));
        status.put("frameProcessingErrorAt", prefs.getLong("frameProcessingErrorAt", 0L));
        status.put("tripState", prefs.getString("tripState", GtoObserverService.STATE_IDLE));
        status.put("tripStateChangedAt", prefs.getLong("tripStateChangedAt", 0L));
        status.put("screenState", prefs.getString("screenState", "UNKNOWN"));
        status.put("lastEvent", prefs.getString("lastEvent", ""));
        status.put("driverStageCode", prefs.getString("driverStageCode", ""));
        status.put("driverStageMessage", prefs.getString("driverStageMessage", ""));
        status.put("driverStageAt", prefs.getLong("driverStageAt", 0L));
        status.put("pausePromptVisible", prefs.getBoolean("pausePromptVisible", false));
        status.put("pauseScreenDetected", prefs.getBoolean("pauseScreenDetected", false));
        status.put("pauseReadStatus", prefs.getString("pauseReadStatus", ""));
        status.put("pauseMissingField", prefs.getString("pauseMissingField", ""));
        status.put("pauseScreenDetectedAt", prefs.getLong("pauseScreenDetectedAt", 0L));
        status.put("pauseLastReadAt", prefs.getLong("pauseLastReadAt", 0L));
        status.put("lastCancellationReason", prefs.getString("lastCancellationReason", ""));
        status.put("lastCancelledAt", prefs.getLong("lastCancelledAt", 0L));
        status.put("selectedFreight", prefs.getString("selectedFreight", ""));
        status.put("floatingButtonActivationArmed", prefs.getBoolean("floatingButtonActivationArmed", false));
        status.put("floatingButtonActivatedAt", prefs.getLong("floatingButtonActivatedAt", 0L));
        status.put("expectedGtoDestination", prefs.getString("expectedGtoDestination", ""));
        status.put("lastDestinationCorrectionFrom", prefs.getString("lastDestinationCorrectionFrom", ""));
        status.put("lastDestinationCorrectionTo", prefs.getString("lastDestinationCorrectionTo", ""));
        status.put("lastDestinationCorrectionSource", prefs.getString("lastDestinationCorrectionSource", ""));
        status.put("lastDestinationCorrectionAt", prefs.getLong("lastDestinationCorrectionAt", 0L));
        status.put("selectedFreightRow", prefs.getInt("selectedFreightRow", -1));
        status.put("selectedCargo", prefs.getString("selectedCargo", ""));
        status.put("selectedOrigin", prefs.getString("selectedOrigin", ""));
        status.put("selectedCompany", prefs.getString("selectedOriginCompany", ""));
        status.put("selectedDestination", prefs.getString("selectedDestination", ""));
        status.put("selectedKm", prefs.getString("selectedKm", ""));
        status.put("selectedValue", prefs.getString("selectedValue", ""));
        status.put("freightAuthorityStatus", prefs.getString("freightAuthorityStatus", ""));
        status.put("freightAuthorityId", prefs.getString("freightAuthorityId", ""));
        status.put("freightAuthorityRevision", prefs.getInt("freightAuthorityRevision", 0));
        status.put("certifiedFreight", prefs.getString(GtoCertifiedFreight.PREF_KEY, ""));
        status.put("operationName", prefs.getString("operationName", ""));
        status.put("contractName", prefs.getString("contractName", ""));
        status.put("operationContextRevision", prefs.getLong("gtoOperationContextRevision", 0L));
        status.put("operationContextUpdatedAt", prefs.getLong("gtoOperationContextUpdatedAt", 0L));
        org.json.JSONObject operationSnapshot = GtoAutoTripSync.resolveOperationContextSnapshot(context, prefs);
        status.put("operationSnapshotAvailable", operationSnapshot != null);
        status.put("operationSnapshot", operationSnapshot == null ? "" : operationSnapshot.toString());
        status.put("operationSnapshotAuthority", prefs.getString("operationCardContextAuthority", ""));
        status.put("operationSnapshotJobId", prefs.getString("operationCardContextJobId", ""));
        status.put("operationSnapshotWriteStatus", prefs.getString("operationContextSnapshotWriteStatus", ""));
        status.put("resultValue", prefs.getString("resultValue", ""));
        status.put("resultValueEvidenceCount", prefs.getInt("resultValueEvidenceCount", 0));
        status.put("resultValueEvidenceConflict", prefs.getBoolean("resultValueEvidenceConflict", false));
        status.put("finalGain", prefs.getString("finalGain", ""));
        status.put("completionStatus", prefs.getString("completionStatus", ""));
        status.put("completionDetectedAt", prefs.getLong("completionDetectedAt", 0L));
        status.put("gtoTripSessionId", prefs.getString("gtoTripSessionId", ""));
        status.put("gtoTripSyncStatus", prefs.getString("gtoTripSyncStatus", ""));
        status.put("tripSubmissionState", prefs.getString("tripSubmissionState", GtoTripSubmissionCoordinator.STATE_READY));
        status.put("tripSubmissionStateAt", prefs.getLong("tripSubmissionStateAt", 0L));
        status.put("gtoRegisteredTripId", prefs.getString("gtoRegisteredTripId", ""));
        status.put("gtoTripSyncError", prefs.getString("gtoTripSyncError", ""));
        status.put("gtoTripSyncLastAttemptAt", prefs.getLong("gtoTripSyncLastAttemptAt", 0L));
        status.put("gtoTripSyncLastErrorCode", prefs.getString("gtoTripSyncLastErrorCode", ""));
        GtoAutoTripSync.reconcileBackgroundSyncMarkers(context, prefs);
        String statusSessionId = prefs.getString("gtoTripSessionId", "");
        status.put("gtoDurableQueueCount", GtoAutoTripSync.queuedCount(context));
        status.put("gtoCurrentSessionQueued", GtoAutoTripSync.hasPendingSession(context, statusSessionId));
        com.google.firebase.auth.FirebaseUser statusUser = GtoFirebaseRuntime.currentUser(context);
        String statusUid = statusUser == null ? "" : statusUser.getUid();
        // Older completed deliveries are an independent outbox and are never exposed as
        // a condition that can block the current list/accept/new-trip flow.
        status.put("gtoBackgroundQueuePending", false);
        status.put("gtoIndependentDeliveryPending", GtoAutoTripSync.hasQueuedOtherThanForDriver(context, statusSessionId, statusUid));
        status.put("gtoQueueRecoveryLastAt", prefs.getLong("gtoQueueRecoveryLastAt", 0L));
        status.put("gtoQueueRecoveryQueueCount", prefs.getInt("gtoQueueRecoveryQueueCount", 0));
        status.put("gtoQueueRecoveryOwnedCount", prefs.getInt("gtoQueueRecoveryOwnedCount", 0));
        status.put("gtoQueueRecoveryForeignCount", prefs.getInt("gtoQueueRecoveryForeignCount", 0));
        status.put("gtoQueueRecoveryInvalidCount", prefs.getInt("gtoQueueRecoveryInvalidCount", 0));
        status.put("gtoQueueRecoveryCurrentSessionQueued", prefs.getBoolean("gtoQueueRecoveryCurrentSessionQueued", false));
        status.put("gtoQueueRecoverySummary", prefs.getString("gtoQueueRecoverySummary", ""));
        status.put("gtoQueueRecoveryLastErrorCode", prefs.getString("gtoQueueRecoveryLastErrorCode", ""));
        status.put("backgroundSyncPendingSessionId", "");
        status.put("backgroundSyncPendingDetail", "");
        status.put("backgroundSyncLastSessionId", prefs.getString("lastIndependentDeliveryAckSessionId", ""));
        status.put("backgroundSyncLastTripId", prefs.getString("lastIndependentDeliveryAckTripId", ""));
        status.put("backgroundSyncLastAckAt", prefs.getLong("lastIndependentDeliveryAckAt", 0L));
        status.put("independentDeliveryRetrySessionId", prefs.getString("lastIndependentDeliveryRetrySessionId", ""));
        status.put("independentDeliveryRetryDetail", prefs.getString("lastIndependentDeliveryRetryDetail", ""));
        status.put("independentDeliveryRetryAt", prefs.getLong("lastIndependentDeliveryRetryAt", 0L));
        status.put("gtoTripIntegrityStatus", prefs.getString("gtoTripIntegrityStatus", ""));
        status.put("gtoTripIntegrityError", prefs.getString("gtoTripIntegrityError", ""));
        status.put("jobStatus", prefs.getString("jobStatus", ""));
        status.put("jobProgress", prefs.getInt("jobProgress", 0));
        status.put("jobTotalDeliveries", prefs.getInt("jobTotalDeliveries", 0));
        status.put("gtoJobStatus", prefs.getString("gtoJobStatus", ""));
        status.put("gtoJobProgress", prefs.getInt("gtoJobProgress", 0));
        status.put("gtoBackendJobClosed", prefs.getBoolean("gtoBackendJobClosed", false));
        status.put("gtoContractVersion", GtoAutoTripSync.CONTRACT_VERSION);
        status.put("gtoPackage", GtoObserverService.GTO_PACKAGE);
        String webRuntimeRevision = prefs.getString("webRuntimeRevision", "");
        status.put("webRuntimeRevision", webRuntimeRevision);
        status.put("webRuntimeCompatible", EXPECTED_WEB_RUNTIME_REVISION.equals(webRuntimeRevision));
        return status;
    }

    private static boolean hasUsageStatsAccess(Context context) {
        AppOpsManager appOps = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
        if (appOps == null) return false;

        int mode;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            mode = appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                context.getPackageName()
            );
        } else {
            mode = appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                context.getPackageName()
            );
        }
        return mode == AppOpsManager.MODE_ALLOWED;
    }


    private static String safe(String value) {
        return value == null ? "" : value;
    }
}
