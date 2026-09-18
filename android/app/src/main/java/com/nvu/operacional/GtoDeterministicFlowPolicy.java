package com.nvu.operacional;

/**
 * Pure policy helpers for the deterministic GTO state machine.
 *
 * This class deliberately has no Android dependencies so the critical transition rules
 * can be regression-tested on Windows/Linux without an emulator. The observer owns the
 * actual state; this policy only answers whether a visual event is allowed to influence it.
 */
final class GtoDeterministicFlowPolicy {
    private GtoDeterministicFlowPolicy() {}

    static boolean isAllowedTripTransition(String from, String to) {
        if (to == null || to.isEmpty()) return false;
        String safeFrom = from == null || from.isEmpty() ? "IDLE" : from;
        if (safeFrom.equals(to)) return true;
        if ("IDLE".equals(safeFrom)) {
            return "WAITING_FREIGHT".equals(to) || "CANCELLED".equals(to);
        }
        if ("WAITING_FREIGHT".equals(safeFrom)) {
            return "TRIP_STARTED".equals(to) || "CONFIRMING_FREIGHT".equals(to)
                || "CANCELLED".equals(to) || "IDLE".equals(to);
        }
        if ("TRIP_STARTED".equals(safeFrom)) {
            return "TRIP_IN_PROGRESS".equals(to) || "CONFIRMING_FREIGHT".equals(to)
                || "WAITING_FREIGHT".equals(to) || "CANCELLED".equals(to) || "IDLE".equals(to);
        }
        if ("CONFIRMING_FREIGHT".equals(safeFrom)) {
            return "TRIP_IN_PROGRESS".equals(to) || "WAITING_FREIGHT".equals(to)
                || "CANCELLED".equals(to) || "IDLE".equals(to);
        }
        if ("TRIP_IN_PROGRESS".equals(safeFrom)) {
            return "RESULT_DETECTED".equals(to) || "REJECTED_BONUS".equals(to)
                || "WAITING_FREIGHT".equals(to) || "CANCELLED".equals(to);
        }
        if ("RESULT_DETECTED".equals(safeFrom)) {
            return "AWAITING_BONUS_VALIDATION".equals(to) || "RESULT_CONFIRMED".equals(to)
                || "REJECTED_BONUS".equals(to) || "WAITING_FREIGHT".equals(to)
                || "CANCELLED".equals(to);
        }
        if ("AWAITING_BONUS_VALIDATION".equals(safeFrom)) {
            return "RESULT_CONFIRMED".equals(to) || "REJECTED_BONUS".equals(to)
                || "RESULT_DETECTED".equals(to) || "WAITING_FREIGHT".equals(to)
                || "CANCELLED".equals(to);
        }
        if ("RESULT_CONFIRMED".equals(safeFrom) || "REJECTED_BONUS".equals(safeFrom)) {
            return "IDLE".equals(to) || "WAITING_FREIGHT".equals(to) || "CANCELLED".equals(to);
        }
        if ("CANCELLED".equals(safeFrom)) {
            return "IDLE".equals(to) || "WAITING_FREIGHT".equals(to);
        }
        return false;
    }

    static boolean mayRepairWaitingToTrip(
        String state,
        boolean durableFreightLocked,
        boolean durableFreightRestored
    ) {
        return ("WAITING_FREIGHT".equals(state) || "TRIP_STARTED".equals(state))
            && durableFreightLocked
            && durableFreightRestored;
    }

    static boolean shouldPrepareWaitingBeforeGtoOpen(String state) {
        return "IDLE".equals(state) || "CANCELLED".equals(state);
    }

    static boolean isPreparedForGtoOpen(String state) {
        return "WAITING_FREIGHT".equals(state)
            || "TRIP_STARTED".equals(state)
            || "CONFIRMING_FREIGHT".equals(state)
            || "TRIP_IN_PROGRESS".equals(state)
            || "RESULT_DETECTED".equals(state)
            || "AWAITING_BONUS_VALIDATION".equals(state)
            || "RESULT_CONFIRMED".equals(state);
    }

