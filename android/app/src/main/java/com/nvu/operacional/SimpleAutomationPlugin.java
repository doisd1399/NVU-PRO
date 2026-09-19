package com.nvu.operacional;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.Settings;
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
    public void openOverlaySettings(PluginCall call) {
        try {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                android.net.Uri.parse("package:" + getContext().getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(buildStatus());
        } catch (Exception error) {
            call.reject("Não foi possível abrir a permissão de sobreposição.", error);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!Settings.canDrawOverlays(getContext())) {
            JSObject status = buildStatus();
            status.put("status", "overlay-permission");
            call.resolve(status);
            return;
        }
        boolean started = SimpleAutomationService.startIfAllowed(getContext());
        JSObject status = buildStatus();
        status.put("status", started ? "started" : "start-failed");
        call.resolve(status);
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
        int jobTotalDeliveries = call.getInt("jobTotalDeliveries", 0);
        String jobStatus = safe(call.getString("jobStatus"));
        boolean operationClosed = Boolean.TRUE.equals(call.getBoolean("operationClosed", false));
        String vehicleName = safe(call.getString("vehicleName"));
        String trailerName = safe(call.getString("trailerName"));
        String packageId = safe(call.getString("packageId"));
        if (simulatorKey.isEmpty() || simulatorCode.isEmpty() || simulatorLabel.isEmpty() || contextEpoch.isEmpty()
            || !isCanonicalSimulatorPackage(simulatorKey, packageId)
            || !isCanonicalSimulatorCode(simulatorKey, simulatorCode)) {
            call.reject("Contexto do Modo Pro inválido.");
            return;
        }
        JSONArray cities = call.getArray("cities");
        SimpleAutomationService.updateContext(
            getContext(), simulatorKey, simulatorCode, simulatorLabel, contextEpoch, companyName,
            operationName, contractName, jobId, contractId, companyId, driverId,
            jobProgress, jobTotalDeliveries, jobStatus, operationClosed, vehicleName, trailerName,
            packageId, cities == null ? "[]" : cities.toString()
        );
        JSObject status = buildStatus();
        status.put("status", "context-updated");
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
        int jobTotalDeliveries = Math.max(0, call.getInt("jobTotalDeliveries", 0));
        String jobStatus = safe(call.getString("jobStatus"));
        boolean operationClosed = Boolean.TRUE.equals(call.getBoolean("operationClosed", false));
        String vehicleName = safe(call.getString("vehicleName"));
        String trailerName = safe(call.getString("trailerName"));
        if (jobTotalDeliveries > 0 && jobProgress > jobTotalDeliveries) {
            call.reject("Progresso da operação inválido.");
            return;
        }
        SimpleAutomationService.refreshOperationSnapshot(
            getContext(), companyName, operationName, contractName, jobId, contractId,
            companyId, driverId, jobProgress, jobTotalDeliveries, jobStatus,
            operationClosed, vehicleName, trailerName
        );
        JSObject status = buildStatus();
        status.put("status", "operation-snapshot-refreshed");
        call.resolve(status);
    }

    @PluginMethod
    public void refreshOperationState(PluginCall call) {
        int jobProgress = Math.max(0, call.getInt("jobProgress", 0));
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
        SimpleAutomationService.acknowledgeReceipt(getContext(), accepted, reason);
        JSObject status = buildStatus();
        String resultingState = status.optString("simpleState", SimpleAutomationService.STATE_IDLE);
        status.put("status", accepted
            ? "completed"
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
        android.content.SharedPreferences prefs = SimpleAutomationService.getPreferences(getContext());
        JSObject status = new JSObject();
        status.put("running", prefs.getBoolean("running", false));
        status.put("overlayPermission", Settings.canDrawOverlays(getContext()));
        status.put("overlayVisible", prefs.getBoolean("overlayVisible", false));
        status.put("overlayType", android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O
            ? "TYPE_APPLICATION_OVERLAY" : "TYPE_PHONE");
        status.put("bubbleVisible", prefs.getBoolean("bubbleVisible", prefs.getBoolean("overlayVisible", false)));
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
        status.put("jobProgress", prefs.getInt("jobProgress", 0));
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
        switch (simulatorKey.trim().toLowerCase(java.util.Locale.ROOT)) {
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
