package com.nvu.operacional;

/**
 * HF69: separates the NVU observer service lifecycle from the GTO foreground context.
 *
 * GTO foreground is a capture/interpretation condition, not a service ownership condition.
 * Leaving GTO may pause semantic screen mutations, but it must never stop the NVU observer,
 * clear the durable trip, or be reported as a dead service.
 */
final class GtoObserverLifecyclePolicy {
    static final String ACTIVE = "OBSERVER_ACTIVE";
    static final String GTO_FOREGROUND_CAPTURE = "GTO_FOREGROUND_CAPTURE";
    static final String GTO_BACKGROUND_OBSERVER_ACTIVE = "GTO_BACKGROUND_OBSERVER_ACTIVE";
    static final String WAITING_ANDROID_REAUTH = "WAITING_ANDROID_REAUTH";
    static final String SERVICE_STOPPED = "SERVICE_STOPPED";

    private GtoObserverLifecyclePolicy() {}

    static boolean serviceAlive(
        boolean running,
        boolean enabled,
        boolean destroying,
        long now,
        long serviceHeartbeatAt
    ) {
        return running
            && enabled
            && !destroying
            && serviceHeartbeatAt > 0L
            && now >= serviceHeartbeatAt
            && now - serviceHeartbeatAt <= 5_000L;
    }

    static String status(
        boolean running,
        boolean enabled,
        boolean destroying,
        boolean gtoForeground,
        boolean screenAnalysisPaused,
        boolean projectionReauthRequired,
        boolean captureHealthy,
        long now,
        long serviceHeartbeatAt
    ) {
        if (!serviceAlive(running, enabled, destroying, now, serviceHeartbeatAt)) {
            return SERVICE_STOPPED;
        }
        if (projectionReauthRequired) return WAITING_ANDROID_REAUTH;
        if (gtoForeground && captureHealthy) return GTO_FOREGROUND_CAPTURE;
        if (screenAnalysisPaused || !gtoForeground) return GTO_BACKGROUND_OBSERVER_ACTIVE;
        return ACTIVE;
    }

    static boolean shouldPreserveOnGtoExit(
        boolean enabled,
        boolean explicitStop,
        boolean nvuSessionActive
    ) {
        return enabled && !explicitStop && nvuSessionActive;
    }

    static boolean isBackgroundObserverActive(String status) {
        return GTO_BACKGROUND_OBSERVER_ACTIVE.equals(status);
    }
}
