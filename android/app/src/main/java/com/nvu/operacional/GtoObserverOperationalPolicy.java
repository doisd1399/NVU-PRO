package com.nvu.operacional;

/**
 * HF42 single source of truth for the floating-button / permission / capture relationship.
 * A visible bubble never means the observer is healthy. "READY" requires the Observe
 * toggle, overlay, real GTO context, a live MediaProjection pipeline and fresh analyzed
 * frames. Missing pieces are recovery states, not successful states.
 */
final class GtoObserverOperationalPolicy {
    private GtoObserverOperationalPolicy() {}

    /**
     * HF90 transport readiness. A stale foreground owner must not make a live observer
     * look stopped; context and action permission are evaluated by the service separately.
     */
    static boolean transportReady(
        boolean observeEnabled,
        boolean bubbleAttached,
        boolean projectionActive,
        boolean projectionBound,
        boolean captureHealthy
    ) {
        return observeEnabled && bubbleAttached && projectionActive
            && projectionBound && captureHealthy;
    }

    static boolean isReady(
        boolean observeEnabled,
        boolean bubbleAttached,
        boolean gtoForeground,
        boolean projectionActive,
        boolean projectionBound,
        boolean captureHealthy
    ) {
        return observeEnabled && bubbleAttached && gtoForeground
            && projectionActive && projectionBound && captureHealthy;
    }

    static boolean shouldArmInitialPermission(
        boolean observeEnabled,
        boolean gtoForeground,
        boolean bubbleAttached,
        boolean projectionActive,
        boolean projectionBound,
        boolean surfacePending,
        boolean permissionInFlight,
        boolean explicitDenial
    ) {
        return observeEnabled && gtoForeground && bubbleAttached
            && !projectionActive && !projectionBound && !surfacePending && !permissionInFlight
            && !explicitDenial;
    }

    static boolean shouldRepairBoundTransport(
        boolean observeEnabled,
        boolean projectionBound,
        boolean captureHealthy,
        boolean permissionInFlight
    ) {
        return observeEnabled && projectionBound
            && !captureHealthy && !permissionInFlight;
    }

    static boolean shouldRepairBoundCapture(
        boolean observeEnabled,
        boolean gtoForeground,
        boolean projectionBound,
        boolean captureHealthy,
        boolean permissionInFlight
    ) {
        return observeEnabled && gtoForeground && projectionBound
            && !captureHealthy && !permissionInFlight;
    }

    static String transportStatus(
        boolean observeEnabled,
        boolean bubbleAttached,
        boolean permissionInFlight,
        boolean projectionActive,
        boolean projectionBound,
        boolean captureHealthy
    ) {
        if (!observeEnabled) return "OFF";
        if (!bubbleAttached) return "RECOVERING_BUBBLE";
        if (permissionInFlight) return "WAITING_ANDROID_CONSENT";
        if (!projectionBound) return "WAITING_CAPTURE_GRANT";
        if (!projectionActive) return "BINDING_CAPTURE";
        if (!captureHealthy) return "RECOVERING_REAL_FRAMES";
        return "TRANSPORT_READY";
    }

    static String status(
        boolean observeEnabled,
        boolean bubbleAttached,
        boolean gtoForeground,
        boolean permissionInFlight,
        boolean projectionActive,
        boolean projectionBound,
        boolean captureHealthy
    ) {
        if (!observeEnabled) return "OFF";
        if (!bubbleAttached) return "RECOVERING_BUBBLE";
        if (!gtoForeground) return "WAITING_GTO";
        if (permissionInFlight) return "WAITING_ANDROID_CONSENT";
        if (!projectionBound) return "WAITING_CAPTURE_GRANT";
        if (!projectionActive) return "BINDING_CAPTURE";
        if (!captureHealthy) return "RECOVERING_REAL_FRAMES";
        return "READY";
    }
}