    static boolean useOrderedFreightFrames(String state) {
        return "WAITING_FREIGHT".equals(state) || "TRIP_STARTED".equals(state);
    }

    /**
     * Ordered frames are required only while a human touch is being correlated.
     * Before the touch, the newest frame minimizes queue latency; after the marker,
     * every queued frame is preserved so a transient pressed state cannot be skipped.
     */
    static boolean useOrderedFreightFrames(String state, boolean criticalTouchWindow) {
        return criticalTouchWindow;
    }

    /**
     * A session may be in TRIP_STARTED while the first-touch transaction is still being
     * hydrated. In that narrow state the freight surface must remain observable, otherwise
     * the list can be visible while OCR/AcceptRects are silently disabled. A confirmed row
     * with validated evidence remains protected from this informational observer.
     */
    static boolean mayObserveFreightSelectionSurface(
        String state,
        boolean hasSelectedRow,
        boolean selectionConfirmed,
        boolean evidencePending
    ) {
        if ("WAITING_FREIGHT".equals(state)) return true;
        return "TRIP_STARTED".equals(state)
            && (!hasSelectedRow || !selectionConfirmed || evidencePending);
    }

    /**
     * TRIP_STARTED is a durable operational state, not a touch-progress marker. It is
     * valid only after the same selection has a session, row, human identity and a locked
     * freight snapshot. A false result is an orphaned state and must be normalized before
     * any new list or touch is processed.
     */
    static boolean hasDurableTripStartedIdentity(
        String state,
        boolean sessionPresent,
        int selectedRow,
        boolean humanIdentityConfirmed,
        boolean freightLocked
    ) {
        return "TRIP_STARTED".equals(state)
            && sessionPresent
            && selectedRow >= 0
            && humanIdentityConfirmed
            && freightLocked;
    }

    static boolean isOrphanedTripStarted(
        String state,
        boolean sessionPresent,
        int selectedRow,
        boolean humanIdentityConfirmed,
        boolean freightLocked
    ) {
        return "TRIP_STARTED".equals(state)
            && !hasDurableTripStartedIdentity(
                state, sessionPresent, selectedRow, humanIdentityConfirmed, freightLocked
            );
    }

    static boolean mayAutoBootstrapFreightList(String state) {
        return shouldPrepareWaitingBeforeGtoOpen(state);
    }

    static boolean mayObserveFreightListOutsideWaiting(String state) {
        return mayAutoBootstrapFreightList(state)
            || "TRIP_STARTED".equals(state)
            || "TRIP_IN_PROGRESS".equals(state)
            || "RESULT_DETECTED".equals(state)
            || "AWAITING_BONUS_VALIDATION".equals(state);
    }


    static boolean mayProbeFreightListForCurrentState(String state, boolean ignoredExplicitReplacementFlag) {
        // HF34: recognition of the GTO jobs list is never conditional on a menu/button.
        // The list is a first-class lifecycle state and must always be observable.
        return mayObserveFreightListOutsideWaiting(state);
    }

    static boolean shouldAutoPrepareNextFreightAfterSync(
        String state,
        boolean syncAcknowledged,
        boolean operationClosed
    ) {
        return shouldAutoPrepareNextFreightAfterSync(
            state, syncAcknowledged, operationClosed, false
        );
    }

    static boolean shouldAutoPrepareNextFreightAfterSync(
        String state,
        boolean syncAcknowledged,
        boolean operationClosed,
        boolean deferForCertifiedListBoundary
    ) {
        return "RESULT_CONFIRMED".equals(state)
            && syncAcknowledged
            && !operationClosed
            && !deferForCertifiedListBoundary;
    }

    static boolean mayPrepareNextFreightAfterSealedQueue(
        String state,
        boolean payloadSealed,
        boolean operationClosed,
        int completedBeforeThisTrip,
        int totalDeliveries
    ) {
        if (!"RESULT_CONFIRMED".equals(state) || !payloadSealed || operationClosed) return false;
        return hasNextFreightAfterCurrentTrip(completedBeforeThisTrip, totalDeliveries);
    }

