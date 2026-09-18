package com.nvu.operacional;

/**
 * Pure visual-context reducer. It never owns MediaProjection and never changes the
 * trip state by itself. A context is valid only for the current capture generation
 * and after consecutive compatible frames.
 */
final class GtoVisualContextStateMachine {
    static final String UNKNOWN = "UNKNOWN";
    static final String FREIGHT_LIST = "FREIGHT_LIST";
    static final String PAUSE = "PAUSE";
    static final String ACTIVE_TRIP = "ACTIVE_TRIP";
    static final String RESULT = "RESULT";

    static final int REQUIRED_CONFIRMATION_FRAMES = 3;
    static final long MAX_CANDIDATE_GAP_MS = 950L;

    static final class Snapshot {
        final long generation;
        final String state;
        final String candidateState;
        final String signature;
        final int consecutiveFrames;
        final boolean confirmed;
        final boolean becameConfirmed;
        final long changedAt;

        Snapshot(
            long generation,
            String state,
            String candidateState,
            String signature,
            int consecutiveFrames,
            boolean confirmed,
            boolean becameConfirmed,
            long changedAt
        ) {
            this.generation = generation;
            this.state = state;
            this.candidateState = candidateState;
            this.signature = signature == null ? "" : signature;
            this.consecutiveFrames = consecutiveFrames;
            this.confirmed = confirmed;
            this.becameConfirmed = becameConfirmed;
            this.changedAt = changedAt;
        }
    }

    private long generation = -1L;
    private String state = UNKNOWN;
    private String candidateState = UNKNOWN;
    private String candidateSignature = "";
    private int consecutiveFrames = 0;
    private long lastCandidateAt = 0L;
    private long changedAt = 0L;

    synchronized Snapshot resetForGeneration(long nextGeneration, long now) {
        generation = nextGeneration;
        state = UNKNOWN;
        candidateState = UNKNOWN;
        candidateSignature = "";
        consecutiveFrames = 0;
        lastCandidateAt = 0L;
        changedAt = Math.max(0L, now);
        return snapshot(false);
    }

    synchronized Snapshot observe(
        long observedGeneration,
        String observedState,
        String observedSignature,
        long now
    ) {
        String normalizedState = normalizeState(observedState);
        String normalizedSignature = normalizeSignature(observedSignature);
        if (generation != observedGeneration) {
            generation = observedGeneration;
            state = UNKNOWN;
            candidateState = UNKNOWN;
            candidateSignature = "";
            consecutiveFrames = 0;
            lastCandidateAt = 0L;
            changedAt = Math.max(0L, now);
        }

        if (UNKNOWN.equals(normalizedState) || now <= 0L) {
            candidateState = UNKNOWN;
            candidateSignature = "";
            consecutiveFrames = 0;
            lastCandidateAt = 0L;
            return snapshot(false);
        }

        boolean sameCandidate = normalizedState.equals(candidateState)
            && normalizedSignature.equals(candidateSignature)
            && lastCandidateAt > 0L
            && now >= lastCandidateAt
            && now - lastCandidateAt <= MAX_CANDIDATE_GAP_MS;
        if (!sameCandidate) {
            candidateState = normalizedState;
            candidateSignature = normalizedSignature;
            consecutiveFrames = 1;
        } else {
            consecutiveFrames = Math.min(REQUIRED_CONFIRMATION_FRAMES, consecutiveFrames + 1);
        }
        lastCandidateAt = now;

        boolean becameConfirmed = consecutiveFrames >= REQUIRED_CONFIRMATION_FRAMES
            && !normalizedState.equals(state);
        if (becameConfirmed) {
            state = normalizedState;
            changedAt = now;
        }
        return snapshot(becameConfirmed);
    }

    synchronized Snapshot current() {
        return snapshot(false);
    }

    synchronized boolean isConfirmedFor(long observedGeneration, String expectedState) {
        return generation == observedGeneration
            && state.equals(normalizeState(expectedState))
            && consecutiveFrames >= REQUIRED_CONFIRMATION_FRAMES;
    }

    private Snapshot snapshot(boolean becameConfirmed) {
        return new Snapshot(
            generation,
            state,
            candidateState,
            candidateSignature,
            consecutiveFrames,
            !UNKNOWN.equals(state),
            becameConfirmed,
            changedAt
        );
    }

    private static String normalizeState(String value) {
        if (FREIGHT_LIST.equals(value)) return FREIGHT_LIST;
        if (PAUSE.equals(value)) return PAUSE;
        if (ACTIVE_TRIP.equals(value)) return ACTIVE_TRIP;
        if (RESULT.equals(value)) return RESULT;
        return UNKNOWN;
    }

    private static String normalizeSignature(String value) {
        return value == null ? "" : value.trim();
    }
}
