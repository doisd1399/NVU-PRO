package com.nvu.operacional;

import android.content.Context;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Isolated device experiment. Never starts a trip or changes AppOps. */
@CapacitorPlugin(name = "ProOverlayProbe")
public final class ProOverlayProbePlugin extends Plugin {
    private JSObject status() {
        android.content.SharedPreferences p = getContext().getSharedPreferences("nvu_overlay_probe", Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        boolean active = ProOverlayProbeService.isActive();
        String storedStage = p.getString("stage", "NOT_RUN");
        result.put("active", active);
        result.put("stage", active ? "OVERLAY_OK" : "OVERLAY_OK".equals(storedStage) ? "STOPPED" : storedStage);
        result.put("detail", active ? "Captura temporária já ativa" : p.getString("detail", ""));
        result.put("checkedAt", p.getLong("checkedAt", 0L));
        return result;
    }

    @PluginMethod
    public void getStatus(PluginCall call) { call.resolve(status()); }

    @PluginMethod
    public void stop(PluginCall call) {
        ProOverlayProbeService.stopSession(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void run(PluginCall call) {
        try {
            // MediaProjection consent is one-shot. Reuse the living session when
            // the driver returns from the simulator instead of requesting it again.
            if (ProOverlayProbeService.isActive()) {
                call.resolve(status());
                return;
            }
            JSObject current = status();
            String stage = current.optString("stage", "");
            long ageMs = System.currentTimeMillis() - current.optLong("checkedAt", 0L);
            if (("WAITING_CONSENT".equals(stage) || "STARTING".equals(stage))
                && ageMs >= 0L && ageMs < 30000L) {
                call.resolve(current);
                return;
            }
            getContext().getSharedPreferences("nvu_overlay_probe", Context.MODE_PRIVATE)
                .edit().putString("stage", "WAITING_CONSENT")
                .putLong("checkedAt", System.currentTimeMillis()).remove("detail").apply();
            Intent intent = new Intent(getContext(), ProOverlayProbeActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(status());
        } catch (Exception error) {
            call.reject("Não foi possível abrir a autorização de captura.", error);
        }
    }
}
