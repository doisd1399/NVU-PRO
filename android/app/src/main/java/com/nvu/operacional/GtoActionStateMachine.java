package com.nvu.operacional;

/**
 * Action authority. It does not detect screens and cannot repair transport. It only
 * derives whether a current-generation screen may receive a mutating action.
 */
final class GtoActionStateMachine {
    static final String DISARMED = "DISARMED";
    static final String ARMED = "ARMED";

    static final class Snapshot {
        final long generation;
        final String state;
        final boolean armed;
        final String reason;
        final long changedAt;

        Snapshot(long generation, String state, boolean armed, String reason, long changedAt) {
            this.generation = generation;
            this.state = state;
            this.armed = armed;
            this.reason = reason == null ? "" : reason;
            this.changedAt = changedAt;
        }
    }

    private long generation = -1L;
    private String state = DISARMED;
    private boolean armed = false;
    private String reason = "INIT";
    private long changedAt = 0L;

    synchronized Snapshot derive(
        long observedGeneration,
        long contextGeneration,
        boolean transportHealthy,
        boolean contextConfirmed,
        boolean geometryValid,
        boolean nvuForeground,
        boolean transientSurface,
        long now
    ) {
        boolean contextCurrent = observedGeneration >= 0L
            && contextGeneration == observedGeneration;
        boolean nextArmed = contextCurrent
            && transportHealthy
            && contextConfirmed
            && geometryValid
            && !nvuForeground
            && !transientSurface;
        String nextReason = actionBlockReason(
            nextArmed,
            contextCurrent,
            transportHealthy,
            contextConfirmed,
            geometryValid,
            nvuForeground,
            transientSurface
        );
        String nextState = nextArmed ? ARMED : DISARMED;
        if (generation != observedGeneration || armed != nextArmed
            || !state.equals(nextState) || !reason.equals(nextReason)) {
            generation = observedGeneration;
            armed = nextArmed;
            state = nextState;
            reason = nextReason;
            changedAt = Math.max(0L, now);
        }
        return new Snapshot(generation, state, armed, reason, changedAt);
    }

    private static String actionBlockReason(
        boolean armed,
        boolean contextCurrent,
        boolean transportHealthy,
        boolean contextConfirmed,
        boolean geometryValid,
        boolean nvuForeground,
        boolean transientSurface
    ) {
        if (armed) return "";
        if (!transportHealthy) return "TRANSPORT_NOT_HEALTHY";
        if (!contextCurrent) return "SCREEN_CONTEXT_STALE";
        if (!contextConfirmed) return "SCREEN_CONTEXT_NOT_CONFIRMED";
        if (!geometryValid) return "GEOMETRY_NOT_VALID";
        if (nvuForeground) return "NVU_FOREGROUND";
        if (transientSurface) return "TRANSIENT_SURFACE";
        return "UNKNOWN";
    }
}
