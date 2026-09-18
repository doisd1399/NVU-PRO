package com.nvu.operacional;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.MediaPlayer;

import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.Set;

/**
 * Small, local-only voice layer for NVU automation events.
 *
 * The class deliberately does not inspect capture frames or decide automation state.
 * It only consumes already-confirmed automation events produced by GtoObserverService.
 *
 * The user-supplied MP3 files remain byte-for-byte in res/raw and all voices share a
 * serialized queue so phrases can never overlap. Playback is fail-open for automation:
 * an audio failure is diagnosed but can never block the GTO state machine.
 */
public final class NvuAudioManager {
    private static final String PREFS_NAME = "nvu_audio_events";
    private static final String KEY_LAST_READY_EVENT_ID = "lastReadyVoiceEventId";
    private static final String KEY_LAST_READY_PLAYED_AT = "lastReadyVoicePlayedAt";
    private static final String KEY_LAST_COMPLETED_EVENT_ID = "lastTripCompletedVoiceEventId";
    private static final String KEY_LAST_COMPLETED_PLAYED_AT = "lastTripCompletedVoicePlayedAt";
    private static final String KEY_LAST_PAUSE_EVENT_ID = "lastPauseActionVoiceEventId";
    private static final String KEY_LAST_PAUSE_PLAYED_AT = "lastPauseActionVoicePlayedAt";
    private static final String KEY_LAST_GTO_START_EVENT_ID = "lastGtoAutomatedStartVoiceEventId";
    private static final String KEY_LAST_GTO_START_PLAYED_AT = "lastGtoAutomatedStartVoicePlayedAt";
    private static final String KEY_LAST_ERROR = "lastAudioError";
    private static final String KEY_LAST_ERROR_AT = "lastAudioErrorAt";

    private enum VoiceKind {
        READY,
        TRIP_COMPLETED,
        PAUSE_ACTION,
        GTO_AUTOMATED_START
    }

    private static final class VoiceRequest {
        final VoiceKind kind;
        final String eventId;

        VoiceRequest(VoiceKind kind, String eventId) {
            this.kind = kind;
            this.eventId = eventId;
        }
    }

    public interface ErrorReporter {
        void onAudioError(String detail);
    }

    private final Context appContext;
    private final SharedPreferences prefs;
    private final ErrorReporter errorReporter;
    private final Object lock = new Object();
    private final ArrayDeque<VoiceRequest> pendingVoices = new ArrayDeque<>();
    private final Set<String> queuedOrPlayingEventIds = new HashSet<>();

    private MediaPlayer readyPlayer;
    private MediaPlayer tripCompletedPlayer;
    private MediaPlayer pauseActionPlayer;
    private MediaPlayer gtoAutomatedStartPlayer;
    private MediaPlayer activePlayer;
    private String activeEventId = "";
    private boolean released = false;

    public NvuAudioManager(Context context, ErrorReporter reporter) {
        appContext = context.getApplicationContext();
        prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        errorReporter = reporter;
        synchronized (lock) {
            preparePlayerLocked(VoiceKind.READY);
            preparePlayerLocked(VoiceKind.TRIP_COMPLETED);
            preparePlayerLocked(VoiceKind.PAUSE_ACTION);
            preparePlayerLocked(VoiceKind.GTO_AUTOMATED_START);
        }
    }

    /**
     * Plays the user-supplied ~3 s phrase once for the supplied confirmed trip session:
     * "Tudo preparado, podemos partir."
     */
    public boolean playReadyVoice(String eventId) {
        return enqueueOrPlay(VoiceKind.READY, eventId);
    }

    /**
     * Plays the user-supplied ~6 s phrase once for the supplied certified result session:
     * "Ótimo trabalho, chegamos no destino. Sua viagem será enviada automaticamente."
     */
    public boolean playTripCompletedVoice(String eventId) {
        return enqueueOrPlay(VoiceKind.TRIP_COMPLETED, eventId);
    }

    /**
     * Plays the supplied pause instruction once for a pause-recovery event.
     * The caller decides when the alert is semantically eligible; this class only plays it.
     */
    public boolean playPauseActionVoice(String eventId) {
        return enqueueOrPlay(VoiceKind.PAUSE_ACTION, eventId);
    }

    /** Plays the automated-GTO opening voice once for the supplied launch event. */
    public boolean playGtoAutomatedStartVoice(String eventId) {
        return enqueueOrPlay(VoiceKind.GTO_AUTOMATED_START, eventId);
    }

