package com.nvu.operacional;

/**
 * Pure policy for deciding which state is allowed to invalidate the floating menu.
 *
 * The manual route picker is an interaction surface. Operation-context heartbeats and
 * backend ACK timestamps are not visible there and must not recreate its view tree.
 * Operation metadata becomes render-relevant only while the operation summary is expanded.
 */
final class GtoMenuRenderPolicy {
    static final String MODE_MANUAL_ROUTE = "MANUAL_ROUTE";
    static final String MODE_OPERATION_SUMMARY = "OPERATION_SUMMARY";
    static final String MODE_STANDARD = "STANDARD";

    private GtoMenuRenderPolicy() {}

    static String mode(boolean manualRoutePending, boolean operationSummaryExpanded) {
        if (manualRoutePending && !operationSummaryExpanded) return MODE_MANUAL_ROUTE;
        if (operationSummaryExpanded) return MODE_OPERATION_SUMMARY;
        return MODE_STANDARD;
    }

    static boolean operationMetadataAffectsMenu(
        boolean manualRoutePending,
        boolean operationSummaryExpanded
    ) {
        return operationSummaryExpanded;
    }

    static String manualRouteSignature(
        String tripState,
        boolean operationSummaryExpanded,
        String companyName,
        boolean pendingFreightReview,
        String routeStep,
        String selectedOrigin,
        boolean projectionActive,
        boolean projectionPermissionInFlight,
        boolean projectionSurfacePending
    ) {
        return "mode=" + MODE_MANUAL_ROUTE
            + "|state=" + safe(tripState)
            + "|expanded=" + safe(operationSummaryExpanded)
            + "|company=" + safe(companyName)
            + "|pendingReview=" + safe(pendingFreightReview)
            + "|routeStep=" + safe(routeStep)
            + "|selectedOrigin=" + safe(selectedOrigin)
            + "|projectionActive=" + safe(projectionActive)
            + "|projectionPermissionInFlight=" + safe(projectionPermissionInFlight)
            + "|projectionSurfacePending=" + safe(projectionSurfacePending);
    }

    static String base(String tripState, boolean operationSummaryExpanded, String companyName) {
        return "mode=" + mode(false, operationSummaryExpanded)
            + "|state=" + safe(tripState)
            + "|expanded=" + safe(operationSummaryExpanded)
            + "|company=" + safe(companyName);
    }

    static String safe(String value) {
        return value == null ? "" : value;
    }

    static String safe(boolean value) {
        return Boolean.toString(value);
    }
}
