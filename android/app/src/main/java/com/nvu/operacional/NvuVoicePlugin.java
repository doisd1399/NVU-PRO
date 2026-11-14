package com.nvu.operacional;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NvuVoice")
public class NvuVoicePlugin extends Plugin {
    private NvuVoicePlayback playback;
    private NvuVoicePlayback.Listener listener;
    @Override public void load() {
        playback = NvuVoicePlayback.get(getContext());
        listener = (busy, token, stage) -> {
            JSObject value = new JSObject(); value.put("busy", busy); value.put("token", token); value.put("stage", stage);
            notifyListeners("state", value);
        };
        playback.addListener(listener);
    }
    @PluginMethod public void configure(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        String voice = call.getString("voice", "male"), uid = call.getString("userId", "");
        double volume = call.getData().optDouble("volume", .75);
        if (!Double.isFinite(volume)) volume = .75;
        playback.configure(enabled, voice, volume, uid, call.getString("mode", "complete"), () -> { JSObject result = new JSObject(); result.put("busy", playback.busy()); call.resolve(result); });
    }
    @PluginMethod public void play(PluginCall call) {
        String cue = call.getString("cue", ""), token = call.getString("token", "");
        if (!NvuVoicePlayback.validCue(cue) || token.isEmpty()) { call.reject("Áudio inválido."); return; }
        int priority = Math.max(0, Math.min(4, call.getData().optInt("priority", 1)));
        long expires = call.getData().optLong("expiresAt", System.currentTimeMillis() + 20000L);
        playback.enqueue(cue, token, "web", priority, expires, call.getString("dedupeKey", token), new NvuVoicePlayback.Callback() {
            public void started() { }
            public void finished(boolean played, boolean failed) { JSObject result = new JSObject(); result.put("played", played); result.put("failed", failed); call.resolve(result); }
        });
    }
    @PluginMethod public void stop(PluginCall call) { playback.stopWeb(call.getString("token")); call.resolve(); }
    @Override protected void handleOnPause() { if (playback != null) playback.stopWeb(null); }
    @Override protected void handleOnDestroy() { if (playback != null) { playback.stopWeb(null); if (listener != null) playback.removeListener(listener); } }
}