    private boolean enqueueOrPlay(VoiceKind kind, String eventId) {
        String safeEventId = eventId == null ? "" : eventId.trim();
        if (safeEventId.isEmpty()) return false;

        synchronized (lock) {
            if (released) return false;
            if (wasAlreadyPlayedLocked(kind, safeEventId)
                || queuedOrPlayingEventIds.contains(safeEventId)) {
                // The event is already handled; report success to the caller while
                // keeping playback strictly once-per-event.
                return true;
            }

            if (activePlayer != null) {
                pendingVoices.addLast(new VoiceRequest(kind, safeEventId));
                queuedOrPlayingEventIds.add(safeEventId);
                return true;
            }

            return startVoiceLocked(kind, safeEventId, false);
        }
    }

    public void release() {
        synchronized (lock) {
            released = true;
            pendingVoices.clear();
            queuedOrPlayingEventIds.clear();
            activeEventId = "";
            activePlayer = null;
            releasePlayerLocked(VoiceKind.READY);
            releasePlayerLocked(VoiceKind.TRIP_COMPLETED);
            releasePlayerLocked(VoiceKind.PAUSE_ACTION);
            releasePlayerLocked(VoiceKind.GTO_AUTOMATED_START);
        }
    }

    private boolean wasAlreadyPlayedLocked(VoiceKind kind, String eventId) {
        String key;
        if (kind == VoiceKind.READY) key = KEY_LAST_READY_EVENT_ID;
        else if (kind == VoiceKind.TRIP_COMPLETED) key = KEY_LAST_COMPLETED_EVENT_ID;
        else if (kind == VoiceKind.PAUSE_ACTION) key = KEY_LAST_PAUSE_EVENT_ID;
        else key = KEY_LAST_GTO_START_EVENT_ID;
        return eventId.equals(prefs.getString(key, ""));
    }

    private boolean startVoiceLocked(VoiceKind kind, String eventId, boolean alreadyQueued) {
        if (released) return false;
        MediaPlayer player = getPlayerLocked(kind);
        if (player == null && !preparePlayerLocked(kind)) {
            if (alreadyQueued) queuedOrPlayingEventIds.remove(eventId);
            return false;
        }
        player = getPlayerLocked(kind);
        if (player == null) {
            if (alreadyQueued) queuedOrPlayingEventIds.remove(eventId);
            return false;
        }

        if (!alreadyQueued) queuedOrPlayingEventIds.add(eventId);
        activePlayer = player;
        activeEventId = eventId;
        try {
            player.seekTo(0);
            player.start();
            SharedPreferences.Editor editor = prefs.edit()
                .remove(KEY_LAST_ERROR)
                .remove(KEY_LAST_ERROR_AT);
            if (kind == VoiceKind.READY) {
                editor.putString(KEY_LAST_READY_EVENT_ID, eventId)
                    .putLong(KEY_LAST_READY_PLAYED_AT, System.currentTimeMillis());
            } else if (kind == VoiceKind.TRIP_COMPLETED) {
                editor.putString(KEY_LAST_COMPLETED_EVENT_ID, eventId)
                    .putLong(KEY_LAST_COMPLETED_PLAYED_AT, System.currentTimeMillis());
            } else if (kind == VoiceKind.PAUSE_ACTION) {
                editor.putString(KEY_LAST_PAUSE_EVENT_ID, eventId)
                    .putLong(KEY_LAST_PAUSE_PLAYED_AT, System.currentTimeMillis());
            } else {
                editor.putString(KEY_LAST_GTO_START_EVENT_ID, eventId)
                    .putLong(KEY_LAST_GTO_START_PLAYED_AT, System.currentTimeMillis());
            }
            editor.apply();
            return true;
        } catch (RuntimeException error) {
            queuedOrPlayingEventIds.remove(eventId);
            activeEventId = "";
            activePlayer = null;
            reportErrorLocked("Falha ao reproduzir " + kind.name() + ": " + safeMessage(error));
            releasePlayerLocked(kind);
            startNextLocked();
            return false;
        }
    }

