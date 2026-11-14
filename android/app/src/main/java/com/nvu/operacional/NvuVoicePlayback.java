package com.nvu.operacional;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Set;

/** One process-wide speech channel shared by the WebView and both Pro services.
 * It consumes confirmed events only; it never controls capture or operation state. */
public final class NvuVoicePlayback {
    private static final String PREFS = "nvu_voice_assistant_v1";
    private static final long GAP_MS = 8000L;
    private static NvuVoicePlayback instance;
    private static final Set<String> CUES = new LinkedHashSet<>(Arrays.asList(
        "driver_greet_morning_idle", "driver_greet_morning_job", "driver_greet_morning_active", "driver_greet_afternoon_idle", "driver_greet_afternoon_job",
        "driver_greet_afternoon_active", "driver_greet_night_idle", "driver_greet_night_job", "driver_greet_night_active", "admin_greet_morning_calm",
        "admin_greet_morning_active", "admin_greet_morning_news", "admin_greet_afternoon_calm", "admin_greet_afternoon_active", "admin_greet_afternoon_news",
        "admin_greet_night_calm", "admin_greet_night_active", "admin_greet_night_news", "event_new_job", "event_job_cancelled",
        "event_pro_ready", "event_job_started", "event_trip_detected", "event_trip_saved", "event_trip_saved_b",
        "event_trip_saved_c", "event_half_done", "event_near_goal", "event_last_trip", "event_goal_reached",
        "event_pause_needed", "event_trip_failed", "event_offline", "event_back_online", "event_deadline_near",
        "event_deadline_goal_risk", "event_deadline_passed", "event_job_completed", "event_payment_confirmed", "admin_late",
        "admin_driver_completed", "admin_goal_reached", "admin_driver_started", "admin_trips_batch", "admin_job_declined",
        "admin_payments_due", "admin_payment_received", "admin_new_candidate", "admin_partnership_offer",
        "driver_greeting_1", "driver_greeting_2", "driver_greeting_3", "driver_greeting_4", "driver_greeting_5", "admin_greeting_1", "admin_greeting_2", "admin_greeting_3", "admin_greeting_4", "admin_greeting_5", "page_operations", "page_assign", "page_active_jobs", "page_team", "page_recruitment", "page_fleet", "page_trips", "page_partnerships", "page_wallet"));

    public interface Callback { void started(); void finished(boolean played, boolean failed); }
    public interface Listener { void state(boolean busy, String token, String stage); }
    private static final class Request {
        final String cue, token, owner, dedupeKey; final int priority; final long expiresAt; final Callback callback;
        boolean started;
        Request(String cue, String token, String owner, int priority, long expiresAt, String dedupeKey, Callback callback) {
            this.dedupeKey = dedupeKey; this.cue = cue; this.token = token; this.owner = owner; this.priority = priority; this.expiresAt = expiresAt; this.callback = callback;
        }
    }
    private final Context context;
    private final SharedPreferences prefs;
    private final java.util.function.LongSupplier wallClock;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ArrayList<Listener> listeners = new ArrayList<>();
    private final LinkedHashSet<String> seen = new LinkedHashSet<>();
    private final HashMap<String, Long> lastCueAt = new HashMap<>();
    private Request active, pending;
    private MediaPlayer player;
    private long lastFinished;
    private final Runnable pumpRunnable = this::pump;
    private final Runnable watchdog = () -> finish(false, true);

