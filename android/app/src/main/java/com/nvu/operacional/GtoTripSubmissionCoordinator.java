package com.nvu.operacional;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.HashSet;
import java.util.Set;

/**
 * HF126: single owner for completed-trip submission.
 *
 * The normal path is intentionally small: seal the immutable completed payload,
 * send it immediately through GtoAutoTripSync, and expose only one terminal callback.
 * The durable queue remains an invisible outbox fallback for authentication/network/
 * persistence failures; it is never a second submission pipeline.
 */
final class GtoTripSubmissionCoordinator {
    static final String STATE_READY = "READY";
    static final String STATE_SENDING = "SENDING";
    static final String STATE_SYNCED = "SYNCED";
    static final String STATE_PENDING_RETRY = "PENDING_RETRY";

    private static final Object LOCK = new Object();
    private static final Set<String> SUBMISSIONS_IN_FLIGHT = new HashSet<>();

    private GtoTripSubmissionCoordinator() {}

    static boolean submitCompletedTrip(
        Context context,
        SharedPreferences prefs,
        GtoAutoTripSync.Listener listener
    ) {
        if (context == null || prefs == null) return false;
        String sessionId = clean(prefs.getString("gtoTripSessionId", ""));
        if (sessionId.isEmpty()) {
            setCurrentState(prefs, STATE_PENDING_RETRY, "Sessão GTO ausente; envio preservado para retry.");
            if (listener != null) listener.onPending("", "Sessão GTO ausente");
            return false;
        }
        boolean terminalState = GtoTripSubmissionPolicy.maySubmit(
            prefs.getString("tripState", ""),
            prefs.getString("completionStatus", ""),
            prefs.getBoolean("resultCertifiedLatched", false),
            sessionId
        );
        if (!terminalState) {
            setCurrentState(prefs, STATE_PENDING_RETRY,
                "Viagem ainda em andamento; envio bloqueado até a confirmação final Concluído.");
            if (listener != null) listener.onPending(
                sessionId, "Envio bloqueado: a viagem ainda não foi confirmada como Concluído.");
            return false;
        }

        synchronized (LOCK) {
            if (!SUBMISSIONS_IN_FLIGHT.add(sessionId)) {
                // The first owner already sealed/sent this exact session. Do not create
                // a second callable or overwrite its state with a second UI message.
                return true;
            }
        }

        setCurrentState(prefs, STATE_SENDING, "Viagem concluída; enviando automaticamente.");
        GtoAutoTripSync.Listener coordinatedListener = new GtoAutoTripSync.Listener() {
            @Override
            public void onSynced(String callbackSessionId, String tripId) {
                if (sessionId.equals(clean(callbackSessionId))) {
                    release(sessionId);
                    setCurrentState(prefs, STATE_SYNCED, "Viagem registrada com sucesso.");
                }
                if (listener != null) listener.onSynced(callbackSessionId, tripId);
            }

            @Override
            public void onPending(String callbackSessionId, String message) {
                if (sessionId.equals(clean(callbackSessionId))) {
                    release(sessionId);
                    setCurrentState(prefs, STATE_PENDING_RETRY, "Viagem protegida; nova tentativa automática.");
                }
                if (listener != null) listener.onPending(callbackSessionId, message);
            }
        };

        boolean accepted;
        try {
            accepted = GtoAutoTripSync.enqueueConfirmedTrip(context, prefs, coordinatedListener);
        } catch (RuntimeException error) {
            release(sessionId);
            setCurrentState(prefs, STATE_PENDING_RETRY, "Falha transitória; viagem preservada para retry.");
            if (listener != null) listener.onPending(sessionId, "Falha transitória ao iniciar envio");
            return false;
        }

        if (!accepted) {
            release(sessionId);
            setCurrentState(prefs, STATE_PENDING_RETRY, "Viagem protegida; nova tentativa automática.");
        }
        return accepted;
    }

    static void flushPending(
        Context context,
        SharedPreferences prefs,
        GtoAutoTripSync.Listener listener
    ) {
        if (context == null || prefs == null) return;
        GtoAutoTripSync.flushPending(context, prefs, listener);
    }

    static boolean isSubmissionInFlight(String sessionId) {
        String cleanSession = clean(sessionId);
        synchronized (LOCK) {
            return !cleanSession.isEmpty() && SUBMISSIONS_IN_FLIGHT.contains(cleanSession);
        }
    }

    private static void release(String sessionId) {
        String cleanSession = clean(sessionId);
        if (cleanSession.isEmpty()) return;
        synchronized (LOCK) {
            SUBMISSIONS_IN_FLIGHT.remove(cleanSession);
        }
    }

    private static void setCurrentState(SharedPreferences prefs, String state, String event) {
        if (prefs == null) return;
        prefs.edit()
            .putString("tripSubmissionState", state)
            .putLong("tripSubmissionStateAt", System.currentTimeMillis())
            .putString("lastEvent", event)
            .apply();
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
