package com.nvu.operacional;

/**
 * HF22: keeps journey messages deterministic without coupling UI to detector internals.
 * Higher-priority messages may preempt lower-priority ones; lower-priority messages
 * wait until the current stage has been readable for the minimum visibility window.
 */
final class GtoDriverMessagePriorityPolicy {
    static final int INFO = 10;
    static final int SUCCESS = 20;
    static final int ACTION = 30;
    static final int CRITICAL = 40;

    private GtoDriverMessagePriorityPolicy() {}

    static int priorityFor(String code) {
        String c = code == null ? "" : code.trim().toUpperCase();
        if (c.contains("FAILED") || c.contains("ERROR") || c.contains("CAPTURE_LOST") || c.contains("BLOCKED")) {
            return CRITICAL;
        }
        if (c.contains("REVIEW") || c.contains("REPLACEMENT_ARMED") || c.contains("AUTHORIZE") || c.contains("ACTION_REQUIRED") || c.contains("PAUSE")) {
            return ACTION;
        }
        if (c.startsWith("SYNCED") || c.equals("TRIP_IN_PROGRESS") || c.contains("CONFIRMED") || c.contains("RECOVERED")) {
            return SUCCESS;
        }
        return INFO;
    }

    static boolean mayPreemptImmediately(int currentPriority, int incomingPriority) {
        return incomingPriority > currentPriority;
    }

    static boolean shouldQueueUntilReadable(
        int currentPriority,
        int incomingPriority,
        long visibleForMs,
        long minimumVisibleMs
    ) {
        if (incomingPriority > currentPriority) return false;
        return visibleForMs < minimumVisibleMs;
    }
}