    private NvuVoicePlayback(Context context) { this(context, System::currentTimeMillis); }
    NvuVoicePlayback(Context context, java.util.function.LongSupplier wallClock) { this.context = context.getApplicationContext(); this.wallClock = wallClock; prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String saved = prefs.getString("seenEvents", ""); if (!saved.isEmpty()) seen.addAll(Arrays.asList(saved.split("\u001f")));
    }
    private long wall() { return wallClock.getAsLong(); }
    public static synchronized NvuVoicePlayback get(Context context) {
        if (instance == null) instance = new NvuVoicePlayback(context);
        return instance;
    }
    public static boolean isConfigured(Context context) { return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("configured", false); }
    public static boolean validCue(String cue) { return cue != null && CUES.contains(cue); }
    public void addListener(Listener listener) { handler.post(() -> { if (!listeners.contains(listener)) listeners.add(listener); }); }
    public void removeListener(Listener listener) { handler.post(() -> listeners.remove(listener)); }
    public boolean busy() { return active != null || NvuAudioManager.isLegacyVoicePlaying(); }
    private void state(String token, String stage) {
        for (Listener listener : new ArrayList<>(listeners)) { try { listener.state(busy(), token, stage); } catch (RuntimeException ignored) { } }
    }
    public void configure(boolean enabled, String voice, double volume, String uid, Runnable done) {
        configure(enabled, voice, volume, uid, "complete", done);
    }
    public void configure(boolean enabled, String voice, double volume, String uid, String mode, Runnable done) {
        handler.post(() -> {
            String oldUser = prefs.getString("userId", "");
            boolean changedUser = !oldUser.isEmpty() && !oldUser.equals(uid);
            prefs.edit().putBoolean("configured", true).putBoolean("enabled", enabled).putString("voice", "female".equals(voice) ? "female" : "male")
                .putString("mode", "quiet".equals(mode) ? "quiet" : "complete").putFloat("volume", (float) Math.max(0, Math.min(1, volume))).putString("userId", uid).apply();
            if (!enabled || changedUser) {
                stopAll(); NvuAudioManager.silenceLegacyVoices();
                if (changedUser) { seen.clear(); lastCueAt.clear(); prefs.edit().remove("seenEvents").apply(); }
            } else if (player != null) {
                try { float level = prefs.getFloat("volume", .75f); player.setVolume(level, level); } catch (RuntimeException ignored) { }
            }
            state("", "configured"); if (done != null) done.run();
        });
    }
    public void enqueue(String cue, String token, String owner, int priority, long expiresAt, Callback callback) {
        enqueue(cue, token, owner, priority, expiresAt, token, callback);
    }
    public void enqueue(String cue, String token, String owner, int priority, long expiresAt, String dedupeKey, Callback callback) {
        handler.post(() -> {
            if (("quiet".equals(prefs.getString("mode", "complete")) && Arrays.asList("event_pro_ready", "event_trip_saved_b", "event_trip_saved_c", "event_half_done", "event_near_goal", "admin_driver_started", "admin_trips_batch").contains(cue)) || !validCue(cue) || token == null || token.isEmpty() || !prefs.getBoolean("enabled", true) || expiresAt <= wall()) {
                try { callback.finished(false, false); } catch (RuntimeException ignored) { } return;
            }
            long last = lastCueAt.containsKey(cue) ? lastCueAt.get(cue) : 0L;
            if (seen.contains(dedupeKey) || (active != null && (active.token.equals(token) || active.dedupeKey.equals(dedupeKey))) || (pending != null && (pending.token.equals(token) || pending.dedupeKey.equals(dedupeKey)))
                || (owner.startsWith("automation:") && last > 0 && SystemClock.elapsedRealtime() - last < 12000L)) {
                try { callback.finished(false, false); } catch (RuntimeException ignored) { } return;
            }
            Request request = new Request(cue, token, owner, priority, Math.min(expiresAt, wall() + 20000L), dedupeKey == null || dedupeKey.isEmpty() ? token : dedupeKey, callback);
            if (active != null || NvuAudioManager.isLegacyVoicePlaying() || lastFinished > 0 && SystemClock.elapsedRealtime() - lastFinished < GAP_MS) {
                if (priority < 2 && active != null) { try { callback.finished(false, false); } catch (RuntimeException ignored) { } return; }
                if (pending != null && pending.priority > priority) { try { callback.finished(false, false); } catch (RuntimeException ignored) { } return; }
                if (pending != null) complete(pending, false, false);
                pending = request; pump(); return;
            }
            if (pending != null) { if (pending.priority > priority) { try { callback.finished(false, false); } catch (RuntimeException ignored) { } return; } complete(pending, false, false); pending = null; }
            start(request);
        });
    }
    private void complete(Request request, boolean played, boolean failed) { try { request.callback.finished(played, failed); } catch (RuntimeException ignored) { } }
    private void start(Request request) {
        if (active != null || !prefs.getBoolean("enabled", true) || request.expiresAt <= wall()) { complete(request, false, false); return; }
        active = request;
        try {
            MediaPlayer next = new MediaPlayer(); player = next;
            next.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            String asset = "public/audio/nvu/" + prefs.getString("voice", "male") + "/" + request.cue + ".mp3";
            try (AssetFileDescriptor fd = context.getAssets().openFd(asset)) { next.setDataSource(fd.getFileDescriptor(), fd.getStartOffset(), fd.getLength()); }
            float level = prefs.getFloat("volume", .75f); next.setVolume(level, level); next.setLooping(false);
            next.setOnPreparedListener(ready -> {
                if (active != request || player != ready) return;
                if (request.expiresAt <= wall()) { finish(false, false); return; }
                try {
                    ready.start(); request.started = true; seen.add(request.dedupeKey);
                    while (seen.size() > 2048) seen.remove(seen.iterator().next());
                    prefs.edit().putString("seenEvents", String.join("\u001f", seen)).apply();
                    lastCueAt.put(request.cue, SystemClock.elapsedRealtime());
                    request.callback.started(); state(request.token, "started");
                } catch (RuntimeException error) { finish(false, true); }
            });
            next.setOnCompletionListener(done -> { if (player == done) finish(true, false); });
            next.setOnErrorListener((failed, what, extra) -> { if (player == failed) finish(false, true); return true; });
            state(request.token, "preparing"); handler.postDelayed(watchdog, 15000L); next.prepareAsync();
        } catch (Exception error) { finish(false, true); }
    }
    private void finish(boolean played, boolean failed) {
        handler.removeCallbacks(watchdog);
        Request done = active; active = null;
        if (player != null) { try { player.setOnPreparedListener(null); player.setOnCompletionListener(null); player.setOnErrorListener(null); player.release(); } catch (RuntimeException ignored) { } player = null; }
        if (done != null) {
            if (done.started) lastFinished = SystemClock.elapsedRealtime();
            complete(done, played, failed); state(done.token, failed ? "failed" : "finished");
        }
        pump();
    }
    private void pump() {
        handler.removeCallbacks(pumpRunnable);
        if (pending == null || active != null) return;
        if (!prefs.getBoolean("enabled", true) || pending.expiresAt <= wall()) { Request old = pending; pending = null; complete(old, false, false); return; }
        long wait = NvuAudioManager.isLegacyVoicePlaying() ? 150L : Math.max(0L, lastFinished > 0 ? GAP_MS - (SystemClock.elapsedRealtime() - lastFinished) : 0L);
        if (wait > 0) { handler.postDelayed(pumpRunnable, Math.min(wait, Math.max(1L, pending.expiresAt - wall()))); return; }
        Request next = pending; pending = null; start(next);
    }
    /** Called only after the native writer has durably accepted the server ACK. */
    public static void confirmedTrip(Context context, String driverId, String companyId, String tripId) {
        try {
            NvuVoicePlayback voice = get(context);
            if (!isConfigured(context) || driverId == null || driverId.isEmpty() || companyId == null || companyId.isEmpty() || tripId == null || tripId.isEmpty()
                || !driverId.equals(voice.prefs.getString("userId", ""))) return;
            String key = "event_trip_saved|" + driverId + "|" + companyId + "|" + tripId;
            voice.enqueue("event_trip_saved", key, "automation:confirmed", 3, voice.wall() + 20000L, key, new Callback() {
                public void started() {} public void finished(boolean played, boolean failed) {}
            });
        } catch (RuntimeException ignored) { /* Audio never alters the confirmed trip. */ }
    }
    public void stopWeb(String token) { handler.post(() -> {
        if (pending != null && "web".equals(pending.owner) && (token == null || token.equals(pending.token))) { Request old = pending; pending = null; complete(old, false, false); }
        if (active != null && "web".equals(active.owner) && (token == null || token.equals(active.token))) finish(false, false);
    }); }
    public void cancelOwner(String owner) { handler.post(() -> {
        if (pending != null && owner.equals(pending.owner)) { Request old = pending; pending = null; complete(old, false, false); }
        if (active != null && owner.equals(active.owner)) finish(false, false);
    }); }
    private void stopAll() {
        handler.removeCallbacks(pumpRunnable);
        if (pending != null) { Request old = pending; pending = null; complete(old, false, false); }
        if (active != null) finish(false, false);
    }
}