    /**
     * The web/backend progress can lag, lead, or temporarily advertise a terminal
     * status while the current local trip is being sealed. The observer therefore
     * keeps the position at which this trip started and uses that durable local fact
     * to decide whether another freight exists.
     */
    static boolean hasNextFreightAfterCurrentTrip(int tripStartingProgress, int totalDeliveries) {
        if (totalDeliveries <= 0) return false;
        int safeStartingProgress = Math.max(0, tripStartingProgress);
        return safeStartingProgress + 1 < totalDeliveries;
    }

    static boolean shouldRefreshTransientVisualContextAfterReturn(String state) {
        return "WAITING_FREIGHT".equals(state)
            || "CONFIRMING_FREIGHT".equals(state)
            || "TRIP_IN_PROGRESS".equals(state)
            || "RESULT_DETECTED".equals(state)
            || "AWAITING_BONUS_VALIDATION".equals(state);
    }

    static boolean mayReplaceActiveTrip(String state, boolean stableFreightListReturned) {
        return stableFreightListReturned && "TRIP_IN_PROGRESS".equals(state);
    }

    /**
     * A list visible during an active trip is a read-only visual context unless the
     * replacement coordinator has already correlated a real Accept touch. This prevents
     * merely reopening the jobs screen from cancelling/replacing the durable active trip.
     */
    static boolean freightListIsInformationalOnly(String state, boolean exactAcceptTouchConfirmed) {
        return "TRIP_IN_PROGRESS".equals(state) && !exactAcceptTouchConfirmed;
    }

    static boolean mayReplaceActiveTripAfterAcceptTouch(
        String state,
        boolean exactAcceptTouchConfirmed,
        boolean semanticListCertified
    ) {
        return "TRIP_IN_PROGRESS".equals(state)
            && exactAcceptTouchConfirmed
            && semanticListCertified;
    }

    static boolean mayInterpretResultScreen(String state) {
        return "TRIP_IN_PROGRESS".equals(state)
            || "RESULT_DETECTED".equals(state)
            || "AWAITING_BONUS_VALIDATION".equals(state);
    }

    static boolean mayInterpretBonusOrAds(String state) {
        return "RESULT_DETECTED".equals(state)
            || "AWAITING_BONUS_VALIDATION".equals(state);
    }

    static boolean unknownScreenMustBeNeutral(String state) {
        return state != null && !state.isEmpty();
    }

    static int stabilizeVisibleFreightCount(int baselineCount, int currentCount, boolean isolatedMissingRow) {
        int safeCurrent = Math.max(0, currentCount);
        int safeBaseline = Math.max(0, baselineCount);
        if (isolatedMissingRow && safeBaseline == safeCurrent + 1) return safeBaseline;
        return safeCurrent;
    }

    static boolean mayUseCurrentSessionVisualFreightProof(
        boolean waitingForFreight,
        boolean projectionActive,
        boolean authorizedCaptureSession,
        boolean packageMatchesGto,
        boolean packageUnknown,
        boolean permissionReturnFromNvu,
        int freightCount
    ) {
        if (!waitingForFreight || !projectionActive || !authorizedCaptureSession) return false;
        if (freightCount < 1 || freightCount > 6) return false;
        // A strict current-pixel GTO list is allowed to rebuild screen context even when
        // UsageStats still names another app. The action layer separately rejects NVU and
        // transient surfaces, so this bridge cannot authorize a touch by itself.
        return packageMatchesGto || packageUnknown || permissionReturnFromNvu;
    }

    static boolean mayUseVisualFreightProof(
        boolean waitingForFreight,
        boolean projectionActive,
        boolean packageMatchesGto,
        boolean packageUnknown,
        boolean permissionReturnFromNvu,
        int freightCount
    ) {
        if (!waitingForFreight || !projectionActive) return false;
        if (freightCount < 1 || freightCount > 6) return false;
        // Pixels may bridge a missing/stale UsageStats event only when Android has not
        // positively identified another foreground app, or during the bounded return
        // from the MediaProjection permission flow. A known non-GTO foreground app is
        // authoritative and pauses analysis.
        return packageMatchesGto || packageUnknown || permissionReturnFromNvu;
    }
}