    private boolean preparePlayerLocked(VoiceKind kind) {
        if (released) return false;
        if (getPlayerLocked(kind) != null) return true;
        try {
            AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
            int resourceId;
            if (kind == VoiceKind.READY) resourceId = R.raw.nvu_ready_voice_pt_br;
            else if (kind == VoiceKind.TRIP_COMPLETED) resourceId = R.raw.nvu_trip_completed_voice_pt_br;
            else if (kind == VoiceKind.PAUSE_ACTION) resourceId = R.raw.nvu_pause_alert_voice_pt_br;
            else resourceId = R.raw.nvu_gto_automated_start_voice_pt_br;
            MediaPlayer player = MediaPlayer.create(appContext, resourceId, attributes, 0);
            if (player == null) {
                reportErrorLocked("Android não conseguiu preparar o áudio local " + kind.name() + ".");
                return false;
            }
            player.setLooping(false);
            player.setOnCompletionListener(completed -> onPlayerCompleted(kind, completed));
            player.setOnErrorListener((failed, what, extra) -> onPlayerError(kind, failed, what, extra));
            setPlayerLocked(kind, player);
            return true;
        } catch (RuntimeException error) {
            reportErrorLocked("Falha ao preparar áudio local " + kind.name() + ": " + safeMessage(error));
            releasePlayerLocked(kind);
            return false;
        }
    }

    private void onPlayerCompleted(VoiceKind kind, MediaPlayer player) {
        synchronized (lock) {
            if (released || player != getPlayerLocked(kind)) return;
            if (player == activePlayer) {
                queuedOrPlayingEventIds.remove(activeEventId);
                activeEventId = "";
                activePlayer = null;
            }
            try {
                player.seekTo(0);
            } catch (RuntimeException ignored) {
            }
            startNextLocked();
        }
    }

    private boolean onPlayerError(VoiceKind kind, MediaPlayer player, int what, int extra) {
        synchronized (lock) {
            reportErrorLocked("MediaPlayer " + kind.name() + " error what=" + what + " extra=" + extra);
            if (player == activePlayer) {
                queuedOrPlayingEventIds.remove(activeEventId);
                activeEventId = "";
                activePlayer = null;
            }
            releasePlayerLocked(kind);
            startNextLocked();
        }
        return true;
    }

    private void startNextLocked() {
        if (released || activePlayer != null) return;
        while (!pendingVoices.isEmpty()) {
            VoiceRequest next = pendingVoices.removeFirst();
            if (wasAlreadyPlayedLocked(next.kind, next.eventId)) {
                queuedOrPlayingEventIds.remove(next.eventId);
                continue;
            }
            if (startVoiceLocked(next.kind, next.eventId, true)) return;
        }
    }

    private MediaPlayer getPlayerLocked(VoiceKind kind) {
        if (kind == VoiceKind.READY) return readyPlayer;
        if (kind == VoiceKind.TRIP_COMPLETED) return tripCompletedPlayer;
        if (kind == VoiceKind.PAUSE_ACTION) return pauseActionPlayer;
        return gtoAutomatedStartPlayer;
    }

    private void setPlayerLocked(VoiceKind kind, MediaPlayer player) {
        if (kind == VoiceKind.READY) readyPlayer = player;
        else if (kind == VoiceKind.TRIP_COMPLETED) tripCompletedPlayer = player;
        else if (kind == VoiceKind.PAUSE_ACTION) pauseActionPlayer = player;
        else gtoAutomatedStartPlayer = player;
    }

    private void releasePlayerLocked(VoiceKind kind) {
        MediaPlayer player = getPlayerLocked(kind);
        setPlayerLocked(kind, null);
        if (player == null) return;
        try {
            player.setOnCompletionListener(null);
            player.setOnErrorListener(null);
            player.release();
        } catch (RuntimeException ignored) {
        }
    }

    private void reportErrorLocked(String detail) {
        String safeDetail = detail == null ? "Falha de áudio desconhecida" : detail;
        prefs.edit()
            .putString(KEY_LAST_ERROR, safeDetail)
            .putLong(KEY_LAST_ERROR_AT, System.currentTimeMillis())
            .apply();
        if (errorReporter != null) {
            try {
                errorReporter.onAudioError(safeDetail);
            } catch (RuntimeException ignored) {
            }
        }
    }

    private static String safeMessage(Throwable error) {
        if (error == null || error.getMessage() == null || error.getMessage().trim().isEmpty()) {
            return error == null ? "erro desconhecido" : error.getClass().getSimpleName();
        }
        return error.getMessage().trim();
    }
}
