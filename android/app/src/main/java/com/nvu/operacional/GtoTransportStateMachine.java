package com.nvu.operacional;

/**
 * Transport-only state machine. It never interprets the screen and never consults
 * foreground ownership. A healthy transport means that the current capture generation
 * has a bound token/display/reader/handler and recent frame + analysis heartbeats.
 */
final class GtoTransportStateMachine {
    static final String STOPPED = "STOPPED";
    static final String BINDING = "BINDING";
    static final String SESSION_BOUND = "SESSION_BOUND";
    static final String FRAME_RECEIVED = "FRAME_RECEIVED";
    static final String ANALYSIS_RUNNING = "ANALYSIS_RUNNING";
    static final String RECOVERY_IN_FLIGHT = "RECOVERY_IN_FLIGHT";
    static final String FRAME_STALE = "FRAME_STALE";

    static final long FRAME_STALE_MS = 1800L;
    static final long ANALYSIS_STALE_MS = 2400L;

    static final class Snapshot {
        final long generation;
        final String state;
        final boolean enabled;
        final boolean tokenPresent;
        final boolean displayPresent;
        final boolean readerPresent;
        final boolean handlerPresent;
        final long lastFrameAt;
        final long lastAnalyzedAt;
        final boolean healthy;
        final boolean recoveryInFlight;
        final long changedAt;

        Snapshot(
            long generation,
            String state,
            boolean enabled,
            boolean tokenPresent,
            boolean displayPresent,
            boolean readerPresent,
            boolean handlerPresent,
            long lastFrameAt,
            long lastAnalyzedAt,
            boolean healthy,
            boolean recoveryInFlight,
            long changedAt
        ) {
            this.generation = generation;
            this.state = state;
            this.enabled = enabled;
            this.tokenPresent = tokenPresent;
            this.displayPresent = displayPresent;
            this.readerPresent = readerPresent;
            this.handlerPresent = handlerPresent;
            this.lastFrameAt = lastFrameAt;
            this.lastAnalyzedAt = lastAnalyzedAt;
            this.healthy = healthy;
            this.recoveryInFlight = recoveryInFlight;
            this.changedAt = changedAt;
        }
    }

    private long generation = -1L;
    private String state = STOPPED;
    private long changedAt = 0L;

    synchronized Snapshot observe(
        long observedGeneration,
        boolean enabled,
        boolean tokenPresent,
        boolean displayPresent,
        boolean readerPresent,
        boolean handlerPresent,
        long lastFrameAt,
        long lastAnalyzedAt,
        boolean recoveryInFlight,
        long now
    ) {
        boolean resources = tokenPresent && displayPresent && readerPresent && handlerPresent;
        boolean frameFresh = now > 0L && lastFrameAt > 0L && now >= lastFrameAt
            && now - lastFrameAt <= FRAME_STALE_MS;
        boolean analysisFresh = now > 0L && lastAnalyzedAt > 0L && now >= lastAnalyzedAt
            && now - lastAnalyzedAt <= ANALYSIS_STALE_MS;
        String next;
        if (!enabled) next = STOPPED;
        else if (recoveryInFlight) next = RECOVERY_IN_FLIGHT;
        else if (!resources) next = BINDING;
        else if (!frameFresh) next = lastFrameAt > 0L ? FRAME_STALE : SESSION_BOUND;
        else if (!analysisFresh) next = FRAME_RECEIVED;
        else next = ANALYSIS_RUNNING;
        if (generation != observedGeneration || !next.equals(state)) {
            generation = observedGeneration;
            state = next;
            changedAt = Math.max(0L, now);
        }
        return new Snapshot(
            observedGeneration,
            next,
            enabled,
            tokenPresent,
            displayPresent,
            readerPresent,
            handlerPresent,
            lastFrameAt,
            lastAnalyzedAt,
            resources && frameFresh && analysisFresh && !recoveryInFlight,
            recoveryInFlight,
            changedAt
        );
    }

    synchronized Snapshot current() {
        return new Snapshot(
            generation, state, false, false, false, false, false,
            0L, 0L, false, RECOVERY_IN_FLIGHT.equals(state), changedAt
        );
    }
}
